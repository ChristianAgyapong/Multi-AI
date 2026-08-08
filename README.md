# Multimodal AI Tutor — MVP

A working prototype of a multimodal AI tutoring system: students can ask
questions in text, upload a photo of handwritten work or a diagram, upload
course material (PDF/TXT/DOCX) for grounded answers (RAG), and get an
auto-generated quiz on any topic.




Built to match the "Start Small → Scale" path, and now upgraded with advanced features:
- **Unified LLM Support**: Use Ollama (free/local), Gemini (free tier), OpenAI, or Anthropic.
- **Frontend**: Streamlit for a fast interactive multimodal UI.
- **RAG**: Embedding-based retrieval using `sentence-transformers` for deep semantic search over uploaded course materials.
- **Agent Modes**: Switch between Tutor, Quiz Master, Socratic Peer, or Debugger modes.
- **Knowledge Tracing**: Tracks student progress per topic and adapts quiz difficulty.
- **Voice Capabilities**: Optional Speech-to-Text (`faster-whisper`) and Text-to-Speech (`gTTS`).
- **Caching & Streaming**: SQLite-backed caching for speed and streaming responses for real-time engagement.

## Directory structure

```
multimodal-edu-tutor/
├── README.md                  # This file
├── requirements.txt           # Python dependencies
├── .env.example               # Copy to .env and configure your LLM provider
├── app.py                     # Streamlit UI — entry point
├── backend/
│   ├── __init__.py
│   ├── tutor_engine.py        # Core tutoring logic and prompt orchestration
│   ├── llm_client.py          # Unified LLM client (Ollama/Gemini/OpenAI/Anthropic)
│   ├── rag.py                 # Embedding-based RAG using sentence-transformers
│   ├── quiz.py                # Quiz generation (structured JSON output)
│   ├── knowledge_tracer.py    # Student modeling and topic tracking
│   ├── speech.py              # STT and TTS capabilities
│   ├── cache.py               # SQLite-based Q&A caching
│   └── api.py                 # Optional FastAPI wrapper for production
├── data/
│   └── sample_materials/      # Drop PDFs/TXTs/DOCXs here for RAG grounding
└── frontend_assets/           # (reserved for custom CSS/JS if needed)
```

## Setup

```bash
cd multimodal-edu-tutor
python3 -m venv venv
source venv/Scripts/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env              # then edit .env and configure your provider
```

### Choosing an LLM Provider
This project supports multiple providers. In your `.env` file, set `LLM_PROVIDER`:
- **Ollama** (Free, Local, Unlimited): `LLM_PROVIDER=ollama`
- **Google Gemini** (Free tier): `LLM_PROVIDER=gemini` and set `GEMINI_API_KEY`
- **OpenAI-Compatible** (OpenRouter/Groq): `LLM_PROVIDER=openai` and set `OPENAI_API_KEY`
- **Anthropic**: `LLM_PROVIDER=anthropic` and set `ANTHROPIC_API_KEY`

## Run it

```bash
streamlit run app.py
```

Opens at `http://localhost:8501`. You can:

1. **Chat** — ask a question in text.
2. **Upload an image** — a photo of handwritten math, a diagram, a graph — the tutor reads it.
3. **Upload course material** (PDF/TXT/DOCX) in the sidebar — answers get grounded in that material using embedding-based RAG.
4. **Generate a quiz** — type a topic, get N auto-generated questions with an answer key, adapted to your past performance.
5. **Listen** — click "Read Aloud" to hear the tutor's response via Text-To-Speech.

## Next steps (per the "Advanced/Production" roadmap)

- **Persistent Vector DB**: Replace the in-memory `MaterialStore` with Chroma or pgvector for cross-session persistence.
- **Persistent User Profiles**: Save the `StudentModel` to a database to track student progress over time.
- **LMS integration**: Wrap `backend/api.py` (FastAPI) as a proper service and call it from Moodle/D2L via LTI.
- **Custom Web App Frontend**: Replace Streamlit with a modern React/Vanilla JS web app communicating with `backend/api.py` for full control over aesthetics and UI flow.

## Known limitations of this MVP

- RAG index and user profiles are stored in-memory (or session state). Data is lost when the app reloads.
- Voice/Speech capabilities require optional packages that may be heavy to install (`faster-whisper`).

---

## Deploy the Backend to Render

The FastAPI backend (`backend/api.py`) is production-ready and can be deployed to
[Render](https://render.com) as a free web service.

### What gets deployed

A single web service serving the full JSON API plus (optionally) the legacy
vanilla-JS UI at the root as a stopgap while the Next.js frontend is built:

| Route          | Description                                            |
| -------------- | ------------------------------------------------------ |
| `/ask`         | Non-streaming tutor answer                             |
| `/ask/stream`  | SSE streaming tutor answer (used by the chat UI)       |
| `/quiz`        | Generate an MCQ quiz on a topic                        |
| `/materials`   | Upload / list course material (RAG) for a session      |
| `/flashcards`  | List / generate flashcards                             |
| `/debate`      | Dual-agent Feynman-technique debate                    |
| `/tts`         | Text-to-speech (needs `gtts` enabled)                  |
| `/transcribe`  | Speech-to-text (needs `faster-whisper` enabled)        |
| `/health`      | Health check for Render                                |
| `/provider/status` | LLM provider connection status                     |
| `/docs`        | Interactive Swagger docs                               |

### Deploy via Render Blueprint (recommended)

A `render.yaml` blueprint is included, so Render auto-creates the service:

1. Push this repo to GitHub.
2. Go to [dashboard.render.com](https://dashboard.render.com) → **New +** → **Blueprint**.
3. Select this repository. Render detects `render.yaml` and creates the service.
4. In the service dashboard, set your **LLM provider env vars**:
   - `LLM_PROVIDER=gemini` and `GEMINI_API_KEY=<your free key>` (recommended), **or**
   - `LLM_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_BASE_URL=https://openrouter.ai/api/v1`,
     `OPENAI_MODEL=deepseek/deepseek-r1-distill-qwen-32b:free`, **or**
   - `LLM_PROVIDER=anthropic`, `ANTHROPIC_API_KEY`, etc.
5. (Optional) Set `SERVE_FRONTEND=1` to serve the legacy UI at the API root.
6. Click **Deploy**. The service is live at `https://<service-name>.onrender.com`.

### Deploy manually (alternative)

1. On Render, **New +** → **Web Service** → connect your GitHub repo.
2. **Build Command**: `pip install -r requirements-api.txt`
3. **Start Command**: `uvicorn backend.api:app --host 0.0.0.0 --port $PORT`
4. **Health Check Path**: `/health`
5. Add the env vars above, then deploy.

### Environment variables

See `.env.example` for the full list. The most important ones for Render:

| Variable            | Purpose                                              | Example / Default            |
| ------------------- | ---------------------------------------------------- | ---------------------------- |
| `LLM_PROVIDER`      | Which LLM backend to use                             | `gemini` / `openai` / `anthropic` |
| `GEMINI_API_KEY`    | Google Gemini key (free tier)                        | *(required for gemini)*      |
| `OPENAI_API_KEY`    | OpenAI-compatible key (OpenRouter/Groq)              | *(required for openai)*      |
| `OPENAI_BASE_URL`   | OpenAI-compatible base URL                           | `https://openrouter.ai/api/v1` |
| `OPENAI_MODEL`      | Model to use                                         | `deepseek/deepseek-r1-distill-qwen-32b:free` |
| `CORS_ORIGINS`      | Comma-separated allowed origins                      | `https://my-ui.onrender.com` |
| `SERVE_FRONTEND`    | Serve the legacy UI at the root (`1`/`0`)            | `1`                          |
| `VISION_API_KEY`    | Optional dedicated vision provider                   | *(optional)*                 |

### ⚠️ Free-tier notes

- Render's free tier uses an **ephemeral filesystem**. The SQLite cache
  (`data/cache.db`) and student profile JSON are reset on every redeploy.
  This is fine for a demo; for production persistence, add a managed
  **PostgreSQL** or **Redis** instance and wire the cache/profile to it.
- `Ollama` cannot run on Render free tier — use a cloud LLM provider instead.
- The optional speech extras (`gtts`, `faster-whisper`) are commented out in
  `requirements-api.txt`. Uncomment them if you need TTS/STT on Render.
