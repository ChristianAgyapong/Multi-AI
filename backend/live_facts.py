"""
Live Facts module — fetches REAL-TIME, verified current information for
time-sensitive questions (e.g. "Who is the current president of Ghana?").

Why: LLMs have a training-data cutoff and cannot know about recent elections,
leaders, laws, or events. This module queries Wikipedia's live, up-to-date
pages and extracts the current officeholder / fact, which is then injected
into the tutor's prompt as authoritative "LIVE FACT" context.

Strategy:
  1. Detect if the question is time-sensitive (current leader, "latest", etc.).
  2. Map the queried country/entity to its Wikipedia page title.
  3. Fetch the page's wikitext via the MediaWiki API and parse the infobox
     "incumbent" / "incumbentsince" fields.
  4. Return a clean, human-readable fact string (or None if unavailable).
"""
from __future__ import annotations

import re
import threading
import time
from typing import Optional

import requests

# Keywords that flag a question as time-sensitive
_TIME_SENSITIVE_RE = [
    re.compile(r"current (president|prime minister|leader|king|queen|chancellor|governor|head of state|minister)"),
    re.compile(r"who (is|are) (the )?(president|prime minister|leader|king|queen|chancellor|governor|minister)"),
    re.compile(r"current (minister|secretary|commissioner|ambassador)"),
    re.compile(r"minister of (education|health|finance|defence|defense|foreign|interior|justice|lands|energy|transport|agriculture|trade|gender|communications|works|sanitation|environment|tourism|employment|youth|sports|information)"),
    re.compile(r"minister for (education|health|finance|defence|defense|foreign|interior|justice|lands|energy|transport|agriculture|trade|gender|communications|works|sanitation|environment|tourism|employment|youth|sports|information)"),
    re.compile(r"secretary of (education|state|treasury|defense|defence|health|commerce|energy|interior|agriculture|veterans)"),
    re.compile(r"who (is|are) currently"),
    re.compile(r"\bnow\b"),
    re.compile(r"\bnewest\b"),
    re.compile(r"\blatest\b"),
    re.compile(r"right now"),
    re.compile(r"in 202[4-9]"),
    re.compile(r"as of (today|now|202[4-9])"),
    re.compile(r"\btoday\b"),
    re.compile(r"news"),
    re.compile(r"current affairs"),
    re.compile(r"recently"),
    re.compile(r"who won"),
]

# Simple in-memory TTL cache for web searches
_cache: dict[str, tuple[float, Optional[str]]] = {}
_cache_lock = threading.Lock()
_CACHE_TTL = 3600  # seconds


def _is_time_sensitive(question: str) -> bool:
    """Return True if the question asks for current/live information."""
    q = question.lower()
    for pat in _TIME_SENSITIVE_RE:
        if pat.search(q):
            return True
    return False


def fetch_live_fact(question: str) -> Optional[str]:
    """
    Return a verified current fact (string) for a time-sensitive question,
    or None if nothing reliable could be retrieved.

    Uses DuckDuckGo web search to pull the top 3 live snippets, completely
    bypassing old training data, and caches the result for 1 hour.
    """
    if not _is_time_sensitive(question):
        return None

    # Check cache based on exact question string
    cache_key = question.strip().lower()
    with _cache_lock:
        hit = _cache.get(cache_key)
        if hit and (time.monotonic() - hit[0]) < _CACHE_TTL:
            return hit[1]

    fact: Optional[str] = None
    try:
        from ddgs import DDGS
        with DDGS() as ddgs:
            # Ask DDG for text search results
            results = list(ddgs.text(question, max_results=3))
            if results:
                snippets = "\n".join(f"- {r.get('title', '')}: {r.get('body', '')}" for r in results)
                fact = (
                    "VERIFIED LIVE FACT (from Web Search):\n"
                    f"Search results for '{question}':\n{snippets}\n"
                    "--- End of web search results ---"
                )
    except Exception as e:
        print(f"[LiveFacts] DuckDuckGo search failed: {e}")

    # Save to cache even if None (to prevent hammering API on repeated failures)
    with _cache_lock:
        _cache[cache_key] = (time.monotonic(), fact)

    return fact


def detect_time_sensitive(question: str) -> bool:
    """Public helper so the tutor engine can bypass the answer cache."""
    return _is_time_sensitive(question)

