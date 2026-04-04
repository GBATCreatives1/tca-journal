export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const repairJSON = (text) => {
    let s = text.replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim();
    const start = s.indexOf("{");
    const end = s.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    s = s.slice(start, end + 1);
    // Try 1: direct parse
    try { return JSON.parse(s); } catch(e) {}
    // Try 2: fix trailing commas
    const fixed = s.replace(/,\s*([\]}])/g, "$1");
    try { return JSON.parse(fixed); } catch(e) {}
    // Try 3: fix unescaped control chars in strings
    const fixed2 = fixed.replace(/[\x00-\x1F\x7F]/g, " ");
    try { return JSON.parse(fixed2); } catch(e) {}
    console.error("repairJSON failed on:", s.slice(0, 200));
    return null;
  };

  try {
    const body = req.body || {};
    const type = body.type || "";
    const MODEL = "claude-sonnet-4-6";
    console.log("Coach type:", type);

    // ── CHAT ─────────────────────────────────────────────────────────────────
    if (type === "chat") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST",
        headers:{"Content-Type":"application/json","x-api-key":process.env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},
        body: JSON.stringify({ model:MODEL, max_tokens:600, system:body.chatContext||"", messages:body.chatHistory||[] }),
      });
      if (!r.ok) return res.status(200).json({ content:[{type:"text",text:"API error "+r.status}] });
      return res.status(200).json(await r.json());
    }

    // ── STRUCTURED TYPES ─────────────────────────────────────────────────────
    const stats = body.stats || {};
    const dayStats = body.dayStats || {};

    // Use a two-message conversation: system sets role, user asks for JSON
    // This is more reliable than a single prompt
    const systemPrompts = {
      full:     "You are an expert MES futures trading coach API. You ONLY respond with raw JSON objects, never with explanations or markdown. Your responses are always valid, parseable JSON.",
      day:      "You are a trading coach API. You ONLY respond with raw JSON objects, never with explanations or markdown.",
      trade:    "You are a trading coach API. You ONLY respond with raw JSON objects, never with explanations or markdown.",
      patterns: "You are a trading psychology API. You ONLY respond with raw JSON objects, never with explanations or markdown.",
      economic: "You are a financial calendar API. You ONLY respond with raw JSON objects, never with explanations or markdown.",
    };

    const userPrompts = {
      full: `Analyze this trader's MES futures performance data and return a JSON object with exactly these keys:
- "score": integer 0-100 overall performance score
- "summary": string, 2-3 sentence overall summary
- "patterns": array of objects with keys "title" (string), "detail" (string), "type" ("positive"|"negative"|"neutral")
- "psychology": array of objects with keys "title" (string), "detail" (string), "type" ("positive"|"negative"|"neutral")  
- "actions": array of objects with keys "priority" ("high"|"medium"|"low"), "action" (string), "reasoning" (string)

Trader data: ${JSON.stringify(stats)}`,

      day: `Review this trading day and return a JSON object with exactly these keys:
- "mood": string (e.g. "focused", "frustrated", "disciplined")
- "summary": string, brief day summary
- "wins": array of strings, what went well
- "improvements": array of strings, what to improve
- "tomorrowFocus": string, one thing to focus on tomorrow

Day data: ${JSON.stringify(stats)}`,

      trade: `Analyze this single trade and return a JSON object with exactly these keys:
- "score": integer 0-100
- "verdict": string, one sentence verdict
- "strengths": array of strings (2-3 items)
- "improvements": array of strings (2-3 items)
- "lesson": string, the key lesson

Trade data: ${JSON.stringify(stats)}`,

      patterns: `Analyze behavioral trading patterns and return a JSON object with exactly these keys:
- "patterns": array of objects with keys "title", "description", "frequency", "impact" ("positive"|"negative"), "suggestion"
- "topIssue": string
- "topStrength": string

Data: ${JSON.stringify(stats)}`,

      economic: `Generate the US economic calendar for ${dayStats.weekStart} to ${dayStats.weekEnd} and return a JSON object with exactly this key:
- "events": array of objects each with keys "date" (YYYY-MM-DD), "time" (HH:MM), "name" (string), "impact" ("high"|"medium"|"low"), "currency" ("USD"), "actual" (string or ""), "forecast" (string or ""), "previous" (string or "")

Include all major USD events. Today is ${dayStats.today}.`,
    };

    const system = systemPrompts[type];
    const userMsg = userPrompts[type];
    if (!system || !userMsg) return res.status(400).json({ error: "Invalid type: " + type });

    const messages = type === "trade" && body.chartImage
      ? [{ role:"user", content:[
          { type:"image", source:{ type:"base64", media_type:"image/jpeg", data:body.chartImage }},
          { type:"text", text:userMsg }
        ]}]
      : [{ role:"user", content:userMsg }];

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":process.env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},
      body: JSON.stringify({
        model: MODEL,
        max_tokens: type==="full"?2000 : type==="patterns"?1500 : type==="economic"?1500 : 800,
        system,
        messages,
      }),
    });

    if (!r.ok) {
      const t = await r.text();
      console.error("Anthropic error:", r.status, t.slice(0,200));
      return res.status(200).json({ error:"API error "+r.status });
    }

    const d = await r.json();
    const text = d.content?.[0]?.text || "";
    console.log("Response (first 200):", text.slice(0,200));

    if (!text) return res.status(200).json({ error:"Empty response from model" });

    const parsed = repairJSON(text);
    if (!parsed) {
      console.error("Could not parse response:", text.slice(0,400));
      // Return error so frontend shows a retry message instead of blank data
      return res.status(200).json({ error:"Could not parse AI response. Please try again." });
    }

    return res.status(200).json(parsed);

  } catch (err) {
    console.error("Coach error:", err.message);
    if ((req.body||{}).type === "chat") {
      return res.status(200).json({ content:[{type:"text",text:"Error: "+err.message}] });
    }
    return res.status(200).json({ error:err.message });
  }
}
