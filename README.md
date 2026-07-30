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
source venv/bin/activate          # Windows: venv\Scripts\activate
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
