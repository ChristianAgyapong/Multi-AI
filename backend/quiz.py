"""
Quiz generation. Uses the unified LLM client (backend/llm_client.py) to
produce a structured JSON quiz (grounded in retrieved course material when
available) and parses it into a Python object the frontend can render.

Optimizations (v2):
  1. SQLite-based caching — repeat quizzes on same topic return instantly.
  2. Parallel batch generation — for N>4 questions, splits into batches of 4
     and generates them concurrently via ThreadPoolExecutor (up to 3x faster).
  3. Optimized per-batch prompt — shorter, more concise system prompt reduces
     token overhead and LLM response time.
"""
from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed

from backend.llm_client import get_client
from backend.cache import get_cached_quiz, set_cached_quiz

QUIZ_SYSTEM_PROMPT = """You generate quiz questions. Output ONLY valid JSON. No markdown, no explanation.
Schema: {"topic":"string","questions":[{"question":"string","options":["A","B","C","D"],"correct_index":0,"explanation":"1 sentence"}]}
Rules: options max 8 words each, explanation max 15 words, be concise."""

# Per-batch prompt for parallel generation
BATCH_PROMPT = """Generate {n} MCQ questions about: {topic}. {difficulty}{context}
Return ONLY JSON with a \"questions\" array. Each item: question, options(4), correct_index, explanation."""


def _extract_and_clean_json(text: str) -> str:
    """
    Extract valid JSON from model output that may contain:
    - Reasoning/thinking blocks
    - Markdown code fences (```json ... ```)
    - Preamble text before/after
    """
    text = text.strip()

    # Remove think blocks (used by DeepSeek, Qwen, etc.)
    text = re.sub(r' thinking.*? response', '', text, flags=re.DOTALL)
    
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


def _parse_quiz_json(raw_text: str, batch_label: str = "") -> list[dict]:
    """Parse a single batch JSON response into a list of question dicts."""
    cleaned = _extract_and_clean_json(raw_text)
    try:
        data = json.loads(cleaned)
    except json.JSONDecodeError as e:
        raise ValueError(f"Batch {batch_label}: JSON parse error: {e}") from e

    questions = data.get("questions", [])
    if not isinstance(questions, list) or len(questions) == 0:
        raise ValueError(f"Batch {batch_label}: no 'questions' array found")
    return questions


def _generate_batch(
    topic: str,
    n: int,
    difficulty_prompt: str,
    context_str: str,
    batch_num: int,
    total_batches: int,
) -> list[dict]:
    """Generate a single batch of n questions. Called in parallel via ThreadPoolExecutor."""
    llm = get_client()
    prompt = BATCH_PROMPT.format(
        n=n,
        topic=topic,
        difficulty=difficulty_prompt,
        context=context_str,
    )
    prompt += f"\n\n(Batch {batch_num}/{total_batches} - generate exactly {n} questions.)"

    max_retries = 2
    last_err = None

    for attempt in range(max_retries):
        try:
            result = llm.chat(
                system_prompt=QUIZ_SYSTEM_PROMPT,
                messages=[{"role": "user", "content": prompt}],
                max_tokens=150 * n + 64,
                stream=False,
            )
            raw_text = result if isinstance(result, str) else ""
            if not raw_text:
                raise ValueError(f"Batch {batch_num}: empty response from LLM")
            return _parse_quiz_json(raw_text, f"batch_{batch_num}")
        except ValueError as e:
            last_err = e
            print(f"Batch {batch_num} attempt {attempt + 1} failed: {e}. Retrying...")
            continue
        except Exception as e:
            raise ValueError(f"Batch {batch_num} failed: {e}") from e

    raise ValueError(f"Batch {batch_num} failed after {max_retries} attempts: {last_err}")


def generate_quiz(
    topic: str,
    num_questions: int = 5,
    context_chunks: list[dict] | None = None,
    difficulty: str = "standard",
) -> dict:
    """Generate a quiz on `topic`. Returns a dict matching QUIZ_SYSTEM_PROMPT's
    schema. Raises ValueError if the model's output can't be parsed as JSON.

    Speed optimizations:
      - Caches results by (topic, num_questions, difficulty, context)
      - For N > 4, splits into parallel batches of 4 questions (up to 4x faster)
      - Optimized prompts with fewer tokens and lower max_tokens
    """
    # Check cache first (instant return on repeat topics)
    cached = get_cached_quiz(topic, num_questions, difficulty, context_chunks)
    if cached is not None:
        return cached

    # Build difficulty prompt
    if difficulty == "easy":
        difficulty_prompt = "Difficulty: Easy. Make questions foundational and straightforward."
    elif difficulty == "hard":
        difficulty_prompt = "Difficulty: Hard. Use nuanced distractors and multi-step reasoning."
    else:
        difficulty_prompt = "Difficulty: Standard."

    # Build context string
    context_str = ""
    if context_chunks:
        context_lines = [
            f"[From {c['source']}]: {c['text']}" for c in context_chunks
        ]
        context_str = "Base questions on this material:\n" + "\n\n".join(context_lines)

    # Parallel batching: split large quizzes into concurrent requests.
    # BATCH_SIZE=6 means up to 2 parallel requests for a 12-question quiz,
    # which is fast without hitting rate limits on free-tier APIs.
    BATCH_SIZE = 6

    if num_questions <= BATCH_SIZE:
        # Single call for small quizzes (<=6 questions)
        llm = get_client()
        prompt = BATCH_PROMPT.format(
            n=num_questions,
            topic=topic,
            difficulty=difficulty_prompt,
            context=context_str,
        )
        max_retries = 2
        last_err = None
        for attempt in range(max_retries):
            try:
                result = llm.chat(
                    system_prompt=QUIZ_SYSTEM_PROMPT,
                    messages=[{"role": "user", "content": prompt}],
                    max_tokens=150 * num_questions + 64,
                    stream=False,
                )
                raw_text = result if isinstance(result, str) else ""
                if not raw_text:
                    raise ValueError("Empty response from LLM")
                questions = _parse_quiz_json(raw_text, "single_batch")
                break  # Success, exit retry loop
            except ValueError as e:
                last_err = e
                print(f"Single batch attempt {attempt + 1} failed: {e}. Retrying...")
                continue
            except Exception as e:
                raise ValueError(f"Failed to contact LLM for quiz generation: {e}") from e
        else:
            raise ValueError(f"Failed to generate quiz after {max_retries} attempts: {last_err}")
    else:
        # Parallel batch generation (up to 4x faster for 8-15 questions)
        num_batches = (num_questions + BATCH_SIZE - 1) // BATCH_SIZE
        base_size = num_questions // num_batches
        remainder = num_questions % num_batches
        batch_sizes = [
            base_size + (1 if i < remainder else 0)
            for i in range(num_batches)
        ]

        all_questions: list[dict] = []
        with ThreadPoolExecutor(max_workers=min(num_batches, 4)) as executor:
            futures = {
                executor.submit(
                    _generate_batch,
                    topic,
                    batch_sizes[i],
                    difficulty_prompt,
                    context_str,
                    i + 1,
                    num_batches,
                ): i
                for i in range(num_batches)
            }
            for future in as_completed(futures):
                try:
                    batch_questions = future.result()
                    all_questions.extend(batch_questions)
                except Exception as e:
                    raise ValueError(f"Parallel batch generation failed: {e}") from e

        questions = all_questions[:num_questions]

    # Build final quiz object
    quiz_data = {
        "topic": topic,
        "questions": questions[:num_questions],
    }

    # Cache the result (best-effort)
    try:
        set_cached_quiz(topic, num_questions, difficulty, context_chunks, quiz_data)
    except Exception:
        pass

    return quiz_data


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
    cleaned = re.sub(r' thinking.*? response', '', raw_text, flags=re.DOTALL)
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
