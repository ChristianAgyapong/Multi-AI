/**
 * Multimodal AI Tutor — Quiz Module
 * 
 * Handles quiz generation, rendering, option selection, answer checking,
 * and results display.
 */
let currentQuizData = null;

/** Initialize quiz form submission handler */
function initQuiz() {
    const quizForm = document.getElementById('quizForm');
    if (quizForm) {
        quizForm.addEventListener('submit', onGenerateQuiz);
    }
}

/** Handle quiz generation form submission */
async function onGenerateQuiz(e) {
    e.preventDefault();
    
    const topic = document.getElementById('quizTopic').value.trim();
    const count = parseInt(document.getElementById('quizCount').value) || CONFIG.DEFAULT_QUIZ_COUNT;
    
    if (!topic) return;
    
    // Reset UI state
    document.getElementById('quizArea').innerHTML = '';
    document.getElementById('quizResults').style.display = 'none';
    document.getElementById('checkAnswersWrapper').style.display = 'none';
    document.getElementById('quizLoader').style.display = 'block';
    document.getElementById('generateQuizBtn').disabled = true;
    
    try {
        const res = await apiFetch('/quiz', {
            method: 'POST',
            body: JSON.stringify({
                topic: topic,
                num_questions: count,
                use_context: true,
            }),
        });
        
        const data = await res.json();
        currentQuizData = data.quiz;
        renderQuiz(currentQuizData);
        
    } catch (err) {
        document.getElementById('quizArea').innerHTML = `
            <div class="glass card" style="text-align:center; padding: 2rem;">
                <p style="color: var(--danger); font-size: 1.1rem;">⚠️ Failed to generate quiz</p>
                <p style="color: var(--text-muted); margin-top: 0.5rem;">${err.message}</p>
                <button class="btn" style="margin-top: 1rem; max-width: 200px; margin-left: auto; margin-right: auto;" 
                        onclick="document.getElementById('quizForm').dispatchEvent(new Event('submit'))">
                    Retry
                </button>
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
            <div class="glass card" style="text-align:center; padding: 2rem;">
                <p style="color: var(--warning);">No questions were generated. Try a different topic.</p>
            </div>
        `;
        return;
    }
    
    const area = document.getElementById('quizArea');
    let html = `<div class="glass card" style="margin-bottom: 1rem; text-align: center;">
        <p style="color: var(--text-muted); font-size: 0.9rem;">
            Topic: <strong style="color: var(--text-main);">${escHtml(quiz.topic || '')}</strong> 
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
    // Deselect all in this question
    const labels = document.querySelectorAll(`#qcard-${qIndex} .option-label`);
    labels.forEach(l => l.classList.remove('selected'));
    
    // Select clicked
    const selected = document.getElementById(`lbl-${qIndex}-${oIndex}`);
    if (selected) {
        selected.classList.add('selected');
        selected.querySelector('input').checked = true;
    }
}
// Make selectQuizOption globally accessible from onclick attributes
window.selectQuizOption = selectQuizOption;

/** Check answers and display results */
async function checkAnswers() {
    if (!currentQuizData) return;
    
    let score = 0;
    const total = currentQuizData.questions.length;
    const allAnswered = currentQuizData.questions.every((_, i) => {
        const radios = document.getElementsByName(`q${i}`);
        return Array.from(radios).some(r => r.checked);
    });
    
    if (!allAnswered) {
        showToast('Please answer all questions before checking.', 'info');
        return;
    }
    
    currentQuizData.questions.forEach((q, qIndex) => {
        const radios = document.getElementsByName(`q${qIndex}`);
        let selectedIdx = -1;
        for (let r of radios) {
            if (r.checked) {
                selectedIdx = parseInt(r.value);
                break;
            }
        }
        
        // Show explanation with render
        const expDiv = document.getElementById(`exp-${qIndex}`);
        expDiv.innerHTML = marked.parse(q.explanation);
        expDiv.style.display = 'block';
        
        // Disable all options
        const labels = document.querySelectorAll(`#qcard-${qIndex} .option-label`);
        labels.forEach(l => l.classList.add('disabled'));
        radios.forEach(r => r.disabled = true);
        
        // Mark correct/incorrect
        if (selectedIdx !== -1) {
            const selectedLbl = document.getElementById(`lbl-${qIndex}-${selectedIdx}`);
            if (selectedIdx === q.correct_index) {
                selectedLbl.classList.add('correct');
                score++;
            } else {
                selectedLbl.classList.add('incorrect');
                document.getElementById(`lbl-${qIndex}-${q.correct_index}`).classList.add('correct');
            }
        } else {
            // Missed
            document.getElementById(`lbl-${qIndex}-${q.correct_index}`).classList.add('correct');
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
        <p style="font-size: 2rem; margin: 1rem 0;">
            <strong>${score}</strong> / ${total}
        </p>
        <p style="font-size: 1.2rem; color: ${pct >= 60 ? 'var(--success)' : 'var(--warning)'};">
            ${pct}%
        </p>
    `;
    
    document.getElementById('checkAnswersWrapper').style.display = 'none';
}
// Make checkAnswers globally accessible
window.checkAnswers = checkAnswers;

/** Escapes HTML to prevent XSS */
function escHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

