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
    if(btn) btn.textContent = 'Sign In';
    if(toggleText) toggleText.innerHTML = `Don't have an account? <a href="#" onclick="toggleAuthMode()">Sign up</a>`;
  } else {
    if(btn) btn.textContent = 'Create Account';
    if(toggleText) toggleText.innerHTML = `Already have an account? <a href="#" onclick="toggleAuthMode()">Sign in</a>`;
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
    if(overlay) overlay.classList.remove('active');
    if(appContainer) appContainer.style.display = 'flex';
    if(sidebar) sidebar.style.display = 'flex'; // Ensure sidebar behaves normally
    
    updateProfileUI();

    if (currentUsername !== 'guest') {
      loadSessions();
    } else {
      if(sidebarHistory) sidebarHistory.innerHTML = '<div style="padding:20px; font-size:12px; color:var(--text-muted); text-align:center;">Guest history not saved</div>';
    }

    if (sessionId) {
      loadHistory(sessionId);
    } else {
      showWelcome();
    }
  } else {
    if(overlay) overlay.classList.add('active');
    if(appContainer) appContainer.style.display = 'none';
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
  if(document.getElementById('usernameInput')) document.getElementById('usernameInput').value = '';
  if(document.getElementById('passwordInput')) document.getElementById('passwordInput').value = '';
  checkAuth();
}

// Enter key for auth
const passwordInput = document.getElementById('passwordInput');
if(passwordInput) {
  passwordInput.addEventListener('keydown', (e) => {
    if(e.key === 'Enter') handleAuth();
  });
}


// ─── Voice AI Setup (Web Speech API) ─────────────────────────────────────────
let aiVoiceEnabled = true;
const voiceToggleBtn = document.getElementById('voiceToggleBtn');
const micBtn = document.getElementById('micBtn');

function toggleAIVoice() {
  aiVoiceEnabled = !aiVoiceEnabled;
  if (aiVoiceEnabled) {
    if(voiceToggleBtn) voiceToggleBtn.classList.add('active');
    showToast('🔊 AI Voice Enabled');
  } else {
    if(voiceToggleBtn) voiceToggleBtn.classList.remove('active');
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
  // Attempt to find a female voice for Hindi or English
  return availableVoices.find(v => 
    v.name.includes('Female') || 
    v.name.includes('Zira') || 
    v.name.includes('Samantha') || 
    v.name.includes('Victoria') ||
    v.name.includes('Aditi') || // Indian Female
    (v.lang.includes('hi-IN') && !v.name.includes('Male'))
  ) || availableVoices.find(v => v.lang.startsWith('en') && v.name.includes('Female')) || availableVoices[0];
}

function speakText(text) {
  if (!aiVoiceEnabled || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  // Remove markdown formatting to improve pronunciation
  let cleanText = text.replace(/```[\s\S]*?```/g, ' Code snippet. ').replace(/[_*`#]/g, '');
  const utterance = new SpeechSynthesisUtterance(cleanText);
  
  const femaleVoice = getFemaleVoice();
  if (femaleVoice) {
    utterance.voice = femaleVoice;
    utterance.lang = femaleVoice.lang;
  } else {
    utterance.lang = navigator.language || 'en-US';
  }
  
  if (!femaleVoice || !femaleVoice.name.match(/female|zira|samantha|aditi/i)) {
    utterance.pitch = 1.2; // Fallback to make custom voices sound slightly more feminine
  }

  window.speechSynthesis.speak(utterance);
}

let recognition;
let isRecording = false;
if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  // Detect spoken language automatically based on browser locale
  recognition.lang = navigator.language || 'en-US'; 
  recognition.interimResults = false;

  recognition.onstart = () => {
    isRecording = true;
    if(micBtn) micBtn.classList.add('listening');
    userInput.placeholder = "Listening...";
  };

  recognition.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    userInput.value += (userInput.value ? ' ' : '') + transcript;
    userInput.value = userInput.value.trim();
    // Auto send the message when speech finishes, pass true to indicate voice triggered
    sendMessage(true); 
  };

  recognition.onerror = (evt) => {
    stopRecording();
    showToast('🎤 Error listening to microphone.');
  };

  recognition.onend = () => {
    stopRecording();
  };
}

function toggleRecording() {
  if (!recognition) return showToast('⚠️ Speech Recognition not supported in this browser.');
  isRecording ? recognition.stop() : recognition.start();
}

function stopRecording() {
  isRecording = false;
  if(micBtn) micBtn.classList.remove('listening');
  if(userInput) userInput.placeholder = "Ask me anything...";
}
// ─────────────────────────────────────────────────────────────────────────────

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

function appendMessage(role, content, options = {}) {
  hideWelcome();
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.setAttribute('data-index', messageIndex++);

  const avatar = role === 'user' ? '👤' : '🤖';

  const { images = [], rawHtml = false } = options;

  // ─── Better Markdown-ish Formatting ───
  let formatted = content;
  const blocks = [];

  if (!rawHtml) {
    // 1. Extract Triple Backtick Blocks (Code Blocks)
    formatted = formatted.replace(/```([\s\S]*?)```/g, (match, code) => {
      const id = `__BLOCK_${blocks.length}__`;
      const escapedCode = code.trim()
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

      blocks.push(`
        <div class="code-block-wrapper">
          <button class="copy-btn" onclick="copyToClipboard(this)">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span>Copy</span>
          </button>
          <pre><code>${escapedCode}</code></pre>
        </div>
      `);
      return id;
    });

    // 2. Format headings, lists, bold, italics, and newlines
    formatted = formatted
      .replace(/^###### (.*)$/gm, '<h6>$1</h6>')
      .replace(/^##### (.*)$/gm, '<h5>$1</h5>')
      .replace(/^#### (.*)$/gm, '<h4>$1</h4>')
      .replace(/^### (.*)$/gm, '<h3>$1</h3>')
      .replace(/^## (.*)$/gm, '<h2>$1</h2>')
      .replace(/^# (.*)$/gm, '<h1>$1</h1>');

    formatted = formatted.replace(/(^|\n)((?:\s*[-*]\s+.*(?:\n|$))+)/g, (full, before, listBlock) => {
      const items = listBlock
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)
        .map(line => `<li>${line.replace(/^\s*[-*]\s+/, '').trim()}</li>`)
        .join('');
      return `${before}<ul>${items}</ul>\n`;
    });

    formatted = formatted
      .replace(/`([^`]+)`/g, '<code>$1</code>') // Inline code
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') // Bold
      .replace(/\*(.*?)\*/g, '<em>$1</em>') // Italics
      .replace(/\n/g, '<br>'); // Newlines

    // 3. Put Code Blocks back
    blocks.forEach((block, i) => {
      formatted = formatted.replace(`__BLOCK_${i}__`, block);
    });
  }

  // 4. Handle [IMAGE_GEN: url]
  const imageMatch = formatted.match(/\[IMAGE_GEN:\s*(.*?)\]/i);
  let imageHTML = '';
  if (imageMatch) {
    const imageUrl = imageMatch[1].trim();
    formatted = formatted.replace(/\[IMAGE_GEN:.*?\]/gi, '').trim();
    
    const randomId = 'img_' + Math.random().toString(36).substr(2, 9);
    imageHTML = `
      <div class="generated-image-card">
        <div class="image-loading-skeleton" id="skeleton_${randomId}"></div>
        <img src="${imageUrl}" 
             alt="AI Generated" 
             class="generated-image" 
             onload="document.getElementById('skeleton_${randomId}').style.display='none'; this.style.opacity='1'"
             onerror="this.src='https://via.placeholder.com/512?text=Image+Load+Failed'; document.getElementById('skeleton_${randomId}').style.display='none'">
        <div class="image-actions">
          <a href="${imageUrl}" download="ai-generated-image.png" target="_blank" class="download-btn">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Save Image
          </a>
        </div>
      </div>
    `;
    if (!formatted) formatted = "I've generated this image for you: 🎨";
  }

  if (images.length) {
    const previewItems = images.map((src) => `
      <div class="message-image-item">
        <img src="${src}" alt="User image preview" />
      </div>
    `).join('');
    imageHTML += `
      <div class="message-images">
        ${previewItems}
      </div>
    `;
  }
  // ────────────────────────────────────────

  div.innerHTML = `
    <div class="avatar">${avatar}</div>
    <div class="message-body">
      <div class="message-content">
        ${role === 'user' ? '<button class="edit-btn" onclick="editMessage(this)">✏️</button>' : ''}
        <div class="bubble">${formatted}${imageHTML}</div>
      </div>
      <div class="time">${getTime()}</div>
    </div>
  `;
  chatBox.appendChild(div);
  chatBox.scrollTop = chatBox.scrollHeight;
  return div;
}

function editMessage(btn) {
  const messageDiv = btn.closest('.message');
  const bubble = messageDiv.querySelector('.bubble');
  const originalContent = bubble.innerHTML;
  const textarea = document.createElement('textarea');
  textarea.value = bubble.textContent; // Get plain text for editing
  textarea.className = 'edit-textarea';
  textarea.style.width = '100%';
  textarea.style.minHeight = '60px';
  textarea.style.resize = 'vertical';

  const saveBtn = document.createElement('button');
  saveBtn.textContent = 'Save';
  saveBtn.className = 'edit-save-btn';
  saveBtn.onclick = () => saveEdit(messageDiv, textarea.value);

  const cancelBtn = document.createElement('button');
  cancelBtn.textContent = 'Cancel';
  cancelBtn.className = 'edit-cancel-btn';
  cancelBtn.onclick = () => cancelEdit(messageDiv, originalContent);

  bubble.innerHTML = '';
  bubble.appendChild(textarea);
  bubble.appendChild(saveBtn);
  bubble.appendChild(cancelBtn);
  textarea.focus();
}

function saveEdit(messageDiv, newContent) {
  // Format the new content like appendMessage
  let formatted = newContent;
  const blocks = [];

  // Extract Triple Backtick Blocks
  formatted = formatted.replace(/```([\s\S]*?)```/g, (match, code) => {
    const id = `__BLOCK_${blocks.length}__`;
    const escapedCode = code.trim()
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    blocks.push(`
      <div class="code-block-wrapper">
        <button class="copy-btn" onclick="copyToClipboard(this)">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span>Copy</span>
        </button>
        <pre><code>${escapedCode}</code></pre>
      </div>
    `);
    return id;
  });

  // Format headings, lists, bold, italics, and newlines
  formatted = formatted
    .replace(/^###### (.*)$/gm, '<h6>$1</h6>')
    .replace(/^##### (.*)$/gm, '<h5>$1</h5>')
    .replace(/^#### (.*)$/gm, '<h4>$1</h4>')
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>');

  formatted = formatted.replace(/(^|\n)((?:\s*[-*]\s+.*(?:\n|$))+)/g, (full, before, listBlock) => {
    const items = listBlock
      .trim()
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => `<li>${line.replace(/^\s*[-*]\s+/, '').trim()}</li>`)
      .join('');
    return `${before}<ul>${items}</ul>\n`;
  });

  formatted = formatted
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/\n/g, '<br>');

  // Put Code Blocks back
  blocks.forEach((block, i) => {
    formatted = formatted.replace(`__BLOCK_${i}__`, block);
  });

  const bubble = messageDiv.querySelector('.bubble');
  bubble.innerHTML = formatted;

  // Remove subsequent messages
  const currentIndex = parseInt(messageDiv.getAttribute('data-index'));
  const allMessages = Array.from(chatBox.querySelectorAll('.message'));
  allMessages.forEach(msg => {
    if (parseInt(msg.getAttribute('data-index')) > currentIndex) {
      msg.remove();
    }
  });

  // Resend the message
  sendEditedMessage(newContent);
}

function cancelEdit(messageDiv, originalContent) {
  const bubble = messageDiv.querySelector('.bubble');
  bubble.innerHTML = originalContent;
}

function sendEditedMessage(content) {
  // Similar to sendMessage but with specific content
  showTyping();
  fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: content, session_id: sessionId, username: currentUsername })
  })
  .then(res => res.json())
  .then(data => {
    hideTyping();
    if (data.error) {
      showToast('❌ ' + data.error);
      return;
    }
    sessionId = data.session_id;
    localStorage.setItem('chat_session_id', sessionId);
    appendMessage('assistant', data.reply);
    if (currentUsername !== 'guest') loadSessions();
  })
  .catch(err => {
    hideTyping();
    showToast('❌ Network error');
  });
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
  if (!currentUsername || currentUsername === 'guest') return;
  try {
    const res = await fetch(`/api/sessions?username=${encodeURIComponent(currentUsername)}`);
    const data = await res.json();
    
    sidebarHistory.innerHTML = '';
    
    if (data.sessions && data.sessions.length > 0) {
      data.sessions.forEach(session => {
        const item = document.createElement('div');
        item.className = `sidebar-item ${session.session_id === sessionId ? 'active' : ''}`;
        
        const itemContent = document.createElement('div');
        itemContent.className = 'sidebar-item-content';
        itemContent.textContent = session.title || 'New Chat';
        itemContent.onclick = () => selectSession(session.session_id);
        
        const itemActions = document.createElement('div');
        itemActions.className = 'sidebar-item-actions';
        
        const shareBtn = document.createElement('button');
        shareBtn.className = 'sidebar-action-btn share-btn';
        shareBtn.title = 'Share Chat';
        shareBtn.innerHTML = '🔗';
        shareBtn.onclick = (e) => {
          e.stopPropagation();
          shareChat(session.session_id);
        };
        
        const deleteBtn = document.createElement('button');
        deleteBtn.className = 'sidebar-action-btn delete-btn';
        deleteBtn.title = 'Delete Chat';
        deleteBtn.innerHTML = '🗑️';
        deleteBtn.onclick = (e) => {
          e.stopPropagation();
          deleteChat(session.session_id);
        };
        
        itemActions.appendChild(shareBtn);
        itemActions.appendChild(deleteBtn);
        
        item.appendChild(itemContent);
        item.appendChild(itemActions);
        
        sidebarHistory.appendChild(item);
      });
    } else {
      sidebarHistory.innerHTML = '<div style="padding:20px; font-size:12px; color:var(--text-muted); text-align:center;">No recent chats</div>';
    }
  } catch (err) {
    console.error('Error loading sessions:', err);
  }
}

async function loadHistory(id) {
  try {
    const res = await fetch(`/api/history/${id}`);
    const data = await res.json();
    hideTyping();
    
    if (data.messages && data.messages.length > 0) {
      data.messages.forEach(m => appendMessage(m.role, m.content));
      messageIndex = data.messages.length;
    } else {
      showWelcome();
    }
    loadSessions(); // Update active state
  } catch (err) {
    hideTyping();
    showToast('❌ Could not load chat');
  }
}

async function selectSession(id) {
  if (id === sessionId) return;
  
  sessionId = id;
  localStorage.setItem('chat_session_id', sessionId);
  
  // Close sidebar on mobile
  if(sidebar) sidebar.classList.remove('open');
  if(overlay) overlay.classList.remove('show');
  
  // Clear UI and load history
  chatBox.innerHTML = '';
  showTyping();
  
  loadHistory(sessionId);
}

function startNewChat() {
  sessionId = null;
  localStorage.removeItem('chat_session_id');
  messageIndex = 0;
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
// ─── Image Upload Detection ───────────────────────────────────────────────────

function isImageUploadRequest(message) {
  const uploadKeywords = [
    'upload', 'image', 'photo', 'picture', 'collage', 'banner',
    'attach', 'select image', 'choose image', 'create collage',
    'make collage', 'merge image', 'combine image', 'build banner',
    'design banner', 'select photo', 'choose photo'
  ];
  
  const lowerMessage = message.toLowerCase();
  return uploadKeywords.some(keyword => lowerMessage.includes(keyword));
}

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
  
  // Check if user is asking for product search
  if (isProductSearch(msg)) {
    showTyping();
    fetch('/api/product-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: msg })
    })
    .then(res => res.json())
    .then(data => {
      hideTyping();
      console.log('[Frontend] Product search response:', data);
      
      if (data.products && data.products.length > 0) {
        appendMessage('assistant', '🛍️ Here are some products I found:', { rawHtml: false });
        const carouselHtml = generateProductCarousel(data.products);
        console.log('[Frontend] Generated carousel HTML:', carouselHtml);
        
        const div = document.createElement('div');
        div.className = 'message assistant';
        div.innerHTML = carouselHtml;
        chatBox.appendChild(div);
        chatBox.scrollTop = chatBox.scrollHeight;
      } else {
        appendMessage('assistant', 'Sorry, I couldn\'t find any products matching your search.');
      }
    })
    .catch(err => {
      hideTyping();
      showToast('❌ Error searching products');
      console.error('Product search error:', err);
    });
    sendBtn.disabled = false;
    userInput.focus();
    return;
  }
  
  // Check if user is asking to upload/create images
  if (isImageUploadRequest(msg)) {
    showToast('📸 Click the attachment button or select images!');
    document.getElementById('imageUploadInput').click();
    sendBtn.disabled = false;
    userInput.focus();
    return;
  }

  showTyping();

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg, session_id: sessionId, username: currentUsername })
    });

    const data = await res.json();
    hideTyping();

    if (!res.ok) throw new Error(data.error || 'Server error');

    let aiReply = data.reply;
    let musicRequested = null;
    
    // Parse [PLAY_MUSIC: song_name]
    const musicMatch = aiReply.match(/\[PLAY_MUSIC:\s*(.*?)\]/i);
    if (musicMatch) {
      musicRequested = musicMatch[1].trim();
      aiReply = aiReply.replace(/\[PLAY_MUSIC:([^\]]+)\]/ig, '').trim();
      if (!aiReply) aiReply = "Playing your music request now 🎵";
    }

    sessionId = data.session_id;
    localStorage.setItem('chat_session_id', sessionId);
    appendMessage('assistant', aiReply);
    
    // Speak the response using Voice AI ONLY if user sent via voice
    if (isVoice) {
      speakText(aiReply);
    }
    
    if (musicRequested) {
      playMusicCommand(musicRequested);
    }
    
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

async function deleteChat(sessionId) {
  if (!confirm('Are you sure you want to delete this chat? This action cannot be undone.')) return;
  
  try {
    const res = await fetch(`/api/history/${sessionId}`, { method: 'DELETE' });
    
    if (res.ok) {
      showToast('✅ Chat deleted successfully');
      // If we're currently viewing this chat, start a new one
      if (sessionId === window.sessionId) {
        startNewChat();
      } else {
        loadSessions(); // Refresh the sidebar
      }
    } else {
      throw new Error('Failed to delete chat');
    }
  } catch (err) {
    console.error('Delete error:', err);
    showToast('❌ Failed to delete chat');
  }
}

async function shareChat(sessionId) {
  try {
    // Load the chat history
    const res = await fetch(`/api/history/${sessionId}`);
    const data = await res.json();
    
    if (!data.messages || data.messages.length === 0) {
      showToast('❌ No messages to share');
      return;
    }
    
    // Format the chat for sharing
    let shareText = '💬 AI Chat Conversation\n\n';
    data.messages.forEach(msg => {
      const role = msg.role === 'user' ? '👤 You' : '🤖 AI';
      shareText += `${role}: ${msg.content}\n\n`;
    });
    
    // Try to use the Web Share API if available
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'AI Chat Conversation',
          text: shareText
        });
        return;
      } catch (err) {
        // User cancelled or share failed, fall back to clipboard
      }
    }
    
    // Fallback: Copy to clipboard
    await navigator.clipboard.writeText(shareText);
    showToast('✅ Chat copied to clipboard!');
    
  } catch (err) {
    console.error('Share error:', err);
    showToast('❌ Failed to share chat');
  }
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

/**
 * Copy code from block to clipboard
 */
window.copyToClipboard = (btn) => {
  const wrapper = btn.closest('.code-block-wrapper');
  const code = wrapper.querySelector('code').innerText;
  
  navigator.clipboard.writeText(code).then(() => {
    const btnText = btn.querySelector('span');
    const originalHTML = btn.innerHTML;
    
    btn.classList.add('copied');
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
      <span>Copied!</span>
    `;
    
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.innerHTML = originalHTML;
    }, 2000);
  }).catch(err => {
    console.error('Failed to copy: ', err);
    showToast('❌ Copy failed');
  });
};

/**
 * Theme Management
 */
const themeBtn = document.getElementById('themeBtn');
const themeMenu = document.getElementById('themeMenu');
const themeOptions = document.querySelectorAll('.theme-option');

function toggleThemeMenu(e) {
  e.stopPropagation();
  themeMenu.classList.toggle('show');
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('chat_theme', theme);
  
  // Update active state in menu
  themeOptions.forEach(opt => {
    if (opt.dataset.theme === theme) {
      opt.classList.add('active');
    } else {
      opt.classList.remove('active');
    }
  });
}

if (themeBtn) {
  themeBtn.onclick = toggleThemeMenu;
}

themeOptions.forEach(opt => {
  opt.onclick = () => {
    setTheme(opt.dataset.theme);
    themeMenu.classList.remove('show');
  };
});

// Close menu on outside click
document.addEventListener('click', (e) => {
  if (themeMenu && !themeMenu.contains(e.target) && e.target !== themeBtn) {
    themeMenu.classList.remove('show');
  }
});

// Initialize Theme
const savedTheme = localStorage.getItem('chat_theme') || 'emerald';
setTheme(savedTheme);

// Initialize
checkAuth();


// ─── Music Player Setup (YouTube IFrame API) ─────────────────────────────────
let ytPlayer;
let isMusicPlaying = false;
let musicPlayerContainer = document.getElementById('musicPlayer');
let musicTitle = document.getElementById('musicTitle');
let musicIcon = document.getElementById('musicIcon');
let playIconPath = document.getElementById('playIcon');

function onYouTubeIframeAPIReady() {
  ytPlayer = new YT.Player('ytplayer', {
    height: '0',
    width: '0',
    playerVars: {
      autoplay: 1,
      controls: 0,
      disablekb: 1,
      fs: 0,
      origin: window.location.origin,
    },
    events: {
      'onReady': onPlayerReady,
      'onStateChange': onPlayerStateChange,
      'onError': onPlayerError
    }
  });
}

function onPlayerReady(event) {
  // YT Player ready
}

function onPlayerStateChange(event) {
  if (event.data == YT.PlayerState.PLAYING) {
    isMusicPlaying = true;
    if(musicIcon) musicIcon.classList.add('spin');
    if(playIconPath) playIconPath.setAttribute('d', 'M6 19h4V5H6v14zm8-14v14h4V5h-4z'); 
  } else if (event.data == YT.PlayerState.PAUSED || event.data == YT.PlayerState.ENDED) {
    isMusicPlaying = false;
    if(musicIcon) musicIcon.classList.remove('spin');
    if(playIconPath) playIconPath.setAttribute('d', 'M8 5v14l11-7z');
  }
}

function onPlayerError(e) {
  showToast('❌ Could not play music. Try another song.');
  closeMusic();
}

async function playMusicCommand(songName) {
  if (!ytPlayer || !ytPlayer.loadVideoById) {
    showToast('⚠️ Music Player loading... Try again in a few seconds.');
    return;
  }
  
  if(musicTitle) musicTitle.textContent = 'Searching...';
  if(musicPlayerContainer) musicPlayerContainer.classList.remove('disabled');
  
  try {
    const res = await fetch(`/api/music/search?q=${encodeURIComponent(songName)}`);
    const data = await res.json();
    
    if (!res.ok || !data.videoId) {
      throw new Error(data.error || 'Music not found');
    }

    if(musicTitle) musicTitle.textContent = songName;
    ytPlayer.unMute();
    ytPlayer.loadVideoById(data.videoId);
    // Explicitly call play if it doesn't start
    setTimeout(() => {
      if (ytPlayer.getPlayerState() !== YT.PlayerState.PLAYING) {
        ytPlayer.playVideo();
      }
    }, 1000);
    showToast('🎵 Playing: ' + songName);
  } catch (err) {
    showToast('❌ ' + err.message);
    closeMusic();
  }
}

function toggleMusic() {
  if (!ytPlayer) return;
  if (isMusicPlaying) {
    ytPlayer.pauseVideo();
  } else {
    ytPlayer.playVideo();
  }
}

function closeMusic() {
  if (ytPlayer && ytPlayer.stopVideo) ytPlayer.stopVideo();
  if (musicPlayerContainer) musicPlayerContainer.classList.add('disabled');
}

// ─── Product Search ──────────────────────────────────────────────────────────
let isProductSearchMode = false;

function openProductSearch() {
  isProductSearchMode = true;
  document.getElementById('imageUploadInput').accept = 'image/*';
  document.getElementById('imageUploadInput').multiple = false;
  document.getElementById('imageUploadInput').click();
}

function isProductSearch(message) {
  const keywords = ['find product', 'search product', 'buy', 'price', 'where to buy', 'product', 'shopping'];
  return keywords.some(k => message.toLowerCase().includes(k));
}

// ─── Product Carousel HTML Generator ────────────────────────────────────────
function generateProductCarousel(products) {
  if (!products || products.length === 0) return '';
  
  const carouselId = `carousel_${Date.now()}`;
  const productCards = products.map(p => {
    const imageUrl = p.image && p.image.trim() ? p.image : 'https://via.placeholder.com/300x300?text=No+Image';
    const title = p.title || 'Unknown Product';
    const price = p.price || 'Price not available';
    const description = p.description || 'No description available';
    const link = p.link || '#';
    
    return `
    <div class="product-card">
      <div class="product-image-wrapper">
        <img src="${imageUrl}" alt="${title}" class="product-image" onerror="this.src='https://via.placeholder.com/300x300?text=No+Image'" loading="lazy">
        ${p.rating ? `<div class="product-rating">⭐ ${p.rating}</div>` : ''}
      </div>
      <div class="product-info">
        <h4 class="product-title">${title}</h4>
        <p class="product-description">${description}</p>
        <div class="product-footer">
          <span class="product-price">₹${price}</span>
          <a href="${link}" target="_blank" class="product-link">View →</a>
        </div>
      </div>
    </div>
    `;
  }).join('');

  return `
    <div class="products-carousel-container">
      <div class="products-carousel" id="${carouselId}">
        ${productCards}
      </div>
    </div>
  `;
}

// ─── Image Upload & Processing Logic ─────────────────────────────────────────
let selectedFiles = [];

function handleImageSelection(event) {
  const files = Array.from(event.target.files);
  if (files.length === 0) return;

  const totalFiles = selectedFiles.length + files.length;
  if (totalFiles > 5) {
    showToast("⚠️ Maximum 5 images allowed.");
    event.target.value = '';
    return;
  }
  
  // Append new files
  selectedFiles = [...selectedFiles, ...files];
  renderImagePreviews();
  event.target.value = '';
}

function renderImagePreviews() {
  const previewContainer = document.getElementById('inputImagePreviews');
  if (!previewContainer) return;
  
  previewContainer.innerHTML = '';
  
  selectedFiles.forEach((file, index) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const item = document.createElement('div');
      item.className = 'input-preview-item';
      
      const img = document.createElement('img');
      img.src = e.target.result;
      img.title = file.name;
      
      const removeBtn = document.createElement('button');
      removeBtn.className = 'input-preview-remove';
      removeBtn.innerHTML = '✕';
      removeBtn.title = 'Remove Image';
      removeBtn.onclick = () => removeSelectedImage(index);
      
      item.appendChild(img);
      item.appendChild(removeBtn);
      previewContainer.appendChild(item);
    };
    reader.readAsDataURL(file);
  });
}

function removeSelectedImage(index) {
  selectedFiles.splice(index, 1);
  renderImagePreviews();
}

async function processImageRequest(msg, isNewSession) {
  if (selectedFiles.length === 0) return false;

  const filesToProcess = [...selectedFiles];
  // Clear previews visually immediately
  selectedFiles = [];
  renderImagePreviews();
  
  // Check if it's a product search query explicitly OR if only 1 image and it seems like search
  if (isProductSearch(msg) && filesToProcess.length === 1) {
    const file = filesToProcess[0];
    const reader = new FileReader();
    reader.onload = async (e) => {
      const imageUrl = e.target.result;
      appendMessage('user', msg || `🔍 Searching for products based on this image...`, { images: [imageUrl] });
      showTyping();
      
      try {
        const res = await fetch('/api/product-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ imageUrl, query: msg })
        });
        
        const data = await res.json();
        hideTyping();
        
        if (data.products && data.products.length > 0) {
          appendMessage('assistant', '🛍️ Here are some products I found:', { rawHtml: false });
          const carouselHtml = generateProductCarousel(data.products);
          const div = document.createElement('div');
          div.className = 'message assistant';
          div.innerHTML = carouselHtml;
          chatBox.appendChild(div);
          chatBox.scrollTop = chatBox.scrollHeight;
        } else {
          appendMessage('assistant', 'Sorry, I couldn\'t find any matching products for that image.');
        }
      } catch (err) {
        hideTyping();
        showToast('❌ Error searching products');
        console.error('Product search error:', err);
      } finally {
        sendBtn.disabled = false;
        userInput.focus();
      }
    };
    reader.readAsDataURL(file);
    return true;
  }
  
  // Collage/Banner create mode
  const size = 'landscape'; // Default to landscape for simplicity
  const prompt = msg || '';
  const imagePreviews = filesToProcess.map((file) => URL.createObjectURL(file));
  
  appendMessage(
    'user',
    msg || `🎨 Uploaded ${filesToProcess.length} image(s) for editing/merging`,
    { images: imagePreviews }
  );
  showTyping();
  
  const formData = new FormData();
  filesToProcess.forEach((file) => formData.append('images', file, file.name));
  formData.append('size', size);
  formData.append('prompt', prompt);
  // Default session info
  if (sessionId) formData.append('session_id', sessionId);
  if (currentUsername) formData.append('username', currentUsername);
  
  try {
    const res = await fetch('/api/banner/create', {
      method: 'POST',
      body: formData
    });
    
    const data = await res.json();
    hideTyping();
    
    if (!res.ok) throw new Error(data.error || "Image processing failed");
    
    const bannerUrl = data.bannerUrl.startsWith('data:') ? data.bannerUrl : `${window.location.origin}${data.bannerUrl}`;
    const bannerMessage = `✨ **Here is your generated image!** [IMAGE_GEN: ${bannerUrl}]`;
    appendMessage('assistant', bannerMessage);
    
    if (data.session_id && data.session_id !== sessionId) {
       sessionId = data.session_id;
       localStorage.setItem('chat_session_id', sessionId);
    }
    
    // Refresh sidebar if it's new
    if (isNewSession) loadSessions();
    showToast("✅ Image Created!");
    
  } catch (err) {
    hideTyping();
    showToast("❌ " + err.message);
    console.error("Image processing error:", err);
  } finally {
    sendBtn.disabled = false;
    userInput.focus();
  }
  
  return true;
}


