"""
Quiz generation. Uses the unified LLM client (backend/llm_client.py) to
produce a structured JSON quiz (grounded in retrieved course material when
available) and parses it into a Python object the frontend can render.

Works with any provider: Ollama (free), Gemini (free), OpenAI-compatible, etc.
"""
from __future__ import annotations

import json
import re

from backend.llm_client import get_client

QUIZ_SYSTEM_PROMPT = """You are a quiz generator. Respond with ONLY a valid JSON object.
No preamble, no explanation, no code fences, no commentary before or after.
Do not include any thinking or reasoning in your response.

The JSON must match this exact structure:
{
  "topic": "string",
  "questions": [
    {
      "question": "string",
      "options": ["string", "string", "string", "string"],
      "correct_index": 0,
      "explanation": "string"
    }
  ]
}
"""


def _extract_and_clean_json(text: str) -> str:
    """
    Extract valid JSON from model output that may contain:
    - Reasoning/thinking blocks
    - Markdown code fences (```json ... ```)
    - Preamble text before/after
    """
    text = text.strip()

    # Remove think blocks (used by DeepSeek, Qwen, etc.)
    text = re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL)
    
    # Remove markdown code fences
    text = re.sub(r'```(?:json)?\s*', '', text)
    text = re.sub(r'\s*```', '', text)

    # Find the LAST complete balanced JSON object using brace-depth tracking
    # This correctly handles multiple JSON blocks (drafts, thinking, final)
    brace_depth = 0
    last_json_start = -1
    last_json_end = -1

    for i, ch in enumerate(text):
        if ch == '{':
            if brace_depth == 0:
                last_json_start = i
            brace_depth += 1
        elif ch == '}':
            brace_depth -= 1
            if brace_depth == 0:
                last_json_end = i
        # Reset if malformed
        if brace_depth < 0:
            brace_depth = 0

    if last_json_start >= 0 and last_json_end > last_json_start:
        return text[last_json_start:last_json_end + 1]

    # Fallback: simple outermost extraction
    start = text.find('{')
    end = text.rfind('}')
    if start >= 0 and end >= 0 and end > start:
        return text[start:end + 1]

    return text


def generate_quiz(
    topic: str,
    num_questions: int = 5,
    context_chunks: list[dict] | None = None,
    difficulty: str = "standard",
) -> dict:
    """Generate a quiz on `topic`. Returns a dict matching QUIZ_SYSTEM_PROMPT's
    schema. Raises ValueError if the model's output can't be parsed as JSON."""
    llm = get_client()

    difficulty_prompt = ""
    if difficulty == "easy":
        difficulty_prompt = "Make the questions foundational and straightforward. Use simple language and obvious distractors."
    elif difficulty == "hard":
        difficulty_prompt = "Make the questions challenging. Use nuanced distractors, multi-step reasoning, and edge cases."

    prompt = f"Generate a {num_questions}-question multiple-choice quiz on: {topic}."
    if difficulty_prompt:
        prompt += f"\n\nDifficulty: {difficulty_prompt}"
    if context_chunks:
        context_str = "\n\n".join(
            f"[From {c['source']}]: {c['text']}" for c in context_chunks
        )
        prompt += (
            f"\n\nBase the questions on this course material where relevant:\n"
            f"{context_str}"
        )

    try:
        result = llm.chat(
            system_prompt=QUIZ_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=4096,
            stream=False,
        )
    except Exception as e:
        raise ValueError(f"Failed to contact LLM for quiz generation: {e}") from e

    raw_text = result if isinstance(result, str) else ""
    if not raw_text:
        raise ValueError("Empty response from LLM")

    cleaned = _extract_and_clean_json(raw_text)

    try:
        quiz_data = json.loads(cleaned)
        if "questions" not in quiz_data or not isinstance(quiz_data["questions"], list):
            raise ValueError("Missing 'questions' array in generated quiz")
        return quiz_data
    except json.JSONDecodeError as e:
        raise ValueError(
            f"Couldn't parse quiz JSON from model output: {e}\nRaw output:\n{raw_text}"
        ) from e


FLASHCARD_SYSTEM_PROMPT = """You are a flashcard generator. Respond with ONLY a valid JSON array.
No preamble, no explanation, no code fences, no commentary.

Extract exactly 3-5 of the most important terms or concepts from the text provided.
Format the response EXACTLY like this:
[
  {
    "front": "Term or short question",
    "back": "Short, clear definition or answer (1-2 sentences)"
  }
]
"""


def generate_flashcards(text: str) -> list[dict]:
    """Generate flashcards from a text snippet. Returns a list of dicts with 'front' and 'back'."""
    llm = get_client()

    # Limit input to avoid token overflow
    text_snippet = text[:3000]

    prompt = f"Extract 3-5 key academic terms from the following text and create flashcards:\n\n{text_snippet}"

    try:
        result = llm.chat(
            system_prompt=FLASHCARD_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=512,
            stream=False,
        )
    except Exception as e:
        raise ValueError(f"Failed to contact LLM for flashcard generation: {e}") from e

    raw_text = result if isinstance(result, str) else ""
    if not raw_text:
        raise ValueError("Empty response from LLM")

    # Strip any markdown fences and think blocks
    cleaned = re.sub(r'<think>.*?</think>', '', raw_text, flags=re.DOTALL)
    cleaned = re.sub(r'```(?:json)?', '', cleaned)
    cleaned = cleaned.strip()

    # Extract the JSON array
    start = cleaned.find('[')
    end = cleaned.rfind(']')
    if start >= 0 and end > start:
        cleaned = cleaned[start:end + 1]

    try:
        cards = json.loads(cleaned)
        if not isinstance(cards, list):
            raise ValueError("Expected a JSON array of flashcards")
        return cards
    except json.JSONDecodeError as e:
        raise ValueError(
            f"Couldn't parse flashcard JSON: {e}\nRaw output:\n{raw_text}"
        ) from e
