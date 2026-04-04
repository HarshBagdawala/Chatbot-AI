const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const Groq = require("groq-sdk");
const { v4: uuidv4 } = require("uuid");
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
    // Attempting a more robust search source or better headers for DuckDuckGo
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      method: "GET",
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://duckduckgo.com/',
        'Cache-Control': 'max-age=0',
        'DNT': '1'
      }
    });

    if (!response.ok) {
       console.error(`Search Engine responded with ${response.status}`);
       if (response.status === 403) return "Search engine blocked the request. Please try again later or ask something else.";
       throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const html = await response.text();
    let results = [];

    // Improved parsing for DDG HTML results
    const chunks = html.split('class="result__snippet');
    
    for (let i = 1; i < Math.min(chunks.length, 5); i++) {
        const chunk = chunks[i];
        const prevChunk = chunks[i-1];
        
        // Extract title
        const titleMatch = prevChunk.match(/class="result__title"[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
        
        // Extract snippet (it's at the start of the current chunk)
        const snippetMatch = chunk.match(/^[^>]*>([\s\S]*?)<\/a>/i);

        if (titleMatch && snippetMatch) {
            const cleanTitle = titleMatch[1].replace(/<\/?[^>]+(>|$)/g, "").trim();
            const cleanSnippet = snippetMatch[1].replace(/<\/?[^>]+(>|$)/g, "").trim();
            
            // To HTML decode basic entities
            const finalTitle = cleanTitle.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
            const finalSnippet = cleanSnippet.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

            results.push(`Title: ${finalTitle}\nSnippet: ${finalSnippet}`);
        }
    }

    if (results.length === 0) {
      // Fallback: If no snippets, try to find links
      const linkMatches = html.match(/class="result__url"[^>]*>([\s\S]*?)<\/a>/gi);
      if (linkMatches) return "Found search results but could not extract details. Try a more specific question.";
      return "No web results found.";
    }
    
    return results.join('\n\n');
  } catch (err) {
    console.error("Web search failed:", err.message);
    return "Error performing web search. Search engine is currently unavailable.";
  }
}

// ─── Weather API ─────────────────────────────────────────────────────────────
async function getWeatherData(city) {
  try {
    console.log(`Fetching weather for: ${city}`);
    
    // 1. Geocoding: City Name -> Lat/Lon
    const geoRes = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(city)}&format=json&limit=1`, {
      headers: { 'User-Agent': 'AI-Chatbot-Assistant/1.0' }
    });
    const geoData = await geoRes.json();
    
    if (!geoData || geoData.length === 0) {
      return `Could not find coordinates for "${city}". Please check the spelling.`;
    }
    
    const { lat, lon, display_name } = geoData[0];
    
    // 2. Weather: Lat/Lon -> Forecast
    const weatherRes = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m`);
    const weatherData = await weatherRes.json();
    
    if (!weatherData.current) throw new Error("Weather data unavailable");
    
    const curr = weatherData.current;
    
    // Simple weather code mapping
    const weatherCodes = {
      0: "Clear sky",
      1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast",
      45: "Fog", 48: "Depositing rime fog",
      51: "Light drizzle", 53: "Moderate drizzle", 55: "Dense drizzle",
      61: "Slight rain", 63: "Moderate rain", 65: "Heavy rain",
      71: "Slight snow fall", 73: "Moderate snow fall", 75: "Heavy snow fall",
      95: "Thunderstorm"
    };
    
    const condition = weatherCodes[curr.weather_code] || "Conditions unknown";
    
    return `Current Weather in ${display_name}:
- Temperature: ${curr.temperature_2m}°C (Feels like ${curr.apparent_temperature}°C)
- Condition: ${condition}
- Humidity: ${curr.relative_humidity_2m}%
- Wind Speed: ${curr.wind_speed_10m} km/h
- Precipitation: ${curr.precipitation} mm`;

  } catch (err) {
    console.error("Weather API error:", err.message);
    return "Error: Could not retrieve weather data at this time.";
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
7. WEB SEARCH: For general real-time news or information, use 'search_web'. 
8. WEATHER: For ANY questions about weather, temperature, or forecasts for a specific city, you MUST use the 'get_weather' tool. Do NOT guess or use old data.

You can help with: coding, science, history, general knowledge, math, creative writing, advice, and much more!`;

// ─── Routes ──────────────────────────────────────────────────────────────────

// ─── Auth Routes ───
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
  if (username.toLowerCase() === 'guest') return res.status(400).json({ error: 'Username not allowed' });

  try {
    // Check if user already exists
    const { data: existingUser, error: checkError } = await supabase
      .from('users')
      .select('username')
      .eq('username', username)
      .single();

    if (existingUser) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    // Insert new user
    const { error: insertError } = await supabase
      .from('users')
      .insert([{ username, password }]);

    if (insertError) throw insertError;

    res.json({ success: true });
  } catch (err) {
    console.error("Registration error:", err.message);
    res.status(500).json({ error: 'Could not register user' });
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

  try {
    const { data: user, error: loginError } = await supabase
      .from('users')
      .select('username')
      .eq('username', username)
      .eq('password', password)
      .single();

    if (loginError || !user) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    res.json({ success: true, username: user.username });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: 'Something went wrong during login' });
  }
});

// Send a message
app.post("/api/chat", async (req, res) => {
  const { message, session_id, username } = req.body;

  if (!message || !message.trim()) {
    return res.status(400).json({ error: "Message is required" });
  }

  const userPrefix = username ? `${username}_` : 'guest_';
  const sessionId = session_id || `${userPrefix}${uuidv4()}`;

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
          description: "Search the internet for real-time information, news, or general facts.",
          parameters: {
            type: "object",
            properties: {
              query: {
                type: "string",
                description: "The search query (e.g. 'latest news on AI').",
              },
            },
            required: ["query"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_weather",
          description: "Get current weather and temperature for a specific city.",
          parameters: {
            type: "object",
            properties: {
              city: {
                type: "string",
                description: "The name of the city (e.g. 'Surat', 'New York').",
              },
            },
            required: ["city"],
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
        let toolResults = "";
        
        if (toolCall.function.name === 'search_web') {
          const args = JSON.parse(toolCall.function.arguments);
          console.log("Searching web for:", args.query);
          toolResults = await performWebSearch(args.query);
        } else if (toolCall.function.name === 'get_weather') {
          const args = JSON.parse(toolCall.function.arguments);
          toolResults = await getWeatherData(args.city);
        }
        
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: toolResults,
        });
      }

      // Second API call with the tool results
      completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages,
        tools: tools,
        temperature: 0.7,
        max_tokens: 1024,
      });

      assistantMessage = completion.choices[0]?.message;
    }

    const assistantReply = assistantMessage?.content || "Sorry, I could not generate a response.";

    // 4. Save user message + assistant reply to Supabase
    if (username !== 'guest') {
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
    const { username } = req.query;

    let query = supabase
      .from("chat_messages")
      .select("session_id, content, created_at")
      .order("session_id")
      .order("created_at", { ascending: true });

    if (username) {
      query = query.like("session_id", `${username}_%`);
    }

    const { data, error } = await query;

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
