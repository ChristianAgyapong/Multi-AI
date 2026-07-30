/**
 * Multimodal AI Tutor — Configuration
 * 
 * Central configuration: API base URL, constants, and shared utilities.
 */
const CONFIG = {
    /** Base URL for the FastAPI backend. Uses same origin in dev. */
    API_BASE: window.location.origin,

    /** Default number of quiz questions */
    DEFAULT_QUIZ_COUNT: 5,

    /** Quick action prompts for the welcome screen */
    QUICK_ACTIONS: [
        { label: 'Explain photosynthesis', prompt: 'Explain photosynthesis step by step' },
        { label: 'Quadratic equations', prompt: 'Help me solve x squared minus 5x plus 6 equals 0' },
        { label: 'What are mitochondria?', prompt: 'What are mitochondria and what do they do?' },
        { label: 'French Revolution', prompt: 'What were the main causes of the French Revolution?' },
    ],

    /** Application version (displayed in sidebar footer) */
    VERSION: '2.0.0',
};

