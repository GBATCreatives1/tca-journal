export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};
    const type = body.type || "";
    const MODEL = "claude-sonnet-4-6";
    console.log("Coach called, type:", type);

    // ── CHAT ─────────────────────────────────────────────────────────────────
    if (type === "chat") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: 600, system: body.chatContext || "", messages: body.chatHistory || [] }),
      });
      if (!r.ok) return res.status(200).json({ content: [{ type: "text", text: "API error " + r.status }] });
      return res.status(200).json(await r.json());
    }

    // ── STRUCTURED TYPES ──────────────────────────────────────────────────────
    const stats = body.stats || {};
    const dayStats = body.dayStats || {};

    let systemPrompt = "";
    let userPrompt = "";
    let maxTokens = 1000;

    if (type === "full") {
      maxTokens = 2000;
      systemPrompt = "You are a trading coach. Output ONLY raw JSON. No prose, no markdown, no explanation before or after.";
      userPrompt = `Analyze this trader's performance. Output ONLY this JSON structure with real values filled in:
{"score":75,"summary":"2-3 sentence summary here","patterns":[{"title":"Pattern name","detail":"Specific detail with numbers","type":"positive"},{"title":"Pattern name","detail":"Specific detail","type":"negative"},{"title":"Pattern name","detail":"Specific detail","type":"neutral"}],"psychology":[{"title":"Psychology observation","detail":"Specific detail","type":"positive"},{"title":"Psychology observation","detail":"Detail","type":"negative"}],"actions":[{"priority":"high","action":"Specific action to take","reasoning":"Why this matters"},{"priority":"medium","action":"Another action","reasoning":"Why"}]}

Trader stats: winRate=${stats.winRate}%, totalTrades=${stats.totalTrades}, totalPnl=$${stats.totalPnl}, avgWin=$${stats.avgWin}, avgLoss=$${stats.avgLoss}
Sessions: ${JSON.stringify(stats.sessions)}
Setups: ${JSON.stringify(stats.setups?.slice(0,5))}
Recent trades: ${JSON.stringify(stats.recentTrades?.slice(0,8))}`;
    }

    else if (type === "trade") {
      maxTokens = 600;
      systemPrompt = "You are a trading coach. Output ONLY raw JSON. No prose, no markdown.";
      userPrompt = `Analyze this trade. Output ONLY this JSON structure:
{"score":75,"verdict":"One sentence verdict","strengths":["Strength 1","Strength 2"],"improvements":["Improvement 1","Improvement 2"],"lesson":"Key lesson learned"}

Trade: ${JSON.stringify(stats)}`;
    }

    else if (type === "patterns") {
      maxTokens = 1500;
      systemPrompt = "You are a trading psychologist. Output ONLY raw JSON. No prose, no markdown.";
      userPrompt = `Find behavioral patterns. Output ONLY this JSON structure:
{"topIssue":"Main problem area","topStrength":"Main strength","patterns":[{"title":"Pattern name","description":"Detailed description with specifics","type":"negative","frequency":"How often","suggestion":"What to do about it"},{"title":"Pattern name","description":"Description","type":"positive","frequency":"How often","suggestion":"Keep doing this"}],"actions":[{"priority":"high","action":"Specific action","reasoning":"Why"}]}

Data: ${JSON.stringify(stats)}`;
    }

    else if (type === "day") {
      maxTokens = 600;
      systemPrompt = "You are a trading coach. Output ONLY raw JSON. No prose, no markdown.";
      userPrompt = `Review this trading day. Output ONLY this JSON:
{"mood":"focused","summary":"Day summary","wins":["Win 1","Win 2"],"improvements":["Improve 1"],"tomorrowFocus":"Focus for tomorrow"}

Day data: ${JSON.stringify(stats)}`;
    }

    else if (type === "economic") {
      maxTokens = 1500;
      systemPrompt = "You are a financial calendar. Output ONLY raw JSON. No prose, no markdown.";
      userPrompt = `Generate US economic calendar for ${dayStats.weekStart} to ${dayStats.weekEnd}. Output ONLY this JSON:
{"events":[{"date":"YYYY-MM-DD","time":"HH:MM","name":"Event name","impact":"high","currency":"USD","actual":"","forecast":"100K","previous":"95K"}]}

Include all major USD events. Today: ${dayStats.today}`;
    }

    else {
      return res.status(400).json({ error: "Unknown type: " + type });
    }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!r.ok) {
      const errText = await r.text();
      console.error("API error:", r.status, errText.slice(0, 200));
      return res.status(200).json({ error: "API error " + r.status });
    }

    const d = await r.json();
    const rawText = d.content?.[0]?.text || "";
    console.log("Raw response (first 300):", rawText.slice(0, 300));

    if (!rawText) return res.status(200).json({ error: "Empty response from model" });

    // Parse JSON - try progressively more aggressive cleanup
    let parsed = null;
    let attempts = [
      // 1. As-is after stripping fences
      rawText.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim(),
      // 2. Extract just the JSON object
      (() => { const s = rawText.replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim(); const i=s.indexOf("{"); const j=s.lastIndexOf("}"); return i>-1&&j>-1?s.slice(i,j+1):""; })(),
    ];

    for (const attempt of attempts) {
      if (!attempt) continue;
      // Try direct
      try { parsed = JSON.parse(attempt); break; } catch(e) {}
      // Try fixing trailing commas
      try { parsed = JSON.parse(attempt.replace(/,\s*([\]}])/g, "$1")); break; } catch(e) {}
      // Try fixing control chars
      try { parsed = JSON.parse(attempt.replace(/,\s*([\]}])/g, "$1").replace(/[\x00-\x1F\x7F]/g, " ")); break; } catch(e) {}
    }

    if (!parsed) {
      console.error("All parse attempts failed. Raw:", rawText.slice(0, 500));
      return res.status(200).json({ error: "Parse failed. Raw response: " + rawText.slice(0, 300) });
    }

    return res.status(200).json(parsed);

  } catch (err) {
    console.error("Coach handler error:", err.message);
    if ((req.body || {}).type === "chat") {
      return res.status(200).json({ content: [{ type: "text", text: "Error: " + err.message }] });
    }
    return res.status(200).json({ error: err.message });
  }
}
