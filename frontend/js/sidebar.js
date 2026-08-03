/**
 * Multimodal AI Tutor — Sidebar Module
 *
 * Handles:
 * - Provider status indicator
 * - Cache usage stats
 * - Student profile summary
 * - Uploaded course materials (RAG) list + delete
 */

/** Initialize all sidebar widgets */
function initSidebar() {
  loadProviderStatus();
  loadCacheStats();
  loadStudentProfile();
  loadMaterialsList();

  // RAG document upload (drag & drop + click)
  const dropZone = document.getElementById('dropZone');
  const docUpload = document.getElementById('docUpload');
  if (dropZone && docUpload) {
    docUpload.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) uploadMaterial(file);
    });

    ['dragenter', 'dragover'].forEach((evt) => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.add('dragging');
      });
    });
    ['dragleave', 'drop'].forEach((evt) => {
      dropZone.addEventListener(evt, (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragging');
      });
    });
    dropZone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) uploadMaterial(file);
    });
  }
}

/** Upload a course material file into the session RAG store */
async function uploadMaterial(file) {
  const statusEl = document.getElementById('uploadStatus');
  const dropZone = document.getElementById('dropZone');
  if (!statusEl) return;

  statusEl.style.display = 'block';
  statusEl.style.color = 'var(--text-muted)';
  statusEl.textContent = `Indexing ${file.name}...`;

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await apiFetch('/materials', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    statusEl.style.color = 'var(--success)';
    statusEl.textContent = `✓ Added ${file.name} (${data.chunks_added} chunks)`;
    showToast('Material indexed successfully!', 'success');
    loadMaterialsList();
    // Clear the input so the same file can be re-uploaded
    if (dropZone) {
      const input = dropZone.querySelector('input[type="file"]');
      if (input) input.value = '';
    }
  } catch (err) {
    statusEl.style.color = 'var(--danger)';
    statusEl.textContent = `Error: ${err.message}`;
    showToast('Upload failed: ' + err.message, 'error');
  }
}

/** Load and render the list of indexed course materials */
async function loadMaterialsList() {
  const listEl = document.getElementById('materialsList');
  const emptyEl = document.getElementById('materialsEmpty');
  if (!listEl) return;

  try {
    const res = await apiFetch('/materials');
    const data = await res.json();
    const sources = data.sources || [];

    if (emptyEl) emptyEl.style.display = sources.length ? 'none' : 'block';
    listEl.innerHTML = '';

    sources.forEach((src) => {
      const row = document.createElement('div');
      row.className = 'material-row';
      row.innerHTML = `
        <span class="material-name" title="${escHtml(src)}">📄 ${escHtml(src)}</span>
        <button class="material-delete" title="Remove material" data-name="${escHtml(src)}">✕</button>
      `;
      row.querySelector('.material-delete').addEventListener('click', () => removeMaterial(src));
      listEl.appendChild(row);
    });
  } catch (err) {
    console.warn('Could not load materials:', err.message);
  }
}

/** Remove a single material from the session RAG store */
async function removeMaterial(name) {
  try {
    await apiFetch(`/materials?filename=${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    showToast(`Removed ${name}`, 'info');
    loadMaterialsList();
  } catch (err) {
    showToast('Could not remove material: ' + err.message, 'error');
  }
}

/** Load cache usage stats into the sidebar */
async function loadCacheStats() {
  const statsBody = document.getElementById('statsBody');
  if (!statsBody) return;

  try {
    const res = await apiFetch('/cache/stats');
    const data = await res.json();
    statsBody.innerHTML =
      `<div class="stat-row"><span>Cached answers</span><span>${data.cached_entries || 0}</span></div>` +
      `<div class="stat-row"><span>Cache quantum</span><span>${data.total_hits || 0}</span></div>` +
      `<div class="stat-row"><span>Cache size</span><span>${fmtBytes(data.cache_size_bytes || 0)}</span></div>`;
  } catch (err) {
    statsBody.innerHTML = '<div class="stat-row"><span>Unavailable</span><span>—</span></div>';
  }
}

/** Load student profile summary into the sidebar */
async function loadStudentProfile() {
  const profileBody = document.getElementById('studentProfileBody');
  if (!profileBody) return;

  try {
    const res = await apiFetch('/student/profile');
    const data = await res.json();
    if (data.interaction_count > 0) {
      profileBody.innerHTML = `
        <div class="stat-row"><span>Interactions</span><span>${data.interaction_count}</span></div>
        <div style="margin-top:0.6rem; font-size:0.85rem; color:var(--text-muted);">${escHtml(data.summary || '')}</div>
      `;
    } else {
      profileBody.textContent = 'No data yet. Start learning! 👋';
    }
  } catch (err) {
    profileBody.textContent = 'Unavailable';
  }
}

/** Load LLM provider status into the sidebar */
async function loadProviderStatus() {
  const statusEl = document.getElementById('providerStatus');
  if (!statusEl) return;

  try {
    const res = await apiFetch('/provider/status');
    const data = await res.json();
    const connected = !!data.connected;
    statusEl.innerHTML = `
      <div class="provider-dot ${connected ? 'ok' : 'bad'}"></div>
      <div>
        <div class="provider-name">${escHtml(data.provider || 'unknown')} ${connected ? '' : '(offline)'}</div>
        ${data.message ? `<div class="provider-msg">${escHtml(data.message)}</div>` : ''}
      </div>
    `;
  } catch (err) {
    statusEl.innerHTML = `
      <div class="provider-dot bad"></div>
      <div>
        <div class="provider-name">Backend unreachable</div>
        <div class="provider-msg">${escHtml(err.message)}</div>
      </div>
    `;
  }
}

/** Format a byte count into a human-readable string */
function fmtBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  const kb = bytes / 1024;
  if (kb < 1024) return kb.toFixed(1) + ' KB';
  return (kb / 1024).toFixed(1) + ' MB';
}
