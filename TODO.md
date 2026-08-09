# Task: Persist chat history across tab switches and page reloads

## Problem
Switching tabs (Chat → Quiz/Flashcards/Debate) destroys the active component because
`page.tsx` keys the tab panel with `<div key={activeTab}>`. The Chat component's local
`useState` message history is therefore lost when leaving the Chat tab.

## Solution
Persist chat messages to `localStorage` so they survive tab switches and page reloads.

## Steps
- [x] (Prior task) Add SMART FORMATTING guidance to `backend/tutor_engine.py`
- [x] 1. Explore frontend: `Chat.tsx`, `page.tsx`, `session.ts` — confirmed root cause
- [x] 2. Add `CHAT_STORAGE_KEY` + `loadStoredMessages()` helper in `Chat.tsx`
- [x] 3. Initialize `messages` state from localStorage
- [x] 4. Add a save effect (persist messages whenever they change)
- [x] 5. Clear saved chat (localStorage.removeItem) when the user clicks "Clear chat"
- [x] 6. Fix hydration mismatch: start state empty + restore stored messages in a mount-only `useEffect`
- [x] 7. Verify frontend type-checks and lints (`tsc --noEmit` and `eslint` both pass)

## Result
Chat history is retained when switching to any other screen and when the page reloads,
with no React hydration mismatch (server and client both render the empty state first,
then stored messages load on the client after mount).
