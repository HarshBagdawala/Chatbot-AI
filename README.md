# 🤖 AI Chatbot — Hindi & English
**Node.js + Groq + Supabase**

---

## 📁 Project Structure
```
ai-chatbot/
├── server.js              ← Node.js backend (Express + Groq + Supabase)
├── public/
│   └── index.html         ← Frontend chat UI
├── supabase_setup.sql     ← Database setup script
├── .env.example           ← Environment variables template
├── package.json
└── README.md
```

---

## 🚀 Setup Guide (Step by Step)

### Step 1: Dependencies Install Karo
```bash
npm install
```

### Step 2: Groq API Key Lo
1. https://console.groq.com pe jao
2. Account banao (free hai)
3. **API Keys** section mein jaake key generate karo

### Step 3: Supabase Setup Karo
1. https://supabase.com pe jao
2. Naya project banao
3. **SQL Editor** mein `supabase_setup.sql` ka content paste karke run karo
4. **Settings > API** mein se `URL` aur `anon key` copy karo

### Step 4: .env File Banao
```bash
cp .env.example .env
```
Phir `.env` file mein apni keys dalo:
```
GROQ_API_KEY=gsk_xxxxxxxxxxxx
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJxxxxxxxxxx
PORT=3000
```

### Step 5: Server Start Karo
```bash
# Normal start
npm start

# Development mode (auto-restart)
npm run dev
```

### Step 6: Browser Mein Open Karo
```
http://localhost:3000
```

---

## 🌟 Features
- ✅ **Hindi + English** dono samajhta hai
- ✅ **Hinglish** bhi support karta hai
- ✅ **Chat history** Supabase mein save hoti hai
- ✅ **Session persist** — page reload ke baad bhi chat milti hai
- ✅ **Fast responses** — Groq ka Llama 3 (70B) model
- ✅ **Beautiful dark UI** with animations
- ✅ **Suggestion chips** for quick start
- ✅ **Code formatting** in responses
- ✅ **Mobile friendly**

---

## 🔌 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/chat` | Message bhejo, reply pao |
| GET | `/api/history/:session_id` | Chat history dekho |
| DELETE | `/api/history/:session_id` | Chat clear karo |
| GET | `/api/health` | Server status check |

### POST /api/chat Example:
```json
// Request
{
  "message": "Python kya hoti hai?",
  "session_id": "optional-uuid"
}

// Response
{
  "reply": "Python ek programming language hai...",
  "session_id": "generated-or-same-uuid"
}
```

---

## 🛠 Tech Stack
- **Backend**: Node.js + Express
- **AI Model**: Groq API (Llama 3 70B)
- **Database**: Supabase (PostgreSQL)
- **Frontend**: Vanilla HTML/CSS/JS

---

## ❓ Troubleshooting

**"Groq API Error"** → Check karo ki GROQ_API_KEY sahi hai  
**"Supabase Error"** → SQL script run kiya? URL/Key sahi hai?  
**Port already in use** → `.env` mein PORT=3001 karo
