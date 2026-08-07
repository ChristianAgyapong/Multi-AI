"""
Unified LLM client supporting multiple free/low-cost backends.

Providers (configured via .env → LLM_PROVIDER):
  - "ollama"   : Run local models via Ollama (completely free, unlimited)
                 Install: https://ollama.ai → `ollama pull llama3.2`
  - "gemini"   : Google Gemini API (generous free tier, 60 req/min)
                 Get key: https://aistudio.google.com
  - "openai"   : OpenAI-compatible APIs (OpenRouter, Groq, etc. — optional)
  - "anthropic": Claude (fallback, if you still have a key)

Usage:
    from backend.llm_client import get_client
    client = get_client()
    response = client.chat(system_prompt, messages, stream=False)
    for token in client.chat(system_prompt, messages, stream=True):
        print(token)
"""
from __future__ import annotations

import json
import os
import re
import time
from abc import ABC, abstractmethod
from typing import Generator

import requests

# Default generation temperature. A touch of warmth (0.5) makes the tutor feel
# more natural and creative, while structured outputs (quiz JSON) pass ~0.2.
DEFAULT_TEMPERATURE = float(os.environ.get("LLM_TEMPERATURE", "0.7"))

# Smarter fallback chain for OpenRouter. Free model availability changes, so
# the first entry is the OpenRouter "free" router which auto-picks an available
# free model. The rest are known-valid free variants as a safety net.
OPENROUTER_FALLBACK_MODELS = [
    "openrouter/free",
    "meta-llama/llama-3.3-70b-instruct:free",
    "google/gemma-4-26b-a4b-it:free",
    "deepseek/deepseek-chat:free",
    "qwen/qwen-2.5-72b-instruct:free",
]


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------

class LLMClient(ABC):
    """Interface all providers must implement."""

    @abstractmethod
    def chat(
        self,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int = 1024,
        stream: bool = False,
        temperature: float | None = None,
    ) -> str | Generator[str, None, None]:
        ...

    @property
    @abstractmethod
    def name(self) -> str:
        ...


# ---------------------------------------------------------------------------
# Ollama (local, free, unlimited)
# ---------------------------------------------------------------------------

OLLAMA_DEFAULT_MODEL = "llama3.2"  # 1.6B — very fast. Swap to "llama3.1", "mistral", "phi3", "gemma2"


class OllamaClient(LLMClient):
    def __init__(self, model: str = None, base_url: str = None):
        self.model = model or os.environ.get("OLLAMA_MODEL", OLLAMA_DEFAULT_MODEL)
        self.base_url = (base_url or os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434")).rstrip("/")

    @property
    def name(self) -> str:
        return f"ollama/{self.model}"

    def chat(
        self,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int = 1024,
        stream: bool = False,
        temperature: float | None = None,
    ) -> str | Generator[str, None, None]:
        # Build Ollama payload
        temperature = DEFAULT_TEMPERATURE if temperature is None else temperature
        ollama_messages = [{"role": "system", "content": system_prompt}]
        for m in messages:
            role = m["role"]
            content = m["content"]
            if isinstance(content, str):
                ollama_messages.append({"role": role, "content": content})
            elif isinstance(content, list):
                texts = []
                images = []
                for block in content:
                    if block.get("type") == "text":
                        texts.append(block["text"])
                    elif block.get("type") == "image":
                        source = block.get("source", {})
                        images.append(source.get("data", ""))
                msg = {"role": role, "content": "\n".join(texts)}
                if images:
                    msg["images"] = images
                ollama_messages.append(msg)

        payload = {
            "model": self.model,
            "messages": ollama_messages,
            "stream": stream,
            "options": {
                "num_predict": max_tokens,
                "temperature": temperature,
                "top_p": 1.0,
            },
        }

        if stream:
            return self._stream_response(payload)
        else:
            return self._non_stream_response(payload)

    def _non_stream_response(self, payload: dict) -> str:
        resp = requests.post(f"{self.base_url}/api/chat", json=payload, timeout=120)
        resp.raise_for_status()
        data = resp.json()
        return data.get("message", {}).get("content", "")

    def _stream_response(self, payload: dict) -> Generator[str, None, None]:
        with requests.post(f"{self.base_url}/api/chat", json=payload, stream=True, timeout=120) as resp:
            resp.raise_for_status()
            for line in resp.iter_lines():
                if line:
                    try:
                        chunk = json.loads(line)
                        if chunk.get("done"):
                            break
                        content = chunk.get("message", {}).get("content", "")
                        if content:
                            yield content
                    except json.JSONDecodeError:
                        continue

    @staticmethod
    def check_available() -> bool:
        """Return True if Ollama server is reachable."""
        try:
            resp = requests.get(f"{os.environ.get('OLLAMA_BASE_URL', 'http://localhost:11434')}/api/tags", timeout=3)
            return resp.status_code == 200
        except Exception:
            return False


# ---------------------------------------------------------------------------
# Google Gemini (free tier)
# ---------------------------------------------------------------------------

GEMINI_DEFAULT_MODEL = "gemini-2.0-flash"  # Free tier, fast, high quality


class GeminiClient(LLMClient):
    def __init__(self, model: str = None, api_key: str = None):
        self.model = model or os.environ.get("GEMINI_MODEL", GEMINI_DEFAULT_MODEL)
        self.api_key = api_key or os.environ.get("GEMINI_API_KEY", "")

    @property
    def name(self) -> str:
        return f"gemini/{self.model}"

    def chat(
        self,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int = 1024,
        stream: bool = False,
        temperature: float | None = None,
    ) -> str | Generator[str, None, None]:
        if not self.api_key:
            raise RuntimeError(
                "GEMINI_API_KEY is not set. Get a free key at https://aistudio.google.com"
            )
        temperature = DEFAULT_TEMPERATURE if temperature is None else temperature

        api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:{'streamGenerateContent' if stream else 'generateContent'}?key={self.api_key}"

        # Build Gemini-format contents
        gemini_contents = []
        for m in messages:
            content = m["content"]
            parts = []
            if isinstance(content, str):
                parts.append({"text": content})
            elif isinstance(content, list):
                for block in content:
                    if block.get("type") == "text":
                        parts.append({"text": block["text"]})
                    elif block.get("type") == "image_url":
                        # Parse data URL: data:image/jpeg;base64,.....
                        img_url = block.get("image_url", {}).get("url", "")
                        if img_url.startswith("data:"):
                            header, b64_data = img_url.split(",", 1)
                            mime_type = header.replace("data:", "").replace(";base64", "")
                            parts.append({
                                "inlineData": {
                                    "mimeType": mime_type,
                                    "data": b64_data
                                }
                            })
                    elif block.get("type") == "image":
                        source = block.get("source", {})
                        parts.append({
                            "inlineData": {
                                "mimeType": source.get("media_type", "image/jpeg"),
                                "data": source.get("data", "")
                            }
                        })
            gemini_contents.append({"role": self._map_role(m["role"]), "parts": parts})

        payload = {
            "system_instruction": {"parts": [{"text": system_prompt}]},
            "contents": gemini_contents,
            "generationConfig": {
                "maxOutputTokens": max_tokens,
                "temperature": temperature,
                "topP": 1.0,
            },
        }

        if stream:
            return self._stream_response(api_url, payload)
        else:
            return self._non_stream_response(api_url, payload)

    def _map_role(self, role: str) -> str:
        return "user" if role == "user" else "model"

    def _non_stream_response(self, url: str, payload: dict) -> str:
        resp = requests.post(url, json=payload, timeout=60)
        resp.raise_for_status()
        data = resp.json()
        candidates = data.get("candidates", [])
        if candidates:
            parts = candidates[0].get("content", {}).get("parts", [])
            return "".join(p.get("text", "") for p in parts)
        return ""

    def _stream_response(self, url: str, payload: dict) -> Generator[str, None, None]:
        with requests.post(url, json=payload, stream=True, timeout=60) as resp:
            resp.raise_for_status()
            buffer = ""
            for chunk in resp.iter_content(chunk_size=None):
                if chunk:
                    buffer += chunk.decode("utf-8", errors="ignore")
                    # Gemini SSE format: chunks are JSON objects separated by \n
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if line.startswith("data: "):
                            line = line[6:]
                        if line and line != "[DONE]":
                            try:
                                data = json.loads(line)
                                candidates = data.get("candidates", [])
                                if candidates:
                                    parts = candidates[0].get("content", {}).get("parts", [])
                                    text = "".join(p.get("text", "") for p in parts)
                                    if text:
                                        yield text
                            except json.JSONDecodeError:
                                continue


# ---------------------------------------------------------------------------
# OpenAI-compatible (OpenRouter, Groq, Together, etc.)
# ---------------------------------------------------------------------------

class OpenAIClient(LLMClient):
    # Models known to support vision/image inputs (OpenAI, Anthropic, etc.)
    # NOTE: Groq does NOT currently offer vision-capable models (as of 2026).
    # 'groq/compound' and 'groq/compound-mini' are NOT vision models and will 400 if sent images.
    VISION_MODELS = {
        "gpt-4o", "gpt-4o-mini", "gpt-4-vision-preview",
        "claude-3-opus-20240229", "claude-3-sonnet-20240229", "claude-3-haiku-20240307",
        "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022",
        "openrouter/free",
        "google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free",
        "nvidia/nemotron-nano-12b-v2-vl:free", "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
    }

    # Map of decommissioned models to recommended replacements
    DECOMMISSIONED_MODELS = {
        "llama-3.2-11b-vision-preview": "groq/compound-mini",
    }

    def __init__(self, model: str = None, api_key: str = None, base_url: str = None, fallback_models: list[str] | None = None):
        self.model = model or os.environ.get("OPENAI_MODEL", "gpt-3.5-turbo")
        self.api_key = api_key or os.environ.get("OPENAI_API_KEY", "")
        self.base_url = (base_url or os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")).rstrip("/")
        if fallback_models is None:
            env_fallback = os.environ.get("OPENAI_FALLBACK_MODELS", "")
            fallback_models = [m.strip() for m in env_fallback.split(",") if m.strip()]
        self.fallback_models = list(fallback_models or [])

    @property
    def name(self) -> str:
        return f"openai/{self.model}"

    def _supports_vision(self) -> bool:
        """Check if the current model supports vision/image inputs."""
        model_lower = self.model.lower()
        for vm in self.VISION_MODELS:
            if vm.lower() in model_lower or model_lower in vm.lower():
                return True
        if "gpt-4o" in model_lower or "gpt-4-vision" in model_lower:
            return True
        if "claude-3" in model_lower:
            return True
        if "gemini" in model_lower:
            return True
        if "vision" in model_lower:
            return True
        return False

    def chat(
        self,
        system_prompt: str,
        messages: list[dict],
        max_tokens: int = 1024,
        stream: bool = False,
        temperature: float | None = None,
    ) -> str | Generator[str, None, None]:
        if not self.api_key:
            raise RuntimeError("OPENAI_API_KEY is not set.")
        temperature = DEFAULT_TEMPERATURE if temperature is None else temperature

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

        supports_vision = self._supports_vision()
        is_groq = "groq.com" in self.base_url

        openai_messages = [{"role": "system", "content": system_prompt}]
        has_images = False
        for m in messages:
            content = m["content"]
            if isinstance(content, str):
                openai_messages.append({"role": m["role"], "content": content})
            elif isinstance(content, list):
                # Detect image blocks in both formats:
                # - OpenAI format: {"type": "image_url", "image_url": {"url": "data:..."}}
                # - Anthropic format (legacy): {"type": "image", "source": {...}}
                img_blocks = [b for b in content if b.get("type") in ("image", "image_url")]
                text_blocks = [b.get("text", "") for b in content if b.get("type") == "text"]
                has_images = bool(img_blocks)

                if has_images and supports_vision and not is_groq:
                    # Standard OpenAI/OpenRouter: pass image_url blocks directly
                    formatted_content = []
                    for block in content:
                        if block.get("type") == "text":
                            formatted_content.append({"type": "text", "text": block["text"]})
                        elif block.get("type") == "image_url":
                            # Already in correct OpenAI format — pass through
                            formatted_content.append(block)
                        elif block.get("type") == "image":
                            # Legacy Anthropic format — convert to OpenAI image_url
                            source = block.get("source", {})
                            media_type = source.get("media_type", "image/jpeg")
                            b64_data = source.get("data", "")
                            formatted_content.append({
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{media_type};base64,{b64_data}"
                                }
                            })
                    openai_messages.append({"role": m["role"], "content": formatted_content})
                elif has_images and supports_vision and is_groq:
                    # Groq: embed images inline as text (Groq has no vision API)
                    combined_parts = []
                    for block in content:
                        if block.get("type") == "text":
                            combined_parts.append(block["text"])
                        elif block.get("type") == "image_url":
                            url = block.get("image_url", {}).get("url", "")
                            combined_parts.append(f'[img:{url}]')
                        elif block.get("type") == "image":
                            source = block.get("source", {})
                            media_type = source.get("media_type", "image/jpeg")
                            b64_data = source.get("data", "")
                            combined_parts.append(f'[img:data:{media_type};base64,{b64_data}]')
                    openai_messages.append({"role": m["role"], "content": "\n".join(combined_parts)})
                elif has_images and not supports_vision:
                    combined_text = "\n".join(text_blocks)
                    combined_text += "\n\n[Note: An image was attached but this model does not support vision.]"
                    openai_messages.append({"role": m["role"], "content": combined_text})
                else:
                    openai_messages.append({"role": m["role"], "content": "\n".join(text_blocks)})

        payload = {
            "model": self.model,
            "messages": openai_messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
            "top_p": 0.9,
            "stream": stream,
        }

        if stream:
            return self._stream_response(headers, payload)
        else:
            return self._non_stream_response_with_fallback(headers, payload)

    def _non_stream_response_with_fallback(self, headers: dict, payload: dict) -> str:
        """Try the primary model, then each fallback model until we get a non-empty answer.

        Retries 429 rate-limit responses once with a short backoff before moving to
        the next fallback, and skips 404 model-not-found errors so valid fallbacks
        can be tried.
        """
        models = [self.model] + [m for m in self.fallback_models if m != self.model]
        last_err: Exception | None = None

        for i, model in enumerate(models):
            if i > 0:
                print(f"[LLM] Primary model failed/empty — retrying with fallback: {model}")
            payload["model"] = model

            for attempt in range(2):
                try:
                    result = self._non_stream_response(headers, payload)
                    if result and result.strip():
                        # Permanently upgrade to the working model for the rest of the session
                        if self.model != model:
                            print(f"[LLM] Model upgraded to: {model}")
                            self.model = model
                        return result
                    last_err = ValueError("Empty response from model")
                    break
                except requests.HTTPError as e:
                    last_err = e
                    status = e.response.status_code if e.response is not None else 0
                    # Auth errors won't be fixed by swapping models or waiting.
                    if status in (401, 403):
                        raise
                    if status == 429:
                        if attempt == 0:
                            print(f"[LLM] Rate limit (429) for {model}, retrying in 2s...")
                            time.sleep(2)
                            continue
                        print(f"[LLM] Rate limit persisted for {model}, trying next fallback.")
                        break
                    if status == 404:
                        # Model not found; keep trying the next fallback.
                        break
                except Exception as e:
                    last_err = e
                    break

        if isinstance(last_err, requests.HTTPError):
            status = last_err.response.status_code if last_err.response is not None else 0
            if status == 404:
                raise ValueError(
                    "No valid LLM model was found. If using OpenRouter, set OPENAI_MODEL to a valid "
                    "model ID such as 'openrouter/free' and ensure OPENAI_BASE_URL is https://openrouter.ai/api/v1."
                ) from last_err
            if status == 429:
                raise ValueError(
                    "All models are rate-limited. Free-tier providers have usage caps. "
                    "Wait a few seconds and retry, or upgrade/switch providers."
                ) from last_err

        raise last_err if last_err else ValueError("All models returned empty responses")

    def _handle_decommissioned(self, error_body: str) -> str | None:
        """Check if error is a decommissioned model and return replacement name."""
        if "decommissioned" in error_body.lower() or "no longer supported" in error_body.lower():
            model_lower = self.model.lower()
            for old_model, replacement in self.DECOMMISSIONED_MODELS.items():
                if old_model.lower() in model_lower or model_lower in old_model.lower():
                    print(f"Model '{self.model}' decommissioned. Falling back to '{replacement}'.")
                    return replacement
            return "llama-3.1-8b-instant"
        return None

    def _non_stream_response(self, headers: dict, payload: dict) -> str:
        resp = requests.post(f"{self.base_url}/chat/completions", json=payload, headers=headers, timeout=180)
        if resp.status_code == 400:
            try:
                err_body = resp.json().get("error", {}).get("message", "")
            except Exception:
                err_body = resp.text
            replacement = self._handle_decommissioned(err_body)
            if replacement:
                self.model = replacement
                payload["model"] = replacement
                print(f"  Retrying with model: {replacement}")
                resp = requests.post(f"{self.base_url}/chat/completions", json=payload, headers=headers, timeout=180)
        resp.raise_for_status()
        data = resp.json()
        choices = data.get("choices", [])
        if choices:
            return choices[0].get("message", {}).get("content", "")
        return ""

    def _stream_response(self, headers: dict, payload: dict) -> Generator[str, None, None]:
        resp = requests.post(f"{self.base_url}/chat/completions", json=payload, headers=headers, stream=True, timeout=300)
        if resp.status_code == 400:
            try:
                err_body = resp.json().get("error", {}).get("message", "")
            except Exception:
                err_body = ""
            replacement = self._handle_decommissioned(err_body)
            if replacement:
                self.model = replacement
                payload["model"] = replacement
                print(f"  Retrying stream with model: {replacement}")
                resp = requests.post(f"{self.base_url}/chat/completions", json=payload, headers=headers, stream=True, timeout=300)
        resp.raise_for_status()
        for line in resp.iter_lines():
            if line:
                line = line.decode("utf-8", errors="ignore")
                if line.startswith("data: "):
                    data_str = line[6:]
                    if data_str.strip() == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                        delta = data.get("choices", [{}])[0].get("delta", {})
                        content = delta.get("content", "")
                        if content:
                            yield content
                    except json.JSONDecodeError:
                        continue


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------

def _is_groq(base_url: str = None) -> bool:
    """Check if the given (or configured) base URL is a Groq endpoint."""
    url = base_url or os.environ.get("OPENAI_BASE_URL", "")
    return "groq.com" in url.lower()


def _get_vision_fallbacks(vision_base_url: str) -> list[str] | None:
    """Return the right fallback model chain for the configured vision provider."""
    env_fallback = os.environ.get("VISION_FALLBACK_MODELS") or os.environ.get("OPENROUTER_FALLBACK_MODELS")
    if env_fallback:
        return [m.strip() for m in env_fallback.split(",") if m.strip()]
    if "openrouter.ai" in (vision_base_url or "").lower():
        return OPENROUTER_FALLBACK_MODELS
    env_primary_fallback = os.environ.get("OPENAI_FALLBACK_MODELS", "")
    if env_primary_fallback:
        return [m.strip() for m in env_primary_fallback.split(",") if m.strip()]
    return None


def get_client(require_vision: bool = False) -> LLMClient:
    """Return the appropriate LLM client based on environment configuration.

    Supports a DUAL-PROVIDER setup for maximum speed + vision/document capability:
      - OPENAI_* / GROQ : Primary provider for fast text chat
      - VISION_API_KEY / OPENROUTER_* : Separate provider for image + document analysis

    When `require_vision=True` and a vision/OpenRouter key is set, always routes to
    the dedicated vision provider regardless of the primary provider.

    Providers:
      - "ollama"    : Local Ollama (completely free, unlimited)
      - "gemini"    : Google Gemini API (free tier)
      - "openai"    : OpenAI-compatible (Groq, OpenRouter, Together, etc.)
      - "anthropic" : Anthropic Claude (fallback)
    """
    provider = os.environ.get("LLM_PROVIDER", "").strip().lower()

    if require_vision:
        # --- Priority 1: Dedicated vision provider (VISION_* or OPENROUTER_* aliases) ---
        vision_api_key = os.environ.get("VISION_API_KEY") or os.environ.get("OPENROUTER_API_KEY")
        vision_base_url = os.environ.get("VISION_BASE_URL") or os.environ.get("OPENROUTER_BASE_URL")
        vision_model = (
            os.environ.get("VISION_MODEL")
            or os.environ.get("OPENROUTER_MODEL")
            or "google/gemma-4-26b-a4b-it:free"
        )
        if vision_api_key and vision_base_url:
            print(f"[LLM] Image/document request -> vision provider: {vision_base_url} model: {vision_model}")
            fallback_models = _get_vision_fallbacks(vision_base_url)
            return OpenAIClient(
                model=vision_model,
                api_key=vision_api_key,
                base_url=vision_base_url,
                fallback_models=fallback_models,
            )

        # --- Priority 2: Primary provider if it's NOT Groq ---
        is_groq_primary = (provider == "openai" and _is_groq())
        if provider == "openai" and not is_groq_primary:
            vision_model = os.environ.get("OPENAI_VISION_MODEL", "google/gemma-4-26b-a4b-it:free")
            print(f"[LLM] Image/document request -> using vision model: {vision_model}")
            return OpenAIClient(
                model=vision_model,
                api_key=os.environ.get("OPENAI_API_KEY"),
                base_url=os.environ.get("OPENAI_BASE_URL"),
                fallback_models=_get_vision_fallbacks(os.environ.get("OPENAI_BASE_URL", "")),
            )

        # --- Priority 3: Gemini (native vision support) ---
        if os.environ.get("GEMINI_API_KEY"):
            print("[LLM] Using Gemini for vision.")
            return GeminiClient()

        # --- Priority 4: Ollama ---
        if OllamaClient.check_available():
            print("[LLM] Using Ollama for vision.")
            return OllamaClient()

        # --- Priority 5: Fall back to primary even if it's Groq ---
        print("[LLM] No dedicated vision backend — using primary provider (vision may not work).")
        return OpenAIClient(
            model=os.environ.get("OPENAI_VISION_MODEL", os.environ.get("OPENAI_MODEL", "gpt-4o-mini")),
            api_key=os.environ.get("OPENAI_API_KEY"),
            base_url=os.environ.get("OPENAI_BASE_URL"),
        )

    # --- Non-vision path ---
    if provider == "ollama":
        if OllamaClient.check_available():
            return OllamaClient()
        else:
            print("[LLM] Ollama not reachable; falling back to OpenAI.")
            return OpenAIClient()
    elif provider == "gemini":
        return GeminiClient()
    elif provider == "openai":
        # Attach the smarter fallback chain automatically for OpenRouter users
        is_openrouter = "openrouter.ai" in os.environ.get("OPENAI_BASE_URL", "").lower()
        if is_openrouter:
            # Default to the auto-selecting free router if the user hasn't set a model
            model = os.environ.get("OPENAI_MODEL") or "openrouter/free"
            return OpenAIClient(model=model, fallback_models=OPENROUTER_FALLBACK_MODELS)
        return OpenAIClient()
    elif provider == "anthropic":
        return OpenAIClient(
            model=os.environ.get("ANTHROPIC_MODEL", "claude-3-haiku-20240307"),
            api_key=os.environ.get("ANTHROPIC_API_KEY", ""),
            base_url=os.environ.get("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1"),
        )
    else:
        # Auto-detect: prefer Ollama if available, else OpenAI
        if OllamaClient.check_available():
            print("[LLM] Auto-detected Ollama (use LLM_PROVIDER=openai to override).")
            return OllamaClient()
        is_openrouter = "openrouter.ai" in os.environ.get("OPENAI_BASE_URL", "").lower()
        if is_openrouter:
            model = os.environ.get("OPENAI_MODEL") or "openrouter/free"
            print(f"[LLM] Auto-detected OpenRouter. Using model: {model}")
            return OpenAIClient(model=model, fallback_models=OPENROUTER_FALLBACK_MODELS)
        print("[LLM] Using OpenAI-compatible client (set LLM_PROVIDER=ollama for local).")
        return OpenAIClient()


