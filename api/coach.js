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

    // ── CHAT (handles Pre-Trade Checker with optional image) ──────────────────
    if (type === "chat") {
      const messages = body.chatHistory || [];
      const hasImage = messages.some(m =>
        Array.isArray(m.content) && m.content.some(c => c.type === "image")
      );
      // Pre-trade checker with chart image needs significantly more tokens
      const maxTokens = hasImage ? 2000 : 800;
      console.log("Chat hasImage:", hasImage, "maxTokens:", maxTokens);

      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system: body.chatContext || "", messages }),
      });
      if (!r.ok) {
        const t = await r.text();
        console.error("Chat error:", r.status, t.slice(0,200));
        return res.status(200).json({ content: [{ type: "text", text: "API error " + r.status }] });
      }
      const d = await r.json();
      console.log("Chat stop_reason:", d.stop_reason, "tokens used:", d.usage);
      return res.status(200).json(d);
    }

    // ── STRUCTURED TYPES ──────────────────────────────────────────────────────
    const stats = body.stats || {};
    const dayStats = body.dayStats || {};

    const repairJSON = (text) => {
      let s = text.replace(/```json\s*/gi,"").replace(/```\s*/g,"").trim();
      const start = s.indexOf("{"); const end = s.lastIndexOf("}");
      if (start===-1||end===-1) return null;
      s = s.slice(start, end+1);
      try { return JSON.parse(s); } catch(e) {}
      const f = s.replace(/,\s*([\]}])/g,"$1");
      try { return JSON.parse(f); } catch(e) {}
      const f2 = f.replace(/[\x00-\x1F\x7F]/g," ");
      try { return JSON.parse(f2); } catch(e) {}
      // Close truncated JSON
      let opens=[],inStr=false,esc=false;
      for(let i=0;i<f2.length;i++){
        const ch=f2[i];
        if(esc){esc=false;continue;}
        if(ch==='\\'&&inStr){esc=true;continue;}
        if(ch==='"'){inStr=!inStr;continue;}
        if(inStr)continue;
        if(ch==='{'||ch==='[')opens.push(ch);
        if(ch==='}'||ch===']')opens.pop();
      }
      const closing=opens.reverse().map(c=>c==='{'?'}':']').join('');
      try{return JSON.parse((f2+closing).replace(/,\s*([\]}])/g,"$1"));}catch(e){}
      return null;
    };

    let systemPrompt="", userPrompt="", maxTokens=1000;

    if (type==="full") {
      maxTokens=2500;
      systemPrompt="You are a trading coach. Output ONLY raw JSON. No prose, no markdown.";
      userPrompt=`Analyze this trader's performance. Output ONLY this JSON:
{"score":75,"summary":"2-3 sentences","patterns":[{"title":"string","detail":"string","type":"positive"}],"psychology":[{"title":"string","detail":"string","type":"positive"}],"actions":[{"priority":"high","action":"string","reasoning":"string"}]}
Stats: winRate=${stats.winRate}%, totalTrades=${stats.totalTrades}, totalPnl=$${stats.totalPnl}, avgWin=$${stats.avgWin}, avgLoss=$${stats.avgLoss}
Sessions: ${JSON.stringify(stats.sessions)}
Setups: ${JSON.stringify(stats.setups?.slice(0,5))}
Recent: ${JSON.stringify(stats.recentTrades?.slice(0,8))}`;
    }
    else if (type==="trade") {
      maxTokens=800;
      systemPrompt="You are a trading coach. Output ONLY raw JSON. No prose, no markdown.";
      userPrompt=`Analyze this trade. Output ONLY this JSON:
{"score":75,"verdict":"string","strengths":["string"],"improvements":["string"],"lesson":"string"}
Trade: ${JSON.stringify(stats)}`;
    }
    else if (type==="patterns") {
      maxTokens=2500;
      systemPrompt="You are a trading psychologist. Output ONLY raw JSON. No prose, no markdown. Keep descriptions under 100 chars.";
      userPrompt=`Find behavioral patterns. Output ONLY this JSON:
{"topIssue":"string","topStrength":"string","patterns":[{"title":"string","description":"string","type":"negative","frequency":"string","suggestion":"string"}],"actions":[{"priority":"high","action":"string","reasoning":"string"}]}
Data: ${JSON.stringify(stats)}`;
    }
    else if (type==="day") {
      maxTokens=800;
      systemPrompt="You are a trading coach. Output ONLY raw JSON. No prose, no markdown.";
      userPrompt=`Review this trading day. Output ONLY this JSON:
{"mood":"string","summary":"string","wins":["string"],"improvements":["string"],"tomorrowFocus":"string"}
Data: ${JSON.stringify(stats)}`;
    }
    else if (type==="economic") {
      maxTokens=1500;
      systemPrompt="You are a financial calendar. Output ONLY raw JSON. No prose, no markdown.";
      userPrompt=`Generate US economic calendar for ${dayStats.weekStart} to ${dayStats.weekEnd}. Output ONLY this JSON:
{"events":[{"date":"YYYY-MM-DD","time":"HH:MM","name":"string","impact":"high","currency":"USD","actual":"","forecast":"","previous":""}]}
Today: ${dayStats.today}`;
    }
    else { return res.status(400).json({ error:"Unknown type: "+type }); }

    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method:"POST",
      headers:{"Content-Type":"application/json","x-api-key":process.env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01"},
      body:JSON.stringify({ model:MODEL, max_tokens:maxTokens, system:systemPrompt, messages:[{role:"user",content:userPrompt}] }),
    });

    if (!r.ok) {
      const t=await r.text();
      console.error("API error:",r.status,t.slice(0,200));
      return res.status(200).json({error:"API error "+r.status});
    }

    const d=await r.json();
    const rawText=d.content?.[0]?.text||"";
    console.log("stop_reason:",d.stop_reason,"raw (300):",rawText.slice(0,300));
    if (!rawText) return res.status(200).json({error:"Empty response"});

    const parsed=repairJSON(rawText);
    if (!parsed) {
      console.error("Parse failed:",rawText.slice(0,500));
      return res.status(200).json({error:"Parse failed. Raw: "+rawText.slice(0,300)});
    }
    return res.status(200).json(parsed);

  } catch(err) {
    console.error("Coach error:",err.message);
    if ((req.body||{}).type==="chat") {
      return res.status(200).json({content:[{type:"text",text:"Error: "+err.message}]});
    }
    return res.status(200).json({error:err.message});
  }
}
