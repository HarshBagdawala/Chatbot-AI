let sessionId = localStorage.getItem('chat_session_id') || null;
let currentUsername = localStorage.getItem('chat_username') || null;

const chatBox = document.getElementById('chatBox');
const userInput = document.getElementById('userInput');
const sendBtn = document.getElementById('sendBtn');
const sidebarHistory = document.getElementById('sidebarHistory');
const sidebar = document.getElementById('sidebar');

// ─── Authentication ────────────────────────────────────────────────────────────
function checkAuth() {
  const overlay = document.getElementById('loginOverlay');
  const appContainer = document.getElementById('appContainer');
  
  if (currentUsername) {
    if(overlay) overlay.classList.remove('active');
    if(appContainer) appContainer.style.display = 'flex';
    if(sidebar) sidebar.style.display = 'flex'; // Ensure sidebar behaves normally
    loadSessions();
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

function handleLogin() {
  const user = document.getElementById('usernameInput')?.value.trim();
  if (!user) {
    showToast("⚠️ Please enter a username.");
    return;
  }
  currentUsername = user;
  localStorage.setItem('chat_username', currentUsername);
  
  // Clear any existing session from previous user
  sessionId = null;
  localStorage.removeItem('chat_session_id');
  
  checkAuth();
}

function handleLogout() {
  currentUsername = null;
  sessionId = null;
  localStorage.removeItem('chat_username');
  localStorage.removeItem('chat_session_id');
  document.getElementById('usernameInput').value = '';
  checkAuth();
}

// Enter key for login
const usernameInput = document.getElementById('usernameInput');
if(usernameInput) {
  usernameInput.addEventListener('keydown', (e) => {
    if(e.key === 'Enter') handleLogin();
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
  if (!currentUsername) return;
  try {
    const res = await fetch(`/api/sessions?username=${encodeURIComponent(currentUsername)}`);
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

async function loadHistory(id) {
  try {
    const res = await fetch(`/api/history/${id}`);
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

async function sendMessage(isVoice = false) {
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

function playMusicCommand(songName) {
  if (!ytPlayer || !ytPlayer.loadPlaylist) {
    showToast('⚠️ Music Player loading... Try again in a few seconds.');
    return;
  }
  
  if(musicTitle) musicTitle.textContent = songName;
  if(musicPlayerContainer) musicPlayerContainer.classList.remove('disabled');
  
  // Use loadPlaylist with search query to play the top result
  ytPlayer.loadPlaylist({
    listType: 'search',
    list: songName,
    index: 0,
    startSeconds: 0,
    suggestedQuality: 'small'
  });
  
  showToast('🎵 Playing: ' + songName);
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
