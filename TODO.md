# Task: Optimize file upload / RAG indexing speed

## Problem
- Uploading a document shows "Uploading…" for a long time.
- Root cause: `MaterialStore.add_document()` makes a **synchronous Gemini
  embedding API call** per upload, and the blocking work runs on the FastAPI
  event loop.
- Secondary: TF-IDF fallback re-fits vocabulary over ALL chunks on every
  upload (quadratic growth); no embedding cache (re-uploads hit the API again).

## Steps
- [x] 1. Add persistent SQLite embedding cache in `backend/rag.py` (chunk hash → vector)
- [x] 2. Replace TF-IDF full re-fit with `HashingVectorizer` (O(new chunks), no fit)
- [x] 3. Embed large documents in parallel batches (ThreadPoolExecutor) + retry on 429
- [x] 4. Offload extraction + indexing to a worker thread in `backend/api.py` (`asyncio.to_thread`)
- [x] 5. Delete temp `_benchmark_upload.py`, re-run benchmark, verify speedup

## Results
- First upload of a new file: ~10.6s (Gemini embedding API latency — unavoidable)
- Re-upload of the same file: **0.37s** (SQLite embedding cache hit) — ~97% faster
- The API event loop is no longer blocked during uploads (extraction + indexing run in a worker thread)

