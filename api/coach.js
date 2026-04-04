export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  // Robust JSON extractor - handles trailing commas, truncated responses, etc.
  const parseAI = (text) => {
    // Strip markdown
    let s = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

    // Find outermost { }
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON found");
    s = s.slice(start, end + 1);

    // Try direct parse first
    try { return JSON.parse(s); } catch(e) {}

    // Fix trailing commas  before } or ]
    s = s.replace(/,\s*([\]}])/g, "$1");
    try { return JSON.parse(s); } catch(e) {}

    // Fix unescaped quotes inside strings (basic)
    // Replace literal newlines inside strings with \n
    s = s.replace(/("(?:[^"\\]|\\.)*)(\n)((?:[^"\\]|\\.)*")/g, '$1\\n$3');
    try { return JSON.parse(s); } catch(e) {}

    // If still failing, try to truncate to last complete top-level value
    // by finding the last , at depth 1 and closing the object
    let depth = 0;
    let lastGoodPos = start;
    let inStr = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (ch === '"' && s[i-1] !== '\\') inStr = !inStr;
      if (inStr) continue;
      if (ch === '{' || ch === '[') depth++;
      if (ch === '}' || ch === ']') {
        depth--;
        if (depth === 0) lastGoodPos = i;
      }
    }
    const truncated = s.slice(0, lastGoodPos + 1);
    try { return JSON.parse(truncated); } catch(e) {}

    throw new Error("Could not parse AI response as JSON");
  };

  try {
    const body = req.body || {};
    const type = body.type || "";
    console.log("Coach type:", type);

    const MODEL = "claude-sonnet-4-6";

    // ── CHAT handler ─────────────────────────────────────────────────────────
    if (type === "chat") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 600,
          system: body.chatContext || "",
          messages: body.chatHistory || [],
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        console.error("Chat error:", r.status, t.slice(0, 200));
        return res.status(200).json({ content: [{ type: "text", text: "API error " + r.status }] });
      }
      return res.status(200).json(await r.json());
    }

    // ── Structured types ──────────────────────────────────────────────────────
    const stats = body.stats || {};
    const dayStats = body.dayStats || {};

    // Use explicit examples to reduce model creativity with JSON structure
    const schemas = {
      full: '{"patterns":[{"title":"Example","detail":"Details here","type":"positive"}],"psychology":[{"title":"Example","detail":"Details here","type":"neutral"}],"actions":[{"priority":"high","action":"Do this","reasoning":"Because"}],"summary":"Overall summary","score":72}',
      day:  '{"mood":"focused","summary":"Day summary","wins":["Win 1"],"improvements":["Improve 1"],"tomorrowFocus":"Focus"}',
      trade:'{"score":75,"verdict":"Good trade","strengths":["Strength 1"],"improvements":["Improve 1"],"lesson":"Key lesson"}',
      patterns:'{"patterns":[{"title":"Pattern","description":"Desc","frequency":"Often","impact":"negative","suggestion":"Fix this"}],"topIssue":"Main issue","topStrength":"Main strength"}',
      economic:'{"events":[{"date":"2026-04-07","time":"08:30","name":"Event Name","impact":"high","currency":"USD","actual":"","forecast":"100K","previous":"95K"}]}',
    };

    const contexts = {
      full: "You are an expert MES futures trading coach. Analyze the trader data and return JSON exactly matching this structure (no extra fields, no trailing commas, no markdown):\n" + schemas.full + "\n\nTrader data:\n" + JSON.stringify(stats),
      day:  "Trading coach. Analyze this day. Return JSON matching this structure exactly (no markdown, no trailing commas):\n" + schemas.day + "\n\nDay data:\n" + JSON.stringify(stats),
      trade:"Trading coach. Analyze this trade. Return JSON matching this structure exactly (no markdown, no trailing commas):\n" + schemas.trade + "\n\nTrade:\n" + JSON.stringify(stats),
      patterns:"Trading psychologist. Find patterns. Return JSON matching this structure exactly (no markdown, no trailing commas):\n" + schemas.patterns + "\n\nData:\n" + JSON.stringify(stats),
      economic:"Financial calendar assistant. Return JSON matching this structure exactly (no markdown, no trailing commas):\n" + schemas.economic + "\n\nGenerate all major USD events for week " + dayStats.weekStart + " to " + dayStats.weekEnd + ". Today: " + dayStats.today,
    };

    const prompt = contexts[type];
    if (!prompt) return res.status(400).json({ error: "Invalid type: " + type });

    const messages = type === "trade" && body.chartImage
      ? [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: body.chartImage }},
          { type: "text", text: prompt }
        ]}]
      : [{ role: "user", content: prompt }];

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: type === "full" ? 1200 : type === "patterns" ? 1200 : type === "economic" ? 1500 : 700,
        messages,
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("Anthropic error:", r.status, t.slice(0, 200));
      return res.status(200).json({ error: "API error " + r.status });
    }

    const d = await r.json();
    const text = d.content?.[0]?.text || "";
    console.log("Response preview:", text.slice(0, 100));

    const parsed = parseAI(text);
    return res.status(200).json(parsed);

  } catch (err) {
    console.error("Coach error:", err.message);
    if ((req.body || {}).type === "chat") {
      return res.status(200).json({ content: [{ type: "text", text: "Error: " + err.message }] });
    }
    return res.status(200).json({ error: err.message });
  }
}
