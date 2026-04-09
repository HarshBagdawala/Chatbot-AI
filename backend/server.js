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
const axios = require("axios");
const { HfInference } = require("@huggingface/inference");

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, "..", "frontend")));

// Serve a small inline SVG favicon at /favicon.ico to avoid 404s
app.get('/favicon.ico', (req, res) => {
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
  <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>
    <rect width='100' height='100' rx='18' fill='%23111'/>
    <text x='50' y='60' font-size='56' text-anchor='middle'>🤖</text>
  </svg>`;
  res.set('Content-Type', 'image/svg+xml');
  res.send(svg);
});

// ─── Multer Setup ────────────────────────────────────────────────────────────
const storage = multer.memoryStorage();

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

// ─── Clients ────────────────────────────────────────────────────────────────


const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
const hf = process.env.HF_TOKEN ? new HfInference(process.env.HF_TOKEN.trim()) : null;

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

// ─── Product Search Functions ────────────────────────────────────────────────
async function describeImage(imageUrl, instruction = 'Describe this image in detail, focusing on any products, items, or objects visible. Provide a concise description suitable for product search.') {
  try {
    const response = await axios.post('https://api.mistral.ai/v1/chat/completions', {
      model: 'pixtral-12b-2409',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: instruction },
            { type: 'image_url', image_url: { url: imageUrl } }
          ]
        }
      ],
      max_tokens: 200
    }, {
      headers: {
        'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`,
        'Content-Type': 'application/json'
      }
    });
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    if (error.response && error.response.status === 429) {
       console.error('Mistral API rate limit (429) reached.');
       return null; // Return null so we know it failed
    }
    console.error('Image description error:', error.message);
    return null;
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
function getWindDirection(deg = 0) {
  const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  const index = Math.floor(((deg % 360) + 360) / 22.5);
  return directions[index % directions.length];
}

function formatLocalTime(timestampSec, timezoneOffsetSec) {
  const timeMs = timestampSec ? timestampSec * 1000 : Date.now();
  const localDate = new Date(timeMs + timezoneOffsetSec * 1000);
  return localDate.toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'UTC'
  });
}

function getWeatherAdvice(condition, temp, humidity) {
  const adviceParts = [];
  if (condition.includes('rain') || condition.includes('drizzle') || condition.includes('thunder')) {
    adviceParts.push('Carry an umbrella or raincoat.');
  } else if (condition.includes('clear') && temp >= 28) {
    adviceParts.push('Stay hydrated and use sunscreen if you go outside.');
  } else if (condition.includes('snow')) {
    adviceParts.push('Dress warmly and watch for slippery surfaces.');
  } else if (condition.includes('fog') || condition.includes('mist')) {
    adviceParts.push('Drive carefully and use low-beam headlights.');
  }

  if (temp >= 35) adviceParts.push('It is very hot — drink plenty of water.');
  if (temp <= 10) adviceParts.push('It is chilly — wear warm clothing.');
  if (humidity >= 85) adviceParts.push('High humidity makes it feel heavier outside.');

  return adviceParts.length ? adviceParts.join(' ') : 'Weather looks stable and comfortable for most activities.';
}

async function getWeatherData(city) {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey || apiKey.includes('your_openweather_api_key_here')) {
    return 'Weather API is not configured. Please add your OpenWeatherMap API key to the .env file. 🛠️';
  }

  try {
    console.log(`Fetching weather for: ${city}`);

    const url = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&appid=${apiKey}&units=metric`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.cod !== 200) {
      console.log(`OpenWeatherMap error: ${data.message}`);
      if (data.cod === '404') return `I'm sorry, I couldn't find the location "${city}". Please check the spelling. 🌏`;
      if (data.cod === 401) return 'Invalid API Key. Please check your OpenWeatherMap credentials. 🔑';
      throw new Error(data.message);
    }

    const { main, weather, wind, name, sys, clouds, visibility, timezone } = data;
    const temp = Math.round(main.temp);
    const feelsLike = Math.round(main.feels_like);
    const minTemp = Math.round(main.temp_min);
    const maxTemp = Math.round(main.temp_max);
    const pressure = main.pressure;
    const humidity = main.humidity;
    const windSpeed = wind.speed;
    const windDir = getWindDirection(wind.deg || 0);
    const condition = weather[0].main;
    const description = weather[0].description;
    const country = sys.country;
    const cloudsPct = clouds?.all ?? 0;
    const visibilityKm = visibility ? (visibility / 1000).toFixed(1) : 'N/A';
    const localTime = formatLocalTime(null, timezone);
    const sunriseTime = formatLocalTime(sys.sunrise, timezone);
    const sunsetTime = formatLocalTime(sys.sunset, timezone);

    let emoji = '🌡️';
    const condLower = condition.toLowerCase();
    if (condLower.includes('cloud')) emoji = '☁️';
    else if (condLower.includes('rain') || condLower.includes('drizzle')) emoji = '🌧️';
    else if (condLower.includes('clear')) emoji = '☀️';
    else if (condLower.includes('snow')) emoji = '❄️';
    else if (condLower.includes('thunder')) emoji = '⛈️';
    else if (condLower.includes('mist') || condLower.includes('fog')) emoji = '🌫️';

    const advice = getWeatherAdvice(condLower, temp, humidity);

    return `### 🌦️ Live Weather in ${name}, ${country} ${emoji}

- **Local time**: ${localTime}
- **Temperature**: **${temp}°C** (Feels like ${feelsLike}°C)
- **Min / Max**: **${minTemp}°C / ${maxTemp}°C**
- **Condition**: **${condition}** — ${description}
- **Humidity**: **${humidity}%**
- **Pressure**: **${pressure} hPa**
- **Wind**: **${windSpeed} m/s** (${windDir})
- **Cloud cover**: **${cloudsPct}%**
- **Visibility**: **${visibilityKm} km**
- **Sunrise / Sunset**: **${sunriseTime} / ${sunsetTime}**

**Weather tip:** ${advice}`;

  } catch (err) {
    console.error('OpenWeatherMap API error:', err.message);
    return 'Error: Could not retrieve weather data from OpenWeatherMap at this time. 🛑';
  }
}

// ─── HTML Page Generator ──────────────────────────────────────────────────────
function generateHTMLPage(pageTitle = "My Page", bodyContent = "") {
  const defaultContent = bodyContent || `
    <h1>Welcome to ${pageTitle}</h1>
    <p>This is a basic webpage with header, body, and footer sections.</p>
    <ul>
      <li>Point 1: Easy to customize</li>
      <li>Point 2: Responsive design</li>
      <li>Point 3: Clean structure</li>
    </ul>
  `;

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${pageTitle}</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;   
            line-height: 1.6;
            color: #333;
            background-color: #f4f4f4;
        }
        
        header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 2rem 0;
            text-align: center;
            box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        }
        
        header h1 {
            font-size: 2.5rem;
            margin-bottom: 0.5rem;
        }
        
        header p {
            font-size: 1.1rem;
            opacity: 0.9;
        }
        
        nav {
            background-color: #333;
            padding: 1rem;
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
        }
        
        nav ul {
            list-style: none;
            display: flex;
            justify-content: center;
            gap: 2rem;
            flex-wrap: wrap;
        }
        
        nav a {
            color: white;
            text-decoration: none;
            font-weight: 500;
            transition: color 0.3s;
        }
        
        nav a:hover {
            color: #667eea;
        }
        
        main {
            max-width: 1000px;
            margin: 2rem auto;
            padding: 0 1rem;
            background: white;
            border-radius: 10px;
            box-shadow: 0 2px 15px rgba(0, 0, 0, 0.05);
            padding: 2rem;
            min-height: 400px;
        }
        
        main h1 {
            color: #667eea;
            margin-bottom: 1rem;
            font-size: 2rem;
        }
        
        main p {
            margin-bottom: 1rem;
            color: #555;
        }
        
        main ul {
            margin-left: 2rem;
            margin-bottom: 1rem;
        }
        
        main li {
            margin-bottom: 0.5rem;
            color: #555;
        }
        
        footer {
            background-color: #333;
            color: white;
            text-align: center;
            padding: 2rem 1rem;
            margin-top: 2rem;
            border-top: 4px solid #667eea;
        }
        
        footer p {
            margin-bottom: 0.5rem;
        }
        
        footer a {
            color: #667eea;
            text-decoration: none;
        }
        
        footer a:hover {
            text-decoration: underline;
        }
        
        @media (max-width: 768px) {
            header h1 {
                font-size: 1.8rem;
            }
            
            nav ul {
                gap: 1rem;
                flex-direction: column;
            }
            
            main {
                margin: 1rem auto;
                padding: 1.5rem;
            }
        }
    </style>
</head>
<body>
    <header>
        <h1>${pageTitle}</h1>
        <p>✨ A modern and responsive webpage</p>
    </header>
    
    <nav>
        <ul>
            <li><a href="#home">Home</a></li>
            <li><a href="#about">About</a></li>
            <li><a href="#services">Services</a></li>
            <li><a href="#contact">Contact</a></li>
        </ul>
    </nav>
    
    <main>
        ${defaultContent}
    </main>
    
    <footer>
        <p>&copy; 2025 ${pageTitle}. All rights reserved.</p>
        <p>Created with <span style="color: red;">❤️</span> | <a href="#">Privacy Policy</a></p>
    </footer>
</body>
</html>`;
}

function isHTMLPageRequest(message) {
  const htmlKeywords = [
    'html page', 'full page', 'basic page', 'html code',
    'create page', 'make page', 'web page', 'html template',
    'design page', 'build page', 'webpage code'
  ];
  
  const lowerMessage = message.toLowerCase();
  return htmlKeywords.some(keyword => lowerMessage.includes(keyword));
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
6. WEATHER: For ANY questions about weather, temperature, or forecasts for ANY city, region, or country globally, you MUST use the 'get_weather' tool. Do NOT guess or use old data. Always return a rich weather report with full live details, local time, temperature range, humidity, wind, visibility, sunrise/sunset, and a helpful tip. Always format the weather answer using Markdown-style headings, bold labels, and clear bullet lists. This must work for any city name the user provides. 🌦️
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
    // Check if user is asking for HTML page
    if (isHTMLPageRequest(message)) {
      const htmlCode = generateHTMLPage();
      const assistantReply = `🎨 **Here's a complete HTML page for you!**\n\nI've created a beautiful, responsive webpage with:\n✅ **Header** - Eye-catching title section\n✅ **Navigation** - Menu bar with links\n✅ **Body** - Main content area\n✅ **Footer** - Footer section with credits\n✅ **Styling** - Modern CSS with gradients and responsive design\n✅ **Mobile Friendly** - Works on all devices\n\nYou can copy this code and customize it with your own content, colors, and text!\n\n\`\`\`html\n${htmlCode}\n\`\`\``;

      // Save to Supabase if not guest
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

      return res.json({
        reply: assistantReply,
        session_id: sessionId,
      });
    }

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
  console.log(`[Banner Creator] Received ${req.files ? req.files.length : 0} images with size: ${req.body.size}`);
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "At least one image is required" });
  }

  const { size = 'landscape', prompt = '' } = req.body;

  try {
    const imageFiles = req.files;
    let targetWidth, targetHeight;

    if (size === 'square')        { targetWidth = 1080; targetHeight = 1080; }
    else if (size === 'portrait') { targetWidth = 1080; targetHeight = 1920; }
    else                          { targetWidth = 1920; targetHeight = 1080; } // landscape

    const count = imageFiles.length;

    // ── 0. AI Editor Branch (Single Image Edit) ─────────────────────────────
    if (count === 1 && prompt) {
      console.log("[AI Editor] Single uploaded image detected. Routing to AI Edit mode.");
      try {
        const mimeType = imageFiles[0].mimetype;
        const base64Img = imageFiles[0].buffer.toString('base64');
        const imageUrl = `data:${mimeType};base64,${base64Img}`;
        
        // 1. Analyze original image
        let imgDescription = await describeImage(imageUrl, "Briefly describe the primary subject, character, or object in this image. Do not mention the act of describing it. Just state what the subject is. Keep it under 2 sentences.");
        
        let aiSystemPrompt = "You are an expert stable-diffusion prompt engineer. The user wants to edit an image. You are given the current image description and the user's prompt. Merging them, generate ONE highly detailed, comma-separated image generation prompt to create the final desired image. The new prompt must retain the main subject but apply the user's edits. Return ONLY the prompt text without any quotes or conversational fillers.";
        let aiUserPrompt = `Original Image Subject: ${imgDescription}\nUser Edit Request: ${prompt}`;

        if (!imgDescription) {
           console.log(`[AI Editor] Mistral failed/rate-limited. Falling back to using only user's prompt.`);
           aiSystemPrompt = "You are an expert stable-diffusion prompt engineer. Generate ONE highly detailed, comma-separated image generation prompt based purely on the user's text request. Return ONLY the prompt text without quotes.";
           aiUserPrompt = `User Request: ${prompt}`;
           imgDescription = prompt; // fallback for logs
        } else {
           console.log(`[AI Editor] Mistral Description: ${imgDescription}`);
        }
        
        // 2. Generate new text prompt for the image
        const aiResponse = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: aiSystemPrompt },
            { role: "user", content: aiUserPrompt }
          ],
          max_tokens: 150
        });
        
        const finalPrompt = aiResponse.choices[0]?.message?.content?.trim() || prompt;
        console.log(`[AI Editor] Generated Prompt: ${finalPrompt}`);
        
        // 3. Try Real Image-to-Image with HuggingFace
        if (hf) {
          const modelsToTry = [
            "stabilityai/stable-diffusion-2-1",
            "stabilityai/sdxl-turbo",
            "runwayml/stable-diffusion-v1-5"
          ];

          for (const modelId of modelsToTry) {
            try {
              console.log(`[AI Editor] 🚀 Attempting True Image-to-Image via HuggingFace (${modelId})...`);
              // Ensure we pass the image as a Buffer directly
              const hfResponse = await hf.imageToImage({
                model: modelId,
                inputs: imageFiles[0].buffer,
                parameters: {
                  prompt: finalPrompt,
                  negative_prompt: "blurry, low quality, distorted, deformed, ugly, bad anatomy, text, watermark",
                  strength: 0.6,
                  guidance_scale: 7.5
                }
              });

              if (hfResponse && hfResponse.size > 0) {
                const buffer = Buffer.from(await hfResponse.arrayBuffer());
                const base64 = buffer.toString('base64');
                const hfImageUrl = `data:image/jpeg;base64,${base64}`;
                console.log(`[AI Editor] ✅ Success via HuggingFace (${modelId})!`);
                return res.json({ success: true, bannerUrl: hfImageUrl, isEdit: true });
              }
            } catch (hfErr) {
              console.warn(`[AI Editor] ⚠️ HuggingFace model ${modelId} failed: ${hfErr.message}`);
              
              if (hfErr.message.toLowerCase().includes("invalid username")) {
                console.error("[AI Editor] CRITICAL: Your HF_TOKEN is likely invalid or lacks 'Inference' permissions.");
                break; // No point trying other models if token is bad
              }

              if (hfErr.message.includes("429") || hfErr.message.includes("limit")) {
                console.error("[AI Editor] Rate limit reached for HuggingFace.");
                break;
              }
            }
          }
        }

        // 3. Fallback: Call Pollinations AI (Text-to-Image only)
        console.log("[AI Editor] ⚠️ Falling back to Pollinations (Text-to-Image)...");
        const randomSeed = Math.floor(Math.random() * 1000000);
        const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(finalPrompt)}?width=${targetWidth}&height=${targetHeight}&nologo=true&seed=${randomSeed}`;
        
        console.log(`[AI Editor] ✅ Fallback Success URL: ${pollinationsUrl}`);
        return res.json({ success: true, bannerUrl: pollinationsUrl, isEdit: true });
        
      } catch (aiEditError) {
        console.error("AI Editing Error:", aiEditError.message);
        // Fallback: If AI edit fails, falls through to the normal single-image layout maker below
      }
    }

    // ── 1. Generate AI Caption (Collage Mode) ────────────────────────────────
    let smartCaption = "";
    if (prompt) {
      try {
        const aiResponse = await groq.chat.completions.create({
          model: "llama-3.3-70b-versatile",
          messages: [
            { role: "system", content: "You are a premium creative director. Generate ONE stunning, short, punchy title (max 6 words) for a collage banner based on the user's prompt. Return ONLY the text. No quotes, no punctuation at end." },
            { role: "user", content: `Create a premium banner title for: ${prompt}` }
          ],
          max_tokens: 40
        });
        smartCaption = aiResponse.choices[0]?.message?.content?.trim() || prompt;
      } catch (aiErr) {
        console.error("AI Caption Error:", aiErr.message);
        smartCaption = prompt;
      }
    }

    // ── 2. Smart Layout Selection ───────────────────────────────────────────────
    // Layout: 1 image → full bleed | 2 → hero + sidebar | 3 → hero + 2 stack | 4+ → 2x grid
    const compositeList = [];

    if (count === 1) {
      // Full bleed single image
      const buf = await sharp(imageFiles[0].buffer)
        .resize(targetWidth, targetHeight, { fit: 'cover', position: 'centre' })
        .toBuffer();
      compositeList.push({ input: buf, top: 0, left: 0 });

    } else if (count === 2) {
      // Hero (70%) + sidebar (30%)
      const heroW = Math.floor(targetWidth * 0.68);
      const sideW = targetWidth - heroW;

      const hero = await sharp(imageFiles[0].buffer)
        .resize(heroW, targetHeight, { fit: 'cover', position: 'centre' }).toBuffer();
      const side = await sharp(imageFiles[1].buffer)
        .resize(sideW, targetHeight, { fit: 'cover', position: 'centre' }).toBuffer();

      compositeList.push({ input: hero, top: 0, left: 0 });
      compositeList.push({ input: side, top: 0, left: heroW });

      // Gradient divider between images
      const divSvg = `<svg width="4" height="${targetHeight}">
        <defs><linearGradient id="d" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(255,255,255,0.0)"/>
          <stop offset="50%" stop-color="rgba(255,255,255,0.6)"/>
          <stop offset="100%" stop-color="rgba(255,255,255,0.0)"/>
        </linearGradient></defs>
        <rect width="4" height="${targetHeight}" fill="url(#d)"/>
      </svg>`;
      compositeList.push({ input: Buffer.from(divSvg), top: 0, left: heroW - 2 });

    } else if (count === 3) {
      // Hero (60%) + 2 stacked on right (40%)
      const heroW = Math.floor(targetWidth * 0.60);
      const sideW = targetWidth - heroW;
      const halfH = Math.floor(targetHeight / 2);

      const hero  = await sharp(imageFiles[0].buffer).resize(heroW, targetHeight, { fit: 'cover', position: 'centre' }).toBuffer();
      const top2  = await sharp(imageFiles[1].buffer).resize(sideW, halfH,       { fit: 'cover', position: 'centre' }).toBuffer();
      const bot2  = await sharp(imageFiles[2].buffer).resize(sideW, targetHeight - halfH, { fit: 'cover', position: 'centre' }).toBuffer();

      compositeList.push({ input: hero, top: 0, left: 0 });
      compositeList.push({ input: top2, top: 0, left: heroW });
      compositeList.push({ input: bot2, top: halfH, left: heroW });

      // Vertical divider
      const vDiv = `<svg width="4" height="${targetHeight}"><rect width="4" height="${targetHeight}" fill="rgba(255,255,255,0.4)"/></svg>`;
      compositeList.push({ input: Buffer.from(vDiv), top: 0, left: heroW - 2 });
      // Horizontal divider on sidebar
      const hDiv = `<svg width="${sideW}" height="4"><rect width="${sideW}" height="4" fill="rgba(255,255,255,0.4)"/></svg>`;
      compositeList.push({ input: Buffer.from(hDiv), top: halfH - 2, left: heroW });

    } else {
      // 4+ images: symmetric grid (max 4 used, 2 cols × 2 rows)
      const usedFiles = imageFiles.slice(0, 4);
      const cols = 2;
      const rows = Math.ceil(usedFiles.length / cols);
      const cellW = Math.floor(targetWidth / cols);
      const cellH = Math.floor(targetHeight / rows);

      for (let i = 0; i < usedFiles.length; i++) {
        const col = i % cols;
        const row = Math.floor(i / cols);
        const buf = await sharp(usedFiles[i].buffer)
          .resize(cellW, cellH, { fit: 'cover', position: 'centre' }).toBuffer();
        compositeList.push({ input: buf, top: row * cellH, left: col * cellW });
      }

      // Grid lines
      const hLine = `<svg width="${targetWidth}" height="4"><rect width="${targetWidth}" height="4" fill="rgba(255,255,255,0.35)"/></svg>`;
      const vLine = `<svg width="4" height="${targetHeight}"><rect width="4" height="${targetHeight}" fill="rgba(255,255,255,0.35)"/></svg>`;
      compositeList.push({ input: Buffer.from(hLine), top: Math.floor(targetHeight / 2) - 2, left: 0 });
      compositeList.push({ input: Buffer.from(vLine), top: 0, left: Math.floor(targetWidth / 2) - 2 });
    }

    // ── 3. Cinematic Vignette + Bottom Gradient Overlay ─────────────────────────
    const vignetteSvg = `<svg width="${targetWidth}" height="${targetHeight}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <radialGradient id="vig" cx="50%" cy="50%" r="70%">
          <stop offset="40%" stop-color="rgba(0,0,0,0)" stop-opacity="0"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0.65)" stop-opacity="1"/>
        </radialGradient>
        <linearGradient id="btm" x1="0" y1="0" x2="0" y2="1">
          <stop offset="55%" stop-color="rgba(0,0,0,0)" stop-opacity="0"/>
          <stop offset="100%" stop-color="rgba(0,0,0,0.80)" stop-opacity="1"/>
        </linearGradient>
      </defs>
      <rect width="${targetWidth}" height="${targetHeight}" fill="url(#vig)"/>
      <rect width="${targetWidth}" height="${targetHeight}" fill="url(#btm)"/>
    </svg>`;
    compositeList.push({ input: Buffer.from(vignetteSvg), top: 0, left: 0 });

    // ── 4. Premium Caption Overlay ───────────────────────────────────────────────
    if (smartCaption) {
      const escaped = smartCaption.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      const fontSize    = Math.max(48, Math.floor(targetHeight * 0.075));
      const subFontSize = Math.max(22, Math.floor(fontSize * 0.38));
      const captionY    = Math.floor(targetHeight * 0.84);
      const subY        = captionY + fontSize * 0.85;

      const captionSvg = `<svg width="${targetWidth}" height="${targetHeight}" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="glow" x="-20%" y="-40%" width="140%" height="180%">
            <feGaussianBlur stdDeviation="12" result="blur"/>
            <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
          </filter>
          <filter id="shadow" x="-10%" y="-30%" width="120%" height="160%">
            <feDropShadow dx="0" dy="4" stdDeviation="10" flood-color="rgba(0,0,0,0.9)" flood-opacity="1"/>
          </filter>
        </defs>

        <!-- Glow halo behind title -->
        <text x="50%" y="${captionY}" text-anchor="middle" dominant-baseline="alphabetic"
          font-family="'Trebuchet MS', Arial Black, sans-serif"
          font-weight="900" font-size="${fontSize}" fill="rgba(16,185,129,0.25)"
          filter="url(#glow)" style="letter-spacing:4px">
          ${escaped}
        </text>

        <!-- Main title -->
        <text x="50%" y="${captionY}" text-anchor="middle" dominant-baseline="alphabetic"
          font-family="'Trebuchet MS', Arial Black, sans-serif"
          font-weight="900" font-size="${fontSize}" fill="white"
          filter="url(#shadow)" style="letter-spacing:4px">
          ${escaped}
        </text>

        ${prompt ? `<!-- Subtitle line -->
        <text x="50%" y="${subY}" text-anchor="middle" dominant-baseline="alphabetic"
          font-family="'Trebuchet MS', Arial, sans-serif"
          font-weight="400" font-size="${subFontSize}" fill="rgba(255,255,255,0.65)"
          style="letter-spacing:3px">
          ${escaped.substring(0, 40).toUpperCase()}
        </text>` : ''}

        <!-- Accent line under title -->
        <rect x="${Math.floor(targetWidth / 2) - 60}" y="${captionY + 12}" width="120" height="4"
          rx="2" fill="rgba(16,185,129,0.9)"/>
      </svg>`;

      compositeList.push({ input: Buffer.from(captionSvg), top: 0, left: 0 });
    }

    // ── 5. Render final composite ────────────────────────────────────────────────
    const finalBuffer = await sharp({
      create: { width: targetWidth, height: targetHeight, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 1 } }
    })
    .composite(compositeList)
    .webp({ quality: 90, effort: 4 })
    .toBuffer();

    const bannerUrl = `data:image/webp;base64,${finalBuffer.toString("base64")}`;
    console.log(`[Banner Creator] ✅ Success — ${(finalBuffer.length / 1024).toFixed(0)}KB, ${targetWidth}x${targetHeight}`);
    res.json({ success: true, bannerUrl });

  } catch (err) {
    console.error("Banner creation error:", err.message, err.stack);
    res.status(500).json({ error: "Failed to create banner: " + err.message });
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
    
    if (process.env.HF_TOKEN) {
      console.log(`\x1b[34m🖼️  HuggingFace: ✅ [Token Detected: ${maskToken(process.env.HF_TOKEN)}]\x1b[0m`);
    } else {
      console.log(`\x1b[31m🖼️  HuggingFace: ❌ [Token NOT Set in .env]\x1b[0m`);
    }

    console.log(`\n\x1b[90mSecurity Info: No API keys are exposed to the frontend/browser inspect tools.\x1b[0m\n`);
  });
}
