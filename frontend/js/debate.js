/**
 * debate.js
 * Handles the Dual-AI Debate Mode (Feynman Technique).
 * Two AI agents: Fellow Student (wrong) and Tutor Grader.
 */

let debateTopic = '';
let fellowHistory = [];
let tutorHistory = [];

function initDebate() {
    const startBtn = document.getElementById('startDebateBtn');
    const debateForm = document.getElementById('debateForm');
    
    if (startBtn) startBtn.addEventListener('click', startDebate);
    if (debateForm) debateForm.addEventListener('submit', submitDebateReply);
}

async function startDebate() {
    const topicInput = document.getElementById('debateTopic');
    const topic = topicInput ? topicInput.value.trim() : '';
    if (!topic) {
        showToast('Please enter a topic to debate!', 'warning');
        return;
    }
    
    debateTopic = topic;
    fellowHistory = [];
    tutorHistory = [];
    
    document.getElementById('fellowMessages').innerHTML = '';
    document.getElementById('tutorMessages').innerHTML = '';
    document.getElementById('debateArena').style.display = 'none';
    document.getElementById('debateLoader').style.display = 'block';
    document.getElementById('startDebateBtn').disabled = true;
    
    try {
        const result = await callDebateAPI(null);
        document.getElementById('debateLoader').style.display = 'none';
        document.getElementById('debateArena').style.display = 'block';
        
        // Add Fellow Student's opening misconception
        addDebateMessage('fellow', result.fellow);
        fellowHistory.push({ role: 'assistant', content: result.fellow });
        
        // Show waiting message in Tutor panel
        addDebateMessage('tutor', '⏳ Waiting to evaluate your response...', true);
        
        document.getElementById('debateInput').focus();
    } catch (err) {
        document.getElementById('debateLoader').style.display = 'none';
        showToast('Failed to start debate: ' + err.message, 'error');
    } finally {
        document.getElementById('startDebateBtn').disabled = false;
    }
}

async function submitDebateReply(e) {
    e.preventDefault();
    
    const input = document.getElementById('debateInput');
    const correction = input.value.trim();
    if (!correction) return;
    
    input.value = '';
    const sendBtn = document.getElementById('debateSendBtn');
    sendBtn.disabled = true;
    
    // Show student's reply in Fellow Student panel (as a student bubble)
    addStudentBubble('fellow', correction);
    
    // Show loading in both panels
    const fellowLoader = addDebateMessage('fellow', '...', true);
    const tutorLoader = addDebateMessage('tutor', '...', true);
    
    try {
        const result = await callDebateAPI(correction);
        
        // Remove loaders
        if (fellowLoader) fellowLoader.remove();
        if (tutorLoader) tutorLoader.remove();
        
        // Update histories
        fellowHistory.push({ role: 'user', content: correction });
        fellowHistory.push({ role: 'assistant', content: result.fellow });
        
        if (result.tutor) {
            tutorHistory.push({ role: 'assistant', content: result.tutor });
        }
        
        // Display Fellow Student's reaction
        addDebateMessage('fellow', result.fellow);
        
        // Display Tutor's grade
        if (result.tutor) {
            // Remove waiting placeholder
            const tutorPanel = document.getElementById('tutorMessages');
            const placeholder = tutorPanel.querySelector('.placeholder-msg');
            if (placeholder) placeholder.remove();
            
            addDebateMessage('tutor', result.tutor);
        }
        
    } catch (err) {
        if (fellowLoader) fellowLoader.remove();
        if (tutorLoader) tutorLoader.remove();
        showToast('Error: ' + err.message, 'error');
    } finally {
        sendBtn.disabled = false;
        input.focus();
    }
}

async function callDebateAPI(studentCorrection) {
    const res = await apiFetch('/debate', {
        method: 'POST',
        body: JSON.stringify({
            topic: debateTopic,
            student_correction: studentCorrection,
            fellow_student_history: fellowHistory,
            tutor_history: tutorHistory,
        })
    });
    
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Server error ${res.status}`);
    }
    return res.json();
}

function addDebateMessage(panel, text, isLoader = false) {
    const container = document.getElementById(panel === 'fellow' ? 'fellowMessages' : 'tutorMessages');
    if (!container) return null;
    
    const bubble = document.createElement('div');
    bubble.className = 'debate-bubble' + (isLoader ? ' placeholder-msg' : '');
    
    if (isLoader) {
        bubble.innerHTML = `<div class="typing-indicator"><span></span><span></span><span></span></div>`;
    } else {
        // Render markdown
        bubble.innerHTML = typeof marked !== 'undefined' ? marked.parse(text) : text;
    }
    
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
    return bubble;
}

function addStudentBubble(panel, text) {
    const container = document.getElementById(panel === 'fellow' ? 'fellowMessages' : 'tutorMessages');
    if (!container) return;
    
    const bubble = document.createElement('div');
    bubble.className = 'debate-bubble student-bubble';
    bubble.innerHTML = `<strong>You:</strong> ${text}`;
    container.appendChild(bubble);
    container.scrollTop = container.scrollHeight;
}
