# Task: Teach the AI smart, judgment-based formatting (spacing, outline bulleting, standout indicators)

## Goal
Without forcing a single rigid rule on every chat, let the AI decide *when* spacing,
outline bulleting, and standout indicators genuinely make an explanation clearer and
more scannable — instead of producing thorough but flat walls of text.

## Steps
- [x] 1. Explore codebase: `tutor_engine.py`, `Chat.tsx`, `quiz.py`, `globals.css`, sample notes
- [x] 2. Add a "SMART FORMATTING" section to the tutor-agent prompt (judgment-based, with a before/after photosynthesis example)
- [x] 3. Add a global "SMART FORMATTING PRINCIPLE" to `get_system_prompt()` and extend the quality checklist (rule 9)
- [x] 4. Leave specialized mode instructions (socratic/quiz/debugger) intact; they inherit the global rule
- [x] 5. Verify the module still imports / prompt builds cleanly

## Result
- Tutor mode now formats for readability by judgment, not by rote.
- Global formatting principle + checklist items apply to every mode automatically.
- No frontend change required — Markdown headings/lists/tables/callouts are already rendered.

