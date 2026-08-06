from backend.llm_client import get_client
import os

os.environ["LLM_PROVIDER"] = "openai"
openai_api_key = os.getenv("OPENAI_API_KEY")
if not openai_api_key:
    raise SystemExit("Set OPENAI_API_KEY before running this test.")
os.environ["OPENAI_API_KEY"] = openai_api_key
os.environ["OPENAI_BASE_URL"] = "https://openrouter.ai/api/v1"
os.environ["OPENAI_MODEL"] = "google/gemma-4-26b-a4b-it:free"

client = get_client()
print("Client initialized")
try:
    resp = client.chat("You are a helpful assistant", [{"role": "user", "content": "Hello"}], stream=False)
    print("Response:", resp)
except Exception as e:
    print("Exception:", str(e))
