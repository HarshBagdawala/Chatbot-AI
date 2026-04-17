let sessionId = localStorage.getItem('chat_session_id') || null;
let currentUsername = localStorage.getItem('chat_username') || null;
let messageIndex = 0;

const chatBox = document.getElementById('chatBox');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const sidebarHistory = document.getElementById('sidebarHistory');
const sidebar = document.getElementById('sidebar');

// ─── Authentication ────────────────────────────────────────────────────────────
let isLoginMode = true;

function toggleAuthMode() {
  isLoginMode = !isLoginMode;
  const btn = document.getElementById('submitAuthBtn');
  const toggleText = document.getElementById('authToggleText');

  if (isLoginMode) {
    if (btn) btn.textContent = 'Sign In';
    if (toggleText) toggleText.innerHTML = `Don't have an account? <a href="#" onclick="toggleAuthMode()">Sign up</a>`;
  } else {
    if (btn) btn.textContent = 'Create Account';
    if (toggleText) toggleText.innerHTML = `Already have an account? <a href="#" onclick="toggleAuthMode()">Sign in</a>`;
  }
}

function updateProfileUI() {
  const profileName = document.getElementById('profileName');
  if (profileName) {
    profileName.textContent = currentUsername === 'guest' ? 'Guest' : '@' + currentUsername;
  }
}

function checkAuth() {
  const overlay = document.getElementById('loginOverlay');
  const appContainer = document.getElementById('appContainer');

  if (currentUsername) {
    if (overlay) overlay.classList.remove('active');
    if (appContainer) appContainer.style.display = 'flex';
    if (sidebar) sidebar.style.display = 'flex';

    updateProfileUI();

    if (currentUsername !== 'guest') {
      loadSessions();
    } else {
      if (sidebarHistory) sidebarHistory.innerHTML = '<div style="padding:20px; font-size:12px; color:var(--text-muted); text-align:center;">Guest history not saved</div>';
    }

    if (sessionId) {
      loadHistory(sessionId);
    } else {
      showWelcome();
    }
  } else {
    if (overlay) overlay.classList.add('active');
    if (appContainer) appContainer.style.display = 'none';
  }
}

async function handleAuth() {
  const username = document.getElementById('usernameInput')?.value.trim();
  const password = document.getElementById('passwordInput')?.value.trim();

  if (!username || !password) {
    showToast("⚠️ Please enter username and password.");
    return;
  }

  const endpoint = isLoginMode ? '/api/login' : '/api/register';
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.error || 'Authentication failed');

    if (!isLoginMode) {
      showToast("✅ Registered! Please sign in.");
      toggleAuthMode();
      return;
    }

    currentUsername = username;
    localStorage.setItem('chat_username', currentUsername);
    sessionId = null;
    localStorage.removeItem('chat_session_id');
    checkAuth();
  } catch (e) {
    showToast("❌ " + e.message);
  }
}

function continueAsGuest() {
  currentUsername = 'guest';
  localStorage.setItem('chat_username', currentUsername);
  sessionId = null;
  localStorage.removeItem('chat_session_id');
  checkAuth();
}

function handleLogout() {
  currentUsername = null;
  sessionId = null;
  localStorage.removeItem('chat_username');
  localStorage.removeItem('chat_session_id');
  if (document.getElementById('usernameInput')) document.getElementById('usernameInput').value = '';
  if (document.getElementById('passwordInput')) document.getElementById('passwordInput').value = '';
  checkAuth();
}

// Enter key for auth
const passwordInput = document.getElementById('passwordInput');
if (passwordInput) {
  passwordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAuth();
  });
}




// ─── Sidebar Overlay ──────────────────────────────────────────────────────────
const appCont = document.querySelector('.app-container');
if (appCont) {
  const overlay = document.createElement('div');
  overlay.className = 'sidebar-overlay';
  appCont.appendChild(overlay);
  overlay.onclick = toggleSidebar;
}

userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
});

userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function toggleSidebar() {
  sidebar.classList.toggle('open');
  const overlay = document.querySelector('.sidebar-overlay');
  if (overlay) overlay.classList.toggle('show');
}

function hideWelcome() {
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();
}

function getTime() {
  return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function copyToClipboard(btn) {
  const wrapper = btn.closest('.code-block-wrapper');
  const code = wrapper.querySelector('code').innerText;
  navigator.clipboard.writeText(code).then(() => {
    const originalHTML = btn.innerHTML;
    btn.innerHTML = '<span>Copied!</span>';
    setTimeout(() => btn.innerHTML = originalHTML, 2000);
  });
}

function appendMessage(role, content, options = {}) {
  hideWelcome();
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.setAttribute('data-index', messageIndex++);

  const avatar = role === 'user' ? '👤' : '🤖';
  const { images = [], rawHtml = false } = options;

  let formatted = content;
  const blocks = [];

  if (!rawHtml) {
    formatted = formatted.replace(/```([\s\S]*?)```/g, (match, code) => {
      const id = `__BLOCK_${blocks.length}__`;
      const escapedCode = code.trim().replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      blocks.push(`
        <div class="code-block-wrapper">
          <button class="copy-btn" onclick="copyToClipboard(this)">Copy</button>
          <pre><code>${escapedCode}</code></pre>
        </div>
      `);
      return id;
    });

    formatted = formatted
      .replace(/^### (.*)$/gm, '<h3>$1</h3>')
      .replace(/^## (.*)$/gm, '<h2>$1</h2>')
      .replace(/^# (.*)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');

    blocks.forEach((block, i) => {
      formatted = formatted.replace(`__BLOCK_${i}__`, block);
    });
  }

  const imageMatch = formatted.match(/\[IMAGE_GEN:\s*(.*?)\]/i);
  let imageHTML = '';
  if (imageMatch) {
    const imageUrl = imageMatch[1].trim();
    formatted = formatted.replace(/\[IMAGE_GEN:.*?\]/gi, '').trim();
    const randomId = 'img_' + Math.random().toString(36).substr(2, 9);
    imageHTML = `
      <div class="generated-image-card">
        <div class="image-loading-skeleton" id="skeleton_${randomId}"></div>
        <img src="${imageUrl}" class="generated-image" 
             onload="if(this.previousElementSibling) this.previousElementSibling.style.display='none'; this.style.opacity='1'"
             onerror="this.src='https://via.placeholder.com/512?text=Error'; if(this.previousElementSibling) this.previousElementSibling.style.display='none'; this.style.opacity='1'">
        <div class="image-actions">
          <button onclick="downloadImage('${imageUrl}')" class="download-btn">Save Image</button>
        </div>
      </div>`;
    if (!formatted) formatted = "Generated image: 🎨";
  }

  if (images.length) {
    imageHTML += `<div class="message-images">${images.map(src => {
      if (src.includes('pdf-icon')) {
        return `<div class="message-image-item doc-preview pdf"><span class="doc-icon">📄</span><span class="doc-label">PDF</span></div>`;
      } else if (src.includes('txt-icon')) {
        return `<div class="message-image-item doc-preview txt"><span class="doc-icon">📝</span><span class="doc-label">TXT</span></div>`;
      }
      return `<div class="message-image-item"><img src="${src}"></div>`;
    }).join('')}</div>`;
  }

  div.innerHTML = `
    <div class="avatar">${avatar}</div>
    <div class="message-body">
      <div class="message-content">
        ${role === 'user' ? '<button class="edit-btn" onclick="editMessage(this)">✏️</button>' : ''}
        <div class="bubble">${formatted}${imageHTML}</div>
      </div>
      <div class="time">${getTime()}</div>
    </div>`;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
  return div;
}

// ─── Session Management ──────────────────────────────────────────────────────
async function loadSessions() {
  if (!currentUsername || currentUsername === 'guest') return;
  try {
    const res = await fetch(`/api/sessions?username=${encodeURIComponent(currentUsername)}`);
    const data = await res.json();
    sidebarHistory.innerHTML = '';
    if (data.sessions?.length > 0) {
      data.sessions.forEach(session => {
        const item = document.createElement('div');
        item.className = `sidebar-item ${session.session_id === sessionId ? 'active' : ''}`;
        item.innerHTML = `
          <div class="sidebar-item-content" onclick="selectSession('${session.session_id}')">
            ${session.title || 'New Chat'}
          </div>
          <div class="sidebar-item-actions">
            <button class="sidebar-dots-btn" onclick="toggleSidebarMenu(event, '${session.session_id}')">⋮</button>
            <div class="sidebar-dropdown" id="dropdown-${session.session_id}">
              <button onclick="renameChatSession(event, '${session.session_id}', '${(session.title || '').replace(/'/g, "\\'")}')">✏️ Rename</button>
              <button onclick="deleteChatSession(event, '${session.session_id}')" class="delete">🗑️ Delete</button>
            </div>
          </div>
        `;
        sidebarHistory.appendChild(item);
      });
    } else {
      sidebarHistory.innerHTML = '<div style="padding:20px; font-size:12px; color:var(--text-muted); text-align:center;">No recent chats</div>';
    }
  } catch (err) { console.error('Error loading sessions:', err); }
}

async function loadHistory(id) {
  try {
    const res = await fetch(`/api/history/${id}`);
    const data = await res.json();
    chatBox.innerHTML = '';
    if (data.messages?.length > 0) {
      data.messages.forEach(m => appendMessage(m.role, m.content));
    } else { showWelcome(); }
    loadSessions();
  } catch (err) { showToast('❌ Could not load chat'); }
}

function selectSession(id) {
  if (id === sessionId) return;
  sessionId = id;
  localStorage.setItem('chat_session_id', sessionId);
  chatBox.innerHTML = '';
  loadHistory(sessionId);
}

function startNewChat() {
  sessionId = null;
  localStorage.removeItem('chat_session_id');
  chatBox.innerHTML = '';
  showWelcome();
  loadSessions();
}

// ─── Sidebar Menu Logic ──────────────────────────────────────────────────────
function toggleSidebarMenu(event, id) {
  event.stopPropagation();
  const menu = document.getElementById(`dropdown-${id}`);

  // Close all other menus first
  document.querySelectorAll('.sidebar-dropdown.show').forEach(m => {
    if (m !== menu) m.classList.remove('show');
  });

  menu.classList.toggle('show');
}

// Close menus when clicking anywhere else
document.addEventListener('click', () => {
  document.querySelectorAll('.sidebar-dropdown.show').forEach(m => m.classList.remove('show'));
});

async function deleteChatSession(event, id) {
  event.stopPropagation();
  if (!confirm("Are you sure you want to delete this chat?")) return;

  try {
    const res = await fetch(`/api/history/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error("Failed to delete");

    showToast("🗑️ Chat deleted");
    if (sessionId === id) startNewChat();
    else loadSessions();
  } catch (err) {
    showToast("❌ Error: " + err.message);
  }
}

async function renameChatSession(event, id, oldTitle) {
  event.stopPropagation();
  const newTitle = prompt("Enter new chat name:", oldTitle);
  if (!newTitle || newTitle === oldTitle) return;

  try {
    const res = await fetch(`/api/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: newTitle })
    });
    if (!res.ok) throw new Error("Failed to rename");

    showToast("✏️ Chat renamed");
    loadSessions();
  } catch (err) {
    showToast("❌ Error: " + err.message);
  }
}

function showWelcome() {
  chatBox.innerHTML = `
    <div class="welcome" id="welcome">
      <div class="welcome-icon">✨</div>
      <h2>Hello! I'm your AI Assistant</h2>
      <p>Ask me anything!</p>
    </div>`;
}

// ─── Message Sending ──────────────────────────────────────────────────────────
async function sendMessage() {
  const msg = userInput.value.trim();
  if (!msg || sendBtn.disabled) return;
  const isNewSession = !sessionId;
  userInput.value = '';
  userInput.style.height = 'auto';
  sendBtn.disabled = true;

  if (selectedFiles.length > 0) {
    processImageRequest(msg, isNewSession);
    return;
  }

  appendMessage('user', msg);
  await getAIResponse(msg, isNewSession);
  sendBtn.disabled = false;
  userInput.focus();
}

async function getAIResponse(msg, isNewSession = false) {
  showTyping();
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, session_id: sessionId, username: currentUsername })
    });
    const data = await res.json();
    hideTyping();
    if (!res.ok) throw new Error(data.error);

    let aiReply = data.reply;
    sessionId = data.session_id;
    localStorage.setItem('chat_session_id', sessionId);
    appendMessage('assistant', aiReply);
    if (isNewSession) loadSessions();
  } catch (err) {
    hideTyping();
    showToast('❌ ' + err.message);
  }
}

function sendSuggestion(text) {
  userInput.value = text;
  sendMessage();
}

function showTyping() {
  const div = document.createElement('div');
  div.className = 'typing-indicator';
  div.id = 'typingIndicator';
  div.innerHTML = `<div class="avatar">🤖</div><div class="typing-bubble">...</div>`;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function hideTyping() {
  const t = document.getElementById('typingIndicator');
  if (t) t.remove();
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ─── Image Processing ─────────────────────────────────────────────────────────
let selectedFiles = [];
function handleImageSelection(event) {
  const files = Array.from(event.target.files);
  if (selectedFiles.length + files.length > 5) return showToast("⚠️ Max 5 images.");
  selectedFiles = [...selectedFiles, ...files];
  renderImagePreviews();
}

function renderImagePreviews() {
  const container = document.getElementById('inputImagePreviews');
  if (!container) return;
  container.innerHTML = selectedFiles.map((f, i) => {
    let icon = '🖼️';
    let typeClass = 'img';
    if (f.type === 'application/pdf') { icon = '📄'; typeClass = 'pdf'; }
    else if (f.type === 'text/plain') { icon = '📝'; typeClass = 'txt'; }

    return `<div class="preview-item ${typeClass}"><span class="preview-icon">${icon}</span><span class="preview-name">${f.name}</span><button onclick="removeSelectedImage(${i})">✕</button></div>`;
  }).join('');
}

function removeSelectedImage(i) {
  selectedFiles.splice(i, 1);
  renderImagePreviews();
}

async function processImageRequest(msg, isNewSession) {
  const files = [...selectedFiles];
  selectedFiles = [];
  renderImagePreviews();

  const isDocument = files.some(f => f.type === 'application/pdf' || f.type === 'text/plain');
  const previews = files.map(f => {
    if (f.type === 'application/pdf') return 'pdf-icon';
    if (f.type === 'text/plain') return 'txt-icon';
    return URL.createObjectURL(f);
  });

  appendMessage('user', msg || (isDocument ? 'Analyzing document...' : 'Processing images...'), { images: previews });
  showTyping();

  const formData = new FormData();
  // Using different field names for better backend routing if needed
  if (isDocument) {
    formData.append('files', files[0]); // Only handle first doc for now
  } else {
    files.forEach(f => formData.append('images', f));
  }

  formData.append('prompt', msg || '');
  formData.append('message', msg || ''); // Support both names
  if (sessionId) formData.append('session_id', sessionId);
  if (currentUsername) formData.append('username', currentUsername);

  const endpoint = isDocument ? '/api/chat/document' : '/api/banner/create';

  try {
    const res = await fetch(endpoint, { method: 'POST', body: formData });
    const data = await res.json();
    hideTyping();
    if (!res.ok) throw new Error(data.error);

    if (isDocument) {
      sessionId = data.session_id;
      localStorage.setItem('chat_session_id', sessionId);
      appendMessage('assistant', `📄 **Document Analyzed: ${data.fileName}**\n\n${data.reply}`);
    } else {
      const bannerUrl = (data.bannerUrl.startsWith('data:') || data.bannerUrl.startsWith('http')) ? data.bannerUrl : `${window.location.origin}${data.bannerUrl}`;
      appendMessage('assistant', `✨ **Done!** [IMAGE_GEN: ${bannerUrl}]`);
      if (data.session_id) {
        sessionId = data.session_id;
        localStorage.setItem('chat_session_id', sessionId);
      }
    }
    if (isNewSession) loadSessions();
  } catch (err) {
    hideTyping();
    showToast("❌ " + err.message);
  } finally {
    sendBtn.disabled = false;
  }
}

async function downloadImage(url) {
  try {
    showToast("📥 Downloading...");
    const res = await fetch(url);
    const blob = await res.blob();
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = `ai-image-${Date.now()}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
    showToast("✅ Saved!");
  } catch (err) { window.open(url, '_blank'); }
}

// Initialize Theme
const savedTheme = localStorage.getItem('chat_theme') || 'emerald';
document.documentElement.setAttribute('data-theme', savedTheme);

// Theme Toggle
const themeBtn = document.getElementById('themeBtn');
const themeMenu = document.getElementById('themeMenu');

if (themeBtn && themeMenu) {
  themeBtn.onclick = (e) => {
    e.stopPropagation();
    themeMenu.classList.toggle('show');
  };

  document.addEventListener('click', (e) => {
    if (!themeMenu.contains(e.target) && !themeBtn.contains(e.target)) {
      themeMenu.classList.remove('show');
    }
  });
}

// Start
checkAuth();
const themeOptions = document.querySelectorAll('.theme-option');
themeOptions.forEach(opt => {
  opt.onclick = () => {
    const theme = opt.dataset.theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('chat_theme', theme);
    themeMenu.classList.remove('show');

    // Update active state in menu
    themeOptions.forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
  };
});
// ─── Edit Functionality ──────────────────────────────────────────────────────
function editMessage(btn) {
  const messageDiv = btn.closest('.message');
  const bubble = messageDiv.querySelector('.bubble');
  const originalText = bubble.innerText;

  // Save original HTML in case of cancel
  bubble.dataset.originalHtml = bubble.innerHTML;

  bubble.innerHTML = `
    <textarea class="edit-textarea">${originalText}</textarea>
    <div style="display:flex; gap:8px; margin-top:8px;">
      <button class="edit-save-btn" onclick="saveEdit(this)">Save</button>
      <button class="edit-cancel-btn" onclick="cancelEdit(this)">Cancel</button>
    </div>
  `;

  btn.style.display = 'none';
  const textarea = bubble.querySelector('textarea');
  textarea.focus();
  textarea.style.height = textarea.scrollHeight + 'px';
}

function cancelEdit(btn) {
  const messageDiv = btn.closest('.message');
  const bubble = messageDiv.querySelector('.bubble');
  bubble.innerHTML = bubble.dataset.originalHtml;
  messageDiv.querySelector('.edit-btn').style.display = 'block';
}

async function saveEdit(btn) {
  const messageDiv = btn.closest('.message');
  const bubble = messageDiv.querySelector('.bubble');
  const newText = bubble.querySelector('textarea').value.trim();

  if (!newText) return cancelEdit(btn);

  // 1. Remove the subsequent assistant message if it exists
  const nextMsg = messageDiv.nextElementSibling;
  if (nextMsg && nextMsg.classList.contains('assistant')) {
    nextMsg.remove();
  }

  // 2. Update the user bubble
  bubble.innerHTML = newText.replace(/\n/g, '<br>');
  messageDiv.querySelector('.edit-btn').style.display = 'block';

  // 3. Re-trigger AI response
  await getAIResponse(newText);
}
