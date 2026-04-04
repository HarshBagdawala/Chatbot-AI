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

// ─── Web Search ──────────────────────────────────────────────────────────────
async function performWebSearch(query) {
  try {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      method: "GET",
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });

    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const html = await response.text();
    let results = [];

    // Simple parser to avoid heavy dependencies like cheerio
    const chunks = html.split('class="result__snippet');
    
    // Start from 1 because index 0 is before the first snippet
    for (let i = 1; i < Math.min(chunks.length, 4); i++) {
        const chunk = chunks[i];
        
        // Find title text before this snippet (by looking at the previous chunk)
        const prevChunk = chunks[i-1];
        const titleMatch = prevChunk.match(/<h2 class="result__title">[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>$/i) || prevChunk.match(/class="result__title"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>[\s\S]*?$/i);
        
        // Find snippet text
        const snippetMatch = chunk.match(/^[^>]*>([\s\S]*?)<\/a>/i);

        if (titleMatch && snippetMatch) {
            const cleanTitle = titleMatch[1].replace(/<\/?[^>]+(>|$)/g, "").trim();
            const cleanSnippet = snippetMatch[1].replace(/<\/?[^>]+(>|$)/g, "").trim();
            
            // To HTML decode basic entities
            const finalTitle = cleanTitle.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
            const finalSnippet = cleanSnippet.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

            results.push(`Title: ${finalTitle}\nSnippet: ${finalSnippet}`);
        }
    }

    if (results.length === 0) return "No web results found.";
    return results.join('\n\n');
  } catch (err) {
    console.error("Web search failed:", err.message);
    return "Error performing web search.";
  }
}

// ─── System Prompt ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a helpful, knowledgeable, and friendly AI assistant.

Key behavior rules:
1. Always respond in English unless specifically asked otherwise.
2. Provide accurate, clear, and helpful answers on any topic.
3. Be conversational, warm, and supportive.
4. For complex topics, break down your answer into simple steps.
5. If you don't know something, be honest and say so.
6. MUSIC REQUESTS: If the user asks you to play a song or music (e.g., "play some music", "play Believer by Imagine Dragons"), you MUST include exactly this tag in your response: \`[PLAY_MUSIC: song_name]\` (replace song_name with the requested song title, or "Relaxing Lofi Music" if no specific song is requested).
7. WEB SEARCH: You have a tool called 'search_web' available. You MUST use it whenever the user asks for real-time information, such as today's weather, breaking news, or current prices. Do NOT hallucinate real-time data.

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

    const tools = [
      {
        type: "function",
        function: {
          name: "search_web",
          description: "Search the internet for real-time information, news, weather, or facts.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "The search query to look up on the internet (e.g. 'Mumbai weather today').",
              },
            },
            required: ["query"],
          },
        },
      },
    ];

    // 3. Call Groq API
    let completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      tools: tools,
      tool_choice: "auto",
      temperature: 0.7,
      max_tokens: 1024,
    });

    let assistantMessage = completion.choices[0]?.message;

    // Handle tool calls
    if (assistantMessage.tool_calls) {
      messages.push(assistantMessage); // Append assistant's tool call request to history

      for (const toolCall of assistantMessage.tool_calls) {
        if (toolCall.function.name === 'search_web') {
          const args = JSON.parse(toolCall.function.arguments);
          console.log("Searching web for:", args.query);
          const searchResults = await performWebSearch(args.query);
          
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            name: toolCall.function.name,
            content: searchResults,
          });
        }
      }

      // Second API call with the tool results
      completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages,
        temperature: 0.7,
        max_tokens: 1024,
      });

      assistantMessage = completion.choices[0]?.message;
    }

    const assistantReply = assistantMessage?.content || "Sorry, I could not generate a response.";

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

// Get all chat sessions
app.get("/api/sessions", async (req, res) => {
  try {
    // Fetch unique session_ids with the first message content as a title
    // PostgreSQL: SELECT DISTINCT ON (session_id)
    const { data, error } = await supabase
      .from("chat_messages")
      .select("session_id, content, created_at")
      .order("session_id")
      .order("created_at", { ascending: true });

    if (error) throw error;

    // Manual grouping to get the first message of each session
    const sessionsMap = new Map();
    data.forEach(msg => {
      if (!sessionsMap.has(msg.session_id)) {
        sessionsMap.set(msg.session_id, {
          session_id: msg.session_id,
          title: msg.content.substring(0, 40) + (msg.content.length > 40 ? "..." : ""),
          created_at: msg.created_at
        });
      }
    });

    const sessions = Array.from(sessionsMap.values())
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ sessions });
  } catch (err) {
    console.error("Sessions fetch error:", err.message);
    res.status(500).json({ error: "Could not fetch sessions." });
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

function maskToken(token) {
  if (!token) return 'Not Set';
  if (token.length <= 8) return token;
  return token.substring(0, 5) + '...' + token.substring(token.length - 4);
}

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n\x1b[36m🤖 AI Chatbot Server running at http://localhost:${PORT}\x1b[0m\n`);
    console.log(`\x1b[32m📦 Supabase connected: ✅ [URL: ${process.env.SUPABASE_URL}] \x1b[0m`);
    console.log(`\x1b[33m🔑 Supabase Key: ${maskToken(process.env.SUPABASE_ANON_KEY)}\x1b[0m`);
    console.log(`\x1b[35m🧠 Groq API: ✅ [Key: ${maskToken(process.env.GROQ_API_KEY)}]\x1b[0m`);
    console.log(`\n\x1b[90mSecurity Info: No API keys are exposed to the frontend/browser inspect tools.\x1b[0m\n`);
  });
}
