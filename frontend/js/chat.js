/**
 * Multimodal AI Tutor — Chat Module
 *
 * Handles:
 * - Chat message rendering with Markdown
 * - SSE streaming from /ask/stream endpoint
 * - Image upload (attach button) + clipboard paste (Ctrl+V)
 * - Auto-resizing multi-line input
 * - Voice input (Speech-to-Text) via /transcribe
 * - TTS "Read aloud" with word-by-word highlighting
 * - In-chat interactive quiz cards
 * - Retry on connection error
 * - Welcome screen with quick actions
 */

let currentBase64Image = null;
let currentImageMime = null;
const chatHistory = []; // for context in future requests

/** Initialize chat functionality */
function initChat() {
  const chatForm = document.getElementById('chatForm');
  if (chatForm) chatForm.addEventListener('submit', onSendMessage);

  const imgUpload = document.getElementById('imgUpload');
  if (imgUpload) imgUpload.addEventListener('change', onImageUpload);

  const micBtn = document.getElementById('micBtn');
  if (micBtn) {
    micBtn.addEventListener('mousedown', startRecording);
    micBtn.addEventListener('mouseup', stopRecording);
    micBtn.addEventListener('mouseleave', stopRecording);
    micBtn.addEventListener('touchstart', (e) => { e.preventDefault(); startRecording(); });
    micBtn.addEventListener('touchend', stopRecording);
    micBtn.addEventListener('touchcancel', stopRecording);
  }

  // Auto-resize the chat input
  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    chatInput.addEventListener('input', autoResizeInput);
    chatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        chatForm.dispatchEvent(new Event('submit'));
      }
    });
  }

  // Clipboard paste support
  document.addEventListener('paste', onPaste);

  renderWelcomeScreen();
}

/** Auto-grow the textarea up to a max height */
function autoResizeInput() {
  const el = document.getElementById('chatInput');
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

/** Handle clipboard paste (image) */
function onPaste(e) {
  const items = e.clipboardData && e.clipboardData.items;
  if (!items) return;
  for (const item of items) {
    if (item.type && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        setImageFromFile(file);
        e.preventDefault();
        showToast('Image attached from clipboard', 'info', 2500);
      }
      break;
    }
  }
}

/** Set an image from a File object (shared by upload & paste) */
function setImageFromFile(file) {
  if (!file.type.startsWith('image/')) {
    showToast('Please select a valid image file (PNG, JPEG).', 'error');
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    showToast('Image must be under 10MB.', 'error');
    return;
  }
  const reader = new FileReader();
  reader.onload = function (event) {
    const dataUrl = event.target.result;
    currentImageMime = dataUrl.split(';')[0].split(':')[1];
    currentBase64Image = dataUrl.split(',')[1];
    const preview = document.getElementById('imgPreview');
    const container = document.getElementById('imagePreviewContainer');
    if (preview && container) {
      preview.src = dataUrl;
      container.style.display = 'flex';
    }
  };
  reader.onerror = function () {
    showToast('Failed to read image file.', 'error');
  };
  reader.readAsDataURL(file);
}

/** Handle image file selection and preview */
function onImageUpload(e) {
  const file = e.target.files[0];
  if (!file) return;
  setImageFromFile(file);
  e.target.value = '';
}

/** Remove attached image */
function removeImage() {
  currentBase64Image = null;
  currentImageMime = null;
  const upload = document.getElementById('imgUpload');
  const container = document.getElementById('imagePreviewContainer');
  if (upload) upload.value = '';
  if (container) container.style.display = 'none';
}
window.removeImage = removeImage;

/** Render the welcome screen with quick action buttons */
function renderWelcomeScreen() {
  const chatContainer = document.getElementById('chatHistory');
  if (!chatContainer) return;
  if (chatContainer.querySelector('.welcome-container')) return;

  chatContainer.innerHTML = `
    <div class="welcome-container" id="welcomeScreen">
      <div class="welcome-badge">🎓</div>
      <h1>Multimodal AI Tutor</h1>
      <p class="welcome-sub">
        Ask questions in text, upload a photo of handwritten work, paste an image,
        or generate a quiz on any topic. Powered by free AI.
      </p>
      <div class="quick-actions" id="quickActions"></div>
      <p class="welcome-hint">💡 Tip: You can paste an image (Ctrl+V) or attach one with the 📷 button.</p>
    </div>
  `;

  const quickActionsContainer = document.getElementById('quickActions');
  window.CONFIG.QUICK_ACTIONS.forEach((action) => {
    const btn = document.createElement('button');
    btn.className = 'quick-action-btn';
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      const welcome = document.getElementById('welcomeScreen');
      if (welcome) welcome.remove();
      document.getElementById('chatInput').value = action.prompt;
      autoResizeInput();
      document.getElementById('chatForm').dispatchEvent(new Event('submit'));
    });
    quickActionsContainer.appendChild(btn);
  });
}

// ==========================================
// Voice Input (Speech-to-Text)
// ==========================================
let mediaRecorder = null;
let audioChunks = [];

async function startRecording() {
  if (mediaRecorder && mediaRecorder.state === 'recording') return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream);
    audioChunks = [];

    mediaRecorder.ondataavailable = (event) => {
      audioChunks.push(event.data);
    };

    mediaRecorder.onstop = async () => {
      const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
      stream.getTracks().forEach((track) => track.stop());
      await sendAudioForTranscription(audioBlob);
    };

    mediaRecorder.start();
    const micBtn = document.getElementById('micBtn');
    if (micBtn) micBtn.classList.add('recording');
  } catch (err) {
    console.error('Error accessing microphone:', err);
    showToast('Microphone access denied or unavailable.', 'error');
  }
}

function stopRecording() {
  if (!mediaRecorder || mediaRecorder.state !== 'recording') return;
  mediaRecorder.stop();
  const micBtn = document.getElementById('micBtn');
  if (micBtn) micBtn.classList.remove('recording');
}

async function sendAudioForTranscription(blob) {
  const chatInput = document.getElementById('chatInput');
  const originalPlaceholder = chatInput.placeholder;
  chatInput.placeholder = 'Transcribing...';
  chatInput.disabled = true;

  const formData = new FormData();
  formData.append('audio', blob, 'audio.webm');

  try {
    const response = await apiFetch('/transcribe', {
      method: 'POST',
      body: formData,
    });
    const data = await response.json();
    const transcribedText = data.text ? data.text.trim() : '';
    if (transcribedText) {
      chatInput.value = (chatInput.value + ' ' + transcribedText).trim();
      autoResizeInput();
      document.getElementById('sendBtn').click();
    } else {
      chatInput.focus();
    }
  } catch (err) {
    console.error('Transcription error:', err);
    showToast('Transcription failed: ' + err.message, 'error');
  } finally {
    chatInput.placeholder = originalPlaceholder;
    chatInput.disabled = false;
  }
}

// ==========================================
// In-chat Interactive Quiz cards
// ==========================================
function renderQuizUI(text) {
  // Hide incomplete quiz blocks during stream
  if (text.includes('[QUIZ_UI]') && !text.includes('[/QUIZ_UI]')) {
    return text.replace(/\[QUIZ_UI\][\s\S]*/, '<div class="quiz-results glass card"><div class="typing-indicator"><span></span><span></span><span></span></div><p style="text-align:center; color:var(--text-muted);">Generating Quiz...</p></div>');
  }

  // Replace complete quiz blocks with interactive HTML
  return text.replace(/\[QUIZ_UI\]([\s\S]*?)\[\/QUIZ_UI\]/g, (match, jsonStr) => {
    try {
      const data = JSON.parse(jsonStr.trim());
      const id = 'quiz_' + Date.now() + Math.floor(Math.random() * 1000);
      let html = `<div class="quiz-results glass card" id="${id}" style="margin-top:1rem;">`;
      html += `<h4 style="margin-bottom:1rem; color:var(--primary);">${escHtml(data.question)}</h4>`;
      html += `<div class="quiz-options" style="display:flex; flex-direction:column; gap:0.5rem;">`;
      data.options.forEach((opt, idx) => {
        const safeExp = escHtml(data.explanation || '').replace(/'/g, "\\'");
        html += `<button class="btn chat-option" style="text-align:left; background:var(--bg-card); color:var(--text-main);"
                 onclick="handleChatQuizAnswer('${id}', ${idx}, ${data.correct_index}, '${safeExp}')">
                   ${String.fromCharCode(65 + idx)}. ${escHtml(opt)}
                 </button>`;
      });
      html += `</div></div>`;
      return html;
    } catch (e) {
      console.error('Failed to parse quiz JSON', e);
      return '<p style="color:var(--danger)">Error rendering quiz.</p>';
    }
  });
}

// Global click handler for in-chat quizzes
window.handleChatQuizAnswer = function (containerId, selectedIdx, correctIdx, explanation) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const buttons = container.querySelectorAll('button');
  buttons.forEach((btn, idx) => {
    btn.disabled = true;
    if (idx === correctIdx) {
      btn.style.background = 'rgba(16,185,129,0.15)';
      btn.style.borderColor = 'var(--success)';
      btn.style.color = 'var(--success)';
    } else if (idx === selectedIdx) {
      btn.style.background = 'rgba(244,63,94,0.12)';
      btn.style.borderColor = 'var(--danger)';
      btn.style.color = 'var(--danger)';
    } else {
      btn.style.opacity = '0.5';
    }
  });

  const feedback = document.createElement('div');
  feedback.style.marginTop = '1rem';
  feedback.style.padding = '0.75rem';
  feedback.style.borderRadius = 'var(--radius)';
  feedback.style.fontSize = '0.9rem';
  if (selectedIdx === correctIdx) {
    feedback.style.background = 'rgba(16,185,129,0.1)';
    feedback.style.borderLeft = '4px solid var(--success)';
    feedback.innerHTML = `<strong>✅ Correct!</strong><br><span style="color:var(--text-muted);">${escHtml(explanation)}</span>`;
  } else {
    feedback.style.background = 'rgba(244,63,94,0.1)';
    feedback.style.borderLeft = '4px solid var(--danger)';
    feedback.innerHTML = `<strong>❌ Incorrect</strong><br><span style="color:var(--text-muted);">${escHtml(explanation)}</span>`;
  }
  container.appendChild(feedback);
};

// ==========================================
// Chat sending + SSE streaming
// ==========================================
async function onSendMessage(e) {
  e.preventDefault();

  const input = document.getElementById('chatInput');
  const question = input.value.trim();
  if (!question && !currentBase64Image) return;

  const sendBtn = document.getElementById('sendBtn');
  const chatContainer = document.getElementById('chatHistory');

  const welcome = document.getElementById('welcomeScreen');
  if (welcome) welcome.remove();

  // Append user message
  appendMessage('user', question || '(Sent an image)', currentBase64Image ? null : null);

  // Build request body
  const requestBody = {
    question: question || '(Attached image)',
    agent_mode: document.getElementById('agentMode') ? document.getElementById('agentMode').value : 'tutor',
    stream: true,
    use_context: true,
    history: chatHistory.slice(-8),
  };

  if (currentBase64Image) {
    requestBody.image_base64 = currentBase64Image;
    requestBody.image_media_type = currentImageMime;
    removeImage();
  }

  // Clear input
  input.value = '';
  input.style.height = 'auto';
  sendBtn.disabled = true;

  // Create assistant placeholder
  const msgDiv = document.createElement('div');
  msgDiv.className = 'message tutor glass';
  const contentDiv = document.createElement('div');
  contentDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
  msgDiv.appendChild(contentDiv);
  chatContainer.appendChild(msgDiv);
  scrollToBottom();

  let fullAnswer = '';
  let receivedTokens = false;
  let errorMsg = null;

  try {
    const response = await apiFetch('/ask/stream', {
      method: 'POST',
      body: JSON.stringify(requestBody),
    });

    await readSSE(response, (data) => {
      if (data.type === 'token' && data.text) {
        receivedTokens = true;
        if (data.text.includes('**Error:**') || data.text.includes('Cannot connect')) {
          errorMsg = data.text;
        }
        fullAnswer += data.text;
        let processedHtml = marked.parse(fullAnswer);
        contentDiv.innerHTML = renderQuizUI(processedHtml);
        scrollToBottom();
      }
    });

    // Add TTS controls if we got a response
    if (fullAnswer.trim() && !errorMsg) {
      const ttsBar = document.createElement('div');
      ttsBar.className = 'tts-controls';

      const playBtn = document.createElement('button');
      playBtn.className = 'tts-btn';
      playBtn.id = 'ttsPlay_' + Date.now();
      playBtn.innerHTML = '&#128266; Read aloud';

      const pauseBtn = document.createElement('button');
      pauseBtn.className = 'tts-btn';
      pauseBtn.innerHTML = '&#9646;&#9646; Pause';
      pauseBtn.style.display = 'none';

      const stopBtn = document.createElement('button');
      stopBtn.className = 'tts-btn';
      stopBtn.innerHTML = '&#9632; Stop';
      stopBtn.style.display = 'none';

      const progress = document.createElement('span');
      progress.className = 'tts-progress';

      playBtn.addEventListener('click', () => playTTS(fullAnswer, contentDiv, playBtn, pauseBtn, stopBtn, progress));
      pauseBtn.addEventListener('click', () => togglePauseTTS(pauseBtn));
      stopBtn.addEventListener('click', () => stopTTS(contentDiv, playBtn, pauseBtn, stopBtn, progress));

      ttsBar.appendChild(playBtn);
      ttsBar.appendChild(pauseBtn);
      ttsBar.appendChild(stopBtn);
      ttsBar.appendChild(progress);
      msgDiv.appendChild(ttsBar);
    }

    // If no tokens received but no error, show a hint
    if (!receivedTokens && !errorMsg) {
      contentDiv.innerHTML = `
        <p style="color:var(--warning);">The AI returned an empty response.</p>
        <p style="font-size:0.85rem; color:var(--text-muted); margin-top:0.5rem;">
          Check that Ollama is running or that your API keys are set in the <code>.env</code> file.
        </p>
      `;
    }

    // Store history for context
    chatHistory.push({ role: 'user', content: question || '(image)' });
    chatHistory.push({ role: 'assistant', content: fullAnswer });
    if (chatHistory.length > 20) chatHistory.splice(0, chatHistory.length - 20);

  } catch (error) {
    contentDiv.innerHTML = `
      <p style="color:var(--danger); font-weight:600;">Connection Error</p>
      <p style="font-size:0.9rem; margin-top:0.5rem; color:var(--text-muted);">
        ${escHtml(error.message || 'Could not reach the tutor service.')}
      </p>
      <button class="tts-btn" style="margin-top:0.75rem;" onclick="retryLastMessage()">Retry</button>
    `;
    window._lastQuestion = question;
    window._lastRequestBody = requestBody;
    showToast('Failed to get response: ' + error.message, 'error');
  } finally {
    sendBtn.disabled = false;
    input.focus();
    autoResizeInput();
  }
}

/** Retry sending the last message */
async function retryLastMessage() {
  if (!window._lastRequestBody) return;
  const chatContainer = document.getElementById('chatHistory');
  const messages = chatContainer.querySelectorAll('.message.tutor');
  if (messages.length > 0) messages[messages.length - 1].remove();
  const input = document.getElementById('chatInput');
  input.value = window._lastQuestion || '';
  autoResizeInput();
  document.getElementById('chatForm').dispatchEvent(new Event('submit'));
}
window.retryLastMessage = retryLastMessage;

/** Append a message bubble to the chat */
function appendMessage(role, text) {
  const chatContainer = document.getElementById('chatHistory');
  const msgDiv = document.createElement('div');
  msgDiv.className = 'message ' + role + ' glass';
  msgDiv.innerHTML = '<div>' + marked.parse(text) + '</div>';
  chatContainer.appendChild(msgDiv);
  scrollToBottom();
}

/** Scroll chat to bottom */
function scrollToBottom() {
  const container = document.getElementById('chatHistory');
  if (container) container.scrollTop = container.scrollHeight;
}

// ==========================================
// TTS (Read Aloud) with word highlighting
// ==========================================
let _currentUtterance = null;
let _ttsWords = [];
let _ttsActiveIdx = -1;

function cleanTextForSpeech(text) {
  return text
    .replace(/#{1,6}\s*/g, '')
    .replace(/\*{1,3}|_{1,3}/g, '')
    .replace(/`+[^`]*`+/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/[^\x00-\x7F]/g, ' ')
    .replace(/\n{2,}/g, '. ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function wrapWordsForHighlight(contentDiv) {
  const walker = document.createTreeWalker(contentDiv, NodeFilter.SHOW_TEXT, null);
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement && node.parentElement.closest('code, pre,.quiz-options,.tts-controls')) continue;
    textNodes.push(node);
  }
  textNodes.forEach((textNode) => {
    const words = textNode.textContent.split(/(\s+)/);
    const frag = document.createDocumentFragment();
    words.forEach((part) => {
      if (/^\s+$/.test(part) || part === '') {
        frag.appendChild(document.createTextNode(part));
      } else {
        const span = document.createElement('span');
        span.className = 'tts-word';
        span.textContent = part;
        frag.appendChild(span);
      }
    });
    textNode.parentNode.replaceChild(frag, textNode);
  });
  return contentDiv.querySelectorAll('.tts-word');
}

function unwrapWords(contentDiv) {
  contentDiv.querySelectorAll('.tts-word').forEach((span) => {
    span.replaceWith(document.createTextNode(span.textContent));
  });
}

function playTTS(rawText, contentDiv, playBtn, pauseBtn, stopBtn, progressEl) {
  if (!rawText) return;
  if (window.speechSynthesis.speaking || window.speechSynthesis.pending) return;

  const cleanText = cleanTextForSpeech(rawText);
  if (!cleanText) return;

  _ttsWords = Array.from(wrapWordsForHighlight(contentDiv));
  _ttsActiveIdx = -1;
  const totalWords = _ttsWords.length;

  const utterance = new SpeechSynthesisUtterance(cleanText);
  utterance.lang = 'en-US';
  utterance.rate = 0.92;
  utterance.pitch = 1.0;
  utterance.volume = 1.0;

  const voices = window.speechSynthesis.getVoices();
  const preferred =
    voices.find((v) => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Samantha') || v.name.includes('Natural'))) ||
    voices.find((v) => v.lang.startsWith('en-'));
  if (preferred) utterance.voice = preferred;

  utterance.onboundary = (e) => {
    if (e.name !== 'word') return;
    if (_ttsActiveIdx >= 0 && _ttsWords[_ttsActiveIdx]) {
      _ttsWords[_ttsActiveIdx].classList.remove('tts-active');
    }
    _ttsActiveIdx = Math.min(_ttsActiveIdx + 1, _ttsWords.length - 1);
    const activeSpan = _ttsWords[_ttsActiveIdx];
    if (activeSpan) {
      activeSpan.classList.add('tts-active');
      activeSpan.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (progressEl) progressEl.textContent = `${_ttsActiveIdx + 1} / ${totalWords} words`;
  };

  const resetUI = () => {
    _ttsWords.forEach((w) => w.classList.remove('tts-active'));
    unwrapWords(contentDiv);
    _ttsWords = [];
    _ttsActiveIdx = -1;
    _currentUtterance = null;
    playBtn.disabled = false;
    playBtn.innerHTML = '&#128266; Read aloud';
    playBtn.classList.remove('active');
    pauseBtn.style.display = 'none';
    stopBtn.style.display = 'none';
    if (progressEl) progressEl.textContent = '';
  };

  utterance.onend = resetUI;
  utterance.onerror = (e) => {
    if (e.error !== 'interrupted' && e.error !== 'canceled') {
      showToast('Speech error: ' + e.error, 'error');
    }
    resetUI();
  };

  _currentUtterance = utterance;
  window.speechSynthesis.speak(utterance);

  playBtn.disabled = true;
  playBtn.innerHTML = '&#128266; Reading...';
  playBtn.classList.add('active');
  pauseBtn.style.display = '';
  pauseBtn.innerHTML = '&#9646;&#9646; Pause';
  stopBtn.style.display = '';
}

function togglePauseTTS(pauseBtn) {
  if (!window.speechSynthesis.speaking && !window.speechSynthesis.paused) return;
  if (window.speechSynthesis.paused) {
    window.speechSynthesis.resume();
    pauseBtn.innerHTML = '&#9646;&#9646; Pause';
    pauseBtn.classList.remove('active');
    if (_ttsWords[_ttsActiveIdx]) _ttsWords[_ttsActiveIdx].classList.add('tts-active');
  } else {
    window.speechSynthesis.pause();
    pauseBtn.innerHTML = '&#9654; Resume';
    pauseBtn.classList.add('active');
  }
}

function stopTTS(contentDiv, playBtn, pauseBtn, stopBtn, progressEl) {
  window.speechSynthesis.cancel();
  _ttsWords.forEach((w) => w.classList.remove('tts-active'));
  unwrapWords(contentDiv);
  _ttsWords = [];
  _ttsActiveIdx = -1;
  _currentUtterance = null;
  playBtn.disabled = false;
  playBtn.innerHTML = '&#128266; Read aloud';
  playBtn.classList.remove('active');
  pauseBtn.style.display = 'none';
  stopBtn.style.display = 'none';
  if (progressEl) progressEl.textContent = '';
}
