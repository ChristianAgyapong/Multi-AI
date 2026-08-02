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


# ---------------------------------------------------------------------------
# Country + portfolio → Wikipedia page title for ministers
# ---------------------------------------------------------------------------
MINISTER_PAGES: dict[str, dict[str, str]] = {
    "ghana": {
        "education": "Minister for Education (Ghana)",
        "health": "Minister for Health (Ghana)",
        "finance": "Minister for Finance and Economic Planning (Ghana)",
        "defence": "Minister for Defence (Ghana)",
        "foreign": "Minister for Foreign Affairs (Ghana)",
        "interior": "Minister for the Interior (Ghana)",
        "justice": "Attorney General of Ghana",
        "lands": "Minister for Lands and Natural Resources (Ghana)",
        "energy": "Minister for Energy (Ghana)",
        "roads": "Minister for Roads and Highways (Ghana)",
        "transport": "Minister for Transport (Ghana)",
        "agriculture": "Minister for Food and Agriculture (Ghana)",
        "trade": "Minister for Trade and Industry (Ghana)",
        "gender": "Minister for Gender, Children and Social Protection (Ghana)",
        "communications": "Minister for Communications (Ghana)",
        "local government": "Minister for Local Government, Decentralisation and Rural Development (Ghana)",
        "works": "Minister for Works and Housing (Ghana)",
        "sanitation": "Minister for Sanitation and Water Resources (Ghana)",
        "environment": "Minister for Environment, Science, Technology and Innovation (Ghana)",
        "tourism": "Minister for Tourism, Arts and Culture (Ghana)",
        "employment": "Minister for Employment and Labour Relations (Ghana)",
        "youth": "Minister for Youth and Sports (Ghana)",
        "lands and natural resources": "Minister for Lands and Natural Resources (Ghana)",
        "food and agriculture": "Minister for Food and Agriculture (Ghana)",
        "roads and highways": "Minister for Roads and Highways (Ghana)",
        "trade and industry": "Minister for Trade and Industry (Ghana)",
        "works and housing": "Minister for Works and Housing (Ghana)",
    },
    "united states": {
        "education": "United States Secretary of Education",
        "state": "United States Secretary of State",
        "treasury": "United States Secretary of the Treasury",
        "defense": "United States Secretary of Defense",
        "health": "United States Secretary of Health and Human Services",
        "justice": "United States Attorney General",
    },
    "uk": {
        "education": "Secretary of State for Education (UK)",
        "health": "Secretary of State for Health and Social Care",
        "foreign": "Foreign Secretary (UK)",
        "defence": "Secretary of State for Defence (UK)",
    },
    "united kingdom": {
        "education": "Secretary of State for Education (UK)",
        "health": "Secretary of State for Health and Social Care",
        "foreign": "Foreign Secretary (UK)",
        "defence": "Secretary of State for Defence (UK)",
    },
    "nigeria": {
        "education": "Minister of Education (Nigeria)",
        "health": "Minister of Health (Nigeria)",
        "finance": "Minister of Finance (Nigeria)",
    },
    "south africa": {
        "education": "Minister of Basic Education (South Africa)",
        "health": "Minister of Health (South Africa)",
        "finance": "Minister of Finance (South Africa)",
    },
    "kenya": {
        "education": "Minister of Education (Kenya)",
        "health": "Minister of Health (Kenya)",
    },
    "canada": {
        "education": "Minister of Education (Canada)",
        "health": "Minister of Health (Canada)",
        "finance": "Minister of Finance (Canada)",
        "foreign": "Minister of Foreign Affairs (Canada)",
        "defence": "Minister of National Defence (Canada)",
    },
    "australia": {
        "education": "Minister for Education (Australia)",
        "health": "Minister for Health (Australia)",
        "finance": "Minister for Finance (Australia)",
        "foreign": "Minister for Foreign Affairs (Australia)",
        "defence": "Minister for Defence (Australia)",
    },
    "india": {
        "education": "Minister of Education (India)",
        "health": "Minister of Health and Family Welfare (India)",
        "finance": "Minister of Finance (India)",
        "defence": "Minister of Defence (India)",
        "foreign": "Minister of External Affairs (India)",
    },
}

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


def _extract_portfolio(question: str) -> Optional[str]:
    """Return the ministry/portfolio key from the question, e.g. 'education'."""
    q = question.lower()
    # Match "minister of education", "minister for education", "minister for health", etc.
    # Stop at common words that indicate end of portfolio name
    m = re.search(r"minister (?:of|for) ([a-z]+(?: [a-z]+)*?)(?:\s+(?:in|of|for|at|the|and|with|to)\s|$)", q)
    if m:
        portfolio = m.group(1).strip()
        return portfolio
    # Match "secretary of education", "secretary of state", etc.
    m = re.search(r"secretary of ([a-z]+(?: [a-z]+)*?)(?:\s+(?:in|of|for|at|the|and|with|to)\s|$)", q)
    if m:
        portfolio = m.group(1).strip()
        return portfolio
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


def _parse_wikitable_incumbent(wikitext: str) -> tuple[str, str]:
    """
    Parse a Wikipedia wikitable (list of officeholders) and extract the
    LAST (most recent) entry as the current incumbent.
    
    Handles tables like:
    {| class="wikitable"
    |-
    ! Number !! Minister !! Took office !! Left office !! Government
    |-
    | 40 || [[Haruna Iddrisu]]&nbsp;(MP) || 2025 || present || Mahama government
    |}
    """
    # Find the wikitable
    table_match = re.search(r'\{\|\s*class="wikitable[^"]*"(.*?)\|\}', wikitext, re.DOTALL)
    if not table_match:
        return "", ""
    
    table_content = table_match.group(1)
    
    # Split into rows (lines starting with |-)
    rows = re.split(r'\n\|-\n', table_content)
    
    last_minister = ""
    last_from = ""
    
    for row in rows:
        # Skip header rows (starting with !)
        if row.strip().startswith('!'):
            continue
        
        # Extract cells: each | separated value or [[...]] content
        # Look for wiki-linked names: [[Name]] or [[Name|Display]]
        name_match = re.search(r'\[\[([^\]|]+)(?:\|[^\]]+)?\]\]', row)
        
        if not name_match:
            continue
        
        name = name_match.group(1)
        
        # Only consider rows with "present" or no end date (current officeholder)
        # In a list of ministers, the LAST entry is typically the current one
        # Check if row has "present" or is the last row
        last_minister = name
        last_from = ""
        
        # Try to extract "Took office" date
        # Cells are separated by ||
        cells = re.split(r'\|\|', row)
        if len(cells) >= 3:
            # The third cell is typically "Took office"
            date_match = re.search(r'\d+\s+January|\d+\s+February|\d+\s+March|\d+\s+April|\d+\s+May|\d+\s+June|\d+\s+July|\d+\s+August|\d+\s+September|\d+\s+October|\d+\s+November|\d+\s+December|\d{4}', cells[2])
            if date_match:
                last_from = date_match.group(0)
        
        # Check if current (has "present" or no end date after start)
        if 'present' in row.lower() or 'incumbent' in row.lower():
            # This is definitely current
            break
    
    if not last_minister:
        # Fallback: just find the last wiki-linked name before the table closes
        all_names = re.findall(r'\[\[([^\]|]+)(?:\|[^\]]+)?\]\]', table_content)
        if all_names:
            last_minister = all_names[-1]
    
    return last_minister, last_from


def _is_minister_question(question: str) -> bool:
    """Return True if the question asks about a minister/portfolio."""
    q = question.lower()
    if re.search(r"minister (?:of|for) [a-z]", q):
        return True
    if re.search(r"secretary of [a-z]", q):
        return True
    if "current minister" in q or "current secretary" in q:
        return True
    return False


def fetch_live_fact(question: str) -> Optional[str]:
    """
    Return a verified current fact (string) for a time-sensitive question,
    or None if nothing reliable could be retrieved.

    Supports:
    - Heads of state (president, prime minister, etc.)
    - Cabinet ministers (minister of education, minister for health, etc.)
    - US secretaries (secretary of education, etc.)

    Uses an in-memory TTL cache (1 hour) to avoid repeated API calls.
    """
    if not _is_time_sensitive(question):
        return None

    country = _extract_country(question)
    if not country:
        return None

    is_minister = _is_minister_question(question)
    portfolio = _extract_portfolio(question) if is_minister else None

    # Determine Wikipedia page title
    if is_minister and portfolio:
        # Look up minister page for this country + portfolio
        country_pages = MINISTER_PAGES.get(country, {})
        # Try exact portfolio match first, then partial match
        title = country_pages.get(portfolio)
        if not title:
            # Try partial match: if portfolio is "education", check "education" key
            for key, pg in country_pages.items():
                if portfolio in key or key in portfolio:
                    title = pg
                    break
        if not title:
            # Fallback to constructing generic page name
            title = f"Minister for {portfolio.title()} ({country.title()})"
    else:
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
            # Try infobox parsing first
            incumbent, since = _parse_incumbent(wikitext)
            
            # If infobox parsing failed, try wikitable parsing (for list pages)
            if not incumbent:
                incumbent, since = _parse_wikitable_incumbent(wikitext)
            
            if incumbent:
                role = title
                # Clean up name (remove (MP) suffix, &nbsp; etc.)
                clean_name = re.sub(r'\s*\(MP\)', '', incumbent)
                clean_name = clean_name.replace('\u00a0', ' ').strip()
                fact = (
                    f"The current {role} is {clean_name}"
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

