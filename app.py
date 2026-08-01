"""
Multimodal AI Tutor — Streamlit MVP.

Now works with FREE LLM providers:
  - Ollama (local, free, unlimited) — RECOMMENDED
  - Google Gemini (free tier, 60 req/min)
  - OpenAI-compatible (OpenRouter, Groq, Together — some free tiers)
  - Anthropic Claude (fallback if you have a key)

Run with: streamlit run app.py
"""
import asyncio
import sys

# Fix for Windows asyncio proactor event loop bug:
# "ConnectionResetError: [WinError 10054] An existing connection was forcibly closed"
if sys.platform == "win32":
    try:
        import asyncio.proactor_events
        _orig_call_connection_lost = asyncio.proactor_events._ProactorBasePipeTransport._call_connection_lost
        
        def _silenced_call_connection_lost(self, *args, **kwargs):
            try:
                _orig_call_connection_lost(self, *args, **kwargs)
            except ConnectionResetError:
                pass
                
        asyncio.proactor_events._ProactorBasePipeTransport._call_connection_lost = _silenced_call_connection_lost
    except Exception:
        pass

import os

import streamlit as st
from dotenv import load_dotenv

from backend.quiz import generate_quiz
from backend.rag import MaterialStore, extract_text_from_pdf, extract_text_from_docx, extract_text_from_pptx
from backend.tutor_engine import ask_tutor, ask_tutor_stream, AGENT_MODES, DEFAULT_AGENT_MODE
from backend.cache import get_cache_stats
from backend.knowledge_tracer import StudentModel, adapt_quiz_difficulty

try:
    from backend.speech import transcribe_audio, speak_text
    HAS_SPEECH = True
except ImportError:
    HAS_SPEECH = False
    def transcribe_audio(b): raise NotImplementedError()
    def speak_text(t): raise NotImplementedError()

load_dotenv()

st.set_page_config(page_title="Multimodal AI Tutor", page_icon="🎓", layout="wide")


def user_friendly_error(e: Exception) -> str:
    """Convert common exceptions to user-friendly error messages."""
    msg = str(e)
    if "api_key" in msg.lower() or "authentication" in msg.lower() or "unauthorized" in msg.lower() or "401" in msg or "403" in msg:
        return (
            "⚠️ **API key issue** — your API key may be missing or invalid.\n\n"
            "1. Check that a `.env` file exists in the project folder.\n"
            "2. Make sure your API key is correctly set (see `.env.example`).\n"
            "3. Restart the app after saving the file."
        )
    if "connection" in msg.lower() or "refused" in msg.lower() or "ollama" in msg.lower():
        return (
            "⚠️ **Cannot connect to the AI backend**.\n\n"
            "If using **Ollama**: install from https://ollama.ai and run `ollama pull llama3.2`.\n"
            "If using **Gemini/OpenAI**: check your API key in `.env`.\n"
            "See `.env.example` for all configuration options."
        )
    if "rate" in msg.lower() and "limit" in msg.lower():
        return "⚠️ **Rate limit reached** — you've sent too many requests too quickly. Please wait a moment and try again."
    if "timeout" in msg.lower() or "timed out" in msg.lower():
        return "⚠️ **Request timed out** — the AI service took too long to respond. Please try your question again."
    if "overloaded" in msg.lower() or "429" in msg:
        return "⚠️ **Service is busy** — the AI service is experiencing high demand. Please wait a moment and try again."
    return f"⚠️ **Something went wrong**: {e}\n\nPlease try again. If the problem persists, check your configuration in `.env`."


# ---------- Session state ----------
if "material_store" not in st.session_state:
    st.session_state.material_store = MaterialStore()
if "chat_history" not in st.session_state:
    st.session_state.chat_history = []
if "last_retrieved_chunks" not in st.session_state:
    st.session_state.last_retrieved_chunks = None
if "total_api_calls" not in st.session_state:
    st.session_state.total_api_calls = 0
if "total_cache_hits" not in st.session_state:
    st.session_state.total_cache_hits = 0
if "student_model" not in st.session_state:
    st.session_state.student_model = StudentModel()
if "agent_mode" not in st.session_state:
    st.session_state.agent_mode = DEFAULT_AGENT_MODE


def _extract_text(file) -> str:
    """Return text content from an uploaded file (PDF, DOCX, PPTX, or TXT)."""
    if file.type == "application/pdf":
        return extract_text_from_pdf(file.read())
    elif file.type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return extract_text_from_docx(file.read())
    elif file.type == "application/vnd.openxmlformats-officedocument.presentationml.presentation":
        return extract_text_from_pptx(file.read())
    else:
        return file.read().decode("utf-8", errors="ignore")


# ---------- Sidebar ----------
with st.sidebar:
    st.header("📚 Course Material")
    st.caption("Attach files directly in the chat — PDF, DOCX, PPTX, TXT, or images (PNG, JPG).")

    if not st.session_state.material_store.is_empty():
        stats = st.session_state.material_store.get_stats()
        st.caption(f"Sources: {stats['sources']}")
        st.caption(f"{stats['total_chunks']} chunks · {stats['embedding_dim']}D · {stats.get('backend','?')}")


        if st.session_state.last_retrieved_chunks:
            with st.expander("Last Retrieved Context", expanded=False):
                for i, chunk in enumerate(st.session_state.last_retrieved_chunks):
                    st.markdown(
                        f"**#{i + 1}** from `{chunk['source']}` "
                        f"(score: {chunk['score']:.3f})"
                    )
                    st.caption(chunk['text'][:200] + "...")
                    if i < len(st.session_state.last_retrieved_chunks) - 1:
                        st.divider()

    st.divider()
    st.markdown("#### Tutor Mode")
    mode_options = {
        key: f"{cfg['label']} - {cfg['description']}"
        for key, cfg in AGENT_MODES.items()
    }
    current_mode = st.session_state.agent_mode
    selected_mode = st.selectbox(
        "Select tutor mode",
        options=list(mode_options.keys()),
        format_func=lambda k: mode_options[k],
        index=list(mode_options.keys()).index(current_mode) if current_mode in mode_options else 0,
        key="agent_mode_selector",
        label_visibility="collapsed",
    )
    if selected_mode != current_mode:
        st.session_state.agent_mode = selected_mode
        st.rerun()

    if st.session_state.student_model.interaction_count > 0:
        st.divider()
        with st.expander("Student Profile", expanded=False):
            summary = st.session_state.student_model.get_summary()
            st.caption(summary)

    st.divider()
    # Show LLM provider status (provider-agnostic)
    provider = os.environ.get("LLM_PROVIDER", "auto-detect").strip().lower()
    if provider == "ollama" or (not provider and os.environ.get("OLLAMA_MODEL")):
        import requests as _req
        try:
            _resp = _req.get(f"{os.environ.get('OLLAMA_BASE_URL', 'http://localhost:11434')}/api/tags", timeout=2)
            if _resp.status_code == 200:
                _models = _resp.json().get("models", [])
                _model_names = [m["name"] for m in _models]
                st.success(f"Ollama connected - models: {', '.join(_model_names[:3])}")
            else:
                st.warning("Ollama server found but returned unexpected status")
        except Exception:
            st.warning("Ollama not running - install from https://ollama.ai")
    elif provider == "gemini":
        if not os.environ.get("GEMINI_API_KEY"):
            st.error("GEMINI_API_KEY not set - get a free key at https://aistudio.google.com")
        if not os.environ.get("OPENAI_API_KEY"):
            st.error("OPENAI_API_KEY not set")
    else:
        st.warning(
            "No LLM provider configured.\n\n"
            "Recommended: Install Ollama from https://ollama.ai for free local AI.\n"
            "Or set LLM_PROVIDER=gemini with a free Google API key.\n"
            "See `.env.example` for all options."
        )

    st.divider()
    with st.expander("Usage Stats", expanded=False):
        cache_stats = get_cache_stats()
        st.metric("Cached Answers", cache_stats["cached_entries"])
        st.metric("Total Hits", cache_stats["total_hits"])
        st.metric("Session API Calls", st.session_state.total_api_calls)
        st.metric("Session Cache Uses", st.session_state.total_cache_hits)
        if st.button("Clear Cache", type="secondary", width="stretch"):
            from backend.cache import clear_cache
            cleared = clear_cache()
            st.success(f"Cleared {cleared} entries")
            st.rerun()


def chat_to_markdown(history: list[dict]) -> str:
    lines = ["# AI Tutor - Chat Export", "", ""]
    for turn in history:
        role = "**You**" if turn["role"] == "user" else "**Tutor**"
        lines.append(f"### {role}")
        lines.append(turn["content_display"])
        lines.append("")
    return "\n".join(lines)


# ---------- Tabs ----------
tab_chat, tab_quiz = st.tabs(["Ask the Tutor", "Generate a Quiz"])

with tab_chat:
    if not st.session_state.chat_history:
        st.markdown(
            "<h1 style='text-align: center; font-size: 2.2rem; margin-top: 0.5rem;'>Multimodal AI Tutor</h1>",
            unsafe_allow_html=True,
        )
        st.markdown(
            "<p style='text-align: center; font-size: 1.1rem; color: #666;'>"
            "Your personal AI tutor - ask questions in text, upload a photo of handwritten work, "
            "or get a quiz on any topic. Powered by FREE local AI."
            "</p>",
            unsafe_allow_html=True,
        )
        st.divider()
        st.caption("Try asking about:")

        quick_actions = [
            ("Explain photosynthesis", "Explain photosynthesis step by step"),
            ("Help with quadratic equations", "Help me solve x squared minus 5x plus 6 equals 0"),
            ("What are mitochondria?", "What are mitochondria and what do they do?"),
            ("French Revolution causes", "What were the main causes of the French Revolution?"),
        ]
        cols = st.columns(len(quick_actions))
        for col, (label, prompt) in zip(cols, quick_actions):
            with col:
                if st.button(label, width="stretch", type="secondary"):
                    st.session_state["quick_action_prompt"] = prompt
                    st.rerun()

        st.divider()

    else:
        col_title, col_count, col_clear, col_dl = st.columns([4, 1, 1, 2])
        with col_title:
            st.markdown("#### Chat")
        with col_count:
            msg_count = len([t for t in st.session_state.chat_history if t["role"] == "user"])
            st.caption(f"{msg_count} messages")
        with col_clear:
            if st.button("Clear", help="Clear all chat messages"):
                st.session_state.chat_history = []
                if "quick_action_prompt" in st.session_state:
                    del st.session_state["quick_action_prompt"]
                st.rerun()
        with col_dl:
            if st.session_state.chat_history:
                markdown_export = chat_to_markdown(st.session_state.chat_history)
                st.download_button(
                    label="Download",
                    data=markdown_export,
                    file_name="tutor_chat.md",
                    mime="text/markdown",
                    help="Download chat as markdown file",
                    width="stretch",
                )

        for turn in st.session_state.chat_history:
            with st.chat_message(turn["role"]):
                st.markdown(turn["content_display"])
                if turn["role"] == "assistant":
                    import re as _re, json as _json
                    # Fallback TTS text if parent DOM access fails
                    _fb = _re.sub(r'\[([^\]]+)\]\([^)]+\)', r'\1', turn["content_display"])
                    _fb = _re.sub(r'[#*`_~>]', '', _fb)
                    _fb = _re.sub(r'\n{2,}', '. ', _fb)
                    _fb = _re.sub(r'\s{2,}', ' ', _fb).strip()[:3000]
                    _tid = f"T{abs(hash(turn['content_display'][:80]))}"

                    st.iframe(f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<style>
body{{margin:0;padding:2px 0;background:transparent;font-family:system-ui,sans-serif;}}
#B{{background:none;border:1px solid #4b5563;color:#9ca3af;padding:4px 14px;
    border-radius:6px;cursor:pointer;font-size:0.78rem;transition:all 0.2s;}}
#B:hover{{border-color:#6b7280;color:#e5e7eb;}}
</style>
</head><body>
<button id="B" onclick="{_tid}()">🔊 Read aloud</button>
<script>
(function(){{
  var FB={_json.dumps(_fb)},going=false,parts=[],mdEl=null,pDoc=null;

  function findMd(){{
    try{{
      var f=window.frameElement;
      if(!f)return null;
      pDoc=window.parent.document;
      var el=f;
      for(var d=0;d<14;d++){{
        el=el.parentElement;
        if(!el||el===pDoc.body)break;
        for(var s=el.previousElementSibling;s;s=s.previousElementSibling){{
          var m=s.querySelector('[data-testid="stMarkdownContainer"]');
          if(!m&&s.matches&&s.matches('[data-testid="stMarkdownContainer"]'))m=s;
          if(!m){{var c=s.querySelector('p,li,h1,h2,h3');if(c)m=c.parentElement;}}
          if(m&&(m.innerText||'').trim().length>10)return m;
        }}
      }}
    }}catch(e){{}}
    return null;
  }}

  function collect(el,arr,pos){{
    for(var i=0;i<el.childNodes.length;i++){{
      var n=el.childNodes[i];
      if(n.nodeType===3){{arr.push({{n:n,s:pos,l:n.nodeValue.length}});pos+=n.nodeValue.length;}}
      else if(n.nodeType===1){{
        if(/^(P|LI|H[1-6]|DIV|BLOCKQUOTE|TR|BR)$/.test(n.tagName))pos++;
        pos=collect(n,arr,pos);
      }}
    }}
    return pos;
  }}

  function hlAt(ci){{
    if(!pDoc)return;
    for(var i=0;i<parts.length;i++){{
      var p=parts[i];
      if(ci>=p.s&&ci<p.s+p.l){{
        var t=p.n.nodeValue,li=ci-p.s;
        var ws=li;while(ws>0&&!/\\s/.test(t[ws-1]))ws--;
        var we=li;while(we<t.length&&!/\\s/.test(t[we]))we++;
        if(ws===we)return;
        try{{
          var rng=pDoc.createRange();
          rng.setStart(p.n,ws);rng.setEnd(p.n,we);
          pDoc.getSelection().removeAllRanges();
          pDoc.getSelection().addRange(rng);
          try{{p.n.parentElement.scrollIntoView({{behavior:'smooth',block:'nearest'}});}}catch(_){{}}
        }}catch(e){{}}
        return;
      }}
    }}
  }}

  function rst(){{
    going=false;
    try{{if(pDoc)pDoc.getSelection().removeAllRanges();}}catch(e){{}}
    var b=document.getElementById('B');
    b.textContent='🔊 Read aloud';b.style.color='#9ca3af';b.style.borderColor='#4b5563';
  }}

  window['{_tid}']=function(){{
    if(going){{window.speechSynthesis.cancel();rst();return;}}
    mdEl=findMd();
    var txt;
    if(mdEl){{parts=[];collect(mdEl,parts,0);txt=mdEl.innerText||mdEl.textContent;}}
    else txt=FB;
    if(!txt.trim())return;
    var u=new SpeechSynthesisUtterance(txt);
    u.rate=0.93;u.pitch=1;u.volume=1;
    u.onboundary=function(e){{if(e.name==='word')hlAt(e.charIndex);}};
    u.onend=u.onerror=rst;
    going=true;
    var b=document.getElementById('B');
    b.textContent='⏹️ Stop';b.style.color='#ef4444';b.style.borderColor='#ef4444';
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(u);
  }};
}})();
</script>
</body></html>""", height=44)

    # ── Unified file uploader (images + documents) ──────────────────────────
    upload_col, preview_col = st.columns([3, 2])
    with upload_col:
        uploaded_file = st.file_uploader(
            "Attach a file",
            type=["png", "jpg", "jpeg", "pdf", "docx", "pptx", "txt"],
            key="chat_file_uploader",
            label_visibility="collapsed",
        )

    uploaded_image = None
    if uploaded_file is not None:
        is_image = uploaded_file.type.startswith("image/")
        if is_image:
            # Pass to AI vision pipeline
            uploaded_image = uploaded_file
            with preview_col:
                sub_col1, sub_col2 = st.columns([4, 1])
                with sub_col1:
                    with st.expander("View attached image", expanded=False):
                        st.image(uploaded_file, width="stretch")
                with sub_col2:
                    if st.button("Remove", help="Remove attached file"):
                        st.session_state["remove_file"] = True
                        st.rerun()
        else:
            # Document — index into RAG material store
            if uploaded_file.name not in st.session_state.material_store.sources:
                with st.spinner(f"Indexing {uploaded_file.name}…"):
                    text = _extract_text(uploaded_file)
                    n_chunks = st.session_state.material_store.add_document(
                        uploaded_file.name, text
                    )
                with preview_col:
                    st.success(f"✅ **{uploaded_file.name}** indexed ({n_chunks} chunks) — answers will now be grounded in it")
            else:
                with preview_col:
                    st.info(f"📄 **{uploaded_file.name}** is already indexed")

    if st.session_state.pop("remove_file", False):
        uploaded_image = None
        st.rerun()

    question = st.chat_input("Ask your question...")

    if not question and "quick_action_prompt" in st.session_state:
        question = st.session_state.pop("quick_action_prompt")

    if question:
        api_content: list[dict] = []
        image_bytes = None
        media_type = None
        if uploaded_image is not None:
            import base64
            image_bytes = uploaded_image.getvalue()
            media_type = uploaded_image.type
            api_content.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": media_type,
                    "data": base64.b64encode(image_bytes).decode("utf-8"),
                },
            })
        api_content.append({"type": "text", "text": question})

        st.session_state.chat_history.append(
            {
                "role": "user",
                "content_display": question,
                "api_content": api_content,
            }
        )
        with st.chat_message("user"):
            st.markdown(question)

        context_chunks = None
        if not st.session_state.material_store.is_empty():
            context_chunks = st.session_state.material_store.retrieve(question)
        st.session_state.last_retrieved_chunks = context_chunks

        with st.chat_message("assistant"):
            with st.spinner("Thinking..."):
                try:
                    api_history = [
                        {"role": t["role"], "content": t.get("api_content", t["content_display"])}
                        for t in st.session_state.chat_history[:-1]
                        if t["role"] in ("user", "assistant")
                    ]
                    student_model = st.session_state.student_model
                    detected_topics = student_model.record_question(question)
                    student_summary = student_model.get_summary()

                    answer = st.write_stream(
                        ask_tutor_stream(
                            question,
                            image_bytes=image_bytes,
                            image_media_type=media_type,
                            context_chunks=context_chunks,
                            history=api_history,
                            agent_mode=st.session_state.agent_mode,
                            student_model_summary=student_summary,
                        )
                    )
                    st.session_state.total_api_calls += 1
                except Exception as e:
                    answer = user_friendly_error(e)
                    st.markdown(answer)

        st.session_state.chat_history.append(
            {"role": "assistant", "content_display": answer}
        )

        st.rerun()


with tab_quiz:
    st.markdown("### Generate a Quiz")
    col1, col2, col3 = st.columns([3, 1, 1])
    with col1:
        quiz_topic = st.text_input(
            "Quiz topic",
            placeholder="e.g. Photosynthesis, World War II, ...",
            label_visibility="collapsed",
        )
    with col2:
        difficulty = st.selectbox(
            "Difficulty",
            ["standard", "easy", "hard"],
            index=0,
            label_visibility="collapsed",
        )
    with col3:
        num_questions = st.number_input(
            "Questions",
            min_value=3,
            max_value=15,
            value=5,
            label_visibility="collapsed",
        )

    if difficulty == "hard":
        difficulty_hint = "This will be challenging (good for review)"
        st.info(difficulty_hint)
    elif difficulty == "easy":
        difficulty_hint = "Foundational level (let's build up your understanding)"
        st.info(difficulty_hint)

    if st.button("Generate quiz", type="primary"):
        if not quiz_topic.strip():
            st.warning("Please enter a quiz topic")
        else:
            with st.spinner("Generating quiz..."):
                try:
                    context_chunks = None
                    if not st.session_state.material_store.is_empty():
                        context_chunks = st.session_state.material_store.retrieve(quiz_topic)

                    quiz = generate_quiz(
                        topic=quiz_topic,
                        num_questions=num_questions,
                        context_chunks=context_chunks,
                        difficulty=difficulty,
                    )
                    st.session_state["current_quiz"] = quiz
                    st.session_state["current_quiz_topic"] = quiz_topic
                    st.session_state["quiz_checked"] = False
                    st.session_state["quiz_submitted"] = False
                except Exception as e:
                    st.error(f"Couldn't generate quiz: {e}")
                    st.session_state["current_quiz"] = None

    quiz = st.session_state.get("current_quiz")
    if not quiz:
        st.info(
            "Enter a topic above and click **Generate quiz** to get started.\n\n"
            "If you've uploaded course material in the sidebar, the quiz will be based on that material."
        )
        st.stop()

    n_questions = len(quiz["questions"])
    st.markdown(f"### {quiz.get('topic', quiz_topic)}")
    st.progress(0, text=f"0/{n_questions} answered")

    user_answers = {}
    for i, q in enumerate(quiz["questions"]):
        st.markdown(f"**{i + 1}. {q['question']}**")
        user_answers[i] = st.pills(
            label=f"Options for Q{i + 1}",
            options=q["options"],
            key=f"quiz_q_pills_{i}",
            label_visibility="collapsed",
        )

    answered_count = sum(1 for v in user_answers.values() if v is not None)
    st.progress(answered_count / n_questions, text=f"{answered_count}/{n_questions} answered")

    col_submit, col_reset = st.columns([1, 1])
    with col_submit:
        submitted = st.button("Check answers", type="primary", disabled=answered_count < n_questions)
    with col_reset:
        if st.button("Try Again", type="secondary"):
            st.session_state["current_quiz"] = None
            st.rerun()

    if submitted or st.session_state.get("quiz_submitted"):
        st.session_state["quiz_submitted"] = True
        score = 0
        for i, q in enumerate(quiz["questions"]):
            correct_option = q["options"][q["correct_index"]]
            selected = user_answers.get(i)
            if selected == correct_option:
                score += 1

        quiz_topic_name = st.session_state.get("current_quiz_topic", quiz.get("topic", "general"))
        st.session_state.student_model.record_quiz_result(quiz_topic_name, correct=score, total=n_questions)
        percentage = score / n_questions * 100

        if percentage == 100:
            st.balloons()
            st.success(f"**Perfect score!** {score}/{n_questions} (100%)")
        elif percentage >= 80:
            st.success(f"**Great job!** {score}/{n_questions} ({percentage:.0f}%)")
        elif percentage >= 60:
            st.info(f"**Good effort!** {score}/{n_questions} ({percentage:.0f}%) - review the explanations below")
        else:
            st.warning(f"**Keep studying!** {score}/{n_questions} ({percentage:.0f}%) - review the explanations below")

        st.markdown("---")
        for i, q in enumerate(quiz["questions"]):
            correct_option = q["options"][q["correct_index"]]
            selected = user_answers.get(i)
            with st.container():
                cols = st.columns([1, 20])
                if selected == correct_option:
                    cols[0].markdown("Correct")
                    with cols[1]:
                        st.success(f"**Q{i + 1}: {q['question']}**")
                        st.caption(f"Correct! {q['explanation']}")
                else:
                    cols[0].markdown("Incorrect")
                    with cols[1]:
                        st.error(f"**Q{i + 1}: {q['question']}**")
                        st.caption(f"Your answer: {selected or '(none selected)'}")
                        st.caption(f"Correct answer: **{correct_option}**")
                        st.caption(f"{q['explanation']}")
                st.divider()

