require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const Groq = require("groq-sdk");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

// ─── Clients ────────────────────────────────────────────────────────────────
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// ─── System Prompt ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a helpful, knowledgeable, and friendly AI assistant.

Key behavior rules:
1. Always respond in English unless specifically asked otherwise.
2. Provide accurate, clear, and helpful answers on any topic.
3. Be conversational, warm, and supportive.
4. For complex topics, break down your answer into simple steps.
5. If you don't know something, be honest and say so.

You can help with: coding, science, history, general knowledge, math, creative writing, advice, and much more!`;

// ─── Routes ──────────────────────────────────────────────────────────────────

// Send a message
app.post("/api/chat", async (req, res) => {
  const { message, session_id } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: "Message is required" });
  }

  const sessionId = session_id || uuidv4();

  try {
    // 1. Fetch last 10 messages for context from Supabase
    const { data: history, error: historyError } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true })
      .limit(10);

    if (historyError) {
      console.error("Supabase fetch error:", historyError.message);
    }

    // 2. Build messages array for Groq
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      ...(history || []),
      { role: "user", content: message },
    ];

    // 3. Call Groq API
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.7,
      max_tokens: 1024,
    });

    const assistantReply = completion.choices[0]?.message?.content || "Sorry, I could not generate a response.";

    // 4. Save user message + assistant reply to Supabase
    const { error: insertError } = await supabase
      .from("chat_messages")
      .insert([
        {
          session_id: sessionId,
          role: "user",
          content: message,
        },
        {
          session_id: sessionId,
          role: "assistant",
          content: assistantReply,
        },
      ]);

    if (insertError) {
      console.error("Supabase insert error:", insertError.message);
    }

    // 5. Return response
    res.json({
      reply: assistantReply,
      session_id: sessionId,
    });
  } catch (err) {
    console.error("Server error:", err.message);
    res.status(500).json({ error: "Something went wrong. Please try again." });
  }
});

// Get chat history for a session
app.get("/api/history/:session_id", async (req, res) => {
  const { session_id } = req.params;

  try {
    const { data, error } = await supabase
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("session_id", session_id)
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.json({ messages: data || [] });
  } catch (err) {
    console.error("History fetch error:", err.message);
    res.status(500).json({ error: "Could not fetch history." });
  }
});

// Clear chat session
app.delete("/api/history/:session_id", async (req, res) => {
  const { session_id } = req.params;

  try {
    const { error } = await supabase
      .from("chat_messages")
      .delete()
      .eq("session_id", session_id);

    if (error) throw error;

    res.json({ success: true, message: "Chat cleared!" });
  } catch (err) {
    console.error("Delete error:", err.message);
    res.status(500).json({ error: "Could not clear chat." });
  }
});

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "AI Chatbot server is running! 🚀" });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;

// Export for Vercel
module.exports = app;

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n\x1b[36m🤖 AI Chatbot Server running at http://localhost:${PORT}\x1b[0m\n`);
    console.log(`\x1b[32m📦 Supabase connected: ✅\x1b[0m`);
    console.log(`\x1b[35m🧠 Groq API: ✅\x1b[0m`);
  });
}
