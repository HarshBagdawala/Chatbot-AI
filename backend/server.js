const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(__dirname, ".env") });
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const sharp = require("sharp");
const { createClient } = require("@supabase/supabase-js");
const Groq = require("groq-sdk");
const { v4: uuidv4 } = require("uuid");

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "frontend")));

// ─── Multer Setup ────────────────────────────────────────────────────────────
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${uuidv4()}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPEG, PNG and WebP images are allowed"));
    }
  },
});

// Serve uploaded files statically
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

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

/*
async function searchYoutubeOfficial(query) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey || apiKey.includes('your_youtube_api_key_here')) return null;

  try {
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(query)}&key=${apiKey}&maxResults=1&type=video`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.items && data.items.length > 0) {
      console.log(`[Music Search] Found official video ID: ${data.items[0].id.videoId}`);
      return data.items[0].id.videoId;
    }
    return null;
  } catch (err) {
    console.error("Official YouTube search failed:", err.message);
    return null;
  }
}

async function searchInvidious(query) {
  // Rotate through stable public instances
  const instances = [
    'https://iv.melmac.space',
    'https://invidious.flokinet.to',
    'https://invidious.projectsegfau.lt',
    'https://invidious.perennialte.ch'
  ];

  for (const instance of instances) {
    try {
      const url = `${instance}/api/v1/search?q=${encodeURIComponent(query)}&type=video`;
      const response = await fetch(url, { signal: AbortSignal.timeout(3000) }); // 3s timeout
      if (!response.ok) continue;
      
      const data = await response.json();
      if (data && data.length > 0 && data[0].videoId) {
        console.log(`[Music Search] Found Invidious video ID (${instance}): ${data[0].videoId}`);
        return data[0].videoId;
      }
    } catch (err) {
      continue; // Try next instance
    }
  }
  return null;
}

async function searchYoutubeVideo(query) {
  // 1. Try Official API first
  const officialId = await searchYoutubeOfficial(query);
  if (officialId) return officialId;

  // 2. Try Invidious (Key-less & Reliable fallback)
  const invidiousId = await searchInvidious(query);
  if (invidiousId) return invidiousId;

  // 3. Fallback to Scraper (Local dev fallback)
  try {
    // Strategy 1: Search DuckDuckGo specifically for video links
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent("youtube " + query)}`;
    const response = await fetch(searchUrl, {
      method: "GET",
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    if (!response.ok) return null;
    
    const html = await response.text();
    
    // Multiple regex patterns for video IDs
    const patterns = [
      /watch\?v=([a-zA-Z0-9_-]{11})/,
      /video\/([a-zA-Z0-9_-]{11})/,
      /v=([a-zA-Z0-9_-]{11})/,
      /vi\/([a-zA-Z0-9_-]{11})/
    ];

    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (match && match[1]) return match[1];
    }

    // Strategy 2: Try another search if first one fails
    const searchUrl2 = `https://html.duckduckgo.com/html/?q=${encodeURIComponent("site:youtube.com " + query)}`;
    const response2 = await fetch(searchUrl2, {
      method: "GET",
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    if (response2.ok) {
        const html2 = await response2.text();
        const match2 = html2.match(/watch\?v=([a-zA-Z0-9_-]{11})/);
        if (match2) return match2[1];
    }

    console.warn(`[Music Search] Could not find video ID for: ${query}. HTML snippet: ${html.substring(0, 300)}`);
    return null;
  } catch (err) {
    console.error("YouTube search failed:", err.message);
    return null;
  }
}
*/


// ─── Weather API (OpenWeatherMap) ───────────────────────────────────────────
async function getWeatherData(city) {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey || apiKey.includes('your_openweather_api_key_here')) {
    return "Weather API is not configured. Please add your OpenWeatherMap API key to the .env file. 🛠️";
  }

  try {
    console.log(`Fetching weather for: ${city}`);
    
    // 1. Fetch current weather from OpenWeatherMap
    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`;
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.cod !== 200) {
      console.log(`OpenWeatherMap error: ${data.message}`);
      if (data.cod === "404") return `I'm sorry, I couldn't find the location "${city}". Please check the spelling. 🌏`;
      if (data.cod === 401) return "Invalid API Key. Please check your OpenWeatherMap credentials. 🔑";
      throw new Error(data.message);
    }
    
    // 2. Parse and format the response
    const { main, weather, wind, name, sys } = data;
    const temp = Math.round(main.temp);
    const feelsLike = Math.round(main.feels_like);
    const condition = weather[0].main;
    const description = weather[0].description;
    const humidity = main.humidity;
    const windSpeed = wind.speed;
    const country = sys.country;

    // Get a relevant emoji based on the weather condition
    let emoji = "🌡️";
    const condLower = condition.toLowerCase();
    if (condLower.includes("cloud")) emoji = "☁️";
    else if (condLower.includes("rain")) emoji = "🌧️";
    else if (condLower.includes("clear")) emoji = "☀️";
    else if (condLower.includes("snow")) emoji = "❄️";
    else if (condLower.includes("thunder")) emoji = "⛈️";
    else if (condLower.includes("mist") || condLower.includes("fog")) emoji = "🌫️";

    return `### Current Weather in ${name}, ${country} ${emoji}
- **Temperature**: ${temp}°C (Feels like ${feelsLike}°C)
- **Condition**: ${condition} (${description})
- **Humidity**: ${humidity}%
- **Wind Speed**: ${windSpeed} m/s`;

  } catch (err) {
    console.error("OpenWeatherMap API error:", err.message);
    return "Error: Could not retrieve weather data from OpenWeatherMap at this time. 🛑";
  }
}

// ─── System Prompt ───────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a helpful, knowledgeable, and friendly AI assistant.

Formatting & Style Rules:
1. USE EMOJIS: Add relevant emojis to your responses to make them feel friendly and alive. ✨
2. STRUCTURED REPLIES: Always use bold text for headings, bullet points for lists, and clear line breaks to make your answers professional and easy to read. 📝
3. WARM TONE: Be conversational, supportive, and provide premium quality help. 🤝

Key behavior rules:
1. LANGUAGE MATCHING: Always respond in the same language the user uses. If the user speaks in Hinglish, respond in Hinglish. If they use Hindi, respond in Hindi. If English, respond in English. Be adaptive and match their style perfectly. 🗣️
2. Provide accurate, clear, and helpful answers on any topic.
3. For complex topics, break down your answer into simple steps. 🔢
4. If you don't know something, be honest and say so.
5. MUSIC REQUESTS: If the user asks you to play a song or music (e.g., "play some music", "play Believer by Imagine Dragons"), you MUST include exactly this tag in your response: \`[PLAY_MUSIC: song_name]\` (replace song_name with the requested song title, or "Relaxing Lofi Music" if no specific song is requested). 🎵
6. WEATHER: For ANY questions about weather, temperature, or forecasts for ANY city, region, or country globally, you MUST use the 'get_weather' tool. Do NOT guess or use old data. 🌦️
7. WEB SEARCH: For other real-time news or general facts, use 'search_web'. 🔍
8. IMAGE GENERATION: If the user asks to "generate", "create", "draw", or "make" an image, use the 'generate_image' tool. After the tool returns a URL, you MUST include the tag \`[IMAGE_GEN: url]\` in your final response to display it. 🎨

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
          description: "Get real-time weather and temperature for ANY city, region, or country worldwide.",
          parameters: {
            type: "object",
            properties: {
              city: {
                type: "string",
                description: "The name of the location (e.g. 'Mumbai', 'London', 'California', 'India').",
              },
            },
            required: ["city"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "generate_image",
          description: "Generate a high-quality AI image from a text description.",
          parameters: {
            type: "object",
            properties: {
              prompt: {
                type: "string",
                description: "The detailed English description of the image to generate (e.g. 'A futuristic city at sunset').",
              },
            },
            required: ["prompt"],
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

    console.log("Groq Completion Choice:", JSON.stringify(completion.choices[0], null, 2));
    let assistantMessage = completion.choices[0]?.message;

    // Handle tool calls (Loop to allow multiple turns if needed)
    let toolTurns = 0;
    while (assistantMessage.tool_calls && toolTurns < 5) {
      toolTurns++;
      console.log(`Tool Turn ${toolTurns}: Handling ${assistantMessage.tool_calls.length} calls`);
      
      messages.push(assistantMessage);

      for (const toolCall of assistantMessage.tool_calls) {
        let toolResults = "";
        
        if (toolCall.function.name === 'search_web') {
          const args = JSON.parse(toolCall.function.arguments);
          console.log(`Searching web for: ${args.query}`);
          toolResults = await performWebSearch(args.query);
        } else if (toolCall.function.name === 'get_weather') {
          const args = JSON.parse(toolCall.function.arguments);
          toolResults = await getWeatherData(args.city);
        } else if (toolCall.function.name === 'generate_image') {
          const args = JSON.parse(toolCall.function.arguments);
          const randomSeed = Math.floor(Math.random() * 1000000);
          const imageUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(args.prompt)}?width=1024&height=1024&nologo=true&seed=${randomSeed}`;
          toolResults = `Successfully generated the image. Tell the user you've created it and MUST include this exact tag in your response: [IMAGE_GEN: ${imageUrl}]`;
          console.log(`Generated Image URL: ${imageUrl}`);
        }
        
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,
          name: toolCall.function.name,
          content: toolResults,
        });
      }

      // Call Groq again with tool results
      completion = await groq.chat.completions.create({
        model: "llama-3.3-70b-versatile",
        messages,
        tools: tools,
        temperature: 0.7,
        max_tokens: 1024,
      });

      console.log(`Groq Loop Turn ${toolTurns} Choice:`, JSON.stringify(completion.choices[0], null, 2));
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

/*
// Music search endpoint
app.get("/api/music/search", async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: "Query is required" });
  
  const videoId = await searchYoutubeVideo(q);
  if (!videoId) return res.status(404).json({ error: "Music not found" });
  
  res.json({ videoId });
});
*/

// ─── Banner Creation Route ──────────────────────────────────────────────────
app.post("/api/banner/create", upload.array("images", 5), async (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "At least one image is required" });
  }

  const { size = 'landscape' } = req.body;
  const bannerName = `banner-${Date.now()}.png`;
  const bannerPath = path.join(__dirname, "uploads", bannerName);

  try {
    const bannersDir = path.join(__dirname, "uploads");
    if (!fs.existsSync(bannersDir)) fs.mkdirSync(bannersDir);

    const imageFiles = req.files;
    let targetWidth, targetHeight;

    // Determine proportions based on user choice
    if (size === 'square') {
      targetWidth = 1080; targetHeight = 1080;
    } else if (size === 'portrait') {
      targetWidth = 1080; targetHeight = 1920;
    } else { // default landscape
      targetWidth = 1920; targetHeight = 1080;
    }

    const imageWidth = Math.floor(targetWidth / imageFiles.length);
    const imageHeight = targetHeight;

    // Process and resize each image
    const processedImages = await Promise.all(
      imageFiles.map(async (file, index) => {
        const inputBuffer = fs.readFileSync(file.path);
        const resizedBuffer = await sharp(inputBuffer)
          .resize(imageWidth, imageHeight, { fit: 'cover' })
          .toBuffer();
        
        return {
          input: resizedBuffer,
          top: 0,
          left: index * imageWidth
        };
      })
    );

    // Create the final composite banner
    await sharp({
      create: {
        width: targetWidth,
        height: targetHeight,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 }
      }
    })
    .composite(processedImages)
    .png()
    .toFile(bannerPath);

    // Cleanup: Delete original uploaded files
    imageFiles.forEach(f => fs.unlinkSync(f.path));

    const bannerUrl = `/uploads/${bannerName}`;
    res.json({ success: true, bannerUrl });

  } catch (err) {
    console.error("Banner creation error:", err.message);
    res.status(500).json({ error: "Failed to create banner. Please try again." });
    // Cleanup on error
    if (req.files) req.files.forEach(f => { if(fs.existsSync(f.path)) fs.unlinkSync(f.path); });
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
