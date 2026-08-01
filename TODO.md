# Fix Plan for app.py

## Errors Found
1. **Line 376 SyntaxWarning**: `\s` in JavaScript regex inside Python f-string is treated as invalid Python escape sequence (lines 333-334)
2. **Line 492 IndentationError**: Orphaned `difficulty_hint` code not inside any block
3. **Missing `with tab_quiz:` block**: Quiz tab code (lines 499+) is floating without container and missing `try:` statement

## Fix Steps
- [x] Step 1: Fix SyntaxWarning - Change `/\s/` → `/\\s/` in JavaScript inside Python f-string
- [x] Step 2: Remove orphaned lines 492-495 (leftover difficulty_hint code)
- [x] Step 3: Add missing `with tab_quiz:` block and `try:` statement, wrapping quiz code properly
- [x] Step 4: Verify the app starts without errors (py_compile passed, no SyntaxWarnings, streamlit boot test HTTP 200)

## Summary
- **Line 376 SyntaxWarning**: Fixed by escaping `\s` → `\\s` in JavaScript regex inside Python f-string (lines 333-334)
- **Line 492 IndentationError**: Fixed by replacing orphaned `difficulty_hint` code with a proper `with tab_quiz:` block
- **Missing `try:` / quiz generation**: Added complete quiz generation UI (topic, difficulty, question count) inside `with tab_quiz:`
- **Runtime bug**: Fixed `student_model.record_quiz_result(...)` → `st.session_state.student_model.record_quiz_result(...)` so the quiz tab can access the student model

