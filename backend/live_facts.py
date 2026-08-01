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

# ---------------------------------------------------------------------------
# Country / entity → Wikipedia page title (kept up-to-date by the community)
# ---------------------------------------------------------------------------
LEADER_PAGES: dict[str, str] = {
    "ghana": "President of Ghana",
    "united states": "President of the United States",
    "united states of america": "President of the United States",
    "usa": "President of the United States",
    "us": "President of the United States",
    "america": "President of the United States",
    "united kingdom": "Prime Minister of the United Kingdom",
    "uk": "Prime Minister of the United Kingdom",
    "britain": "Prime Minister of the United Kingdom",
    "england": "Prime Minister of the United Kingdom",
    "nigeria": "President of Nigeria",
    "south africa": "President of South Africa",
    "kenya": "President of Kenya",
    "egypt": "President of Egypt",
    "senegal": "President of Senegal",
    "france": "President of France",
    "germany": "Chancellor of Germany",
    "india": "President of India",
    "china": "President of the People's Republic of China",
    "russia": "President of Russia",
    "canada": "Prime Minister of Canada",
    "australia": "Prime Minister of Australia",
    "japan": "Prime Minister of Japan",
    "brazil": "President of Brazil",
    "mexico": "President of Mexico",
    "argentina": "President of Argentina",
    "italy": "President of Italy",
    "spain": "Prime Minister of Spain",
    "portugal": "President of Portugal",
    "netherlands": "Prime Minister of the Netherlands",
    "ireland": "President of Ireland",
    "turkey": "President of Turkey",
    "israel": "Prime Minister of Israel",
    "saudi arabia": "King of Saudi Arabia",
    "south korea": "President of South Korea",
    "north korea": "Supreme Leader of North Korea",
    "indonesia": "President of Indonesia",
    "pakistan": "President of Pakistan",
    "bangladesh": "President of Bangladesh",
    "ethiopia": "President of Ethiopia",
    "tanzania": "President of Tanzania",
    "uganda": "President of Uganda",
    "rwanda": "President of Rwanda",
    "cameroon": "President of Cameroon",
    "ivory coast": "President of Ivory Coast",
    "cote d'ivoire": "President of Ivory Coast",
    "mali": "President of Mali",
    "burkina faso": "President of Burkina Faso",
    "niger": "President of Niger",
    "zimbabwe": "President of Zimbabwe",
    "zambia": "President of Zambia",
    "mozambique": "President of Mozambique",
    "angola": "President of Angola",
    "democratic republic of the congo": "President of the Democratic Republic of the Congo",
    "libya": "President of Libya",
    "tunisia": "President of Tunisia",
    "morocco": "King of Morocco",
    "algeria": "President of Algeria",
    "sweden": "Prime Minister of Sweden",
    "norway": "Prime Minister of Norway",
    "denmark": "Prime Minister of Denmark",
    "finland": "President of Finland",
    "poland": "President of Poland",
    "ukraine": "President of Ukraine",
    "greece": "President of Greece",
    "australia": "Prime Minister of Australia",
    "new zealand": "Prime Minister of New Zealand",
}

# Keywords that flag a question as time-sensitive
_TIME_SENSITIVE_RE = [
    re.compile(r"current (president|prime minister|leader|king|queen|chancellor|governor|head of state)"),
    re.compile(r"who (is|are) (the )?(president|prime minister|leader|king|queen|chancellor|governor)"),
    re.compile(r"who (is|are) currently"),
    re.compile(r"\bnow\b"),
    re.compile(r"\bnewest\b"),
    re.compile(r"\blatest\b"),
    re.compile(r"right now"),
    re.compile(r"in 202[5-9]"),
    re.compile(r"as of (today|now|202[5-9])"),
]

# Infobox field name variants
_INCUMBENT_KEYS = ("incumbent", "officeholder", "current")
_SINCE_KEYS = ("incumbentsince", "tookoffice", "termstart")

# Simple in-memory TTL cache so we don't hammer the Wikipedia API
_cache: dict[str, tuple[float, Optional[str]]] = {}
_cache_lock = threading.Lock()
_CACHE_TTL = 3600  # seconds


def _is_time_sensitive(question: str) -> bool:
    """Return True if the question asks for current/live information."""
    q = question.lower()
    for pat in _TIME_SENSITIVE_RE:
        if pat.search(q):
            return True
    # Country + role heuristic
    for country in LEADER_PAGES:
        if country in q and any(
            w in q for w in ("president", "prime minister", "leader",
                             "king", "queen", "chancellor", "governor",
                             "head of state", "ruling")
        ):
            return True
    return False


def _extract_country(question: str) -> Optional[str]:
    """Return the first matching country key from the question."""
    q = question.lower()
    for country in LEADER_PAGES:
        if country in q:
            return country
    return None


def _strip_wiki_markup(text: str) -> str:
    """Strip wiki links, refs, and templates from a value."""
    # Remove <ref>...</ref> and self-closing <ref ... />
    text = re.sub(r"<ref[^/>]*/>", "", text, flags=re.DOTALL)
    text = re.sub(r"<ref.*?</ref>", "", text, flags=re.DOTALL)
    # [[Target]] or [[Target|Display]] → Display (or Target)
    text = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", text)
    # {{...}} templates → drop
    text = re.sub(r"\{\{.*?\}\}", "", text, flags=re.DOTALL)
    # <br> and other simple tags
    text = re.sub(r"<br\s*/?>", ", ", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip().strip("|").strip()


def _get_wikitext(title: str) -> str:
    """Fetch the wikitext of a Wikipedia page via the MediaWiki API."""
    url = "https://en.wikipedia.org/w/api.php"
    params = {
        "action": "query",
        "prop": "revisions",
        "rvprop": "content",
        "rvslots": "main",
        "titles": title,
        "format": "json",
        "formatversion": "2",
        "redirects": "1",
        "maxlag": "5",
    }
    resp = requests.get(url, params=params, timeout=15,
                        headers={"User-Agent": "MultimodalEduTutor/1.0 (educational project)"})
    resp.raise_for_status()
    data = resp.json()
    pages = data.get("query", {}).get("pages", [])
    if not pages:
        return ""
    return pages[0].get("revisions", [{}])[0].get("slots", {}).get("main", {}).get("content", "")


def _parse_incumbent(wikitext: str) -> tuple[str, str]:
    """Extract (incumbent, since) from an infobox in wikitext."""
    incumbent = ""
    since = ""
    # Handle multiline infoboxes: accumulate until closing braces of the field
    lines = wikitext.split("\n")
    for i, line in enumerate(lines):
        stripped = line.strip()
        lower = stripped.lower()
        for key in _INCUMBENT_KEYS:
            if re.match(r"^\|\s*" + key + r"\s*=", lower):
                incumbent = stripped.split("=", 1)[1].strip() if "=" in stripped else ""
                # Could span multiple lines; grab until next pipe-field or closing
                j = i + 1
                while j < len(lines) and not re.match(r"^\s*\|", lines[j]) and "}}" not in lines[j]:
                    incumbent += " " + lines[j].strip()
                    j += 1
                incumbent = _strip_wiki_markup(incumbent)
                break
        for key in _SINCE_KEYS:
            if re.match(r"^\|\s*" + key + r"\s*=", lower):
                since = stripped.split("=", 1)[1].strip() if "=" in stripped else ""
                since = _strip_wiki_markup(since)
                break
    return incumbent, since


def fetch_live_fact(question: str) -> Optional[str]:
    """
    Return a verified current fact (string) for a time-sensitive question,
    or None if nothing reliable could be retrieved.

    Uses an in-memory TTL cache (1 hour) to avoid repeated API calls.
    """
    if not _is_time_sensitive(question):
        return None

    country = _extract_country(question)
    if not country:
        return None

    title = LEADER_PAGES[country]

    # Check cache
    with _cache_lock:
        hit = _cache.get(title)
        if hit and (time.monotonic() - hit[0]) < _CACHE_TTL:
            return hit[1]

    fact: Optional[str] = None
    try:
        wikitext = _get_wikitext(title)
        if wikitext:
            incumbent, since = _parse_incumbent(wikitext)
            if incumbent:
                role = title
                fact = (
                    f"The current {role} is {incumbent}"
                    + (f", in office since {since}" if since else "")
                    + ". This is verified live information from Wikipedia and is more current than training data."
                )
    except Exception as e:
        print(f"[LiveFacts] Failed to fetch for '{title}': {e}")
        fact = None

    with _cache_lock:
        _cache[title] = (time.monotonic(), fact)

    return fact


def detect_time_sensitive(question: str) -> bool:
    """Public helper so the tutor engine can bypass the answer cache."""
    return _is_time_sensitive(question)

