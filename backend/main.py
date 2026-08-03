import base64
from typing import List, Optional, Dict, Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from backend.tutor_engine import ask_tutor_stream
from backend.quiz import generate_quiz

app = FastAPI(title="Multimodal AI Tutor API")

# Setup CORS for the Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, restrict this to the Next.js domain
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class ChatMessage(BaseModel):
    role: str
    content: str
    api_content: Optional[List[Dict[str, Any]]] = None

class ChatRequest(BaseModel):
    question: str
    history: List[ChatMessage] = []
    agent_mode: str = "socratic"
    student_summary: str = ""
    image_base64: Optional[str] = None
    image_type: Optional[str] = None
    # For RAG context (simplified for the API boundary)
    context_chunks: Optional[List[Dict[str, Any]]] = None

class QuizRequest(BaseModel):
    topic: str
    text_content: str
    num_questions: int = 5
    difficulty: str = "Medium"

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/health")
def health_check():
    return {"status": "ok"}

@app.post("/api/chat")
async def chat_endpoint(request: ChatRequest):
    # Convert base64 image back to bytes if present
    image_bytes = None
    if request.image_base64:
        try:
            # Handle potential data URL prefix
            b64_data = request.image_base64
            if "," in b64_data:
                b64_data = b64_data.split(",", 1)[1]
            image_bytes = base64.b64decode(b64_data)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid base64 image: {e}")

    # Convert Pydantic history to expected dictionary format
    history_dicts = []
    for msg in request.history:
        if msg.api_content:
            history_dicts.append({"role": msg.role, "api_content": msg.api_content})
        else:
            history_dicts.append({"role": msg.role, "content": msg.content})

    def generate():
        try:
            stream = ask_tutor_stream(
                question=request.question,
                image_bytes=image_bytes,
                image_media_type=request.image_type,
                context_chunks=request.context_chunks,
                history=history_dicts,
                agent_mode=request.agent_mode,
                student_model_summary=request.student_summary,
            )
            for chunk in stream:
                if chunk:
                    # SSE format
                    yield f"data: {chunk}\n\n"
        except Exception as e:
            yield f"data: [ERROR: {str(e)}]\n\n"
        finally:
            yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")

@app.post("/api/quiz")
async def quiz_endpoint(request: QuizRequest):
    try:
        # Note: generate_quiz is currently synchronous. In a high-throughput
        # environment, this should be executed in a threadpool.
        quiz_data = generate_quiz(
            text_content=request.text_content,
            topic=request.topic,
            num_questions=request.num_questions,
            difficulty=request.difficulty
        )
        return {"questions": quiz_data}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
