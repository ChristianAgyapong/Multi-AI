# Deployment Guide

This app is split into two services:

| Service | Platform | Directory |
|---------|----------|-----------|
| **FastAPI backend** (AI tutor API) | [Render](https://render.com) | repo root |
| **Next.js frontend** (UI) | [Vercel](https://vercel.com) | `frontend/` |

---

## Prerequisites

- GitHub account (repo must be pushed there)
- Render account — https://render.com (free tier works)
- Vercel account — https://vercel.com (free tier works)
- At least one LLM API key (see options below)

---

## Part 1 — Deploy the Backend on Render

### 1. Push this repo to GitHub
```bash
git add .
git commit -m "chore: prepare for deployment"
git push origin main
```

### 2. Create the Render service
1. Go to https://dashboard.render.com
2. Click **New +** → **Blueprint**
3. Connect your GitHub account and select this repository
4. Render auto-detects `render.yaml` and creates `multimodal-tutor-api`
5. Click **Apply**

### 3. Set your LLM provider env var
In the Render dashboard → your service → **Environment**:

**Option A — Google Gemini (free, recommended)**
```
LLM_PROVIDER = gemini
GEMINI_API_KEY = <your key from https://aistudio.google.com>
```

**Option B — OpenRouter (free models)**
```
LLM_PROVIDER = openai
OPENAI_API_KEY = <your OpenRouter key>
OPENAI_BASE_URL = https://openrouter.ai/api/v1
OPENAI_MODEL = google/gemma-4-26b-a4b-it:free
```

**Option C — Anthropic Claude**
```
LLM_PROVIDER = anthropic
ANTHROPIC_API_KEY = <your key>
```

### 4. Copy your Render URL
After the first deploy succeeds, copy the public URL shown in the Render dashboard.
It looks like: `https://multimodal-tutor-api.onrender.com`

---

## Part 2 — Deploy the Frontend on Vercel

### 1. Import the project
1. Go to https://vercel.com/new
2. Click **Import Git Repository** → select this repo
3. Vercel reads `vercel.json` at the repo root and automatically sets:
   - **Framework**: Next.js
   - **Root directory**: `frontend/`
   - **Build command**: `npm run build`
   - **Output directory**: `.next`

### 2. Set the backend URL environment variable
In the Vercel project settings → **Environment Variables**:
```
NEXT_PUBLIC_API_URL = https://multimodal-tutor-api.onrender.com
```
(Replace with your actual Render URL from Part 1, Step 4)

### 3. Deploy
Click **Deploy**. Vercel builds and publishes the app.
Copy your Vercel URL (e.g. `https://multimodal-edu-tutor.vercel.app`).

---

## Part 3 — Wire CORS (connect frontend ↔ backend)

Back in the Render dashboard → your service → **Environment**, add:
```
CORS_ORIGINS = https://multimodal-edu-tutor.vercel.app
```
(Use your actual Vercel URL)

Then click **Save Changes** — Render will redeploy automatically.

---

## Verification Checklist

- [ ] `https://<render-url>/health` returns `{"status":"ok","version":"2.0.0"}`
- [ ] `https://<render-url>/docs` shows the FastAPI interactive docs
- [ ] Vercel URL loads the Next.js UI
- [ ] Typing a message in chat gets a streamed response from the AI
- [ ] Sidebar shows "Online" for the AI connection
- [ ] File upload (PDF/DOCX) indexes correctly

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Render deploy fails on `pip install` | Check Python version is 3.11.9 in `PYTHON_VERSION` env var |
| Chat shows "Network Error" | Make sure `NEXT_PUBLIC_API_URL` in Vercel matches your Render URL exactly (no trailing slash) |
| Sidebar shows "Offline" | Check `LLM_PROVIDER` + API key are set in Render env vars |
| CORS error in browser console | Set `CORS_ORIGINS` in Render to your exact Vercel URL |
| Render free tier sleeps after 15 min | Expected — first request after sleep takes ~30s to wake the service |

---

## Local Development

**Backend:**
```bash
uvicorn backend.api:app --reload --port 8000
```

**Frontend:**
```bash
cd frontend
echo "NEXT_PUBLIC_API_URL=http://localhost:8000" > .env.local
npm run dev
```
