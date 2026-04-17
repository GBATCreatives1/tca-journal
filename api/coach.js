export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const repairJSON = (text) => {
    let s = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const start = s.indexOf("{");
    if (start === -1) return null;
    s = s.slice(start);

    // Try direct parse first
    try { return JSON.parse(s); } catch(e) {}

    // Fix trailing commas
    const s2 = s.replace(/,\s*([\]}])/g, "$1");
    try { return JSON.parse(s2); } catch(e) {}

    // Try to close truncated JSON by counting open brackets
    let fixed = s2;
    let opens = [];
    let inStr = false;
    let escape = false;
    for (let i = 0; i < fixed.length; i++) {
      const ch = fixed[i];
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inStr) { escape = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{' || ch === '[') opens.push(ch);
      if (ch === '}' || ch === ']') opens.pop();
    }
    // Close any open brackets in reverse
    let closing = '';
    for (let i = opens.length - 1; i >= 0; i--) {
      closing += opens[i] === '{' ? '}' : ']';
    }
    // Remove trailing comma before closing
    const truncated = (fixed + closing).replace(/,\s*([\]}])/g, "$1");
    try { return JSON.parse(truncated); } catch(e) {}

    console.error("repairJSON failed on:", s.slice(0, 200));
    return null;
  };

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
        body: JSON.stringify({ model: MODEL, max_tokens: 800, system: body.chatContext || "", messages: body.chatHistory || [] }),
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
      maxTokens = 2500;
      systemPrompt = "You are a trading coach. Output ONLY raw JSON. No prose, no markdown, no explanation before or after.";
      userPrompt = `Analyze this trader's performance. Output ONLY this JSON structure with real values filled in:
{"score":75,"summary":"2-3 sentence summary here","patterns":[{"title":"Pattern name","detail":"Specific detail with numbers","type":"positive"},{"title":"Pattern name","detail":"Specific detail","type":"negative"},{"title":"Pattern name","detail":"Specific detail","type":"neutral"}],"psychology":[{"title":"Psychology observation","detail":"Specific detail","type":"positive"},{"title":"Psychology observation","detail":"Detail","type":"negative"}],"actions":[{"priority":"high","action":"Specific action to take","reasoning":"Why this matters"},{"priority":"medium","action":"Another action","reasoning":"Why"}]}

Trader stats: winRate=${stats.winRate}%, totalTrades=${stats.totalTrades}, totalPnl=$${stats.totalPnl}, avgWin=$${stats.avgWin}, avgLoss=$${stats.avgLoss}
Sessions: ${JSON.stringify(stats.sessions)}
Setups: ${JSON.stringify(stats.setups?.slice(0,5))}
Recent trades: ${JSON.stringify(stats.recentTrades?.slice(0,8))}`;
    }

    else if (type === "trade") {
      maxTokens = 800;
      systemPrompt = "You are a trading coach. Output ONLY raw JSON. No prose, no markdown.";
      userPrompt = `Analyze this trade. Output ONLY this JSON structure:
{"score":75,"verdict":"One sentence verdict","strengths":["Strength 1","Strength 2"],"improvements":["Improvement 1","Improvement 2"],"lesson":"Key lesson learned"}

Trade: ${JSON.stringify(stats)}`;
    }

    else if (type === "patterns") {
      maxTokens = 2500;
      systemPrompt = "You are a trading psychologist. Output ONLY raw JSON. No prose, no markdown. Be concise - keep each description under 100 characters.";
      userPrompt = `Find behavioral patterns. Output ONLY this JSON structure (keep descriptions SHORT):
{"topIssue":"Main problem area","topStrength":"Main strength","patterns":[{"title":"Pattern name","description":"Brief description","type":"negative","frequency":"How often","suggestion":"Brief fix"},{"title":"Pattern name","description":"Brief description","type":"positive","frequency":"How often","suggestion":"Keep doing this"}],"actions":[{"priority":"high","action":"Specific action","reasoning":"Why"}]}

Data: ${JSON.stringify(stats)}`;
    }

    else if (type === "day") {
      maxTokens = 800;
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
    console.log("Stop reason:", d.stop_reason);

    if (!rawText) return res.status(200).json({ error: "Empty response from model" });

    const parsed = repairJSON(rawText);
    if (!parsed) {
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
