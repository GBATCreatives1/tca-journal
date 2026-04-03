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
          model: "claude-haiku-4-5-20251001",
          max_tokens: 500,
          system: chatContext,
          messages: chatHistory,
        }),
      });
      if (!r.ok) {
        const t = await r.text();
        console.error("Anthropic chat error:", r.status, t.slice(0, 200));
        return res.status(200).json({ content: [{ type: "text", text: "API error " + r.status + ". Try again." }] });
      }
      const d = await r.json();
      return res.status(200).json(d);
    }

    // ── All other types ───────────────────────────────────────────────────────
    const stats = body.stats || {};
    const dayStats = body.dayStats || {};

    const systemPrompt = type === "full"
      ? `You are an expert MES futures trading coach. Analyze this trader's data and respond with ONLY valid JSON (no markdown, no backticks):
{"patterns":[{"title":"string","detail":"string","type":"positive|negative|neutral"}],"psychology":[{"title":"string","detail":"string","type":"positive|negative|neutral"}],"actions":[{"priority":"high|medium|low","action":"string","reasoning":"string"}],"summary":"string","score":0}
Data: ${JSON.stringify(stats)}`

      : type === "day"
      ? `You are a trading coach. Review this day's trades and respond with ONLY valid JSON:
{"mood":"string","summary":"string","wins":["string"],"improvements":["string"],"tomorrowFocus":"string"}
Data: ${JSON.stringify(stats)}`

      : type === "trade"
      ? `You are a trading coach. Analyze this single trade and respond with ONLY valid JSON:
{"score":0,"verdict":"string","strengths":["string"],"improvements":["string"],"lesson":"string"}
Trade: ${JSON.stringify(stats)}`

      : type === "patterns"
      ? `You are a trading psychologist. Find behavioral patterns and respond with ONLY valid JSON:
{"patterns":[{"title":"string","description":"string","frequency":"string","impact":"positive|negative","suggestion":"string"}],"topIssue":"string","topStrength":"string"}
Data: ${JSON.stringify(stats)}`

      : type === "economic"
      ? `You are a financial data assistant. Generate the US economic calendar for the week ${dayStats.weekStart} to ${dayStats.weekEnd}. Respond with ONLY valid JSON:
{"events":[{"date":"YYYY-MM-DD","time":"HH:MM","name":"string","impact":"high|medium|low","currency":"USD","actual":"","forecast":"","previous":""}]}
Include all major USD events. Today is ${dayStats.today}.`

      : null;

    if (!systemPrompt) {
      return res.status(400).json({ error: "Invalid type: " + type });
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: type === "full" ? 1000 : type === "patterns" ? 1200 : type === "economic" ? 1500 : 600,
        messages: type === "trade" && body.chartImage
          ? [{ role: "user", content: [
              { type: "image", source: { type: "base64", media_type: "image/jpeg", data: body.chartImage }},
              { type: "text", text: systemPrompt }
            ]}]
          : [{ role: "user", content: systemPrompt }],
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("Anthropic error:", r.status, t.slice(0, 200));
      return res.status(200).json({ error: "API error " + r.status });
    }

    const d = await r.json();
    const text = d.content?.[0]?.text || "";
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return res.status(200).json(parsed);

  } catch (err) {
    console.error("Coach error:", err.message);
    return res.status(200).json({
      content: [{ type: "text", text: "Something went wrong: " + err.message }],
      error: err.message
    });
  }
}
