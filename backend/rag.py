"""
Vector-embedding RAG (Retrieval-Augmented Generation) over uploaded course material.

Embedding strategy (no PyTorch / sentence-transformers required):
  - If GEMINI_API_KEY is set: uses Google's text-embedding-004 model via
    the google-generativeai SDK (free tier, fast, ~768-dim embeddings),
    with a persistent SQLite cache so identical chunks are never re-embedded.
  - Fallback: HashingVectorizer (sklearn) — no API key needed, works offline,
    deterministic and O(new chunks) per upload (no vocabulary re-fit).

The public interface (add_document, retrieve, is_empty, get_stats) is unchanged.
"""
from __future__ import annotations

import hashlib
import os
import re
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import HashingVectorizer
from sklearn.metrics.pairwise import cosine_similarity

# ---------------------------------------------------------------------------
# Embedding backend — Gemini if key present, else HashingVectorizer
# ---------------------------------------------------------------------------
# Deterministic offline fallback. HashingVectorizer needs no vocabulary fit,
# so adding documents is O(new chunks) instead of O(all chunks).
_HASH_VECTORIZER = HashingVectorizer(
    n_features=4096, alternate_sign=False, norm="l2"
)

# Persistent SQLite cache: chunk SHA-256 -> serialized embedding vector.
# Re-uploading the same (or overlapping) material never re-calls the Gemini API.
_EMBED_DB_PATH = Path(__file__).resolve().parent.parent / "data" / "embedding_cache.db"
_EMBED_DB_LOCK = threading.Lock()

_GEMINI_MODEL_NAME = "text-embedding-004"
_GEMINI_BATCH_SIZE = 16       # max chunks per API call
_GEMINI_MAX_WORKERS = 4       # parallel batch workers
_GEMINI_MAX_RETRIES = 3       # retries on transient errors / rate limits


def _has_gemini() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY"))


def _get_embedding_conn() -> sqlite3.Connection:
    """Open (and initialize) the embedding cache DB."""
    _EMBED_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(_EMBED_DB_PATH))
    conn.execute(
        "CREATE TABLE IF NOT EXISTS embeddings (key TEXT PRIMARY KEY, vector BLOB)"
    )
    conn.commit()
    return conn


def _chunk_hash(chunk: str) -> str:
    return hashlib.sha256(chunk.encode("utf-8")).hexdigest()


def _load_cached_vectors(chunks: list[str]) -> tuple[dict[str, np.ndarray], list[str]]:
    """Return ({chunk_hash: vector}, uncached_chunks) for the given chunks."""
    cache: dict[str, np.ndarray] = {}
    uncached: list[str] = []
    hashes = {c: _chunk_hash(c) for c in chunks}
    with _EMBED_DB_LOCK:
        conn = _get_embedding_conn()
        try:
            for chunk in chunks:
                row = conn.execute(
                    "SELECT vector FROM embeddings WHERE key = ?",
                    (hashes[chunk],),
                ).fetchone()
                if row is not None:
                    cache[hashes[chunk]] = np.frombuffer(row[0], dtype=np.float32)
                else:
                    uncached.append(chunk)
        finally:
            conn.close()
    return cache, uncached


def _save_cached_vectors(chunks: list[str], vectors: np.ndarray) -> None:
    """Persist (chunk, vector) pairs to the SQLite cache."""
    if not chunks:
        return
    with _EMBED_DB_LOCK:
        conn = _get_embedding_conn()
        try:
            conn.executemany(
                "INSERT OR REPLACE INTO embeddings (key, vector) VALUES (?, ?)",
                [
                    (_chunk_hash(c), v.astype(np.float32).tobytes())
                    for c, v in zip(chunks, vectors)
                ],
            )
            conn.commit()
        finally:
            conn.close()


def _gemini_embed(texts: list[str]) -> np.ndarray:
    """Embed a list of texts using Gemini text-embedding-004 (document task)."""
    from google import genai

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    result = client.models.embed_content(
        model=_GEMINI_MODEL_NAME,
        contents=texts,
        config={"task_type": "RETRIEVAL_DOCUMENT"},
    )
    return np.array([e.values for e in result.embeddings], dtype=np.float32)


def _gemini_embed_query(query: str) -> np.ndarray:
    from google import genai

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    result = client.models.embed_content(
        model=_GEMINI_MODEL_NAME,
        contents=query,
        config={"task_type": "RETRIEVAL_QUERY"},
    )
    return np.array([e.values for e in result.embeddings], dtype=np.float32).reshape(1, -1)


def _embed_with_retry(batch: list[str]) -> np.ndarray:
    """Call Gemini for one batch, retrying on transient/429 errors."""
    last_err: Exception | None = None
    for attempt in range(_GEMINI_MAX_RETRIES):
        try:
            return _gemini_embed(batch)
        except Exception as e:  # noqa: BLE001
            last_err = e
            msg = str(e)
            if "429" in msg or "quota" in msg.lower() or "RESOURCE_EXHAUSTED" in msg:
                time.sleep(1.5 * (attempt + 1))
                continue
            # Transient network errors: retry once
            if attempt < _GEMINI_MAX_RETRIES - 1 and (
                "connection" in msg.lower() or "timeout" in msg.lower()
            ):
                time.sleep(0.5)
                continue
            break
    raise last_err or RuntimeError("Gemini embedding failed")


def _embed_chunks_with_cache(chunks: list[str]) -> np.ndarray:
    """Embed chunks using Gemini, reusing cached vectors and batching in parallel."""
    if not chunks:
        return np.empty((0, 0), dtype=np.float32)

    cache, uncached = _load_cached_vectors(chunks)

    if uncached:
        batches = [
            uncached[i : i + _GEMINI_BATCH_SIZE]
            for i in range(0, len(uncached), _GEMINI_BATCH_SIZE)
        ]
        with ThreadPoolExecutor(max_workers=_GEMINI_MAX_WORKERS) as pool:
            batch_vectors = list(pool.map(_embed_with_retry, batches))
        new_vectors = np.vstack(batch_vectors)
        _save_cached_vectors(uncached, new_vectors)
        for chunk, vec in zip(uncached, new_vectors):
            cache[_chunk_hash(chunk)] = vec

    ordered = np.vstack([cache[_chunk_hash(c)] for c in chunks])
    return ordered


def _hash_embed(texts: list[str]) -> np.ndarray:
    """Offline hashing-vectorizer fallback (deterministic, no fit needed)."""
    return _HASH_VECTORIZER.transform(texts).toarray()


# ---------------------------------------------------------------------------
# Chunking
# ---------------------------------------------------------------------------
def _chunk_text(text: str, max_words: int = 180, overlap: int = 25) -> list[str]:
    """Split text into coherent, overlapping chunks."""
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return []

    raw_paragraphs = re.split(r"\n\s*\n", text)
    paragraphs = [p.strip() for p in raw_paragraphs if p.strip()]

    chunks: list[str] = []
    for para in paragraphs:
        words = para.split()
        if len(words) <= max_words:
            chunks.append(para)
        else:
            sentences = re.split(r"(?<=[.!?])\s+", para)
            buffer: list[str] = []
            buffer_len = 0
            for sent in sentences:
                sent_len = len(sent.split())
                if buffer_len + sent_len <= max_words:
                    buffer.append(sent)
                    buffer_len += sent_len
                else:
                    if buffer:
                        chunks.append(" ".join(buffer))
                    buffer = [sent]
                    buffer_len = sent_len
            if buffer:
                chunks.append(" ".join(buffer))

    if overlap <= 0 or len(chunks) <= 1:
        return chunks

    overlapped: list[str] = []
    for i, chunk in enumerate(chunks):
        if i == 0:
            overlapped.append(chunk)
        else:
            prev_words = chunks[i - 1].split()
            overlap_words = prev_words[-overlap:] if len(prev_words) > overlap else prev_words
            overlapped.append(" ".join(overlap_words + ["[SEP]"] + chunk.split()))
    return overlapped


# ---------------------------------------------------------------------------
# Document extraction helpers
# ---------------------------------------------------------------------------
def extract_text_from_pdf(file_bytes: bytes) -> str:
    """Extract raw text from a PDF's bytes."""
    from io import BytesIO
    from pypdf import PdfReader

    reader = PdfReader(BytesIO(file_bytes))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def extract_text_from_docx(file_bytes: bytes) -> str:
    """Extract raw text from a .docx file's bytes."""
    from io import BytesIO
    from docx import Document

    doc = Document(BytesIO(file_bytes))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def extract_text_from_pptx(file_bytes: bytes) -> str:
    """Extract raw text from a .pptx file's bytes."""
    from io import BytesIO
    from pptx import Presentation

    prs = Presentation(BytesIO(file_bytes))
    texts = []
    for slide in prs.slides:
        for shape in slide.shapes:
            if hasattr(shape, "text") and shape.text.strip():
                texts.append(shape.text.strip())
    return "\n".join(texts)


# ---------------------------------------------------------------------------
# Main store
# ---------------------------------------------------------------------------
@dataclass
class MaterialStore:
    """Holds embedding-indexed chunks from all uploaded documents.

    Uses Gemini embeddings when GEMINI_API_KEY is configured, otherwise
    falls back to TF-IDF.
    """

    chunks: list[str] = field(default_factory=list)
    sources: list[str] = field(default_factory=list)
    _embeddings: np.ndarray | None = field(default=None, repr=False)
    _use_gemini: bool = field(default=False, repr=False)

    def __post_init__(self):
        self._use_gemini = _has_gemini()

    # ── public interface ────────────────────────────────────────────────

    def add_document(self, filename: str, text: str) -> int:
        """Add a document's text to the store. Returns number of chunks added."""
        new_chunks = _chunk_text(text)
        if not new_chunks:
            return 0

        if self._use_gemini:
            try:
                new_embeddings = _embed_chunks_with_cache(new_chunks)
            except Exception:
                # If Gemini fails, fall back to the hashing-vectorizer
                self._use_gemini = False
                new_embeddings = _hash_embed(new_chunks)
        else:
            new_embeddings = _hash_embed(new_chunks)

        self.chunks.extend(new_chunks)
        self.sources.extend([filename] * len(new_chunks))

        if self._embeddings is None:
            self._embeddings = new_embeddings
        else:
            self._embeddings = np.vstack([self._embeddings, new_embeddings])

        return len(new_chunks)

    def retrieve(self, query: str, top_k: int = 3) -> list[dict]:
        """Return up to top_k most relevant chunks for query."""
        if not self.chunks or self._embeddings is None:
            return []

        if self._use_gemini:
            try:
                query_vec = _gemini_embed_query(query)
            except Exception:
                query_vec = _hash_embed([query])
        else:
            query_vec = _hash_embed([query])

        scores = cosine_similarity(query_vec, self._embeddings).flatten()
        top_indices = scores.argsort()[::-1][:top_k]

        results: list[dict] = []
        for idx in top_indices:
            score = float(scores[idx])
            if score <= 0:
                continue
            results.append(
                {
                    "text": self.chunks[idx],
                    "source": self.sources[idx],
                    "score": round(score, 4),
                }
            )
        return results

    def is_empty(self) -> bool:
        return len(self.chunks) == 0

    def remove_document(self, filename: str) -> int:
        """Remove all chunks belonging to a source document.

        Returns the number of chunks removed (0 if the source wasn't found).
        """
        indices = [i for i, src in enumerate(self.sources) if src == filename]
        if not indices:
            return 0

        index_set = set(indices)
        self.chunks = [c for i, c in enumerate(self.chunks) if i not in index_set]
        self.sources = [s for i, s in enumerate(self.sources) if i not in index_set]

        if self._embeddings is not None:
            self._embeddings = np.delete(self._embeddings, indices, axis=0)
            if self._embeddings.shape[0] == 0:
                self._embeddings = None

        return len(indices)

    def get_stats(self) -> dict:
        backend = "Gemini text-embedding-004" if self._use_gemini else "HashingVectorizer"
        return {
            "total_chunks": len(self.chunks),
            "sources": sorted(set(self.sources)),
            "embedding_dim": self._embeddings.shape[1] if self._embeddings is not None else 0,
            "backend": backend,
        }
