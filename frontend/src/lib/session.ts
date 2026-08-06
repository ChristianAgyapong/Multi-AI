const SESSION_STORAGE_KEY = "multimodal-edu-tutor-session-id";

export function getStoredSessionId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(SESSION_STORAGE_KEY);
}

export function setStoredSessionId(sessionId: string | null | undefined) {
  if (typeof window === "undefined") return;
  if (sessionId) {
    window.localStorage.setItem(SESSION_STORAGE_KEY, sessionId);
  } else {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }
}

export function withSessionHeaders(headers: HeadersInit = {}): HeadersInit {
  const sessionId = getStoredSessionId();
  if (!sessionId) return headers;

  if (headers instanceof Headers) {
    const next = new Headers(headers);
    next.set("X-Session-Id", sessionId);
    return next;
  }

  if (Array.isArray(headers)) {
    return [...headers, ["X-Session-Id", sessionId]];
  }

  return { ...headers, "X-Session-Id": sessionId };
}