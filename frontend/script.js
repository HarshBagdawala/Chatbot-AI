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


// ─── Voice AI Setup (Web Speech API) ─────────────────────────────────────────
let aiVoiceEnabled = true;
const voiceToggleBtn = document.getElementById('voiceToggleBtn');
const micBtn = document.getElementById('micBtn');

function toggleAIVoice() {
  aiVoiceEnabled = !aiVoiceEnabled;
  if (aiVoiceEnabled) {
    if (voiceToggleBtn) voiceToggleBtn.classList.add('active');
    showToast('🔊 AI Voice Enabled');
  } else {
    if (voiceToggleBtn) voiceToggleBtn.classList.remove('active');
    window.speechSynthesis.cancel();
    showToast('🔇 AI Voice Muted');
  }
}

// Load and select a female voice
let availableVoices = [];
if ('speechSynthesis' in window) {
  availableVoices = window.speechSynthesis.getVoices();
  window.speechSynthesis.onvoiceschanged = () => {
    availableVoices = window.speechSynthesis.getVoices();
  };
}

function getFemaleVoice() {
  if (!availableVoices.length) availableVoices = window.speechSynthesis.getVoices();
  return availableVoices.find(v =>
    v.name.includes('Female') ||
    v.name.includes('Zira') ||
    v.name.includes('Samantha') ||
    v.name.includes('Victoria') ||
    v.name.includes('Aditi') || 
    (v.lang.includes('hi-IN') && !v.name.includes('Male'))
  ) || availableVoices.find(v => v.lang.startsWith('en') && v.name.includes('Female')) || availableVoices[0];
}

function speakText(text) {
  if (!aiVoiceEnabled || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  let cleanText = text.replace(/```[\s\S]*?```/g, ' Code snippet. ').replace(/[_*`#]/g, '');
  const utterance = new SpeechSynthesisUtterance(cleanText);
  const femaleVoice = getFemaleVoice();
  if (femaleVoice) {
    utterance.voice = femaleVoice;
    utterance.lang = femaleVoice.lang;
  }
  window.speechSynthesis.speak(utterance);
}

let recognition;
let isRecording = false;
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.lang = navigator.language || 'en-US';
  recognition.interimResults = false;

  recognition.onstart = () => {
    isRecording = true;
    if (micBtn) micBtn.classList.add('listening');
    userInput.placeholder = "Listening...";
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    userInput.value += (userInput.value ? ' ' : '') + transcript;
    userInput.value = userInput.value.trim();
    sendMessage(true);
  };

  recognition.onend = () => {
    stopRecording();
  };
}

function toggleRecording() {
  if (!recognition) return showToast('⚠️ Speech Recognition not supported.');
  isRecording ? recognition.stop() : recognition.start();
}

function stopRecording() {
  isRecording = false;
  if (micBtn) micBtn.classList.remove('listening');
  if (userInput) userInput.placeholder = "Ask me anything...";
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
             onload="document.getElementById('skeleton_${randomId}').style.display='none'; this.style.opacity='1'"
             onerror="this.src='https://via.placeholder.com/512?text=Error'; document.getElementById('skeleton_${randomId}').style.display='none'">
        <div class="image-actions">
          <button onclick="downloadImage('${imageUrl}')" class="download-btn">Save Image</button>
        </div>
      </div>`;
    if (!formatted) formatted = "Generated image: 🎨";
  }

  if (images.length) {
    imageHTML += `<div class="message-images">${images.map(src => `<div class="message-image-item"><img src="${src}"></div>`).join('')}</div>`;
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
        item.innerHTML = `<div class="sidebar-item-content">${session.title || 'New Chat'}</div>`;
        item.onclick = () => selectSession(session.session_id);
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

function showWelcome() {
  chatBox.innerHTML = `
    <div class="welcome" id="welcome">
      <div class="welcome-icon">✨</div>
      <h2>Hello! I'm your AI Assistant</h2>
      <p>Ask me anything!</p>
    </div>`;
}

// ─── Message Sending ──────────────────────────────────────────────────────────
async function sendMessage(isVoice = false) {
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
    if (isVoice) speakText(aiReply);
    if (isNewSession) loadSessions();
  } catch (err) {
    hideTyping();
    showToast('❌ ' + err.message);
  }
  sendBtn.disabled = false;
  userInput.focus();
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
  container.innerHTML = selectedFiles.map((f, i) => `<div class="preview-item"><span>${f.name}</span><button onclick="removeSelectedImage(${i})">✕</button></div>`).join('');
}

function removeSelectedImage(i) {
  selectedFiles.splice(i, 1);
  renderImagePreviews();
}

async function processImageRequest(msg, isNewSession) {
  const files = [...selectedFiles];
  selectedFiles = [];
  renderImagePreviews();

  const previews = files.map(f => URL.createObjectURL(f));
  appendMessage('user', msg || 'Processing images...', { images: previews });
  showTyping();

  const formData = new FormData();
  files.forEach(f => formData.append('images', f));
  formData.append('prompt', msg || '');
  if (sessionId) formData.append('session_id', sessionId);
  if (currentUsername) formData.append('username', currentUsername);

  try {
    const res = await fetch('/api/banner/create', { method: 'POST', body: formData });
    const data = await res.json();
    hideTyping();
    if (!res.ok) throw new Error(data.error);

    const bannerUrl = (data.bannerUrl.startsWith('data:') || data.bannerUrl.startsWith('http')) ? data.bannerUrl : `${window.location.origin}${data.bannerUrl}`;
    appendMessage('assistant', `✨ **Done!** [IMAGE_GEN: ${bannerUrl}]`);
    if (data.session_id) {
      sessionId = data.session_id;
      localStorage.setItem('chat_session_id', sessionId);
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

// Start
checkAuth();
const themeOptions = document.querySelectorAll('.theme-option');
themeOptions.forEach(opt => {
  opt.onclick = () => {
    const theme = opt.dataset.theme;
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('chat_theme', theme);
  };
});
