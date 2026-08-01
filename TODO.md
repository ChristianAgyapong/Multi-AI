# Tuning & Smartness Enhancement — Progress

## Steps
- [x] Step 1: backend/llm_client.py — Configurable temperature (0.5 default), smarter model routing with fallback chain, higher max_tokens defaults
- [ ] Step 2: backend/tutor_engine.py — Add REASONING & QUALITY prompt block, answer quality checklist, self-review, raise max_tokens to 4096
- [ ] Step 3: backend/quiz.py — Higher temperature for quiz generation, richer question-quality prompt (better distractors/explanations)
- [ ] Step 4: backend/cache.py — Version-bust cache key to avoid serving stale answers
- [ ] Step 5: Run `streamlit run app.py` and verify clean boot
