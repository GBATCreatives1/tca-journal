export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

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
        console.error("Anthropic chat error:", r.status, t.slice(0, 300));
        return res.status(200).json({ content: [{ type: "text", text: "API error " + r.status + ". Try again." }] });
      }
      const d = await r.json();
      if (d.error) {
        console.error("Anthropic chat error:", d.error);
        return res.status(200).json({ content: [{ type: "text", text: "API error: " + (d.error.message || "unknown") }] });
      }
      return res.status(200).json(d);
    }

    // ── Structured JSON types ─────────────────────────────────────────────────
    const stats = body.stats || {};
    const dayStats = body.dayStats || {};

    const prompts = {
      full: "You are an expert MES futures trading coach. Analyze this trader's performance data. Return ONLY valid JSON, no markdown:\n"
        + '{"patterns":[{"title":"string","detail":"string","type":"positive|negative|neutral"}],'
        + '"psychology":[{"title":"string","detail":"string","type":"positive|negative|neutral"}],'
        + '"actions":[{"priority":"high|medium|low","action":"string","reasoning":"string"}],'
        + '"summary":"string","score":0}\n'
        + "Data: " + JSON.stringify(stats),

      day: "You are a trading coach. Review this day and return ONLY valid JSON, no markdown:\n"
        + '{"mood":"string","summary":"string","wins":["string"],"improvements":["string"],"tomorrowFocus":"string"}\n'
        + "Data: " + JSON.stringify(stats),

      trade: "You are a trading coach. Analyze this trade and return ONLY valid JSON, no markdown:\n"
        + '{"score":0,"verdict":"string","strengths":["string"],"improvements":["string"],"lesson":"string"}\n'
        + "Trade: " + JSON.stringify(stats),

      patterns: "You are a trading psychologist. Find behavioral patterns and return ONLY valid JSON, no markdown:\n"
        + '{"patterns":[{"title":"string","description":"string","frequency":"string","impact":"positive|negative","suggestion":"string"}],'
        + '"topIssue":"string","topStrength":"string"}\n'
        + "Data: " + JSON.stringify(stats),

      economic: "You are a financial data assistant. Generate the US economic calendar for "
        + dayStats.weekStart + " to " + dayStats.weekEnd
        + ". Return ONLY valid JSON, no markdown:\n"
        + '{"events":[{"date":"YYYY-MM-DD","time":"HH:MM","name":"string","impact":"high|medium|low","currency":"USD","actual":"","forecast":"","previous":""}]}\n'
        + "Include all major USD events. Today is " + dayStats.today + ".",
    };

    const prompt = prompts[type];
    if (!prompt) {
      return res.status(400).json({ error: "Invalid type: " + type });
    }

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
        max_tokens: type === "full" ? 1000 : type === "patterns" ? 1200 : type === "economic" ? 1500 : 700,
        messages,
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("Anthropic error:", r.status, t.slice(0, 300));
      return res.status(200).json({ error: "API error " + r.status, detail: t.slice(0, 200) });
    }

    const d = await r.json();
    if (d.error) {
      console.error("Anthropic error object:", d.error);
      return res.status(200).json({ error: d.error.message || "Unknown API error" });
    }

    const text = d.content?.[0]?.text || "";
    if (!text) return res.status(200).json({ error: "Empty response from model" });

    // Strip markdown fences and find JSON
    const stripped = text.split("```json").join("").split("```").join("").trim();
    const start = stripped.indexOf("{");
    const end = stripped.lastIndexOf("}");
    if (start === -1 || end === -1) {
      return res.status(200).json({ error: "No JSON in response", raw: text.slice(0, 200) });
    }
    const parsed = JSON.parse(stripped.slice(start, end + 1));
    return res.status(200).json(parsed);

  } catch (err) {
    console.error("Coach error:", err.message);
    return res.status(200).json({
      content: [{ type: "text", text: "Something went wrong: " + err.message }],
      error: err.message
    });
  }
}
