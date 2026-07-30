# Fix: Groq Model Decommissioned (400 Bad Request)

## Steps

- [x] **Step 0**: Diagnose root cause — `llama-3.2-11b-vision-preview` decommissioned by Groq
- [x] **Step 1**: Update `.env` — Change `OPENAI_MODEL` to `llama-3.1-8b-instant`
- [x] **Step 2**: Update `backend/llm_client.py` — Update `VISION_MODELS` set for current Groq vision models, add `DECOMMISSIONED_MODELS` map
- [x] **Step 3**: Add graceful fallback handling for decommissioned models in `_non_stream_response` and `_stream_response`
- [x] **Step 4**: Clean up test files (`test_groq.py`, `test_models.py`, `verify_fix.py`)
- [x] **Step 5**: Verify fix by testing API call with new model and fallback mechanism

