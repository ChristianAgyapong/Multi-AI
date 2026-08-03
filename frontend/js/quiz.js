/**
 * Multimodal AI Tutor — Quiz Module
 *
 * Handles quiz generation, rendering, option selection, answer checking,
 * and results display. Difficulty selection is included.
 */

let currentQuizData = null;

/** Initialize quiz form submission handler */
function initQuiz() {
  const quizForm = document.getElementById('quizForm');
  if (quizForm) quizForm.addEventListener('submit', onGenerateQuiz);
}

/** Handle quiz generation form submission */
async function onGenerateQuiz(e) {
  e.preventDefault();

  const topic = document.getElementById('quizTopic').value.trim();
  const countEl = document.getElementById('quizCount');
  let count = parseInt(countEl.value, 10) || window.CONFIG.DEFAULT_QUIZ_COUNT;
  count = Math.max(3, Math.min(count, window.CONFIG.MAX_QUIZ_COUNT));
  const difficulty = document.getElementById('quizDifficulty') ? document.getElementById('quizDifficulty').value : 'standard';

  if (!topic) {
    showToast('Please enter a topic for the quiz.', 'warning');
    return;
  }

  // Reset UI state
  document.getElementById('quizArea').innerHTML = '';
  const resultsEl = document.getElementById('quizResults');
  resultsEl.style.display = 'none';
  document.getElementById('checkAnswersWrapper').style.display = 'none';
  document.getElementById('quizLoader').style.display = 'block';
  document.getElementById('generateQuizBtn').disabled = true;

  try {
    const res = await apiFetch('/quiz', {
      method: 'POST',
      body: JSON.stringify({
        topic,
        num_questions: count,
        use_context: true,
        difficulty,
      }),
    });
    const data = await res.json();
    currentQuizData = data.quiz;
    renderQuiz(currentQuizData);
  } catch (err) {
    document.getElementById('quizArea').innerHTML = `
      <div class="glass card" style="text-align:center; padding:2rem;">
        <p style="color:var(--danger); font-size:1.1rem;">⚠️ Failed to generate quiz</p>
        <p style="color:var(--text-muted); margin-top:0.5rem;">${escHtml(err.message)}</p>
        <button class="btn" style="margin-top:1rem; max-width:200px; margin-left:auto; margin-right:auto;"
                onclick="document.getElementById('quizForm').dispatchEvent(new Event('submit'))">Retry</button>
      </div>
    `;
    showToast('Quiz generation failed: ' + err.message, 'error');
  } finally {
    document.getElementById('quizLoader').style.display = 'none';
    document.getElementById('generateQuizBtn').disabled = false;
  }
}

/** Render quiz questions into the DOM */
function renderQuiz(quiz) {
  if (!quiz || !quiz.questions || quiz.questions.length === 0) {
    document.getElementById('quizArea').innerHTML = `
      <div class="glass card" style="text-align:center; padding:2rem;">
        <p style="color:var(--warning);">No questions were generated. Try a different topic.</p>
      </div>
    `;
    return;
  }

  const area = document.getElementById('quizArea');
  let html = `<div class="glass card" style="margin-bottom:1rem; text-align:center;">
    <p style="color:var(--text-muted); font-size:0.9rem;">
      Topic: <strong style="color:var(--text-main);">${escHtml(quiz.topic || '')}</strong>
      · ${quiz.questions.length} questions
    </p>
  </div>`;

  quiz.questions.forEach((q, qIndex) => {
    html += `
      <div class="question-card glass" id="qcard-${qIndex}">
        <div class="question-text">${qIndex + 1}. ${escHtml(q.question)}</div>
        <div class="options-grid">
    `;
    q.options.forEach((opt, oIndex) => {
      html += `
        <label class="option-label" id="lbl-${qIndex}-${oIndex}" onclick="selectQuizOption(${qIndex}, ${oIndex})">
          <input type="radio" name="q${qIndex}" value="${oIndex}">
          <span class="option-letter">${String.fromCharCode(65 + oIndex)}</span>
          <span>${escHtml(opt)}</span>
        </label>
      `;
    });
    html += `
        </div>
        <div class="explanation" id="exp-${qIndex}"></div>
      </div>
    `;
  });

  area.innerHTML = html;
  document.getElementById('checkAnswersWrapper').style.display = 'block';
}

/** Handle option selection (visual highlight) */
function selectQuizOption(qIndex, oIndex) {
  const labels = document.querySelectorAll(`#qcard-${qIndex} .option-label`);
  labels.forEach((l) => l.classList.remove('selected'));

  const selected = document.getElementById(`lbl-${qIndex}-${oIndex}`);
  if (selected) {
    selected.classList.add('selected');
    const radio = selected.querySelector('input');
    if (radio) radio.checked = true;
  }
}
window.selectQuizOption = selectQuizOption;

/** Check answers and display results */
async function checkAnswers() {
  if (!currentQuizData) return;

  let score = 0;
  const total = currentQuizData.questions.length;
  const allAnswered = currentQuizData.questions.every((_, i) => {
    const radios = document.getElementsByName(`q${i}`);
    return Array.from(radios).some((r) => r.checked);
  });

  if (!allAnswered) {
    showToast('Please answer all questions before checking.', 'info');
    return;
  }

  currentQuizData.questions.forEach((q, qIndex) => {
    const radios = document.getElementsByName(`q${qIndex}`);
    let selectedIdx = -1;
    for (const r of radios) {
      if (r.checked) {
        selectedIdx = parseInt(r.value, 10);
        break;
      }
    }

    const expDiv = document.getElementById(`exp-${qIndex}`);
    expDiv.innerHTML = marked.parse(q.explanation);
    expDiv.style.display = 'block';

    const labels = document.querySelectorAll(`#qcard-${qIndex} .option-label`);
    labels.forEach((l) => l.classList.add('disabled'));
    radios.forEach((r) => (r.disabled = true));

    if (selectedIdx !== -1) {
      const selectedLbl = document.getElementById(`lbl-${qIndex}-${selectedIdx}`);
      if (selectedIdx === q.correct_index) {
        selectedLbl.classList.add('correct');
        score++;
      } else {
        selectedLbl.classList.add('incorrect');
        const correctLbl = document.getElementById(`lbl-${qIndex}-${q.correct_index}`);
        if (correctLbl) correctLbl.classList.add('correct');
      }
    } else {
      const correctLbl = document.getElementById(`lbl-${qIndex}-${q.correct_index}`);
      if (correctLbl) correctLbl.classList.add('correct');
    }
  });

  // Show results
  const results = document.getElementById('quizResults');
  results.style.display = 'block';
  const pct = Math.round((score / total) * 100);

  let msg, emoji;
  if (pct === 100) { msg = 'Perfect Score!'; emoji = '🏆'; }
  else if (pct >= 80) { msg = 'Great Job!'; emoji = '🌟'; }
  else if (pct >= 60) { msg = 'Good Effort!'; emoji = '👍'; }
  else { msg = 'Keep Studying!'; emoji = '📚'; }

  results.innerHTML = `
    <h3>${emoji} ${msg}</h3>
    <p style="font-size:2rem; margin:1rem 0;"><strong>${score}</strong> / ${total}</p>
    <p style="font-size:1.2rem; color:${pct >= 60 ? 'var(--success)' : 'var(--warning)'};">${pct}%</p>
    <div class="result-bar"><div class="result-bar-fill" style="width:${pct}%"></div></div>
  `;

  document.getElementById('checkAnswersWrapper').style.display = 'none';

  // Refresh profile in sidebar (quiz results update knowledge tracing)
  if (typeof loadStudentProfile === 'function') loadStudentProfile();
}
window.checkAnswers = checkAnswers;
