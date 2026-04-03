let sessionId = localStorage.getItem('chat_session_id') || null;
const chatBox = document.getElementById('chatBox');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const sidebarHistory = document.getElementById('sidebarHistory');
const sidebar = document.getElementById('sidebar');

// Create overlay for mobile
const overlay = document.createElement('div');
overlay.className = 'sidebar-overlay';
document.querySelector('.app-container').appendChild(overlay);
overlay.onclick = toggleSidebar;

// Auto-resize textarea
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 120) + 'px';
});

// Enter to send, Shift+Enter for newline
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function toggleSidebar() {
  sidebar.classList.toggle('open');
  overlay.classList.toggle('show');
}

function hideWelcome() {
  const welcome = document.getElementById('welcome');
  if (welcome) welcome.remove();
}

function getTime() {
  return new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function appendMessage(role, content) {
  hideWelcome();
  const div = document.createElement('div');
  div.className = `message ${role}`;

  const avatar = role === 'user' ? '👤' : '🤖';

  // ─── Better Markdown-ish Formatting ───
  let formatted = content;
  const blocks = [];

  // 1. Extract Triple Backtick Blocks (Code Blocks)
  formatted = formatted.replace(/```([\s\S]*?)```/g, (match, code) => {
    const id = `__BLOCK_${blocks.length}__`;
    blocks.push(`<pre><code>${code.trim()}</code></pre>`);
    return id;
  });

  // 2. Format the rest (Bold, Italics, Newlines)
  formatted = formatted
    .replace(/`([^`]+)`/g, '<code>$1</code>') // Inline code
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
    .replace(/\*(.*?)\*/g, '<em>$1</em>') // Italics
    .replace(/\n/g, '<br>'); // Newlines

  // 3. Put Code Blocks back
  blocks.forEach((block, i) => {
    formatted = formatted.replace(`__BLOCK_${i}__`, block);
  });
  // ────────────────────────────────────────

  div.innerHTML = `
    <div class="avatar">${avatar}</div>
    <div>
      <div class="bubble">${formatted}</div>
      <div class="time">${getTime()}</div>
    </div>
  `;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
  return div;
}

function showTyping() {
  hideWelcome();
  const div = document.createElement('div');
  div.className = 'typing-indicator';
  div.id = 'typingIndicator';
  div.innerHTML = `
    <div class="avatar" style="background: linear-gradient(135deg,#7c6af7,#a78bfa); box-shadow:0 0 16px rgba(124,106,247,0.25)">🤖</div>
    <div class="typing-bubble">
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
      <div class="typing-dot"></div>
    </div>
  `;
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

// ─── Session Management ──────────────────────────────────────────────────────

async function loadSessions() {
  try {
    const res = await fetch('/api/sessions');
    const data = await res.json();
    
    sidebarHistory.innerHTML = '';
    
    if (data.sessions && data.sessions.length > 0) {
      data.sessions.forEach(session => {
        const item = document.createElement('div');
        item.className = `sidebar-item ${session.session_id === sessionId ? 'active' : ''}`;
        item.textContent = session.title || 'New Chat';
        item.onclick = () => selectSession(session.session_id);
        sidebarHistory.appendChild(item);
      });
    } else {
      sidebarHistory.innerHTML = '<div style="padding:20px; font-size:12px; color:var(--text-muted); text-align:center;">No recent chats</div>';
    }
  } catch (err) {
    console.error('Error loading sessions:', err);
  }
}

async function selectSession(id) {
  if (id === sessionId) return;
  
  sessionId = id;
  localStorage.setItem('chat_session_id', sessionId);
  
  // Close sidebar on mobile
  sidebar.classList.remove('open');
  overlay.classList.remove('show');
  
  // Clear UI and load history
  chatBox.innerHTML = '';
  showTyping();
  
  try {
    const res = await fetch(`/api/history/${sessionId}`);
    const data = await res.json();
    hideTyping();
    
    if (data.messages && data.messages.length > 0) {
      data.messages.forEach(m => appendMessage(m.role, m.content));
    } else {
      showWelcome();
    }
    loadSessions(); // Update active state
  } catch (err) {
    hideTyping();
    showToast('❌ Could not load chat');
  }
}

function startNewChat() {
  sessionId = null;
  localStorage.removeItem('chat_session_id');
  chatBox.innerHTML = '';
  showWelcome();
  loadSessions();
  
  // Close sidebar on mobile
  sidebar.classList.remove('open');
  overlay.classList.remove('show');
}

function showWelcome() {
  chatBox.innerHTML = `
    <div class="welcome" id="welcome">
      <div class="welcome-icon">✨</div>
      <h2>Hello! I'm your AI Assistant</h2>
      <p>Ask me anything — I'm here to help you with any topic!</p>
      <div class="suggestions">
        <button class="suggestion-chip" onclick="sendSuggestion('What is Python programming?')">🐍 What is Python?</button>
        <button class="suggestion-chip" onclick="sendSuggestion('Tell me a fun science fact')">🔬 Science fact</button>
        <button class="suggestion-chip" onclick="sendSuggestion('Tell me a short story')">📖 Tell me a story</button>
        <button class="suggestion-chip" onclick="sendSuggestion('Give me tips to reduce stress')">😌 Stress relief tips</button>
        <button class="suggestion-chip" onclick="sendSuggestion('What is artificial intelligence?')">🧠 What is AI?</button>
        <button class="suggestion-chip" onclick="sendSuggestion('Give me some healthy breakfast ideas')">🥗 Breakfast ideas</button>
      </div>
    </div>`;
}

// ─────────────────────────────────────────────────────────────────────────────

async function sendMessage() {
  const msg = userInput.value.trim();
  if (!msg || sendBtn.disabled) return;

  const isNewSession = !sessionId;

  userInput.value = '';
  userInput.style.height = 'auto';
  sendBtn.disabled = true;

  appendMessage('user', msg);
  showTyping();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, session_id: sessionId })
    });

    const data = await res.json();
    hideTyping();

    if (!res.ok) throw new Error(data.error || 'Server error');

    sessionId = data.session_id;
    localStorage.setItem('chat_session_id', sessionId);
    appendMessage('assistant', data.reply);
    
    // Refresh sidebar if it's the first message of a session
    if (isNewSession) {
      loadSessions();
    }

  } catch (err) {
    hideTyping();
    showToast('❌ ' + (err.message || 'Something went wrong, please try again!'));
  }

  sendBtn.disabled = false;
  userInput.focus();
}

function sendSuggestion(text) {
  userInput.value = text;
  sendMessage();
}

async function clearChat() {
  if (!confirm('Are you sure you want to clear this entire chat history?')) return;

  if (sessionId) {
    try {
      await fetch(`/api/history/${sessionId}`, { method: 'DELETE' });
    } catch (e) {}
  }

  startNewChat();
}

// Initialize
loadSessions();
if (sessionId) {
  fetch(`/api/history/${sessionId}`)
    .then(r => r.json())
    .then(data => {
      if (data.messages && data.messages.length > 0) {
        data.messages.forEach(m => appendMessage(m.role, m.content));
      } else {
        showWelcome();
      }
    })
    .catch(() => showWelcome());
} else {
  showWelcome();
}
