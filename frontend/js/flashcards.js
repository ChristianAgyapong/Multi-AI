/**
 * Multimodal AI Tutor — Flashcards Module
 *
 * Handles fetching, generating, and rendering flashcards (3D flip cards).
 */

let flashcardsData = [];

function initFlashcards() {
  fetchFlashcards();

  const generateBtn = document.getElementById('generateFlashcardsBtn');
  if (generateBtn) generateBtn.addEventListener('click', generateFlashcards);
}

async function fetchFlashcards() {
  const container = document.getElementById('flashcardsContainer');
  if (!container) return;

  try {
    const res = await apiFetch('/flashcards');
    if (res.ok) {
      const data = await res.json();
      flashcardsData = data.flashcards || [];
      renderFlashcards();
    }
  } catch (err) {
    console.error('Error fetching flashcards:', err);
    container.innerHTML =
      '<p style="color:var(--text-muted);">Could not load flashcards. Make sure the backend is running.</p>';
  }
}

async function generateFlashcards() {
  const chatContainer = document.getElementById('chatHistory');
  if (!chatContainer || chatContainer.children.length === 0) {
    showToast('No chat history found. Ask the tutor something first!', 'warning');
    return;
  }

  // Grab text from the last few messages
  let recentText = '';
  const messages = Array.from(chatContainer.children).slice(-6);
  messages.forEach((msg) => {
    recentText += (msg.innerText || msg.textContent) + '\n\n';
  });

  if (!recentText.trim()) {
    showToast('No text to extract from.', 'warning');
    return;
  }

  const loader = document.getElementById('flashcardsLoader');
  const generateBtn = document.getElementById('generateFlashcardsBtn');

  generateBtn.disabled = true;
  loader.style.display = 'block';

  try {
    const res = await apiFetch('/flashcards/generate', {
      method: 'POST',
      body: JSON.stringify({ text: recentText }),
    });

    if (!res.ok) throw new Error(`Server responded with ${res.status}`);

    const data = await res.json();
    flashcardsData = data.flashcards || [];
    renderFlashcards();

    if (data.added_count > 0) {
      showToast(`Added ${data.added_count} new flashcards!`, 'success');
    } else {
      showToast('No new terms found.', 'info');
    }
  } catch (err) {
    console.error('Failed to generate flashcards', err);
    showToast('Error generating flashcards: ' + err.message, 'error');
  } finally {
    loader.style.display = 'none';
    generateBtn.disabled = false;
  }
}

function renderFlashcards() {
  const container = document.getElementById('flashcardsContainer');
  if (!container) return;

  if (!flashcardsData.length) {
    container.innerHTML =
      '<p style="color:var(--text-muted);">No flashcards yet. Generate some from your chat!</p>';
    return;
  }

  container.innerHTML = '';

  flashcardsData.forEach((card) => {
    const cardEl = document.createElement('div');
    cardEl.className = 'flashcard glass';
    cardEl.onclick = () => cardEl.classList.toggle('flipped');

    cardEl.innerHTML = `
      <div class="flashcard-inner">
        <div class="flashcard-front">
          <h3>${escHtml(card.front)}</h3>
          <p class="flashcard-hint">Click to flip</p>
        </div>
        <div class="flashcard-back">
          <p>${escHtml(card.back)}</p>
        </div>
      </div>
    `;

    container.appendChild(cardEl);
  });
}
