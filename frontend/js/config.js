/**
 * Multimodal AI Tutor — Configuration
 *
 * Central configuration: API base URL, constants, and shared utilities.
 *
 * The frontend is normally served by the FastAPI backend (SERVE_FRONTEND=1),
 * in which case API calls go to the same origin. If the frontend is hosted
 * separately (e.g. on Vercel/Netlify), set `API_BASE` in localStorage
 * (key: `tutor_api_base`) or via the global `window.TUTOR_API_BASE`.
 */
(function () {
  // Allow override via localStorage (set once from the UI "Connection" settings)
  const stored = (() => {
    try {
      return localStorage.getItem('tutor_api_base') || '';
    } catch (e) {
      return '';
    }
  })();

  const API_BASE = stored
    ? stored.replace(/\/+$/, '')
    : (window.TUTOR_API_BASE || window.location.origin).replace(/\/+$/, '');

  window.CONFIG = {
    /** Base URL for the FastAPI backend */
    API_BASE,

    /** Default number of quiz questions */
    DEFAULT_QUIZ_COUNT: 5,

    /** Max quiz questions allowed */
    MAX_QUIZ_COUNT: 15,

    /** Quick action prompts for the welcome screen */
    QUICK_ACTIONS: [
      { label: 'Explain photosynthesis', prompt: 'Explain photosynthesis step by step' },
      { label: 'Quadratic equations', prompt: 'Help me solve x squared minus 5x plus 6 equals 0' },
      { label: 'What are mitochondria?', prompt: 'What are mitochondria and what do they do?' },
      { label: 'French Revolution', prompt: 'What were the main causes of the French Revolution?' },
    ],

    /** Agent modes available (mirrors backend AGENT_MODES) */
    AGENT_MODES: [
      { value: 'tutor', label: '🧑‍🏫 Tutor', hint: 'Step-by-step explanations' },
      { value: 'socratic_peer', label: '💭 Socratic Peer', hint: 'Guiding questions' },
      { value: 'quiz_master', label: '📝 Quiz Master', hint: 'Test yourself' },
      { value: 'debugger', label: '🐛 Debugger', hint: 'Code & math' },
    ],

    /** Application version (displayed in sidebar footer) */
    VERSION: '2.0.0',
  };
})();

