"""
Core tutoring engine. Uses the unified LLM client (backend/llm_client.py) to
support multiple free/low-cost backends:
  - Ollama (local, free, unlimited) — default
  - Google Gemini (free tier, 60 req/min)
  - OpenAI-compatible (OpenRouter, Groq, etc.)
  - Anthropic Claude (fallback, if you have a key)
"""
from __future__ import annotations

import os
import re
from typing import Generator

from backend.cache import get_cached_answer, set_cached_answer
from backend.llm_client import get_client
from backend.live_facts import fetch_live_fact, detect_time_sensitive

MODEL = os.environ.get("LLM_MODEL", "free-llm")

AGENT_MODES = {
    "tutor": {
        "label": "\U0001f9d1\u200d\U0001f3eb Tutor",
        "description": "Encouraging, highly communicative tutor who explains concepts thoroughly and dynamically",
        "prompt": """You are an exceptional, student-friendly academic tutor. Your primary goal is to help students truly understand subjects across all levels (primary school through university) with warmth, empathy, and remarkable clarity.

## Communication Style & Emotional Intelligence
- **Be incredibly encouraging and warm.** Speak like a favorite teacher who is deeply invested in the student's success. Celebrate their curiosity and validate their efforts.
- **Build a connection.** Use conversational, natural language. Never sound robotic or like a sterile textbook.
- **Be student-friendly.** Never make the student feel bad for not knowing something. Frame mistakes as excellent learning opportunities.

## Dynamic Response Depth (Be Smart About Length)
- **Gauge the required extensiveness.** If a student asks a broad concept, give a comprehensive explanation but break it down into highly scannable, punchy points. Avoid long, overwhelming walls of text.
- **Expand on the "Why" and "How".** Always provide context and reasoning, but do so efficiently. 
- **Use vivid examples and analogies.** Make abstract concepts concrete by connecting them to real-world scenarios.
- **Match the interaction type.** For quick checks, be concise. For deep explanations, be thorough but use excellent formatting to make it easy to read.

## Handling Uploaded Documents
- If a document is uploaded, it will be marked "UPLOADED DOCUMENT EXTRACT". When the student refers to "the document", "the doc", or "my notes", reference this specific content heavily and intelligently. Do NOT confuse your system instructions with their document.

## Formatting & Structure (CRITICAL)
- **Be punchy and highly scannable.** You MUST use bullet points and numbered lists extensively. 
- **Bold key terms.** Whenever you introduce a new concept or important word, **bold it** so it stands out to the student.
- **Keep paragraphs incredibly short.** Never write a paragraph longer than 3 sentences. Break up text as much as possible so it is easy on the eyes.
- **Guide the student step-by-step.** Instead of just giving the final answer, walk them through the thought process logically and clearly.
""",
    },
    "quiz_master": {
        "label": "\U0001f4dd Quiz Master",
        "description": "Tests knowledge with questions and challenges",
        "prompt": """You are an Academic Quiz Master specialising in formal school and university examinations.

Domain Rules:
- ONLY quiz on academic subjects from school/university curricula.
- If asked about non-academic topics, politely decline and redirect to a subject area.

Guidelines:
1. When the user asks for a quiz, say a brief encouraging greeting, then immediately output a series of questions.
2. Keep questions at the correct academic level (Basic / SHS / University).
3. After each answer, explain why the correct answer is correct and the wrong answers are wrong.
4. Track the student's score and share it at the end.
5. Use clear, exam-style language in your questions.
""",
    },
    "socratic_peer": {
        "label": "\U0001f4ad Socratic Peer",
        "description": "Asks guiding questions instead of giving answers",
        "prompt": """You are a Socratic Academic Peer \u2014 a study buddy who helps students discover answers to their school and university coursework through guided questioning.

Domain Rules:
- ONLY engage with academic subjects from school/university syllabuses.
- Politely redirect non-academic questions back to study topics.

Guidelines:
- NEVER give the answer directly. Guide the student to discover it themselves.
- Break complex problems into smaller steps and ask about each step.
- If the student is truly stuck, give a syllabus-specific hint \u2014 not the answer.
- Use phrases like: "What formula do you think applies here?", "What did your textbook say about this?", "What happens if we try plugging in a number?"
- Celebrate when the student arrives at the right answer.
- Adapt your language to the student's detected level (Basic / SHS / University).
""",
    },
    "debate": {
        "label": "\U0001f9e0 Debate Mode",
        "description": "Two AI agents: a Fellow Student who is wrong, and a Tutor who grades you",
        "prompt": "",
    },
    "debugger": {
        "label": "\U0001f41b Debugger",
        "description": "Specialises in reading code / math work and finding errors",
        "prompt": """You are an Academic Code and Math Debugger for school and university students. The student shows you their work and you help them find and understand their mistakes.

Domain Rules:
- Focus on academic coursework: maths, physics problems, programming assignments, chemistry equations, etc.
- Politely redirect if the request is unrelated to academic work.

Guidelines:
- Carefully analyse the work step by step.
- Point out the EXACT line or step where the error occurs and explain WHY it is wrong.
- Use the "I Do, We Do, You Do" structure: first explain the correct concept, then show a worked example, then give them a practice problem.
- Common things to watch for: sign errors, wrong formula, order of operations, incorrect units, off-by-one errors, logic bugs in code.
- Adapt your explanation depth to the student's level (Basic / SHS / University).
- Keep a constructive, patient tone \u2014 errors are learning opportunities.
""",
    },
}

DEFAULT_AGENT_MODE = "tutor"


def get_system_prompt(mode: str = DEFAULT_AGENT_MODE, student_summary: str = "") -> str:
    mode_config = AGENT_MODES.get(mode, AGENT_MODES[DEFAULT_AGENT_MODE])
    base_prompt = mode_config["prompt"]
    
    from datetime import datetime, timezone
    current_date = datetime.now(timezone.utc).strftime("%B %d, %Y")

    global_rules = f"""

CURRENT DATE: {current_date} (UTC). You MUST use this date as the current date when answering time-sensitive questions.

GLOBAL GUIDELINES:

1. SCOPE & IMAGE ANALYSIS:
   - For text-only questions: focus on academic/school/university subjects. Gently redirect purely off-topic chat.
   - For ANY image shared: analyse it immediately, thoroughly, and naturally — regardless of whether it is academic or not. Do NOT preface with "as a tutor…" disclaimers or scope warnings. Just describe, interpret, and analyse what you see in depth. Treat it as if you are a knowledgeable, curious observer who finds everything worth examining closely.
   - If the user asks you to analyse an image "in the scope you would want", give your own rich, multi-layered analysis covering composition, colour, context, meaning, and any interesting details — no hedging.

2. STUDENT KNOWLEDGE CONTEXT:
"""
    if student_summary:
        global_rules += f"   - Known progress: {student_summary}\n\n"
    else:
        global_rules += "   - Adapt to the student\'s level based on their writing.\n\n"

    global_rules += """3. RECENCY & CURRENT EVENTS AWARENESS:
   - **Current date**: The current date is provided at the top of this prompt. Use it as the reference for "current" or "today".
   - **WEB SEARCH RESULTS / LIVE FACTS**: If the user prompt contains a section labelled "LIVE FACT / SEARCH RESULTS", you MUST treat those results as the absolute truth and current reality. Use the most recent dates found in those search snippets to answer the question, and DO NOT fall back on your older training data if the search snippet provides a newer fact (e.g., if the search snippet says someone is the minister since 2025, do not say it's someone else from 2017).
   - **Knowledge cutoff**: If no search results are provided, and the question is about recent events or fast-changing facts, you MUST do the following:
     a. **Clearly state your knowledge cutoff** and that the information may have changed.
     b. **Give the most recent information you have**, explicitly marking it with the date/year.
     c. **Never pretend** you know current information that you don't. Always be honest.
   - **Future events**: For questions about predictions, future events, or speculative topics, clearly state that you cannot predict the future and can only discuss known plans or trends.

4. LEVEL-APPROPRIATE LANGUAGE:
   - BASIC: Simple words, short sentences, analogies.
   - SHS: Clear language, real-world examples.
   - UNIVERSITY: Precise terminology, deeper analysis.

5. PLAIN LANGUAGE: Explain technical terms after using them.

6. STRUCTURE & LENGTH: Provide thorough, well-developed paragraphs. Do not skimp on details unless the student explicitly asks for a short summary. Make your explanations rich and extensive. Aim for depth — cover the "what", "how", and "why" of each concept.

7. CONVERSATION & EMPATHY: Be an active, empathetic listener. If the student is confused, validate their struggle and try a highly creative, different approach. Use analogies from everyday life, stories, or visual descriptions.

8. FOLLOW-UP: End your responses with an engaging, thought-provoking question to keep the conversation going and check their understanding. Ask questions that require the student to apply the knowledge, not just recall it.

9. QUALITY CHECKLIST (ask yourself before responding):
   - [ ] Did I explain the WHY behind the concept, not just the WHAT?
   - [ ] Did I use at least one concrete example or analogy?
   - [ ] Did I bold the key terms so they stand out?
   - [ ] Is my response well-structured with bullet points or steps?
   - [ ] Did I connect this to something the student might already know?
   - [ ] If they uploaded a document, did I reference it specifically?
   - [ ] Did I think step-by-step before answering?
   - [ ] Did I consider potential counterexamples or edge cases?

10. MATH & SCIENTIFIC NOTATION (CRITICAL — always follow this):
   - **Always use LaTeX** for ALL mathematical expressions, formulas, equations, and scientific notation.
   - Use single dollar signs for **inline math**: $x^2 + y^2 = z^2$, $\frac{d}{dx}$, $\lim_{x \to 0}$, $\sqrt{x}$, $e^x$, $\int_0^\infty$
   - Use double dollar signs for **block/display math** (standalone equations on their own line):
     $$\frac{-b \pm \sqrt{b^2 - 4ac}}{2a}$$
   - NEVER write math as raw ASCII like `x^2`, `sqrt(x)`, `e^x`, `lim_{x->0}`. Always wrap in `$...$`.
   - This applies everywhere: explanations, worked examples, quiz questions, step-by-step solutions, everywhere.
"""
    return base_prompt + global_rules


def _build_messages(
    question: str,
    image_bytes: bytes | None = None,
    image_media_type: str | None = None,
    context_chunks: list[dict] | None = None,
    history: list[dict] | None = None,
    textbook_mode: bool = False,
) -> list[dict]:
    text_parts = []

    if context_chunks:
        context_str = "\n\n".join(
            f"[From {c['source']}]: {c['text']}" for c in context_chunks
        )
        text_parts.append(
            "UPLOADED DOCUMENT EXTRACT (the student uploaded this file):\n"
            f"{context_str}\n"
            "--- End of uploaded document ---"
        )

    # LIVE FACT LOOKUP for time-sensitive questions
    # If the student asks something like "Who is the current president of Ghana?",
    # fetch a VERIFIED, up-to-date fact from Wikipedia and inject it as
    # authoritative context so the model answers with current data.
    if detect_time_sensitive(question):
        try:
            live_fact = fetch_live_fact(question)
            if live_fact:
                text_parts.append(
                    f"LIVE FACT / SEARCH RESULTS (This is AUTHORITATIVE and more current than your training data):\n"
                    f"{live_fact}\n"
                    "--- End of live fact ---"
                )
        except Exception as e:
            print(f"[TutorEngine] Live fact lookup failed: {e}")

    text_parts.append(f"Student question: {question}")
    final_text = "\n\n".join(text_parts)

    messages = list(history) if history else []

    if image_bytes and image_media_type:
        import base64
        b64_data = base64.b64encode(image_bytes).decode("utf-8")
        content = [
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:{image_media_type};base64,{b64_data}"
                }
            },
            {"type": "text", "text": final_text}
        ]
        messages.append({"role": "user", "content": content})
    else:
        messages.append({"role": "user", "content": final_text})

    return messages


def _strip_think(text: str) -> str:
    """Remove  thinking...  response reasoning blocks from model output."""
    return re.sub(r'<think>.*?</think>', '', text, flags=re.DOTALL).strip()


def _is_thinking_enabled() -> bool:
    """Check if we should allow think blocks through (for debugging)."""
    return os.environ.get("SHOW_THINKING", "").strip().lower() in ("1", "true", "yes")


def _streaming_think_filter(tokens: Generator[str, None, None]) -> Generator[str, None, None]:
    """Filter  thinking<...>  blocks from streaming tokens in real-time."""
    buffer = ""
    depth = 0
    in_tag_open = False
    tag_buffer = ""
    
    for token in tokens:
        if not token:
            continue
        
        if depth > 0:
            for ch in token:
                if ch == '<':
                    tag_buffer = '<'
                    in_tag_open = True
                elif in_tag_open:
                    tag_buffer += ch
                    if tag_buffer == '</think>':
                        depth -= 1
                        tag_buffer = ""
                        in_tag_open = False
                    elif ch == '>' and tag_buffer != '</think>':
                        tag_buffer = ""
                        in_tag_open = False
        else:
            for ch in token:
                if ch == '<':
                    tag_buffer = '<'
                    in_tag_open = True
                elif in_tag_open:
                    tag_buffer += ch
                    if tag_buffer == '<think>':
                        if buffer:
                            yield buffer
                            buffer = ""
                        depth = 1
                        tag_buffer = ""
                        in_tag_open = False
                    elif ch == '>':
                        buffer += tag_buffer
                        tag_buffer = ""
                        in_tag_open = False
                else:
                    buffer += ch
            
            if buffer and (len(buffer) >= 50 or buffer.endswith('\n')):
                yield buffer
                buffer = ""
    
    if buffer:
        yield buffer


def ask_tutor(
    question: str,
    image_bytes: bytes | None = None,
    image_media_type: str | None = None,
    context_chunks: list[dict] | None = None,
    history: list[dict] | None = None,
    agent_mode: str = DEFAULT_AGENT_MODE,
    student_model_summary: str = "",
) -> str:
    if image_bytes is None and not student_model_summary:
        # Skip cache for time-sensitive questions so we always fetch live facts
        if not detect_time_sensitive(question):
            cached = get_cached_answer(question, MODEL, context_chunks)
            if cached is not None:
                return cached

    has_images = image_bytes is not None
    llm = get_client(require_vision=has_images)
    messages = _build_messages(
        question, image_bytes=image_bytes, image_media_type=image_media_type,
        context_chunks=context_chunks, history=history,
    )

    system_prompt = get_system_prompt(agent_mode, student_model_summary)

    # Higher max_tokens for richer, more thorough answers
    result = llm.chat(system_prompt=system_prompt, messages=messages, max_tokens=4096, stream=False)
    answer = result if isinstance(result, str) else ""
    answer = _strip_think(answer).strip()

    if image_bytes is None and answer and not student_model_summary:
        set_cached_answer(question, MODEL, context_chunks, answer)

    return answer



def ask_tutor_stream(
    question: str,
    image_bytes: bytes | None = None,
    image_media_type: str | None = None,
    context_chunks: list[dict] | None = None,
    history: list[dict] | None = None,
    agent_mode: str = DEFAULT_AGENT_MODE,
    student_model_summary: str = "",
) -> Generator[str, None, None]:
    """
    Streaming version with real-time <think> block suppression.
    Yields clean text as it arrives, filtering out reasoning tokens.
    
    NOTE: For vision requests (image attached), we use non-streaming to avoid
    model compatibility issues where streaming silently returns nothing.
    """
    has_vision = image_bytes is not None
    llm = get_client(require_vision=has_vision)
    messages = _build_messages(
        question, image_bytes=image_bytes, image_media_type=image_media_type,
        context_chunks=context_chunks, history=history,
    )

    system_prompt = get_system_prompt(agent_mode, student_model_summary)

    # Higher max_tokens for richer, more thorough streaming answers
    stream_max_tokens = 4096

    # Vision: try streaming first (faster perceived response), fall back to non-streaming
    if has_vision:
        try:
            raw = llm.chat(system_prompt=system_prompt, messages=messages, max_tokens=3072, stream=True)
            if isinstance(raw, Generator):
                any_content = False
                token_count = 0
                for chunk in raw:
                    if chunk:
                        any_content = True
                        token_count += len(chunk)
                        yield chunk
                if not any_content:
                    raise ValueError("Vision stream returned no content — retrying non-streaming")
                # Warn if response was likely cut off (ended abruptly without punctuation)
            else:
                answer = _strip_think(str(raw)).strip()
                yield answer if answer else "⚠️ The model returned an empty response. Please try again."
        except Exception:
            # Fall back to non-streaming (some providers don't stream vision)
            try:
                result = llm.chat(system_prompt=system_prompt, messages=messages, max_tokens=3072, stream=False)
                answer = result if isinstance(result, str) else ""
                answer = _strip_think(answer).strip()
                yield answer if answer else "⚠️ The model returned an empty response. Please try again."
            except Exception as e:
                yield f"⚠️ Could not analyse the image: {e}"
        return

    raw_stream = llm.chat(system_prompt=system_prompt, messages=messages, max_tokens=stream_max_tokens, stream=True)
    
    if not isinstance(raw_stream, Generator):
        cleaned = _strip_think(str(raw_stream))
        yield cleaned
        return

    if _is_thinking_enabled():
        yield from raw_stream
        return

    filtered = _streaming_think_filter(raw_stream)
    
    full_text_parts = []
    for token in filtered:
        if token:
            full_text_parts.append(token)
            yield token

    full_answer = "".join(full_text_parts)
    if image_bytes is None and full_answer and not student_model_summary:
        try:
            set_cached_answer(question, MODEL, context_chunks, full_answer)
        except Exception:
            pass


# Voice (delegated to speech module)

def transcribe_audio(audio_bytes: bytes) -> str:
    """Transcribe audio using the speech module (faster-whisper)."""
    try:
        from backend.speech import transcribe_audio as _transcribe
        return _transcribe(audio_bytes)
    except ImportError:
        raise NotImplementedError(
            "Voice input requires faster-whisper. Install with:\n"
            "  pip install faster-whisper\n"
            "See backend/speech.py for details."
        )
    except Exception as e:
        return f"Warning: Could not transcribe audio: {e}"


# Debate Mode: Dual-Agent (Feynman Technique)

FELLOW_STUDENT_PROMPT = """You are a Fellow Student studying the same topic as the user.
You are enthusiastic but you have made a COMMON MISCONCEPTION about this topic.
Your role is to state your (incorrect) understanding confidently, so the user can correct you.

Rules:
- State ONE specific, believable misconception about the topic. Keep it to 2-3 sentences.
- Do NOT reveal that you are wrong. Act like you genuinely believe your answer.
- Your mistake should be a common one students actually make (not obvious nonsense).
- End with a short question inviting the student to agree or share their view.
- Do NOT ask multiple questions.
"""

TUTOR_GRADER_PROMPT = """You are a senior Academic Tutor observing a debate session.
A student was asked to correct a Fellow Student's misconception about a topic.
Your job is to grade the student's correction.

Rules:
- In 2-3 sentences, confirm what the student got RIGHT.
- In 1-2 sentences, gently correct anything the student missed or got wrong.
- Give a grade out of 10 for accuracy and clarity.
- End with the NEXT misconception to debate, formatted as:
[NEXT_MISCONCEPTION]: <Your new incorrect statement about the same topic>
"""


def run_debate_round(
    topic: str,
    student_correction: str | None,
    fellow_student_history: list[dict],
    tutor_history: list[dict],
    student_model_summary: str = "",
) -> dict:
    """
    Runs one round of the debate:
    1. Fellow Student states/continues its misconception.
    2. (If student replied) Tutor Grader evaluates the student's correction.
    Returns: { 'fellow': str, 'tutor': str | None }
    """
    llm = get_client()

    if not fellow_student_history:
        fellow_msgs = [{"role": "user", "content": f"Let's talk about: {topic}. What do you know about it?"}]
    else:
        fellow_msgs = list(fellow_student_history)

    student_model_context = ""
    if student_model_summary:
        student_model_context = f"\nStudent background: {student_model_summary}"

    if not student_correction and not fellow_student_history:
        # First round: Fellow Student states a misconception
        fellow_msgs.append({
            "role": "user",
            "content": f"Share what you know about {topic}.{student_model_context}"
        })
        fellow_response = llm.chat(
            system_prompt=FELLOW_STUDENT_PROMPT + student_model_context,
            messages=fellow_msgs,
            max_tokens=512,
            stream=False
        )
        return {"fellow": fellow_response, "tutor": None}

    # Student has responded — grade it
    tutor_msgs = list(tutor_history) if tutor_history else []
    tutor_msgs.append({
        "role": "user",
        "content": f"The student was asked to correct a misconception about '{topic}'.\n\nStudent's correction:\n{student_correction}"
    })
    tutor_response = llm.chat(
        system_prompt=TUTOR_GRADER_PROMPT + student_model_context,
        messages=tutor_msgs,
        max_tokens=512,
        stream=False
    )

    # Extract next misconception from tutor response
    next_misconception = ""
    for line in tutor_response.split("\n"):
        if line.startswith("[NEXT_MISCONCEPTION]:"):
            next_misconception = line.split(":", 1)[1].strip()
            break

    # Fellow Student states next misconception
    fellow_msgs.append({"role": "user", "content": f"The student responded. Now share another misconception about {topic}."})
    if next_misconception:
        fellow_msgs.append({"role": "user", "content": f"Consider this point: {next_misconception}"})

    fellow_response = llm.chat(
        system_prompt=FELLOW_STUDENT_PROMPT,
        messages=fellow_msgs,
        max_tokens=512,
        stream=False
    )

    return {"fellow": fellow_response, "tutor": tutor_response}
