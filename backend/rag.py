"""
Vector-embedding RAG (Retrieval-Augmented Generation) over uploaded course material.

Embedding strategy (no PyTorch / sentence-transformers required):
  - If GEMINI_API_KEY is set: uses Google's text-embedding-004 model via
    the google-generativeai SDK (free tier, fast, ~768-dim embeddings).
  - Fallback: TF-IDF (sklearn) — no API key needed, works offline, keyword-based.

The public interface (add_document, retrieve, is_empty, get_stats) is unchanged.
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field

import numpy as np
from sklearn.metrics.pairwise import cosine_similarity

# ---------------------------------------------------------------------------
# Embedding backend — Gemini if key present, else TF-IDF
# ---------------------------------------------------------------------------
_GEMINI_MODEL: object = None   # genai embedding client
_TFIDF: object = None          # TfidfVectorizer (fallback)
_TFIDF_MATRIX: object = None   # np.ndarray of TF-IDF vectors (fallback)


def _has_gemini() -> bool:
    return bool(os.environ.get("GEMINI_API_KEY"))


def _gemini_embed(texts: list[str]) -> np.ndarray:
    """Embed a list of texts using Gemini text-embedding-004."""
    from google import genai

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    result = client.models.embed_content(
        model="text-embedding-004",
        contents=texts,
        config={"task_type": "RETRIEVAL_DOCUMENT"},
    )
    return np.array([e.values for e in result.embeddings])


def _gemini_embed_query(query: str) -> np.ndarray:
    from google import genai

    client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])
    result = client.models.embed_content(
        model="text-embedding-004",
        contents=query,
        config={"task_type": "RETRIEVAL_QUERY"},
    )
    return np.array([e.values for e in result.embeddings]).reshape(1, -1)


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
                new_embeddings = _gemini_embed(new_chunks)
            except Exception:
                # If Gemini fails, fall back to TF-IDF
                self._use_gemini = False
                new_embeddings = self._tfidf_embed_docs(new_chunks)
        else:
            new_embeddings = self._tfidf_embed_docs(new_chunks)

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
                query_vec = self._tfidf_embed_query(query)
        else:
            query_vec = self._tfidf_embed_query(query)

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

    def get_stats(self) -> dict:
        backend = "Gemini text-embedding-004" if self._use_gemini else "TF-IDF"
        return {
            "total_chunks": len(self.chunks),
            "sources": sorted(set(self.sources)),
            "embedding_dim": self._embeddings.shape[1] if self._embeddings is not None else 0,
            "backend": backend,
        }

    # ── TF-IDF fallback helpers ──────────────────────────────────────────

    def _tfidf_embed_docs(self, new_chunks: list[str]) -> np.ndarray:
        """Fit or update TF-IDF and return dense vectors for new_chunks."""
        from sklearn.feature_extraction.text import TfidfVectorizer

        all_chunks = self.chunks + new_chunks
        vectorizer = TfidfVectorizer(max_features=4096)
        matrix = vectorizer.fit_transform(all_chunks).toarray()
        # Store fitted vectorizer for query time
        self._tfidf_vectorizer = vectorizer  # type: ignore[attr-defined]
        # Re-embed already stored chunks with new vocabulary
        if self.chunks:
            self._embeddings = matrix[: len(self.chunks)]
        return matrix[len(self.chunks) :]

    def _tfidf_embed_query(self, query: str) -> np.ndarray:
        if not hasattr(self, "_tfidf_vectorizer"):
            from sklearn.feature_extraction.text import TfidfVectorizer
            v = TfidfVectorizer(max_features=4096)
            v.fit(self.chunks)
            self._tfidf_vectorizer = v  # type: ignore[attr-defined]
        return self._tfidf_vectorizer.transform([query]).toarray()
