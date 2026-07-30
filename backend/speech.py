"""
Speech module — voice input (STT) and text-to-speech (TTS).

Voice input uses faster-whisper for offline transcription (runs locally).
TTS uses gTTS (Google Text-to-Speech) with optional ElevenLabs fallback.

Install extras:
    pip install faster-whisper gtts
"""
from __future__ import annotations

import io
import os
import tempfile
import wave
from pathlib import Path
from typing import Optional

# ── Lazy imports (so the app loads even without these packages) ─────────

def _load_whisper():
    """Lazy-load faster-whisper model (heavy ~500MB download on first use)."""
    # Suppress harmless symlink warning on Windows
    os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        raise ImportError(
            "faster-whisper is not installed. Run: pip install faster-whisper"
        )
    model_size = os.environ.get("WHISPER_MODEL", "base")
    model = WhisperModel(model_size, device="cpu", compute_type="int8")
    return model


_whisper_model: Optional[object] = None


def transcribe_audio(audio_bytes: bytes) -> str:
    """
    Transcribe WAV audio bytes to text using faster-whisper.

    Accepts: raw WAV bytes (16-bit PCM, 16kHz mono recommended)
    Returns: transcribed text string
    """
    global _whisper_model
    if _whisper_model is None:
        _whisper_model = _load_whisper()

    # Write to a temp file (faster-whisper reads from disk)
    suffix = ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        segments, info = _whisper_model.transcribe(
            tmp_path,
            beam_size=5,
            language=None,  # auto-detect
            vad_filter=False,  # don't filter out short clips
        )
        text = " ".join(seg.text for seg in segments).strip()
        return text if text else "(could not transcribe audio)"
    finally:
        Path(tmp_path).unlink(missing_ok=True)


# ── Text-to-Speech ──────────────────────────────────────────────────────

def _clean_text_for_tts(text: str) -> str:
    """Strip markdown symbols so the voice reader doesn't read them aloud."""
    import re
    # Remove markdown headings ##, ###
    text = re.sub(r"#{1,6}\s*", "", text)
    # Remove bold/italic **text**, *text*, __text__
    text = re.sub(r"\*{1,3}|_{1,3}", "", text)
    # Remove inline code `code`
    text = re.sub(r"`+[^`]*`+", "", text)
    # Remove emoji and special unicode symbols
    text = re.sub(r"[^\x00-\x7F]+", " ", text)
    # Remove bullet dashes / numbering
    text = re.sub(r"^\s*[-*]\s+", "", text, flags=re.MULTILINE)
    # Remove URLs and search-query hints
    text = re.sub(r"https?://\S+", "", text)
    # Collapse multiple spaces/newlines
    text = re.sub(r"\n{2,}", ". ", text)
    text = re.sub(r"\s{2,}", " ", text)
    return text.strip()


def speak_text(text: str, lang: str = "en") -> bytes:
    """
    Convert text to speech using Google TTS (gTTS).
    Handles long AI responses by chunking into paragraphs and stitching MP3s.

    Returns: MP3 audio bytes.
    """
    try:
        from gtts import gTTS
    except ImportError:
        raise ImportError(
            "gtts is not installed. Run: pip install gtts"
        )

    # Strip markdown before speaking
    text = _clean_text_for_tts(text)

    if not text:
        return b""

    # gTTS can handle ~3000 chars per request reliably.
    # For very long AI answers, split into sentence-aware chunks.
    CHUNK_SIZE = 2500
    chunks = []
    while len(text) > CHUNK_SIZE:
        # Find last sentence boundary within CHUNK_SIZE
        cut = text.rfind(". ", 0, CHUNK_SIZE)
        if cut == -1:
            cut = CHUNK_SIZE
        else:
            cut += 1  # include the period
        chunks.append(text[:cut].strip())
        text = text[cut:].strip()
    if text:
        chunks.append(text)

    # Generate and concatenate MP3 audio for each chunk
    combined = io.BytesIO()
    for chunk in chunks:
        if not chunk:
            continue
        tts = gTTS(text=chunk, lang=lang, slow=False)
        buf = io.BytesIO()
        tts.write_to_fp(buf)
        buf.seek(0)
        combined.write(buf.read())

    combined.seek(0)
    return combined.read()


def speak_text_elevenlabs(text: str, voice_id: str = "21m00Tcm4TlvDq8ikWAM") -> bytes:
    """
    Higher-quality TTS via ElevenLabs API (requires ELEVENLABS_API_KEY in .env).

    Args:
        text: text to speak
        voice_id: ElevenLabs voice ID (default is Rachel)
    Returns: MP3 audio bytes
    """
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        # Fall back to gTTS
        return speak_text(text)

    import requests

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}"
    headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": api_key,
    }
    data = {
        "text": text[:1000],
        "model_id": "eleven_monolingual_v1",
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.5},
    }
    resp = requests.post(url, json=data, headers=headers, timeout=30)
    resp.raise_for_status()
    return resp.content

