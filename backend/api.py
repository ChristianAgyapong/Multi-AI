"""
Production-ready FastAPI wrapper with:
- Per-session MaterialStore (keyed by X-Session-Id header)
- Per-session StudentModel for knowledge tracing
- Streaming endpoint (SSE) for real-time tutor responses
- TTS endpoint for text-to-speech
- CORS middleware for cross-origin frontends
- Request logging middleware
- Rate-limiting stub

Run with: uvicorn backend.api:app --reload
"""
from __future__ import annotations

import base64
import json
import time
import uuid
import os
from typing import Any

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from backend.cache import get_cache_stats
from backend.quiz import generate_quiz
from backend.rag import MaterialStore, extract_text_from_docx, extract_text_from_pdf
from backend.tutor_engine import ask_tutor, ask_tutor_stream, run_debate_round, AGENT_MODES, DEFAULT_AGENT_MODE
from backend.knowledge_tracer import StudentModel, adapt_quiz_difficulty

# Lazy TTS import
try:
    from backend.speech import speak_text
    HAS_TTS = True
except ImportError:
    HAS_TTS = False
    def speak_text(text: str, lang: str = "en") -> bytes:
        raise NotImplementedError("gTTS not installed. Run: pip install gtts")


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="Multimodal AI Tutor API",
    version="2.0.0",
    docs_url="/docs",
)

# CORS — allow configurable origins for production.
# Set CORS_ORIGINS to a comma-separated list of allowed origins, e.g.:
#   CORS_ORIGINS=https://my-app.onrender.com,https://my-frontend.vercel.app
# If unset, defaults to ["*"] (allow any origin — fine for local dev).
_cors_origins_env = os.environ.get("CORS_ORIGINS", "").strip()
if _cors_origins_env:
    _cors_origins = [o.strip() for o in _cors_origins_env.split(",") if o.strip()]
else:
    _cors_origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Per-session stores (MaterialStore + StudentModel)
# ---------------------------------------------------------------------------
_sessions: dict[str, MaterialStore] = {}
_student_models: dict[str, StudentModel] = {}


def _get_store(session_id: str) -> MaterialStore:
    if session_id not in _sessions:
        _sessions[session_id] = MaterialStore()
    return _sessions[session_id]


def _get_student_model(session_id: str) -> StudentModel:
    if session_id not in _student_models:
        _student_models[session_id] = StudentModel()
    return _student_models[session_id]


def _get_session_id(request: Request) -> str:
    sid = request.headers.get("X-Session-Id")
    if not sid:
        sid = request.cookies.get("session_id")
    if not sid:
        sid = str(uuid.uuid4())
    return sid


# ---------------------------------------------------------------------------
# Request logging middleware
# ---------------------------------------------------------------------------
@app.middleware("http")
async def log_requests(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    elapsed = time.perf_counter() - start
    print(
        f"[API] {request.method} {request.url.path} -> "
        f"{response.status_code} in {elapsed:.3f}s"
    )
    return response


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------
class AskRequest(BaseModel):
    question: str
    image_base64: str | None = None
    image_media_type: str | None = None
    use_context: bool = True
    textbook_mode: bool = False
    stream: bool = False
    agent_mode: str = DEFAULT_AGENT_MODE
    history: list[dict] | None = None


class QuizRequest(BaseModel):
    topic: str
    num_questions: int = Field(default=5, ge=1, le=25)
    use_context: bool = True
    session_id: str | None = None
    difficulty: str | None = None


class TTSRequest(BaseModel):
    text: str


class FlashcardsGenerateRequest(BaseModel):
    text: str


class DebateRequest(BaseModel):
    topic: str
    student_correction: str | None = None
    fellow_student_history: list[dict] = []
    tutor_history: list[dict] = []


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.post("/ask")
def ask(req: AskRequest, request: Request):
    sid = _get_session_id(request)
    store = _get_store(sid)
    student_model = _get_student_model(sid)
    student_model.record_question(req.question)

    image_bytes = base64.b64decode(req.image_base64) if req.image_base64 else None
    context_chunks = store.retrieve(req.question) if req.use_context else None

    answer = ask_tutor(
        req.question,
        image_bytes=image_bytes,
        image_media_type=req.image_media_type,
        context_chunks=context_chunks,
        history=req.history,
        agent_mode=req.agent_mode,
        student_model_summary=student_model.get_summary(),
    )
    return {"answer": answer, "session_id": sid}


@app.post("/ask/stream")
async def ask_stream(req: AskRequest, request: Request):
    sid = _get_session_id(request)
    store = _get_store(sid)
    student_model = _get_student_model(sid)
    student_model.record_question(req.question)

    image_bytes = base64.b64decode(req.image_base64) if req.image_base64 else None
    context_chunks = store.retrieve(req.question) if req.use_context else None

    async def event_stream():
        import asyncio

        loop = asyncio.get_event_loop()

        # Use an asyncio.Queue to stream tokens in real-time from the sync generator
        queue: asyncio.Queue = asyncio.Queue()

        def worker():
            """Run the sync generator and push each token to the queue immediately.

            On a 429 rate-limit error, retry the stream once after a short backoff,
            then fall back to the non-streaming path (which has multi-model fallbacks).
            """
            stream_errors = []
            for attempt in range(2):
                try:
                    for token in ask_tutor_stream(
                        req.question,
                        image_bytes=image_bytes,
                        image_media_type=req.image_media_type,
                        context_chunks=context_chunks,
                        history=req.history,
                        agent_mode=req.agent_mode,
                        student_model_summary=student_model.get_summary(),
                    ):
                        asyncio.run_coroutine_threadsafe(queue.put(("token", token)), loop)
                    asyncio.run_coroutine_threadsafe(queue.put(("done", None)), loop)
                    return
                except Exception as e:
                    error_text = str(e)
                    stream_errors.append(error_text)
                    if "429" in error_text and attempt == 0:
                        print("[LLM] Stream rate-limited (429), retrying in 2s...")
                        time.sleep(2)
                        continue
                    break

            # Fall back to non-streaming; it has model fallbacks and 429 retry logic.
            try:
                answer = ask_tutor(
                    req.question,
                    image_bytes=image_bytes,
                    image_media_type=req.image_media_type,
                    context_chunks=context_chunks,
                    history=req.history,
                    agent_mode=req.agent_mode,
                    student_model_summary=student_model.get_summary(),
                )
                if answer:
                    asyncio.run_coroutine_threadsafe(queue.put(("token", answer)), loop)
                asyncio.run_coroutine_threadsafe(queue.put(("done", None)), loop)
                return
            except Exception as fallback_err:
                error_text = str(fallback_err)

            if "429" in error_text or any("429" in err for err in stream_errors):
                error_text = "Service is busy - Rate limit exceeded. Please wait a moment."
            elif "Connection" in error_text or "refused" in error_text:
                error_text = ("Cannot connect to the AI backend. "
                              "If using Ollama, run: ollama serve. "
                              "If using Gemini/OpenAI, check your API key in .env")
            asyncio.run_coroutine_threadsafe(
                queue.put(("error", f"\n\n**{error_text}**")), loop
            )
            asyncio.run_coroutine_threadsafe(queue.put(("done", None)), loop)

        try:
            # Send session ID first
            session_msg = json.dumps({"type": "session", "session_id": sid})
            yield f"data: {session_msg}\n\n"

            # Start the worker in a thread pool
            loop.run_in_executor(None, worker)

            # Read from the queue and yield tokens as they arrive (true streaming)
            while True:
                msg_type, payload = await queue.get()
                if msg_type == "done":
                    break
                elif msg_type == "token" and payload:
                    token_msg = json.dumps({"type": "token", "text": payload})
                    yield f"data: {token_msg}\n\n"
                elif msg_type == "error":
                    error_data = json.dumps({"type": "token", "text": payload})
                    yield f"data: {error_data}\n\n"

            done_msg = json.dumps({"type": "done"})
            yield f"data: {done_msg}\n\n"

        except Exception as e:
            err_msg = str(e)
            if "429" in err_msg:
                err_msg = "Service is busy - Rate limit exceeded. Please wait a moment."
            elif "Connection" in err_msg or "refused" in err_msg:
                err_msg = ("Cannot connect to the AI backend. "
                           "If using Ollama, run: ollama serve. "
                           "If using Gemini/OpenAI, check your API key in .env")
            error_data = json.dumps({"type": "token", "text": f"\n\n**{err_msg}**"})
            yield f"data: {error_data}\n\n"
            done = json.dumps({"type": "done"})
            yield f"data: {done}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/quiz")
def quiz(req: QuizRequest, request: Request):
    sid = _get_session_id(request)
    store = _get_store(sid)
    student_model = _get_student_model(sid)

    context_chunks = store.retrieve(req.topic, top_k=5) if req.use_context else None

    if req.difficulty:
        raw = req.difficulty.strip().lower()
        difficulty = {"basic": "easy", "easy": "easy", "medium": "standard", "standard": "standard", "hard": "hard"}.get(raw, "standard")
    else:
        difficulty = adapt_quiz_difficulty(student_model, req.topic)

    try:
        result = generate_quiz(
            req.topic,
            num_questions=req.num_questions,
            context_chunks=context_chunks,
            difficulty=difficulty,
        )
        return {"quiz": result, "session_id": sid, "difficulty": difficulty}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/materials")
async def upload_material(file: UploadFile, request: Request):
    sid = _get_session_id(request)
    store = _get_store(sid)

    file_bytes = await file.read()
    if file.filename and file.filename.endswith(".pdf"):
        text = extract_text_from_pdf(file_bytes)
    elif file.filename and file.filename.endswith(".docx"):
        text = extract_text_from_docx(file_bytes)
    elif file.filename and file.filename.endswith((".ppt", ".pptx")):
        from backend.rag import extract_text_from_pptx
        text = extract_text_from_pptx(file_bytes)
    else:
        text = file_bytes.decode("utf-8", errors="ignore")

    n_chunks = store.add_document(file.filename or "unknown", text)
    return {"filename": file.filename, "chunks_added": n_chunks, "session_id": sid}


@app.delete("/materials")
def delete_material(filename: str = "", request: Request = None):
    """Remove a single source document from the session RAG store."""
    sid = _get_session_id(request)
    store = _get_store(sid)

    if not filename:
        raise HTTPException(status_code=400, detail="filename query parameter is required")

    removed = store.remove_document(filename)
    if removed == 0:
        raise HTTPException(status_code=404, detail=f"Material '{filename}' not found")

    return {"filename": filename, "chunks_removed": removed, "session_id": sid}


@app.get("/materials")
def list_materials(request: Request):
    sid = _get_session_id(request)
    store = _get_store(sid)
    stats = store.get_stats()
    return {"sources": stats["sources"], "total_chunks": stats["total_chunks"], "session_id": sid}


@app.get("/cache/stats")
def cache_stats():
    return get_cache_stats()


@app.get("/flashcards")
def get_flashcards(request: Request):
    sid = _get_session_id(request)
    student = _get_student_model(sid)
    return {"flashcards": student.flashcards}


@app.post("/flashcards/generate")
def api_generate_flashcards(req: FlashcardsGenerateRequest, request: Request):
    sid = _get_session_id(request)
    student = _get_student_model(sid)

    from backend.quiz import generate_flashcards
    try:
        new_cards = generate_flashcards(req.text)
        # Deduplicate and append
        existing = {f["front"].lower(): f for f in student.flashcards}
        added_count = 0
        for card in new_cards:
            if card["front"].lower() not in existing:
                student.flashcards.append(card)
                added_count += 1

        student.save_to_disk()
        return {"flashcards": student.flashcards, "added_count": added_count}
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.post("/debate")
def debate(req: DebateRequest, request: Request):
    """
    Dual-agent Feynman Technique endpoint.
    Returns responses from both the Fellow Student (wrong) and Tutor Grader.
    """
    sid = _get_session_id(request)
    student = _get_student_model(sid)
    try:
        result = run_debate_round(
            topic=req.topic,
            student_correction=req.student_correction,
            fellow_student_history=req.fellow_student_history,
            tutor_history=req.tutor_history,
            student_model_summary=student.get_summary(),
        )
        return {**result, "session_id": sid}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/tts")
def text_to_speech(req: TTSRequest, request: Request):
    if not HAS_TTS:
        raise HTTPException(status_code=501, detail="TTS unavailable. Install: pip install gtts")
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    try:
        audio_bytes = speak_text(req.text.strip()[:500])
        return StreamingResponse(
            iter([audio_bytes]),
            media_type="audio/mpeg",
            headers={"Content-Disposition": "inline; filename=tts.mp3", "Cache-Control": "no-cache"},
        )
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS failed: {e}")


@app.post("/transcribe")
async def transcribe(audio: UploadFile):
    try:
        from backend.speech import transcribe_audio
    except ImportError:
        raise HTTPException(status_code=501, detail="Speech-to-text unavailable. Install faster-whisper.")

    try:
        audio_bytes = await audio.read()
        text = transcribe_audio(audio_bytes)
        return {"text": text}
    except NotImplementedError as e:
        raise HTTPException(status_code=501, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {e}")


@app.get("/student/profile")
def student_profile(request: Request):
    sid = _get_session_id(request)
    student_model = _get_student_model(sid)
    summary = student_model.get_summary()
    return {
        "session_id": sid,
        "interaction_count": student_model.interaction_count,
        "summary": summary,
        "topics": {
            topic: {
                "questions_asked": stats.questions_asked,
                "quiz_accuracy": stats.quiz_accuracy,
                "mastery_level": stats.mastery_level,
            }
            for topic, stats in student_model.topic_stats.items()
        },
    }


@app.get("/health")
def health():
    return {"status": "ok", "version": "2.0.0"}


@app.get("/provider/status")
def provider_status():
    """Return LLM provider connection status for the sidebar."""
    from backend.llm_client import OllamaClient
    provider = os.environ.get("LLM_PROVIDER", "").strip().lower()

    if not provider or provider == "ollama":
        ollama_running = OllamaClient.check_available()
        if ollama_running:
            return {
                "provider": "ollama",
                "connected": True,
                "models": [],
                "model_count": 0,
            }
        else:
            return {"provider": "ollama", "connected": False, "models": [], "model_count": 0, "message": "Ollama not running. Install from https://ollama.ai"}

    if provider == "gemini":
        api_key = os.environ.get("GEMINI_API_KEY")
        return {
            "provider": "gemini",
            "connected": bool(api_key),
            "message": "Gemini API key found" if api_key else "GEMINI_API_KEY not set. Get a free key at https://aistudio.google.com",
        }

    if provider == "openai":
        api_key = os.environ.get("OPENAI_API_KEY")
        return {
            "provider": "openai",
            "connected": bool(api_key),
            "message": "OpenAI API key found" if api_key else "OPENAI_API_KEY not set",
        }

    if provider == "anthropic":
        api_key = os.environ.get("ANTHROPIC_API_KEY")
        return {
            "provider": "anthropic",
            "connected": bool(api_key),
            "message": "Anthropic API key found" if api_key else "ANTHROPIC_API_KEY not set",
        }

    return {"provider": provider or "none", "connected": False, "message": "No provider configured"}


# ---------------------------------------------------------------------------
# Static frontend (legacy vanilla-JS UI — optional)
# ---------------------------------------------------------------------------
# Serve the legacy `frontend/` directory ONLY when SERVE_FRONTEND=1.
# Production API deployments (e.g. Render) can set SERVE_FRONTEND=0 (default)
# to expose a pure JSON API. When the Next.js frontend is ready, it will talk
# to this API via CORS.
_serve_frontend = os.environ.get("SERVE_FRONTEND", "0").strip().lower() in (
    "1", "true", "yes", "on"
)

if _serve_frontend and os.path.exists("frontend"):
    app.mount("/static", StaticFiles(directory="frontend"), name="static")

    @app.get("/")
    async def serve_frontend():
        return FileResponse("frontend/index.html")
else:
    @app.get("/")
    async def api_root():
        """API root — shows service info and available docs."""
        return {
            "service": "Multimodal AI Tutor API",
            "version": "2.0.0",
            "status": "ok",
            "docs": "/docs",
            "health": "/health",
            "frontend": "Not served (set SERVE_FRONTEND=1 to enable the legacy UI)",
        }
