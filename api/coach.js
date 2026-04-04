export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const cleanJSON = (text) => {
    // Strip markdown fences
    let s = text.split("```json").join("").split("```").join("").trim();
    // Find outermost JSON object
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start === -1 || end === -1) throw new Error("No JSON object found in response");
    s = s.slice(start, end + 1);
    // Fix trailing commas before } or ]
    s = s.replace(/,(\s*[}\]])/g, "$1");
    // Fix unescaped newlines inside strings
    s = s.replace(/("(?:[^"\\]|\\.)*")|(\n)/g, (m, str, nl) => str ? str : " ");
    return JSON.parse(s);
  };

  try {
    const body = req.body || {};
    const type = body.type || "";
    console.log("Coach type:", type);

    const MODEL = "claude-sonnet-4-6";

    // ── CHAT handler ─────────────────────────────────────────────────────────
    if (type === "chat") {
      const chatContext = body.chatContext || "";
      const chatHistory = body.chatHistory || [];
      if (!chatHistory.length) {
        return res.status(200).json({ content: [{ type: "text", text: "No messages received." }] });
      }
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
          system: chatContext,
          messages: chatHistory,
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        console.error("Chat error:", r.status, t.slice(0, 200));
        return res.status(200).json({ content: [{ type: "text", text: "API error " + r.status + ". Try again." }] });
      }
      const d = await r.json();
      return res.status(200).json(d);
    }

    // ── Structured JSON types ─────────────────────────────────────────────────
    const stats = body.stats || {};
    const dayStats = body.dayStats || {};

    const prompts = {
      full: "You are an expert MES futures trading coach. Analyze this trader's performance data.\n"
        + "IMPORTANT: Respond with ONLY a valid JSON object. No explanation, no markdown, no trailing commas.\n"
        + "Required format: "
        + '{"patterns":[{"title":"string","detail":"string","type":"positive"}],'
        + '"psychology":[{"title":"string","detail":"string","type":"positive"}],'
        + '"actions":[{"priority":"high","action":"string","reasoning":"string"}],'
        + '"summary":"string","score":75}'
        + "\nTrader data: " + JSON.stringify(stats),

      day: "You are a trading coach. Review this trading day.\n"
        + "Respond with ONLY valid JSON, no markdown, no trailing commas:\n"
        + '{"mood":"focused","summary":"string","wins":["string"],"improvements":["string"],"tomorrowFocus":"string"}'
        + "\nData: " + JSON.stringify(stats),

      trade: "You are a trading coach. Analyze this single trade.\n"
        + "Respond with ONLY valid JSON, no markdown, no trailing commas:\n"
        + '{"score":75,"verdict":"string","strengths":["string"],"improvements":["string"],"lesson":"string"}'
        + "\nTrade: " + JSON.stringify(stats),

      patterns: "You are a trading psychologist. Identify behavioral patterns.\n"
        + "Respond with ONLY valid JSON, no markdown, no trailing commas:\n"
        + '{"patterns":[{"title":"string","description":"string","frequency":"string","impact":"positive","suggestion":"string"}],"topIssue":"string","topStrength":"string"}'
        + "\nData: " + JSON.stringify(stats),

      economic: "You are a financial data assistant. Generate the US economic calendar.\n"
        + "Respond with ONLY valid JSON, no markdown, no trailing commas:\n"
        + '{"events":[{"date":"YYYY-MM-DD","time":"HH:MM","name":"string","impact":"high","currency":"USD","actual":"","forecast":"","previous":""}]}'
        + "\nWeek: " + dayStats.weekStart + " to " + dayStats.weekEnd + ". Today: " + dayStats.today,
    };

    const prompt = prompts[type];
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
    if (!text) return res.status(200).json({ error: "Empty response" });

    console.log("Raw response length:", text.length, "chars");
    const parsed = cleanJSON(text);
    return res.status(200).json(parsed);

  } catch (err) {
    console.error("Coach error:", err.message);
    // For chat type errors, return in chat format
    if ((req.body || {}).type === "chat") {
      return res.status(200).json({ content: [{ type: "text", text: "Error: " + err.message }] });
    }
    return res.status(200).json({ error: err.message });
  }
}
