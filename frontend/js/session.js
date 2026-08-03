/**
 * Multimodal AI Tutor — Session Management
 *
 * Handles:
 * - UUID v4 generation for anonymous session IDs
 * - Persisting session ID to localStorage
 * - Injecting X-Session-Id header into all API requests
 * - A shared SSE (Server-Sent Events) reader helper
 * - JSON/error helpers
 */

/** Generate a UUID v4 (RFC 4122 compliant) */
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Get or create a persistent session ID */
function getSessionId() {
  const STORAGE_KEY = 'multimodal_tutor_session_id';
  let sid = null;
  try {
    sid = localStorage.getItem(STORAGE_KEY);
  } catch (e) {
    /* ignore */
  }
  if (!sid) {
    sid = generateUUID();
    try {
      localStorage.setItem(STORAGE_KEY, sid);
    } catch (e) {
      /* ignore */
    }
  }
  return sid;
}

/**
 * Fetch wrapper that automatically includes:
 * - X-Session-Id header
 * - JSON Content-Type for POST/PUT with body
 * - Standard error handling
 *
 * @param {string} endpoint - API path (e.g., '/ask/stream')
 * @param {object} options - Fetch options (method, body, etc.)
 * @returns {Promise<Response>}
 */
async function apiFetch(endpoint, options = {}) {
  const headers = options.headers || {};

  // Always attach session ID
  headers['X-Session-Id'] = getSessionId();

  // Set JSON content-type for POST/PUT with body
  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const url = `${window.CONFIG.API_BASE}${endpoint}`;
  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const errData = await response.json();
      detail = errData.detail || detail;
    } catch (e) {
      // ignore parse errors
    }
    throw new Error(detail);
  }

  return response;
}

/**
 * Read a streaming SSE response body, invoking `onEvent` for each parsed
 * `data:` JSON object.
 *
 * @param {Response} response - response from fetch with a readable body
 * @param {(event: object) => void} onEvent - called for each SSE event
 * @returns {Promise<void>} resolves when the stream ends
 */
async function readSSE(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let done = false;

  while (!done) {
    const { value, done: isDone } = await reader.read();
    done = isDone;
    if (value) {
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() || '';
      for (const chunk of chunks) {
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.substring(6).trim();
            if (!jsonStr) continue;
            try {
              onEvent(JSON.parse(jsonStr));
            } catch (e) {
              // ignore malformed events
            }
          }
        }
      }
    }
  }
  // Flush any trailing buffer
  if (buffer.trim()) {
    const lines = buffer.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.substring(6).trim();
        if (!jsonStr) continue;
        try {
          onEvent(JSON.parse(jsonStr));
        } catch (e) {
          /* ignore */
        }
      }
    }
  }
}

/**
 * Show a toast notification to the user.
 * @param {string} message - Message text
 * @param {'error'|'success'|'info'|'warning'} type - Toast style
 * @param {number} duration - Auto-dismiss in ms (0 = persistent)
 */
function showToast(message, type = 'error', duration = 5000) {
  // Remove existing toasts
  document.querySelectorAll('.toast').forEach((t) => t.remove());

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  if (duration > 0) {
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transition = 'opacity 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
}

/** Escape HTML to prevent XSS */
function escHtml(str) {
  if (str === null || str === undefined) return '';
  const div = document.createElement('div');
  div.textContent = String(str);
  return div.innerHTML;
}

/** Debounce a function call */
function debounce(fn, wait) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}
