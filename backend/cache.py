"""
Simple SQLite-backed cache for Q&A responses.

Reduces API costs by caching (question + context) → answer pairs.
The cache is persistent across app restarts.
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_LOCAL = threading.local()


def _get_conn() -> sqlite3.Connection:
    """Get a thread-local SQLite connection."""
    if not hasattr(_LOCAL, "conn") or _LOCAL.conn is None:
        db_path = Path(__file__).resolve().parent.parent / "data" / "cache.db"
        db_path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(db_path))
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS qa_cache (
                cache_key TEXT PRIMARY KEY,
                question TEXT,
                context_snippet TEXT,
                model TEXT,
                answer TEXT,
                cached_at TEXT,
                hit_count INTEGER DEFAULT 1
            )
            """
        )
        conn.commit()
        _LOCAL.conn = conn
    return _LOCAL.conn


def _make_key(question: str, model: str, context_chunks: list[dict] | None) -> str:
    """Generate a deterministic cache key from the inputs."""
    context_str = json.dumps(
        [{"text": c["text"][:100], "source": c["source"]} for c in (context_chunks or [])],
        sort_keys=True,
    )
    raw = f"{question}||{model}||{context_str}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def get_cached_answer(
    question: str, model: str, context_chunks: list[dict] | None
) -> str | None:
    """Return cached answer if it exists, else None. Increments hit_count async."""
    key = _make_key(question, model, context_chunks)
    conn = _get_conn()
    row = conn.execute(
        "SELECT answer, hit_count FROM qa_cache WHERE cache_key = ?", (key,)
    ).fetchone()
    if row is None:
        return None
    answer, hits = row
    # Fire-and-forget hit_count increment — doesn't block the read path
    def _inc():
        try:
            c = _get_conn()
            c.execute("UPDATE qa_cache SET hit_count = ? WHERE cache_key = ?", (hits + 1, key))
            c.commit()
        except Exception:
            pass
    threading.Thread(target=_inc, daemon=True).start()
    return answer


def set_cached_answer(
    question: str,
    model: str,
    context_chunks: list[dict] | None,
    answer: str,
) -> None:
    """Store a new cache entry."""
    key = _make_key(question, model, context_chunks)
    context_snippet = json.dumps(
        [{"text": c["text"][:100], "source": c["source"]} for c in (context_chunks or [])],
        sort_keys=True,
    )
    conn = _get_conn()
    conn.execute(
        """
        INSERT OR REPLACE INTO qa_cache
            (cache_key, question, context_snippet, model, answer, cached_at, hit_count)
        VALUES (?, ?, ?, ?, ?, ?, 1)
        """,
        (
            key,
            question,
            context_snippet,
            model,
            answer,
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    conn.commit()


def get_cache_stats() -> dict[str, Any]:
    """Return overall cache usage statistics."""
    conn = _get_conn()
    total = conn.execute("SELECT COUNT(*) FROM qa_cache").fetchone()[0]
    total_hits = conn.execute("SELECT COALESCE(SUM(hit_count), 0) FROM qa_cache").fetchone()[0]
    total_bytes = conn.execute(
        "SELECT COALESCE(SUM(LENGTH(answer) + LENGTH(question) + LENGTH(context_snippet)), 0) FROM qa_cache"
    ).fetchone()[0]
    return {
        "cached_entries": total,
        "total_hits": total_hits,
        "cache_size_bytes": int(total_bytes),
    }


def clear_cache() -> int:
    """Clear all cached entries. Returns number of entries deleted."""
    conn = _get_conn()
    count = conn.execute("SELECT COUNT(*) FROM qa_cache").fetchone()[0]
    conn.execute("DELETE FROM qa_cache")
    conn.commit()
    return count


# ── Quiz-specific caching ────────────────────────────────────────────────

def _make_quiz_cache_key(topic: str, num_questions: int, difficulty: str, context_chunks: list[dict] | None) -> str:
    """Generate a deterministic cache key for quiz results."""
    context_str = json.dumps(
        [{"source": c["source"]} for c in (context_chunks or [])],
        sort_keys=True,
    )
    raw = f"quiz||{topic.lower().strip()}||{num_questions}||{difficulty}||{context_str}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def get_cached_quiz(topic: str, num_questions: int, difficulty: str, context_chunks: list[dict] | None) -> dict | None:
    """Return cached quiz dict if it exists, else None."""
    key = _make_quiz_cache_key(topic, num_questions, difficulty, context_chunks)
    conn = _get_conn()
    row = conn.execute(
        "SELECT answer, hit_count FROM qa_cache WHERE cache_key = ?", (key,)
    ).fetchone()
    if row is None:
        return None
    answer, hits = row
    # Fire-and-forget hit_count increment
    def _inc():
        try:
            c = _get_conn()
            c.execute("UPDATE qa_cache SET hit_count = ? WHERE cache_key = ?", (hits + 1, key))
            c.commit()
        except Exception:
            pass
    threading.Thread(target=_inc, daemon=True).start()
    try:
        return json.loads(answer)
    except json.JSONDecodeError:
        return None


def set_cached_quiz(topic: str, num_questions: int, difficulty: str, context_chunks: list[dict] | None, quiz_data: dict) -> None:
    """Store a quiz result in the cache."""
    key = _make_quiz_cache_key(topic, num_questions, difficulty, context_chunks)
    context_snippet = json.dumps(
        [{"source": c["source"]} for c in (context_chunks or [])],
        sort_keys=True,
    )
    conn = _get_conn()
    conn.execute(
        """
        INSERT OR REPLACE INTO qa_cache
            (cache_key, question, context_snippet, model, answer, cached_at, hit_count)
        VALUES (?, ?, ?, ?, ?, ?, 1)
        """,
        (
            key,
            f"quiz:{topic}",
            context_snippet,
            "quiz_generator",
            json.dumps(quiz_data, ensure_ascii=False),
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    conn.commit()

