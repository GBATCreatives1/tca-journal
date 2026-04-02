export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { type, stats, dayStats } = req.body;

  const prompts = {
    full: `You are an expert MES futures trading coach and trading psychologist. Analyze this trader's performance data and provide a JSON response only (no markdown, no backticks).

Trading Stats:
${JSON.stringify(stats, null, 2)}

Respond with ONLY valid JSON:
{
  "patterns": [{"title": "string", "detail": "string with specific numbers", "type": "positive|negative|neutral"}],
  "psychology": [{"title": "string", "detail": "string", "type": "positive|negative|neutral"}],
  "actions": [{"priority": "high|medium|low", "action": "string", "reasoning": "string"}],
  "overallScore": 65,
  "scoreLabel": "Developing",
  "summary": "2-3 sentence coaching summary"
}`,

    day: `You are an expert MES futures trading coach. Review this trader's single trading day and give specific, honest feedback. Respond with ONLY valid JSON, no markdown.

Day data: ${JSON.stringify(dayStats)}

JSON structure:
{
  "verdict": "Good Day|Mixed Day|Tough Day|Excellent Day",
  "verdictColor": "positive|negative|neutral",
  "keyStrength": "One specific thing they did well today with numbers",
  "keyWeakness": "One specific thing to improve with numbers",
  "patternAlert": "Any concerning pattern noticed or null",
  "coachNote": "2-3 sentence personal coaching message speaking directly to the trader",
  "tomorrowFocus": "One specific focus point for tomorrow's session"
}`,

    patterns: `You are an expert MES futures trading coach analyzing a trader's overall performance data. Find specific, actionable patterns in their trading behavior. Respond with ONLY valid JSON, no markdown.

Performance data: ${JSON.stringify(dayStats)}

JSON structure:
{
  "overallScore": 0-100,
  "scoreLabel": "e.g. Developing Consistency",
  "summary": "2-3 sentence overall coaching assessment with specific numbers",
  "patterns": [
    {"title": "Pattern name", "detail": "Specific finding with numbers from the data", "type": "positive|negative|neutral|warning"}
  ],
  "actions": [
    {"priority": "high|medium|low", "action": "Specific action to take", "reasoning": "Why this matters for their trading"}
  ]
}

Find 4-6 patterns covering: time-of-day edge, day-of-week patterns, win/loss streaks, after-loss behavior, setup performance, overtrading signals. Be specific with numbers.`,

        trade: `You are an expert MES futures trading coach. Analyze this single trade and give honest, specific feedback. Respond with ONLY valid JSON, no markdown.

Trade data: ${JSON.stringify(dayStats)}

JSON structure:
{
  "score": 0-100,
  "verdict": "2-3 sentence honest assessment of this trade",
  "strengths": ["specific strength 1", "specific strength 2"],
  "improvements": ["specific improvement 1", "specific improvement 2"],
  "lesson": "The single most important lesson from this trade"
}`
  };

  const prompt = prompts[type];
  if (!prompt) return res.status(400).json({ error: "Invalid type" });

  // Build messages array - support chart image for trade analysis
  let messages;
  if (type === "trade" && req.body.chartImage) {
    messages = [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: req.body.chartImage }},
        { type: "text", text: prompt + "\n\nA chart screenshot is attached. Use it to provide deeper analysis of the entry/exit timing, price action context, and whether the setup was valid." }
      ]
    }];
  } else {
    messages = [{ role: "user", content: prompt }];
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: type === "full" ? 1000 : 600,
        messages,
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || "";
    const cleaned = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);
    return res.status(200).json(parsed);
  } catch (err) {
    console.error("Coach error:", err);
    return res.status(500).json({ error: err.message });
  }
}
