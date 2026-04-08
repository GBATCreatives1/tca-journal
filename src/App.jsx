import { useState, useEffect, useRef, useCallback } 

  // Persist accounts config (including starting balances) to localStorage
  useEffect(()=>{
    try{localStorage.setItem("pref_tca_accounts_v1",JSON.stringify(accounts));}catch(e){}
  },[accounts]);from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ComposedChart, Line, Cell } from "recharts";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
// ── User Preferences (cross-device via Supabase) ─────────────────────────────
async function getPref(userId, key){
  // Check localStorage first for instant load
  const local = localStorage.getItem(`pref_${key}`);
  // Then fetch from Supabase for latest
  try{
    const {data} = await supabase
      .from("user_preferences")
      .select("value")
      .eq("user_id", userId)
      .eq("key", key)
      .single();
    if(data?.value){
      localStorage.setItem(`pref_${key}`, data.value);
      return data.value;
    }
  }catch(e){}
  return local;
}

async function setPref(userId, key, value){
  localStorage.setItem(`pref_${key}`, value);
  if(!userId)return;
  try{
    await supabase
      .from("user_preferences")
      .upsert({user_id:userId, key, value, updated_at:new Date().toISOString()},
              {onConflict:"user_id,key"});
  }catch(e){
    console.warn("Pref sync failed:", e.message);
  }
}

async function syncPref(userId, key, onData){
  // Load localStorage first (fast)
  try{const l=localStorage.getItem(`pref_${key}`);if(l)onData(l);}catch(e){}
  // Then Supabase (cross-device)
  if(!userId)return;
  try{
    const{data}=await supabase.from("user_preferences").select("value").eq("user_id",userId).eq("key",key).single();
    if(data?.value){localStorage.setItem(`pref_${key}`,data.value);onData(data.value);}
  }catch(e){}
}



// ── Tradovate Sync ────────────────────────────────────────────────────────────
// ── Tradovate via Vercel Proxy (avoids CORS) ─────────────────────────────────
const PROXY = "/api/tradovate";

async function tvAuth(account="main") {
  try {
    const res = await fetch(`${PROXY}?action=auth&account=${account}`);
    const data = await res.json();
    if (data.accessToken) {
      sessionStorage.setItem(`tv_token_${account}`, data.accessToken);
      sessionStorage.setItem(`tv_expiry_${account}`, Date.now() + 75 * 60 * 1000);
      return data.accessToken;
    }
    console.error("Tradovate auth failed:", data);
    return null;
  } catch (e) {
    console.error("Tradovate auth error:", e);
    return null;
  }
}

async function getToken(account="main") {
  const expiry = sessionStorage.getItem(`tv_expiry_${account}`);
  const token  = sessionStorage.getItem(`tv_token_${account}`);
  if (token && expiry && Date.now() < parseInt(expiry)) return token;
  return await tvAuth(account);
}

async function fetchClosedTrades(token, fromDate=null, toDate=null, account="main") {
  try {
    let url = `${PROXY}?action=fills&token=${token}&account=${account}`;
    if (fromDate) url += `&from=${fromDate}`;
    if (toDate) url += `&to=${toDate}`;
    const res = await fetch(url);
    const data = await res.json();
    // New proxy returns pre-built trade objects directly
    if (Array.isArray(data)) return data;
    // Handle old format with execs/filledOrders
    if (data.fills && Array.isArray(data.fills)) return data.fills;
    return [];
  } catch (e) {
    console.error("fetchClosedTrades error:", e);
    return [];
  }
}

function execToTrade(exec) {
  // New proxy returns pre-built trade objects - just pass through
  // with any missing fields filled in
  if (exec.date && exec.instrument) {
    // Re-grade synced trades using autoGrade
    if (!exec.grade || exec.grade === "B") exec.grade = autoGrade(exec);
    return exec;
  }
  // Fallback for old format
  const rawDate = exec.timestamp || new Date().toISOString();
  const dateStr = new Date(rawDate).toISOString().slice(0, 10);
  const rawSymbol = exec.name || "MES";
  const symbol = rawSymbol.replace(/[FGHJKMNQUVXZ]\d+$/, "").replace(/\d+/g, "").toUpperCase() || "MES";
  const direction = exec.action === "Sell" ? "Short" : "Long";
  const pnl = Math.round((exec.pnl || 0) * 100) / 100;
  const hr = new Date(rawDate).getHours();
  return {
    date: dateStr, instrument: symbol, direction,
    contracts: exec.qty || 1, entry: exec.entry || 0, exit: exec.exit || 0,
    pnl, rr: "--", setup: "Auto-synced", grade: "B",
    notes: exec.notes || "Tradovate sync",
    session: hr < 10 ? "AM" : hr < 13 ? "Mid" : "PM",
    result: pnl >= 0 ? "Win" : "Loss",
    tradovate_id: exec.tradovate_id || String(exec.id),
  };
}

// ── Brand ─────────────────────────────────────────────────────────────────────
// ── Theme System ──────────────────────────────────────────────────────────────
const DARK_THEME={
  teal:"#00D4A8",blue:"#4F8EF7",purple:"#8B5CF6",spark:"#7B61FF",
  profit:"#059669",loss:"#E53E3E",
  bg:"#0E0E10",surface:"rgba(255,255,255,0.025)",
  border:"rgba(255,255,255,0.07)",borderTeal:"rgba(0,212,168,0.25)",
  borderPurp:"rgba(139,92,246,0.25)",
  text:"#F0EEF8",textMuted:"#6B6880",textDim:"#2E2C3A",
  cardBg:"rgba(255,255,255,0.025)",
  inputBg:"rgba(255,255,255,0.06)",
  sidebarBg:"rgba(8,8,10,0.98)",
  isDark:true,
};
const LIGHT_THEME={
  teal:"#00A87D",blue:"#2B6CB0",purple:"#6B46C1",spark:"#553C9A",
  profit:"#276749",loss:"#C53030",
  bg:"#F7F8FC",surface:"#FFFFFF",
  border:"rgba(0,0,0,0.09)",borderTeal:"rgba(0,168,125,0.25)",
  borderPurp:"rgba(107,70,193,0.25)",
  text:"#1A1A2E",textMuted:"#6B7280",textDim:"#D1D5DB",
  cardBg:"#FFFFFF",
  inputBg:"rgba(0,0,0,0.04)",
  sidebarBg:"#1E2030",
  isDark:false,
};
let B=DARK_THEME;
const GL="linear-gradient(135deg,#00D4A8 0%,#4F8EF7 50%,#8B5CF6 100%)";
const GTB="linear-gradient(90deg,#00D4A8,#4F8EF7)";
const GBP="linear-gradient(90deg,#4F8EF7,#8B5CF6)";
const INST_COLOR={MES:B.purple,SPY:B.blue,SPX:B.teal,ES:B.purple,NQ:B.blue,MNQ:"#f97316"};
const GRADE_COLOR={"A+":B.teal,"A":"#4ade80","B":B.blue,"C":"#f97316","D":B.loss};
const TAG_COLOR={ICT:B.purple,Strat:B.blue,Confluence:B.teal,CISD:"#f97316",OB:B.purple,FVG:B.blue,OTE:B.teal,PDH:B.blue,VWAP:B.spark,Open:"#f97316",Risky:B.loss};
const SETUPS=["AM Session CISD","10AM Triple TF","FVG Fill + OTE","PDH Rejection","PDL Bounce","0930 Rejection","Auto-synced","Other"];
const SESSIONS=["AM","Mid","Open","PM"];
const GRADES=["A+","A","B","C","D"];
const INSTRUMENTS=["MES","ES","SPY","SPX","NQ","MNQ"];
const fmt=n=>n>=0?`+$${n.toLocaleString()}`:`-$${Math.abs(n).toLocaleString()}`;
const pnlColor=n=>n>=0?B.profit:B.loss;
const dayName=d=>["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][new Date(d+"T12:00:00").getDay()];

const SAMPLE=[
  {id:"s1",date:"2026-03-03",instrument:"MES",direction:"Long",contracts:2,entry:5780,exit:5794,pnl:140,rr:"2.1R",setup:"AM Session CISD",grade:"A",notes:"Clean CISD off 8:30 high",session:"AM",result:"Win"},
  {id:"s2",date:"2026-03-04",instrument:"MES",direction:"Short",contracts:2,entry:5810,exit:5793,pnl:170,rr:"2.4R",setup:"10AM Triple TF",grade:"A+",notes:"3H/90M/45M confluence HOD",session:"Mid",result:"Win"},
  {id:"s3",date:"2026-03-05",instrument:"SPX",direction:"Long",contracts:1,entry:5788,exit:5801,pnl:130,rr:"1.9R",setup:"FVG Fill + OTE",grade:"A",notes:"OTE into 0.79 fib",session:"AM",result:"Win"},
  {id:"s4",date:"2026-03-06",instrument:"MES",direction:"Long",contracts:3,entry:5765,exit:5761,pnl:-60,rr:"-0.6R",setup:"PDL Bounce",grade:"C",notes:"Faked below PDL on wick",session:"Open",result:"Loss"},
  {id:"s5",date:"2026-03-07",instrument:"MES",direction:"Short",contracts:2,entry:5820,exit:5805,pnl:150,rr:"2.0R",setup:"AM Session CISD",grade:"A",notes:"Globex high sweep OB",session:"AM",result:"Win"},
];

const PLAYBOOKS=[
  {id:1,name:"10AM Triple TF Confluence",instruments:["MES","ES"],winRate:78,avgRR:"2.3R",trades:18,description:"3H/90M/45M candle alignment at 10AM NY. /ES as leading indicator. Three-layer conviction system.",tags:["ICT","Strat","Confluence"]},
  {id:2,name:"AM Session CISD",instruments:["MES","ES"],winRate:72,avgRR:"2.0R",trades:14,description:"Change In State of Delivery during 8:30-10AM window. Identify displacement, OB entry on retest.",tags:["ICT","CISD","OB"]},
  {id:3,name:"FVG Fill + OTE",instruments:["MES","SPX"],winRate:68,avgRR:"1.9R",trades:11,description:"Fair Value Gap fill into Optimal Trade Entry (0.62-0.79 fib). Wait for confirmation candle.",tags:["ICT","FVG","OTE"]},
  {id:4,name:"PDH/PDL Rejection",instruments:["MES","SPY"],winRate:65,avgRR:"1.7R",trades:9,description:"Previous Day High/Low sweep and rejection. Combined with VWAP confluence for higher probability.",tags:["Strat","PDH","VWAP"]},
  {id:5,name:"0930 Open Rejection",instruments:["SPY","SPX"],winRate:55,avgRR:"1.4R",trades:8,description:"First 5-min candle rejection trade. Only A+ setups at key HTF levels. High risk - size down.",tags:["Open","Strat","Risky"]},
];


// ── Auto-Grade Logic ──────────────────────────────────────────────────────────
const HIGH_QUALITY_SETUPS = [
  "10AM Triple TF","AM Session CISD","FVG Fill + OTE",
  "PDH Rejection","PDL Bounce","10am triple tf","cisd","fvg","ote",
];

// strategies is optional array of user strategy objects from storage
function autoGrade(trade, strategies=[]) {
  const GRADES = ["D","C","B","A","A+"];

  // Step 1: Grade by R:R if available
  const rrRaw = (trade.rr||"--").toString().replace(/R/gi,"").replace("+","").trim();
  const rr = parseFloat(rrRaw);
  let grade = "B";

  if (!isNaN(rr) && rr !== 0 && trade.rr !== "--") {
    if (rr >= 2.0)       grade = "A+";
    else if (rr >= 1.5)  grade = "A";
    else if (rr >= 1.0)  grade = "B";
    else if (rr >= 0.5)  grade = "C";
    else                 grade = "D";
    if (trade.result === "Loss") {
      grade = rr <= -1 ? "D" : "C";
    }
  } else {
    // No R:R — grade by P&L
    if (trade.result === "Loss") {
      grade = trade.pnl < -100 ? "D" : "C";
    } else {
      grade = trade.pnl >= 100 ? "A" : trade.pnl >= 50 ? "B" : "C";
    }
  }

  // Step 2: Strategy match → A+ if win
  const setup = (trade.setup||"").toLowerCase();
  const instrument = (trade.instrument||"").toLowerCase();

  // Check user-created strategies first (highest priority)
  const matchesUserStrategy = strategies.some(s => {
    const nameMatch = setup.includes((s.name||"").toLowerCase()) ||
                      (s.name||"").toLowerCase().includes(setup);
    const instMatch = !s.instruments?.length ||
                      s.instruments.some(inst => instrument.includes(inst.toLowerCase()));
    return nameMatch && instMatch;
  });

  if (matchesUserStrategy && trade.result === "Win") {
    return "A+"; // Strategy match + win = always A+
  }
  if (matchesUserStrategy && trade.result === "Loss") {
    // Strategy match but loss - still boost one level (shows you followed the plan)
    const idx = GRADES.indexOf(grade);
    if (idx < GRADES.length - 1) grade = GRADES[idx + 1];
    return grade;
  }

  // Step 3: Boost by built-in high quality setups
  const isHighQuality = HIGH_QUALITY_SETUPS.some(s => setup.includes(s.toLowerCase()));
  if (isHighQuality && trade.result === "Win") {
    const idx = GRADES.indexOf(grade);
    if (idx < GRADES.length - 1) grade = GRADES[idx + 1];
  }

  return grade;
}

// Inline grade editor component
function GradeBadge({grade, tradeId, onSave, size="normal"}){
  const [editing, setEditing] = useState(false);
  const color = GRADE_COLOR[grade]||"#aaa";
  const sizes = size==="small"
    ? {fontSize:10,padding:"2px 8px",borderRadius:20}
    : {fontSize:12,padding:"3px 12px",borderRadius:20};

  if(editing){
    return(
      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
        {["A+","A","B","C","D"].map(g=>(
          <button key={g} onClick={()=>{onSave(g);setEditing(false);}} style={{
            padding:"3px 10px",borderRadius:20,border:"1px solid",cursor:"pointer",
            fontSize:11,fontWeight:800,
            borderColor:GRADE_COLOR[g]||"#aaa",
            background:g===grade?`${GRADE_COLOR[g]||"#aaa"}25`:"transparent",
            color:GRADE_COLOR[g]||"#aaa"
          }}>{g}</button>
        ))}
        <button onClick={()=>setEditing(false)} style={{padding:"3px 8px",borderRadius:20,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:11}}>✕</button>
      </div>
    );
  }

  return(
    <span
      onClick={()=>setEditing(true)}
      title="Click to change grade"
      style={{
        ...sizes,
        fontWeight:800,cursor:"pointer",
        background:`${color}18`,
        border:`1px solid ${color}40`,
        color,display:"inline-flex",alignItems:"center",gap:4,
        transition:"all 0.15s",userSelect:"none"
      }}
    >
      {grade} <span style={{fontSize:9,opacity:0.6}}>✏</span>
    </span>
  );
}

function buildCalendar(trades){const m={};trades.forEach(t=>{if(!m[t.date])m[t.date]={pnl:0,count:0};m[t.date].pnl+=t.pnl;m[t.date].count++;});return m;}
function buildEquity(trades, startBal=0){const s=[...trades].sort((a,b)=>a.date.localeCompare(b.date));let c=startBal;return [{date:"Start",equity:startBal},...s.map(t=>{c+=t.pnl;return{date:t.date.slice(5),equity:Math.round(c*100)/100};})];}

function parseTradovateCSV(text){
  // Detect if this is a Performance CSV (has buyPrice, sellPrice, pnl columns)
  const firstLine = text.trim().split("\n")[0].toLowerCase();
  if(firstLine.includes("buyprice") || firstLine.includes("buyfillid") || firstLine.includes("soldtimestamp")){
    return parseTradovatePerformanceCSV(text);
  }
  // Otherwise fall through to Orders CSV parser below
  return parseTradovateOrdersCSV(text);
}

function parseTradovatePerformanceCSV(text){
  // Parse CSV respecting quoted fields
  function parseCSVLine(line){
    const result=[];let cur="";let inQ=false;
    for(let i=0;i<line.length;i++){
      if(line[i]==='"'){inQ=!inQ;}
      else if(line[i]===","&&!inQ){result.push(cur.trim());cur="";}
      else cur+=line[i];
    }
    result.push(cur.trim());
    return result;
  }

  const lines=text.trim().split("\n").filter(l=>l.trim());
  const headers=parseCSVLine(lines[0]).map(h=>h.replace(/"/g,"").trim().toLowerCase());
  const trades=[];

  for(let i=1;i<lines.length;i++){
    const vals=parseCSVLine(lines[i]);
    const row={};
    headers.forEach((h,idx)=>{row[h]=(vals[idx]||"").replace(/"/g,"").trim();});

    // Parse P&L — handles "$6.25" and "$(51.25)" formats
    const rawPnl=row["pnl"]||"0";
    const isNeg=rawPnl.includes("(");
    const pnl=parseFloat(rawPnl.replace(/[$(),]/g,""))*(isNeg?-1:1)||0;

    // Parse dates
    const rawDate=row["boughttimestamp"]||row["soldtimestamp"]||"";
    let dateStr=new Date().toISOString().slice(0,10);
    try{if(rawDate)dateStr=new Date(rawDate).toISOString().slice(0,10);}catch(e){}

    // Parse prices
    const buyPrice=parseFloat(row["buyprice"]||"0")||0;
    const sellPrice=parseFloat(row["sellprice"]||"0")||0;
    const qty=parseInt(row["qty"]||"1")||1;

    // Determine direction: if buyTimestamp < sellTimestamp = Long, else Short
    const buyTime=new Date(row["boughttimestamp"]||"").getTime();
    const sellTime=new Date(row["soldtimestamp"]||"").getTime();
    const direction=buyTime<=sellTime?"Long":"Short";
    const entryPrice=direction==="Long"?buyPrice:sellPrice;
    const exitPrice=direction==="Long"?sellPrice:buyPrice;

    // Product
    const rawSymbol=row["symbol"]||"MES";
    const product=rawSymbol.replace(/[FGHJKMNQUVXZ]\d+$/,"").replace(/\d+/g,"").toUpperCase()||"MES";

    // Session
    const hr=rawDate?new Date(rawDate).getHours():9;
    const session=hr<10?"AM":hr<13?"Mid":hr<16?"PM":"After";

    // Duration
    const duration=row["duration"]||"";

    if(!dateStr)continue;

    const tradeObj={
      id:`perf_${Date.now()}_${i}`,
      date:dateStr,
      instrument:product,
      direction,
      contracts:qty,
      entry:entryPrice,
      exit:exitPrice,
      pnl:Math.round(pnl*100)/100,
      rr:"--",
      setup:"Imported",
      grade:"B",
      notes:`${rawSymbol} | ${duration} | Entry: ${entryPrice} → Exit: ${exitPrice}`,
      session,
      result:pnl>=0?"Win":"Loss",
    };
    tradeObj.grade=autoGrade(tradeObj);
    trades.push(tradeObj);
  }
  return trades;
}

function parseTradovateOrdersCSV(text){
  // Parse CSV respecting quoted fields
  function parseCSVLine(line){
    const result=[];let cur="";let inQ=false;
    for(let i=0;i<line.length;i++){
      if(line[i]==='"'){inQ=!inQ;}
      else if(line[i]===","&&!inQ){result.push(cur.trim());cur="";}
      else cur+=line[i];
    }
    result.push(cur.trim());
    return result;
  }

  const lines=text.trim().split("\n").filter(l=>l.trim());
  const headers=parseCSVLine(lines[0]).map(h=>h.replace(/"/g,"").trim().toLowerCase());

  // Tick value lookup per product
  const TICK_VAL={MES:1.25,ES:12.5,MNQ:0.5,NQ:5,MYM:0.5,YM:5};
  const TICK_SIZE=0.25;

  // Collect only Filled orders
  const filled=[];
  for(let i=1;i<lines.length;i++){
    const vals=parseCSVLine(lines[i]);
    const row={};
    headers.forEach((h,idx)=>{row[h]=vals[idx]?.replace(/"/g,"").trim()||"";});

    const status=(row["status"]||"").trim().toLowerCase();
    if(!status.includes("filled"))continue;

    const avgPrice=parseFloat(row["avg fill price"]||row["avgprice"]||row["avg price"]||"0")||0;
    const qty=parseInt(row["filled qty"]||row["filledqty"]||row["quantity"]||"1")||1;
    if(!avgPrice||!qty)continue;

    const rawDate=row["fill time"]||row["timestamp"]||row["date"]||"";
    let dateStr=new Date().toISOString().slice(0,10);
    try{if(rawDate)dateStr=new Date(rawDate.replace(/,/g,"")).toISOString().slice(0,10);}catch(e){}

    const side=(row["b/s"]||row["side"]||"").trim();
    const contract=(row["contract"]||row["product"]||"MES").trim();
    const product=(row["product"]||"MES").replace(/\d+/g,"").toUpperCase().trim();
    const text2=(row["text"]||"").toLowerCase();
    const isExit=text2.includes("exit");

    filled.push({
      id:row["orderid"]||row["order id"]||`${Date.now()}_${i}`,
      date:dateStr,
      side:side.includes("Buy")?"Buy":"Sell",
      product,
      contract,
      price:avgPrice,
      qty,
      isExit,
      rawDate,
    });
  }

  // Pair entries and exits into round-trip trades
  const trades=[];
  const used=new Set();

  for(let i=0;i<filled.length;i++){
    if(used.has(i))continue;
    const entry=filled[i];
    if(entry.isExit)continue; // skip standalone exits

    // Find matching exit — same product, opposite side, not yet used
    const exitSide=entry.side==="Buy"?"Sell":"Buy";
    let exitIdx=-1;
    for(let j=i+1;j<filled.length;j++){
      if(used.has(j))continue;
      const ex=filled[j];
      if(ex.product===entry.product&&ex.side===exitSide&&ex.qty===entry.qty){
        exitIdx=j;break;
      }
    }

    if(exitIdx===-1){
      // Try to find any matching exit regardless of qty
      for(let j=i+1;j<filled.length;j++){
        if(used.has(j))continue;
        const ex=filled[j];
        if(ex.product===entry.product&&(ex.isExit||ex.side===exitSide)){
          exitIdx=j;break;
        }
      }
    }

    if(exitIdx===-1)continue; // no exit found

    const exit=filled[exitIdx];
    used.add(i);used.add(exitIdx);

    // Calculate P&L
    const tv=TICK_VAL[entry.product]||1.25;
    const qty2=Math.min(entry.qty,exit.qty);
    let pnl;
    if(entry.side==="Buy"){
      // Long: exit - entry
      pnl=Math.round(((exit.price-entry.price)/TICK_SIZE)*tv*qty2*100)/100;
    }else{
      // Short: entry - exit
      pnl=Math.round(((entry.price-exit.price)/TICK_SIZE)*tv*qty2*100)/100;
    }

    const direction=entry.side==="Buy"?"Long":"Short";
    const hr=entry.rawDate?new Date(entry.rawDate).getHours():9;
    const session=hr<10?"AM":hr<13?"Mid":hr<16?"PM":"After";

    const ot={
      id:`imp_${Date.now()}_${i}`,
      date:entry.date,
      instrument:entry.product,
      direction,
      contracts:qty2,
      entry:entry.price,
      exit:exit.price,
      pnl,
      rr:"--",
      setup:"Imported",
      grade:"B",
      notes:`${entry.contract} | Entry: ${entry.price} → Exit: ${exit.price}`,
      session,
      result:pnl>=0?"Win":"Loss",
    };
    ot.grade=autoGrade(ot);
    trades.push(ot);
  }

  return trades;
}

function parseGenericCSV(text){
  const lines=text.trim().split("\n");
  const headers=lines[0].split(",").map(h=>h.trim().replace(/"/g,"").toLowerCase());
  const trades=[];
  for(let i=1;i<lines.length;i++){
    const vals=lines[i].split(",").map(v=>v.trim().replace(/"/g,""));
    if(vals.length<3)continue;
    const row={};headers.forEach((h,idx)=>{row[h]=vals[idx]||"";});
    const pnl=parseFloat(row.pnl||row["p&l"]||row["profit"]||row["realized"]||"0")||0;
    const rawDate=row.date||row["trade date"]||row["closedate"]||"";
    let safeDate=new Date().toISOString().slice(0,10);
    try{if(rawDate)safeDate=new Date(rawDate).toISOString().slice(0,10);}catch(e){}
    const gt={id:`imp_${Date.now()}_${i}`,date:safeDate,instrument:(row.symbol||row.instrument||"MES").replace(/\d+/g,"").toUpperCase()||"MES",direction:(row.side||row.direction||"Long").includes("ell")?"Short":"Long",contracts:parseInt(row.qty||row.contracts||"1")||1,entry:0,exit:0,pnl,rr:"--",setup:"Imported",grade:"B",notes:"Imported from CSV",session:"AM",result:pnl>=0?"Win":"Loss"};gt.grade=autoGrade(gt);trades.push(gt);
  }
  return trades;
}

const iS={background:"rgba(0,0,0,0.4)",border:`1px solid ${B.border}`,borderRadius:8,color:B.text,padding:"9px 12px",fontSize:13,width:"100%",outline:"none",fontFamily:"'DM Sans',sans-serif"};
const lS={fontSize:10,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:5,display:"block"};

function TCAIcon({size=34}){
  return(
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <defs>
        <linearGradient id="tcaG" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#00D4A8"/>
          <stop offset="100%" stopColor="#8B5CF6"/>
        </linearGradient>
        <linearGradient id="tcaG2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#4F8EF7"/>
          <stop offset="100%" stopColor="#00D4A8"/>
        </linearGradient>
      </defs>
      {/* Left candle - bearish (red/loss) */}
      <line x1="22" y1="10" x2="22" y2="22" stroke="#F05A7E" strokeWidth="2.5" strokeLinecap="round"/>
      <rect x="16" y="22" width="12" height="30" rx="3" fill="#F05A7E" opacity="0.85"/>
      <line x1="22" y1="52" x2="22" y2="64" stroke="#F05A7E" strokeWidth="2.5" strokeLinecap="round"/>
      {/* Center candle - bullish (main, gradient) */}
      <line x1="50" y1="6" x2="50" y2="18" stroke="url(#tcaG)" strokeWidth="3" strokeLinecap="round"/>
      <rect x="43" y="18" width="14" height="44" rx="3.5" fill="url(#tcaG)"/>
      <line x1="50" y1="62" x2="50" y2="76" stroke="url(#tcaG)" strokeWidth="3" strokeLinecap="round"/>
      {/* Right candle - bullish (blue) */}
      <line x1="78" y1="14" x2="78" y2="26" stroke="#4F8EF7" strokeWidth="2.5" strokeLinecap="round"/>
      <rect x="72" y="26" width="12" height="28" rx="3" fill="#4F8EF7" opacity="0.85"/>
      <line x1="78" y1="54" x2="78" y2="66" stroke="#4F8EF7" strokeWidth="2.5" strokeLinecap="round"/>
      {/* TCA text */}
      <text x="50" y="92" textAnchor="middle" fill="url(#tcaG)" fontSize="13" fontWeight="800" fontFamily="monospace" letterSpacing="3">TCA</text>
    </svg>
  );
}


function StatCard({label,value,sub,accent,grad}){return(<div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:"20px 22px",position:"relative",overflow:"hidden"}}><div style={{position:"absolute",top:0,left:0,right:0,height:2,background:grad||`linear-gradient(90deg,${accent},transparent)`}}/><div style={{position:"absolute",top:-20,right:-20,width:90,height:90,background:`radial-gradient(circle,${accent}14 0%,transparent 70%)`,pointerEvents:"none"}}/><div style={{fontSize:10,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>{label}</div>{grad?<div style={{fontSize:26,fontWeight:800,background:grad,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",fontFamily:"'Space Mono',monospace",letterSpacing:-1}}>{value}</div>:<div style={{fontSize:26,fontWeight:800,color:accent,fontFamily:"'Space Mono',monospace",letterSpacing:-1}}>{value}</div>}{sub&&<div style={{fontSize:11,color:B.textMuted,marginTop:5}}>{sub}</div>}</div>);}
function Tag({label}){const c=TAG_COLOR[label]||"#666";return <span style={{fontSize:10,padding:"2px 9px",borderRadius:20,border:`1px solid ${c}44`,color:c,background:"rgba(0,0,0,0.35)",letterSpacing:0.5,fontWeight:700}}>{label}</span>;}
const CTip=({active,payload,label})=>{if(!active||!payload?.length)return null;return(<div style={{background:"#16151C",border:`1px solid ${B.borderTeal}`,borderRadius:10,padding:"10px 16px",fontSize:12}}><div style={{color:B.textMuted,marginBottom:5}}>{label}</div>{payload.map((p,i)=>(<div key={i} style={{color:p.value>=0?B.profit:B.loss,fontFamily:"monospace",fontWeight:700}}>{p.name}: {(p.value>=0?"+":"-")+"$"+Math.abs(p.value)}</div>))}</div>);};

function LoginScreen(){
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [name,setName]=useState("");
  const [mode,setMode]=useState("login"); // login | signup | forgot
  const [error,setError]=useState("");
  const [success,setSuccess]=useState("");
  const [loading,setLoading]=useState(false);

  const iS={width:"100%",padding:"11px 14px",borderRadius:10,border:`1px solid rgba(255,255,255,0.1)`,background:"rgba(255,255,255,0.04)",color:"#F0EEF8",fontSize:13,outline:"none",fontFamily:"'DM Sans',sans-serif"};

  const handle=async()=>{
    if(!email.trim()||(!password.trim()&&mode!=="forgot")){setError("Please fill in all fields.");return;}
    setLoading(true);setError("");setSuccess("");
    try{
      if(mode==="login"){
        const{error:err}=await supabase.auth.signInWithPassword({email:email.trim(),password});
        if(err)setError(err.message);
      } else if(mode==="signup"){
        if(password.length<8){setError("Password must be at least 8 characters.");setLoading(false);return;}
        const{data,error:err}=await supabase.auth.signUp({
          email:email.trim(),password,
          options:{data:{full_name:name.trim()||email.split("@")[0],role:"student"}},
        });
        if(err)setError(err.message);
        else if(data?.user?.identities?.length===0)setError("An account with this email already exists.");
        else setSuccess("Account created! Check your email to confirm, then sign in.");
      } else if(mode==="forgot"){
        const{error:err}=await supabase.auth.resetPasswordForEmail(email.trim(),{redirectTo:window.location.origin});
        if(err)setError(err.message);
        else setSuccess("Password reset email sent! Check your inbox.");
      }
    }catch(e){setError(e.message);}
    setLoading(false);
  };

  return(
    <div style={{minHeight:"100vh",background:"#0E0D14",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans','Segoe UI',sans-serif",padding:"20px"}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&display=swap');*{box-sizing:border-box;}body{margin:0;}`}</style>
      <div style={{width:"100%",maxWidth:420}}>

        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:36}}>
          <div style={{display:"flex",justifyContent:"center",marginBottom:16}}>
            <div style={{width:80,height:80,borderRadius:24,background:"linear-gradient(135deg,rgba(0,212,168,0.15),rgba(139,92,246,0.15))",border:"1px solid rgba(0,212,168,0.3)",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 0 40px rgba(0,212,168,0.15)"}}>
              <TCAIcon size={52}/>
            </div>
          </div>
          <div style={{fontSize:11,color:"#00D4A8",letterSpacing:3,textTransform:"uppercase",fontWeight:700,marginBottom:6}}>The Candlestick Academy</div>
          <div style={{fontSize:28,fontWeight:900,color:"#F0EEF8",letterSpacing:-1,lineHeight:1.1}}>Trade Journal</div>
          <div style={{fontSize:12,color:"#6B6880",marginTop:6,letterSpacing:0.5}}>Track · Analyze · Improve</div>
        </div>

        {/* Card */}
        <div style={{background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:20,padding:"32px 28px"}}>
          <div style={{height:3,background:"linear-gradient(90deg,#00D4A8,#4F8EF7,#8B5CF6)",borderRadius:3,margin:"-32px -28px 28px",borderRadius:"20px 20px 0 0"}}/>

          <div style={{fontSize:18,fontWeight:800,color:"#F0EEF8",marginBottom:4}}>
            {mode==="login"?"Welcome back":mode==="signup"?"Create your account":"Reset password"}
          </div>
          <div style={{fontSize:12,color:"#6B6880",marginBottom:24}}>
            {mode==="login"?"Sign in to your TCA Journal":mode==="signup"?"Start tracking your trades today":"Enter your email to receive a reset link"}
          </div>

          {/* Fields */}
          <div style={{display:"flex",flexDirection:"column",gap:12}}>
            {mode==="signup"&&(
              <input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name (optional)" style={iS}/>
            )}
            <input value={email} onChange={e=>setEmail(e.target.value)} placeholder="Email address" type="email"
              onKeyDown={e=>e.key==="Enter"&&handle()} style={iS}/>
            {mode!=="forgot"&&(
              <input value={password} onChange={e=>setPassword(e.target.value)} placeholder={mode==="signup"?"Password (min 8 chars)":"Password"} type="password"
                onKeyDown={e=>e.key==="Enter"&&handle()} style={iS}/>
            )}
          </div>

          {/* Forgot link */}
          {mode==="login"&&(
            <div style={{textAlign:"right",marginTop:8}}>
              <span onClick={()=>{setMode("forgot");setError("");setSuccess("");}} style={{fontSize:11,color:"#6B6880",cursor:"pointer",textDecoration:"underline"}}>Forgot password?</span>
            </div>
          )}

          {/* Error / Success */}
          {error&&<div style={{marginTop:14,padding:"10px 14px",borderRadius:10,background:"rgba(240,90,126,0.1)",border:"1px solid rgba(240,90,126,0.2)",fontSize:12,color:"#F05A7E"}}>{error}</div>}
          {success&&<div style={{marginTop:14,padding:"10px 14px",borderRadius:10,background:"rgba(0,212,168,0.1)",border:"1px solid rgba(0,212,168,0.2)",fontSize:12,color:"#00D4A8"}}>{success}</div>}

          {/* Submit */}
          <button onClick={handle} disabled={loading} style={{
            width:"100%",marginTop:20,padding:"13px",borderRadius:11,border:"none",
            background:loading?"rgba(255,255,255,0.06)":"linear-gradient(135deg,#00D4A8,#4F8EF7)",
            color:loading?"#6B6880":"#0E0D14",cursor:loading?"not-allowed":"pointer",
            fontSize:14,fontWeight:800,fontFamily:"'DM Sans',sans-serif",transition:"all 0.15s",
          }}>
            {loading?"Please wait...":(mode==="login"?"Sign In":mode==="signup"?"Create Account":"Send Reset Email")}
          </button>

          {/* Toggle */}
          <div style={{textAlign:"center",marginTop:20,fontSize:12,color:"#6B6880"}}>
            {mode==="forgot"?(
              <span onClick={()=>{setMode("login");setError("");setSuccess("");}} style={{color:B.teal,cursor:"pointer",fontWeight:700}}>← Back to sign in</span>
            ):mode==="login"?(
              <>Don't have an account?{" "}<span onClick={()=>{setMode("signup");setError("");setSuccess("");}} style={{color:B.teal,cursor:"pointer",fontWeight:700}}>Sign up free</span></>
            ):(
              <>Already have an account?{" "}<span onClick={()=>{setMode("login");setError("");setSuccess("");}} style={{color:B.teal,cursor:"pointer",fontWeight:700}}>Sign in</span></>
            )}
          </div>
        </div>

        <div style={{textAlign:"center",marginTop:20,fontSize:11,color:"rgba(255,255,255,0.15)"}}>
          By signing up you agree to use this journal for educational purposes.
        </div>
      </div>
    </div>
  );
}


function TradeFormModal({onClose,onSave,editTrade}){
  const blank={date:new Date().toISOString().slice(0,10),account_id:"main",instrument:"MES",direction:"Long",contracts:1,entry:"",exit:"",stop_loss:"",take_profit:"",tp_category:"",pnl:"",rr:"",setup:SETUPS[0],strategy:"",grade:"A",session:"AM",notes:"",result:"Win"};
  const [form,setForm]=useState(editTrade?{...editTrade}:blank);const [auto,setAuto]=useState(!editTrade);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  // accounts from parent - we'll read from localStorage
  const [formAccounts,setFormAccounts]=useState([{id:"main",label:"Live Account"},{id:"apex_eval",label:"Apex Eval"},{id:"apex_demo",label:"Apex Demo"}]);
  const [formStrategies,setFormStrategies]=useState([]);
  const [customSetups,setCustomSetups]=useState(()=>{
    try{
      const saved=localStorage.getItem("tca_custom_setups_v1");
      if(saved){const p=JSON.parse(saved);if(p?.length)return p;}
    }catch(e){}
    return [...SETUPS]; // default to built-in setups
  });
  const [showSetupMgr,setShowSetupMgr]=useState(false);
  const [newSetupName,setNewSetupName]=useState("");
  const saveCustomSetups=(s)=>{setCustomSetups(s);try{localStorage.setItem("tca_custom_setups_v1",JSON.stringify(s));}catch(e){}};

  useEffect(()=>{
    // Load from localStorage first (fast)
    try{const l=localStorage.getItem("tca_strategies_v1");if(l){const s=JSON.parse(l);if(s.length)setFormStrategies(s);}}catch(e){}
    // Then load from Supabase (authoritative)
    (async()=>{
      try{
        const{data}=await supabase.from("user_preferences").select("value").eq("key","tca_strategies_v1").single();
        if(data?.value){
          const s=JSON.parse(data.value);
          if(Array.isArray(s)&&s.length){
            setFormStrategies(s);
            localStorage.setItem("tca_strategies_v1",data.value);
          }
        }
      }catch(e){}
    })();
  },[]);

  const DEFAULT_TP_CATS=["PDH/PDL","FVG Fill","Order Block","VWAP","Round Number","Session High/Low","Fib Level","Swing High/Low","Custom"];
  const [tpCats,setTpCats]=useState(()=>{try{return JSON.parse(localStorage.getItem("tca_tp_categories")||"null")||DEFAULT_TP_CATS;}catch(e){return DEFAULT_TP_CATS;}});
  const [showTpMgr,setShowTpMgr]=useState(false);
  const [newTpCat,setNewTpCat]=useState("");
  const saveTpCats=(cats)=>{setTpCats(cats);try{localStorage.setItem("tca_tp_categories",JSON.stringify(cats));}catch(e){}};
  useEffect(()=>{try{const l=localStorage.getItem("pref_tca_accounts_v1");if(l)setFormAccounts(JSON.parse(l));}catch(e){};},[]);
  useEffect(()=>{if(!auto)return;const en=parseFloat(form.entry),ex=parseFloat(form.exit),qty=parseInt(form.contracts)||1;if(isNaN(en)||isNaN(ex))return;const inst=form.instrument;let tv=1,ts=0.25;if(inst==="MES"){tv=1.25;ts=0.25;}else if(inst==="ES"){tv=12.5;ts=0.25;}else if(inst==="NQ"){tv=5;ts=0.25;}else if(inst==="MNQ"){tv=0.5;ts=0.25;}const pts=form.direction==="Long"?ex-en:en-ex;const p=Math.round((pts/ts)*tv*qty*100)/100;set("pnl",p);set("result",p>=0?"Win":"Loss");},[form.entry,form.exit,form.contracts,form.instrument,form.direction,auto]);
  const handleSave=()=>{onSave({...form,id:editTrade?.id||`t_${Date.now()}`,pnl:parseFloat(form.pnl)||0,contracts:parseInt(form.contracts)||1,entry:parseFloat(form.entry)||0,exit:parseFloat(form.exit)||0,result:parseFloat(form.pnl)>=0?"Win":"Loss"});onClose();};
  return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(6px)"}}><div style={{background:"#13121A",border:`1px solid ${B.border}`,borderRadius:18,padding:32,width:580,maxHeight:"90vh",overflowY:"auto"}}><div style={{height:3,background:GL,borderRadius:3,marginBottom:24}}/><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}><div style={{fontSize:18,fontWeight:800,color:B.text}}>{editTrade?"Edit Trade":"Log New Trade"}</div><button onClick={onClose} style={{background:"none",border:"none",color:B.textMuted,cursor:"pointer",fontSize:22}}>x</button></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}><div><label style={lS}>Date</label><input type="date" value={form.date} onChange={e=>set("date",e.target.value)} style={iS}/></div><div><label style={lS}>Instrument</label><select value={form.instrument} onChange={e=>set("instrument",e.target.value)} style={iS}>{INSTRUMENTS.map(i=><option key={i}>{i}</option>)}</select></div><div><label style={lS}>Direction</label><div style={{display:"flex",gap:8}}>{["Long","Short"].map(d=>(<button key={d} onClick={()=>set("direction",d)} style={{flex:1,padding:"9px",borderRadius:8,border:"1px solid",cursor:"pointer",fontWeight:700,fontSize:13,borderColor:form.direction===d?(d==="Long"?"#4ade80":"#f87171"):B.border,background:form.direction===d?(d==="Long"?"rgba(74,222,128,0.1)":"rgba(248,113,113,0.1)"):"transparent",color:form.direction===d?(d==="Long"?"#4ade80":"#f87171"):B.textMuted}}>{d}</button>))}</div></div><div><label style={lS}>Contracts</label><input type="number" value={form.contracts} onChange={e=>set("contracts",e.target.value)} style={iS} min="1"/></div><div><label style={lS}>Entry Price</label><input type="number" step="0.01" value={form.entry} onChange={e=>set("entry",e.target.value)} style={iS} placeholder="e.g. 5780.25"/></div><div><label style={lS}>Exit Price</label><input type="number" step="0.01" value={form.exit} onChange={e=>set("exit",e.target.value)} style={iS} placeholder="e.g. 5794.00"/></div>
              <div><label style={lS}>Stop Loss</label><input type="number" step="0.25" value={form.stop_loss||""} onChange={e=>set("stop_loss",e.target.value)} style={iS} placeholder="Price level"/></div>
              <div><label style={lS}>Take Profit</label><input type="number" step="0.25" value={form.take_profit||""} onChange={e=>set("take_profit",e.target.value)} style={iS} placeholder="Price level"/></div>
              <div style={{gridColumn:"1/-1"}}><label style={lS}>TP Category <button type="button" onClick={()=>setShowTpMgr(p=>!p)} style={{background:"none",border:"none",color:B.textMuted,cursor:"pointer",fontSize:10,marginLeft:4}}>⚙ edit</button></label>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {tpCats.map(c=>(
                    <button key={c} type="button" onClick={()=>set("tp_category",form.tp_category===c?"":c)}
                      style={{padding:"4px 12px",borderRadius:20,cursor:"pointer",fontSize:11,fontWeight:600,
                        border:`1px solid ${form.tp_category===c?B.teal:B.border}`,
                        background:form.tp_category===c?`${B.teal}18`:"transparent",
                        color:form.tp_category===c?B.teal:B.textMuted,transition:"all 0.12s"}}>
                      {c}
                    </button>
                  ))}
                </div>
                {showTpMgr&&(
                  <div style={{marginTop:10,padding:"12px 14px",borderRadius:10,background:"rgba(0,0,0,0.3)",border:`1px solid ${B.border}`}}>
                    <div style={{fontSize:10,color:B.textMuted,letterSpacing:1,marginBottom:8}}>MANAGE TP CATEGORIES</div>
                    <div style={{display:"flex",flexWrap:"wrap",gap:5,marginBottom:10}}>
                      {tpCats.map(c=>(
                        <div key={c} style={{display:"flex",alignItems:"center",gap:4,padding:"3px 8px",borderRadius:6,background:`${B.teal}10`,border:`1px solid ${B.borderTeal}`}}>
                          <span style={{fontSize:11,color:B.teal}}>{c}</span>
                          {tpCats.length>1&&<button type="button" onClick={()=>saveTpCats(tpCats.filter(x=>x!==c))} style={{background:"none",border:"none",color:B.loss,cursor:"pointer",fontSize:12,padding:"0 2px",lineHeight:1}}>×</button>}
                        </div>
                      ))}
                    </div>
                    <div style={{display:"flex",gap:6}}>
                      <input value={newTpCat} onChange={e=>setNewTpCat(e.target.value)} onKeyDown={e=>e.key==="Enter"&&newTpCat.trim()&&(saveTpCats([...tpCats,newTpCat.trim()]),setNewTpCat(""))} placeholder="New category..." style={{...iS,flex:1,padding:"5px 10px",fontSize:11}}/>
                      <button type="button" onClick={()=>{if(newTpCat.trim()){saveTpCats([...tpCats,newTpCat.trim()]);setNewTpCat("");}}} style={{padding:"5px 12px",borderRadius:7,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:11,fontWeight:800}}>Add</button>
                    </div>
                  </div>
                )}
              </div><div><label style={lS}>P&L ($) <span onClick={()=>setAuto(a=>!a)} style={{marginLeft:8,cursor:"pointer",color:auto?B.teal:B.textMuted,fontSize:9}}>{auto?"AUTO":"MANUAL"}</span></label><input type="number" step="0.01" value={form.pnl} onChange={e=>{set("pnl",e.target.value);setAuto(false);}} style={{...iS,color:parseFloat(form.pnl)>=0?B.profit:B.loss,fontWeight:700}} placeholder="0.00"/></div><div><label style={lS}>R:R Ratio</label><input value={form.rr} onChange={e=>set("rr",e.target.value)} style={iS} placeholder="e.g. 2.1R"/></div><div><label style={lS}>Setup / Entry Type <button type="button" onClick={()=>setShowSetupMgr(p=>!p)} style={{background:"none",border:"none",color:B.textMuted,cursor:"pointer",fontSize:10,marginLeft:4,textDecoration:"underline"}}>edit list</button></label>
                <select value={form.setup||""} onChange={e=>set("setup",e.target.value)} style={iS}>
                  <option value="">— Select Setup —</option>
                  {customSetups.map(s=><option key={s} value={s}>{s}</option>)}
                </select>
                {showSetupMgr&&(
                  <div style={{marginTop:8,padding:"10px 12px",borderRadius:8,background:"rgba(0,0,0,0.3)",border:`1px solid ${B.border}`}}>
                    <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:8}}>
                      {customSetups.map(s=>(
                        <div key={s} style={{display:"flex",alignItems:"center",gap:3,padding:"2px 8px",borderRadius:6,background:`${B.purple}10`,border:`1px solid ${B.borderPurp}`}}>
                          <span style={{fontSize:11,color:B.purple}}>{s}</span>
                          <button type="button" onClick={()=>saveCustomSetups(customSetups.filter(x=>x!==s))} style={{background:"none",border:"none",color:B.loss,cursor:"pointer",fontSize:12,padding:"0 2px",lineHeight:1}}>×</button>
                        </div>
                      ))}
                    </div>
                    <div style={{display:"flex",gap:6}}>
                      <input value={newSetupName} onChange={e=>setNewSetupName(e.target.value)}
                        onKeyDown={e=>e.key==="Enter"&&newSetupName.trim()&&(saveCustomSetups([...customSetups,newSetupName.trim()]),setNewSetupName(""))}
                        placeholder="Add setup..." style={{...iS,flex:1,padding:"5px 10px",fontSize:11}}/>
                      <button type="button" onClick={()=>{if(newSetupName.trim()){saveCustomSetups([...customSetups,newSetupName.trim()]);setNewSetupName("");}}}
                        style={{padding:"5px 12px",borderRadius:7,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:11,fontWeight:800}}>+</button>
                    </div>
                  </div>
                )}
              </div><div><label style={lS}>Session</label><select value={form.session} onChange={e=>set("session",e.target.value)} style={iS}>{SESSIONS.map(s=><option key={s}>{s}</option>)}</select></div>
              <div style={{gridColumn:"1/-1"}}>
                <label style={lS}>Strategy <span style={{fontSize:9,color:B.textMuted}}>(from your Strategies page)</span></label>
                <select value={form.strategy||""} onChange={e=>set("strategy",e.target.value)} style={iS}>
                  <option value="">— Select Strategy —</option>
                  {formStrategies.length===0&&<option disabled style={{color:B.textMuted}}>No strategies yet — create them in the Strategies page</option>}
                  {formStrategies.map(st=>(
                    <option key={st.id} value={st.name}>{st.name}</option>
                  ))}
                </select>
              </div>
              
              <div><label style={lS}>Account</label><select value={form.account_id||"main"} onChange={e=>set("account_id",e.target.value)} style={{...iS,cursor:"pointer"}}>{formAccounts.map(a=>(<option key={a.id} value={a.id}>{a.label}</option>))}</select></div><div style={{gridColumn:"1/-1"}}><label style={lS}>Grade</label><div style={{display:"flex",gap:6}}>{GRADES.map(g=>(<button key={g} onClick={()=>set("grade",g)} style={{flex:1,padding:"7px 0",borderRadius:8,border:"1px solid",cursor:"pointer",fontWeight:800,fontSize:12,borderColor:form.grade===g?GRADE_COLOR[g]:B.border,background:form.grade===g?`${GRADE_COLOR[g]}18`:"transparent",color:form.grade===g?GRADE_COLOR[g]:B.textMuted}}>{g}</button>))}</div></div><div style={{gridColumn:"1/-1"}}><label style={lS}>Notes</label><textarea value={form.notes} onChange={e=>set("notes",e.target.value)} rows={3} style={{...iS,resize:"vertical"}} placeholder="What happened?"/></div></div><div style={{display:"flex",gap:10,marginTop:24,justifyContent:"flex-end"}}><button onClick={onClose} style={{padding:"10px 22px",borderRadius:10,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:13,fontWeight:600}}>Cancel</button><button onClick={handleSave} style={{padding:"10px 28px",borderRadius:10,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:13,fontWeight:800}}>{editTrade?"Save Changes":"Log Trade"}</button></div></div></div>);
}

function ImportModal({onClose,onImport,existingTrades}){
  const [step,setStep]=useState("upload");
  const [parsed,setParsed]=useState([]);
  const [error,setError]=useState("");
  const [drag,setDrag]=useState(false);
  const [mode,setMode]=useState("add"); // "add" | "replace"
  const [fileType,setFileType]=useState("");
  const [importAccount,setImportAccount]=useState("main");
  const [importAccounts,setImportAccounts]=useState([
    {id:"main",label:"Live Account",color:"#00D4A8"},
    {id:"apex_eval",label:"Apex Eval",color:"#4F8EF7"},
    {id:"apex_demo",label:"Apex Demo",color:"#8B5CF6"},
  ]);
  const ref=useRef();

  // Load custom accounts from localStorage
  useEffect(()=>{
    try{const l=localStorage.getItem("pref_tca_accounts_v1");if(l)setImportAccounts(JSON.parse(l));}catch(e){}
  },[]);

  const handle=(file)=>{
    if(!file)return;
    setError("");
    const r=new FileReader();
    r.onload=(e)=>{
      try{
        const t=e.target.result;
        const firstLine=t.split("\n")[0].toLowerCase();
        let tr=[];
        let type="";
        if(firstLine.includes("buyprice")||firstLine.includes("soldtimestamp")){
          tr=parseTradovatePerformanceCSV(t);
          type="Performance CSV";
        }else{
          tr=parseTradovateOrdersCSV(t);
          type="Orders CSV";
        }
        if(tr.length===0){setError("No valid trades found. Make sure you're uploading a Tradovate Performance.csv or Orders.csv file.");return;}
        setParsed(tr);
        setFileType(type);
        setStep("preview");
      }catch(err){setError("Failed to parse: "+err.message);}
    };
    r.readAsText(file);
  };

  const totalPnl=parsed.reduce((a,t)=>a+t.pnl,0);
  const wins=parsed.filter(t=>t.pnl>0).length;

  // Check for duplicates against existing trades
  const existingDates=new Set(existingTrades.map(t=>t.date));
  const newTrades=parsed.filter(t=>!existingDates.has(t.date)||mode==="replace");
  const duplicates=parsed.length-newTrades.length;

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(6px)"}}>
      <div style={{background:"#13121A",border:`1px solid ${B.border}`,borderRadius:20,width:640,maxHeight:"88vh",overflowY:"auto"}}>
        <div style={{height:3,background:GL,borderRadius:"20px 20px 0 0"}}/>

        {/* Header */}
        <div style={{padding:"24px 28px 0",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div>
            <div style={{fontSize:18,fontWeight:800,color:B.text}}>Import Trades</div>
            <div style={{fontSize:12,color:B.textMuted,marginTop:3}}>Tradovate Performance.csv or Orders.csv</div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.05)",border:`1px solid ${B.border}`,borderRadius:8,color:B.textMuted,cursor:"pointer",fontSize:18,width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
        </div>

        <div style={{padding:"0 28px 28px"}}>
          {step==="upload"&&(
            <>
              {/* Drop zone */}
              <div
                onDragOver={e=>{e.preventDefault();setDrag(true);}}
                onDragLeave={()=>setDrag(false)}
                onDrop={e=>{e.preventDefault();setDrag(false);handle(e.dataTransfer.files[0]);}}
                onClick={()=>ref.current.click()}
                style={{border:`2px dashed ${drag?B.teal:B.border}`,borderRadius:14,padding:"48px 24px",textAlign:"center",cursor:"pointer",background:drag?`${B.teal}08`:"rgba(0,0,0,0.2)",transition:"all 0.2s",marginBottom:20}}>
                <div style={{fontSize:40,marginBottom:12}}>📊</div>
                <div style={{fontSize:15,fontWeight:700,color:B.text,marginBottom:6}}>Drop your Tradovate CSV here</div>
                <div style={{fontSize:12,color:B.textMuted,marginBottom:16}}>or click to browse</div>
                <div style={{display:"inline-flex",gap:8}}>
                  {["Performance.csv","Orders.csv"].map(f=>(
                    <span key={f} style={{fontSize:11,padding:"3px 10px",borderRadius:20,background:`${B.teal}12`,border:`1px solid ${B.borderTeal}`,color:B.teal,fontWeight:700}}>{f}</span>
                  ))}
                </div>
                <input ref={ref} type="file" accept=".csv,.txt" style={{display:"none"}} onChange={e=>handle(e.target.files[0])}/>
              </div>

              {error&&<div style={{padding:"12px 16px",borderRadius:10,background:`${B.loss}10`,border:`1px solid ${B.loss}30`,color:B.loss,fontSize:12,marginBottom:16}}>{error}</div>}

              {/* How to export guide */}
              <div style={{padding:16,borderRadius:12,background:"rgba(0,0,0,0.3)",border:`1px solid ${B.border}`}}>
                <div style={{fontSize:10,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>How to export from Tradovate</div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:B.teal,marginBottom:6}}>Performance.csv (Recommended)</div>
                    {["Open Tradovate platform","Go to Account → Performance","Set your date range","Click Export → Performance CSV"].map((s,i)=>(
                      <div key={i} style={{fontSize:11,color:"#9CA0BC",marginBottom:4,display:"flex",gap:6}}>
                        <span style={{color:B.teal,fontWeight:700,minWidth:14}}>{i+1}.</span>{s}
                      </div>
                    ))}
                  </div>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:B.blue,marginBottom:6}}>Orders.csv (Alternative)</div>
                    {["Open Tradovate platform","Go to Account → Orders","Set your date range","Click Export → Orders CSV"].map((s,i)=>(
                      <div key={i} style={{fontSize:11,color:"#9CA0BC",marginBottom:4,display:"flex",gap:6}}>
                        <span style={{color:B.blue,fontWeight:700,minWidth:14}}>{i+1}.</span>{s}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}

          {step==="preview"&&(
            <>
              {/* File type badge */}
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:16}}>
                <span style={{fontSize:11,padding:"3px 12px",borderRadius:20,background:`${B.teal}15`,border:`1px solid ${B.borderTeal}`,color:B.teal,fontWeight:700}}>✓ {fileType} detected</span>
                <button onClick={()=>{setStep("upload");setParsed([]);setError("");}} style={{fontSize:11,color:B.textMuted,background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>Upload different file</button>
              </div>

              {/* Summary stats */}
              <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:16}}>
                {[
                  {label:"Total Trades",value:parsed.length,color:B.text},
                  {label:"Net P&L",value:fmt(Math.round(totalPnl*100)/100),color:pnlColor(totalPnl)},
                  {label:"Win Rate",value:`${parsed.length?Math.round((wins/parsed.length)*100):0}%`,color:B.teal},
                  {label:"New Trades",value:newTrades.length,color:B.blue},
                ].map(s=>(
                  <div key={s.label} style={{background:"rgba(0,0,0,0.3)",borderRadius:10,padding:"12px 14px",border:`1px solid ${B.border}`,textAlign:"center"}}>
                    <div style={{fontSize:9,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:5}}>{s.label}</div>
                    <div style={{fontSize:18,fontWeight:800,color:s.color,fontFamily:"monospace"}}>{s.value}</div>
                  </div>
                ))}
              </div>

              {/* Import mode */}
              <div style={{marginBottom:16}}>
                <div style={{fontSize:10,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:8}}>Import Mode</div>
                <div style={{display:"flex",gap:8}}>
                  {[
                    {id:"add",label:"Add New Only",desc:`Skip ${duplicates} duplicate dates`},
                    {id:"replace",label:"Replace All",desc:"Overwrite existing trades"},
                  ].map(m=>(
                    <button key={m.id} onClick={()=>setMode(m.id)} style={{
                      flex:1,padding:"10px 14px",borderRadius:10,border:"1px solid",cursor:"pointer",textAlign:"left",
                      borderColor:mode===m.id?B.teal:B.border,
                      background:mode===m.id?`${B.teal}10`:"transparent",
                    }}>
                      <div style={{fontSize:12,fontWeight:700,color:mode===m.id?B.teal:B.text,marginBottom:3}}>{m.label}</div>
                      <div style={{fontSize:10,color:B.textMuted}}>{m.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Trade preview table */}
              <div style={{borderRadius:12,overflow:"hidden",border:`1px solid ${B.border}`,marginBottom:20,maxHeight:260,overflowY:"auto"}}>
                <div style={{display:"grid",gridTemplateColumns:"90px 60px 60px 60px 90px 1fr",padding:"8px 14px",fontSize:10,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",borderBottom:`1px solid ${B.border}`,background:"rgba(0,0,0,0.5)",position:"sticky",top:0}}>
                  {["Date","Symbol","Dir","Qty","P&L","Notes"].map(h=><div key={h}>{h}</div>)}
                </div>
                {parsed.map((t,i)=>(
                  <div key={i} style={{display:"grid",gridTemplateColumns:"90px 60px 60px 60px 90px 1fr",padding:"9px 14px",borderBottom:`1px solid ${B.border}`,fontSize:12,borderLeft:`2px solid ${t.pnl>=0?B.teal:B.loss}`,background:i%2===0?"transparent":"rgba(255,255,255,0.01)"}}>
                    <div style={{color:B.textMuted}}>{t.date.slice(5)}</div>
                    <div style={{color:INST_COLOR[t.instrument]||B.teal,fontWeight:700}}>{t.instrument}</div>
                    <div style={{color:t.direction==="Long"?"#4ade80":"#f87171"}}>{t.direction}</div>
                    <div style={{color:B.textMuted}}>{t.contracts}</div>
                    <div style={{color:pnlColor(t.pnl),fontWeight:700,fontFamily:"monospace"}}>{fmt(t.pnl)}</div>
                    <div style={{color:B.textMuted,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",fontSize:10}}>{t.notes}</div>
                  </div>
                ))}
              </div>

              {/* Action buttons */}
                            {/* Account tagger */}
              <div style={{marginBottom:12,padding:"12px 14px",borderRadius:10,background:"rgba(0,0,0,0.3)",border:`1px solid ${B.border}`}}>
                <div style={{fontSize:10,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:8}}>Tag trades to account:</div>
                <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                  {importAccounts.map(a=>(
                    <button key={a.id} onClick={()=>setImportAccount(a.id)} style={{
                      padding:"6px 14px",borderRadius:20,cursor:"pointer",fontSize:11,fontWeight:600,
                      border:`1px solid ${importAccount===a.id?a.color:B.border}`,
                      background:importAccount===a.id?`${a.color}15`:"transparent",
                      color:importAccount===a.id?a.color:B.textMuted,transition:"all 0.15s",
                    }}>{a.label}</button>
                  ))}
                </div>
              </div>
              <div style={{display:"flex",gap:10}}>
                <button onClick={onClose} style={{flex:1,padding:"11px",borderRadius:10,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:13,fontWeight:600}}>Cancel</button>
                <button onClick={()=>{
                  const tagged=parsed.map(t=>({...t,account_id:importAccount}));
                  const newTagged=tagged.filter(t=>!existingTrades.some(e=>e.tradovate_id&&e.tradovate_id===t.tradovate_id));
                  onImport(mode==="replace"?tagged:newTagged,mode);
                  onClose();
                }} style={{flex:2,padding:"11px",borderRadius:10,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:13,fontWeight:800}}>
                  Import {mode==="replace"?parsed.length:newTrades.length} Trades →
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DeleteConfirm({trade,onConfirm,onCancel}){return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:110,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{background:"#13121A",border:"1px solid rgba(240,90,126,0.3)",borderRadius:16,padding:28,width:360,textAlign:"center"}}><div style={{fontSize:16,fontWeight:700,color:B.text,marginBottom:8}}>Delete Trade?</div><div style={{fontSize:13,color:B.textMuted,marginBottom:6}}>{trade.date} - {trade.instrument} - {trade.direction}</div><div style={{fontSize:15,fontWeight:700,fontFamily:"monospace",color:pnlColor(trade.pnl),marginBottom:20}}>{fmt(trade.pnl)}</div><div style={{display:"flex",gap:10,justifyContent:"center"}}><button onClick={onCancel} style={{padding:"9px 22px",borderRadius:9,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontWeight:600}}>Cancel</button><button onClick={onConfirm} style={{padding:"9px 22px",borderRadius:9,background:"rgba(240,90,126,0.15)",color:B.loss,cursor:"pointer",fontWeight:700,border:"1px solid rgba(240,90,126,0.3)"}}>Delete</button></div></div></div>);}

// ── AI Day Review (inside Day Modal) ─────────────────────────────────────────
function AIDayReview({trades, date}){
  const [review,setReview]=useState(null);
  const [loading,setLoading]=useState(false);
  const [open,setOpen]=useState(false);

  const analyze=async()=>{
    setOpen(true);
    if(review)return;
    setLoading(true);
    const dayStats={
      date,
      trades:trades.length,
      pnl:trades.reduce((a,t)=>a+t.pnl,0),
      winRate:trades.length?Math.round((trades.filter(t=>t.result==="Win").length/trades.length)*100):0,
      tradeDetails:trades.map(t=>({
        instrument:t.instrument,
        direction:t.direction,
        contracts:t.contracts,
        entry:t.entry,
        exit:t.exit,
        pnl:t.pnl,
        result:t.result,
        setup:t.setup,
        grade:t.grade,
        session:t.session,
        notes:t.notes,
      })),
    };
    try{
      const res=await fetch("/api/coach",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({type:"day",dayStats})
      });
      const data=await res.json();
      if(data.error)throw new Error(data.error);
      setReview(data);
    }catch(e){console.error(e);}
    setLoading(false);
  };

  const verdictBg={positive:`${B.teal}12`,negative:`${B.loss}12`,neutral:`${B.blue}12`};
  const verdictBorder={positive:B.borderTeal,negative:`${B.loss}30`,neutral:B.blue+"30"};
  const verdictColor={positive:B.teal,negative:B.loss,neutral:B.blue};

  return(
    <div style={{padding:"0 28px 24px"}}>
      {!open?(
        <button onClick={analyze} style={{
          width:"100%",padding:"12px",borderRadius:12,border:`1px solid ${B.purple}40`,
          background:`${B.purple}10`,color:B.purple,cursor:"pointer",fontSize:13,fontWeight:700,
          display:"flex",alignItems:"center",justifyContent:"center",gap:8
        }}>
          🧠 Get AI Coaching Feedback on This Day
        </button>
      ):(
        <div style={{borderRadius:12,border:`1px solid ${B.border}`,overflow:"hidden"}}>
          <div style={{padding:"12px 16px",background:"rgba(0,0,0,0.4)",display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:`1px solid ${B.border}`}}>
            <div style={{fontSize:11,fontWeight:700,color:B.purple,letterSpacing:1}}>🧠 AI COACHING FEEDBACK</div>
            <button onClick={()=>setOpen(false)} style={{background:"none",border:"none",color:B.textMuted,cursor:"pointer",fontSize:16}}>×</button>
          </div>
          {loading?(
            <div style={{padding:"24px",display:"flex",alignItems:"center",justifyContent:"center",gap:12}}>
              <div style={{width:20,height:20,border:`2px solid ${B.border}`,borderTop:`2px solid ${B.purple}`,borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
              <span style={{fontSize:13,color:B.textMuted}}>Analyzing your trading day...</span>
            </div>
          ):review&&(
            <div style={{padding:"16px"}}>
              {/* Verdict badge */}
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
                <div style={{
                  padding:"6px 16px",borderRadius:20,fontSize:13,fontWeight:800,
                  background:verdictBg[review.verdictColor]||verdictBg.neutral,
                  border:`1px solid ${verdictBorder[review.verdictColor]||verdictBorder.neutral}`,
                  color:verdictColor[review.verdictColor]||verdictColor.neutral
                }}>{review.verdict}</div>
              </div>

              {/* Coach note */}
              <div style={{padding:"12px 14px",borderRadius:10,background:"rgba(139,92,246,0.07)",border:`1px solid ${B.purple}25`,marginBottom:12}}>
                <div style={{fontSize:9,color:B.purple,letterSpacing:1.5,textTransform:"uppercase",marginBottom:6}}>Coach Says</div>
                <div style={{fontSize:13,color:"#C8C4D8",lineHeight:1.7,fontStyle:"italic"}}>{review.coachNote}</div>
              </div>

              {/* Strength + Weakness */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
                <div style={{padding:"10px 12px",borderRadius:10,background:`${B.teal}08`,border:`1px solid ${B.borderTeal}`}}>
                  <div style={{fontSize:9,color:B.teal,letterSpacing:1.5,textTransform:"uppercase",marginBottom:5}}>✅ Strength</div>
                  <div style={{fontSize:12,color:B.text,lineHeight:1.5}}>{review.keyStrength}</div>
                </div>
                <div style={{padding:"10px 12px",borderRadius:10,background:`${B.loss}08`,border:`1px solid ${B.loss}25`}}>
                  <div style={{fontSize:9,color:B.loss,letterSpacing:1.5,textTransform:"uppercase",marginBottom:5}}>⚠️ Improve</div>
                  <div style={{fontSize:12,color:B.text,lineHeight:1.5}}>{review.keyWeakness}</div>
                </div>
              </div>

              {/* Pattern alert */}
              {review.patternAlert&&(
                <div style={{padding:"10px 14px",borderRadius:10,background:"rgba(249,115,22,0.08)",border:"1px solid rgba(249,115,22,0.25)",marginBottom:12}}>
                  <div style={{fontSize:9,color:"#f97316",letterSpacing:1.5,textTransform:"uppercase",marginBottom:5}}>🚨 Pattern Alert</div>
                  <div style={{fontSize:12,color:B.text,lineHeight:1.5}}>{review.patternAlert}</div>
                </div>
              )}

              {/* Tomorrow focus */}
              <div style={{padding:"10px 14px",borderRadius:10,background:`${B.blue}08`,border:`1px solid ${B.blue}25`}}>
                <div style={{fontSize:9,color:B.blue,letterSpacing:1.5,textTransform:"uppercase",marginBottom:5}}>🎯 Tomorrow's Focus</div>
                <div style={{fontSize:12,color:B.text,lineHeight:1.5}}>{review.tomorrowFocus}</div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DayModal({date, trades, onClose}){
  const dayTrades=trades.filter(t=>t.date===date);
  const dayPnl=dayTrades.reduce((a,t)=>a+t.pnl,0);
  const wins=dayTrades.filter(t=>t.result==="Win");
  const losses=dayTrades.filter(t=>t.result==="Loss");
  const winRate=dayTrades.length?Math.round((wins.length/dayTrades.length)*100):0;
  const grossWin=wins.reduce((a,t)=>a+t.pnl,0);
  const grossLoss=losses.reduce((a,t)=>a+t.pnl,0);
  const profitFactor=grossLoss!==0?Math.abs(grossWin/grossLoss).toFixed(2):"--";
  const totalContracts=dayTrades.reduce((a,t)=>a+t.contracts,0);
  const dateLabel=new Date(date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric",year:"numeric"});

  // Mini intraday equity curve
  const sortedTrades=[...dayTrades].sort((a,b)=>a.date.localeCompare(b.date));
  let cum=0;
  const curveData=[{time:"Open",pnl:0},...sortedTrades.map((t,i)=>{cum+=t.pnl;return{time:`T${i+1}`,pnl:cum};})];

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:150,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)"}}
      onClick={onClose}>
      <div style={{background:"#13121A",border:`1px solid ${B.border}`,borderRadius:20,width:680,maxHeight:"88vh",overflowY:"auto",position:"relative"}}
        onClick={e=>e.stopPropagation()}>

        {/* Gradient top bar */}
        <div style={{height:3,background:dayPnl>=0?GTB:"linear-gradient(90deg,#F05A7E,#8B5CF6)",borderRadius:"20px 20px 0 0"}}/>

        {/* Header */}
        <div style={{padding:"22px 28px 0",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{display:"flex",alignItems:"center",gap:16}}>
            <div>
              <div style={{fontSize:13,color:B.textMuted,marginBottom:2}}>{dateLabel}</div>
              <div style={{display:"flex",alignItems:"center",gap:12}}>
                <span style={{fontSize:11,color:B.textMuted,fontWeight:600}}>Net P&L</span>
                <span style={{fontSize:26,fontWeight:800,fontFamily:"'Space Mono',monospace",color:pnlColor(dayPnl)}}>{fmt(dayPnl)}</span>
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.05)",border:`1px solid ${B.border}`,borderRadius:8,color:B.textMuted,cursor:"pointer",fontSize:18,width:34,height:34,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
        </div>

        {/* Mini equity curve */}
        {dayTrades.length>1&&(
          <div style={{padding:"16px 28px 0"}}>
            <ResponsiveContainer width="100%" height={80}>
              <AreaChart data={curveData}>
                <defs>
                  <linearGradient id="dayEqF" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={dayPnl>=0?"#00D4A8":"#F05A7E"} stopOpacity={0.3}/>
                    <stop offset="100%" stopColor={dayPnl>=0?"#00D4A8":"#F05A7E"} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)"/>
                <Area type="monotone" dataKey="pnl" stroke={dayPnl>=0?B.teal:B.loss} strokeWidth={2} fill="url(#dayEqF)" dot={false}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Stats row */}
        <div style={{padding:"16px 28px",display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:1,background:"rgba(0,0,0,0.3)",margin:"16px 0 0"}}>
          {[
            {label:"Total Trades", value:dayTrades.length},
            {label:"Gross P&L",    value:fmt(dayPnl), color:pnlColor(dayPnl)},
            {label:"Winners / Losers", value:`${wins.length} / ${losses.length}`},
            {label:"Win Rate",     value:`${winRate}%`, color:winRate>=50?B.profit:B.loss},
            {label:"Volume",       value:`${totalContracts} contracts`},
            {label:"Profit Factor",value:profitFactor},
            {label:"Gross Win",    value:fmt(grossWin), color:B.profit},
            {label:"Gross Loss",   value:grossLoss!==0?fmt(grossLoss):"--", color:B.loss},
          ].map(s=>(
            <div key={s.label} style={{padding:"12px 16px",borderRight:`1px solid ${B.border}`,borderBottom:`1px solid ${B.border}`}}>
              <div style={{fontSize:9,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:5}}>{s.label}</div>
              <div style={{fontSize:15,fontWeight:800,color:s.color||B.text,fontFamily:"'Space Mono',monospace"}}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Trade table */}
        <div style={{padding:"0 28px 28px"}}>
          <div style={{marginTop:20,borderRadius:12,overflow:"hidden",border:`1px solid ${B.border}`}}>
            {/* Table header */}
            <div style={{display:"grid",gridTemplateColumns:"80px 70px 70px 80px 90px 60px 1fr 60px",
              padding:"10px 16px",background:"rgba(0,0,0,0.5)",
              fontSize:10,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",
              borderBottom:`1px solid ${B.border}`}}>
              {["Time","Ticker","Side","Entry","Exit","Qty","Setup / Notes","P&L"].map(h=><div key={h}>{h}</div>)}
            </div>

            {/* Trade rows */}
            {dayTrades.map((t,i)=>(
              <div key={t.id}>
                <div style={{display:"grid",gridTemplateColumns:"80px 70px 70px 80px 90px 60px 1fr 60px",
                  padding:"14px 16px",borderBottom:i<dayTrades.length-1?`1px solid ${B.border}`:"none",
                  background:i%2===0?"transparent":"rgba(255,255,255,0.01)",
                  borderLeft:`3px solid ${t.result==="Win"?B.teal:B.loss}`}}>
                  <div style={{fontSize:12,color:B.textMuted,fontFamily:"monospace"}}>{t.session}</div>
                  <div>
                    <span style={{fontSize:11,padding:"2px 8px",borderRadius:5,fontWeight:700,
                      background:`${INST_COLOR[t.instrument]||B.teal}20`,
                      color:INST_COLOR[t.instrument]||B.teal}}>{t.instrument}</span>
                  </div>
                  <div style={{fontSize:12,fontWeight:700,color:t.direction==="Long"?"#4ade80":"#f87171"}}>{t.direction}</div>
                  <div style={{fontSize:12,fontFamily:"monospace",color:B.text}}>{t.entry||"--"}</div>
                  <div style={{fontSize:12,fontFamily:"monospace",color:B.text}}>{t.exit||"--"}</div>
                  <div style={{fontSize:12,color:B.textMuted}}>{t.contracts}</div>
                  <div style={{fontSize:11,color:B.textMuted,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{t.setup}</div>
                  <div style={{fontSize:13,fontWeight:800,fontFamily:"monospace",color:pnlColor(t.pnl)}}>{fmt(t.pnl)}</div>
                </div>

                {/* Notes row if exists */}
                {t.notes&&(
                  <div style={{padding:"8px 16px 12px",borderBottom:i<dayTrades.length-1?`1px solid ${B.border}`:"none",background:"rgba(0,0,0,0.2)"}}>
                    <div style={{fontSize:11,color:B.textMuted,fontStyle:"italic"}}>📝 {t.notes}</div>
                  </div>
                )}

                {/* Grade + R:R badges */}
                <div style={{display:"flex",gap:8,padding:"0 16px 12px",borderBottom:i<dayTrades.length-1?`1px solid ${B.border}`:"none",background:"rgba(0,0,0,0.2)"}}>
                  <span style={{fontSize:10,padding:"2px 10px",borderRadius:20,fontWeight:700,
                    background:`${GRADE_COLOR[t.grade]||"#aaa"}18`,border:`1px solid ${GRADE_COLOR[t.grade]||"#aaa"}30`,
                    color:GRADE_COLOR[t.grade]||"#aaa"}}>Grade: {t.grade}</span>
                  {t.rr!=="--"&&<span style={{fontSize:10,padding:"2px 10px",borderRadius:20,fontWeight:700,
                    background:`${B.blue}15`,border:`1px solid ${B.blue}30`,color:B.blue}}>R:R {t.rr}</span>}
                  <span style={{fontSize:10,padding:"2px 10px",borderRadius:20,fontWeight:700,
                    background:t.result==="Win"?`${B.profit}15`:`${B.loss}15`,
                    border:`1px solid ${t.result==="Win"?`${B.profit}30`:`${B.loss}30`}`,
                    color:t.result==="Win"?B.profit:B.loss}}>{t.result}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* AI Day Review */}
        <AIDayReview trades={dayTrades} date={date}/>
      </div>
    </div>
  );
}

function GaugeChart({value, max=100, label, color, size=110}){
  const pct = Math.min(value/max, 1);
  const angle = pct * 180;
  const r = 44, cx = 55, cy = 55;
  const toRad = d => (d-180)*Math.PI/180;
  const startX = cx + r*Math.cos(toRad(0));
  const startY = cy + r*Math.sin(toRad(0));
  const endX = cx + r*Math.cos(toRad(angle));
  const endY = cy + r*Math.sin(toRad(angle));
  const large = angle > 180 ? 1 : 0;
  const trackEnd = cx + r*Math.cos(toRad(180));
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
      <svg width={size} height={size*0.6} viewBox="0 0 110 62">
        <path d={`M ${cx-r} ${cy} A ${r} ${r} 0 0 1 ${cx+r} ${cy}`} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth="8" strokeLinecap="round"/>
        {pct>0&&<path d={`M ${cx-r} ${cy} A ${r} ${r} 0 ${large} 1 ${endX} ${endY}`} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round"/>}
        <text x={cx} y={cy-4} textAnchor="middle" fill={color} fontSize="14" fontWeight="800" fontFamily="'Space Mono',monospace">{value}{max===100?"%":""}</text>
      </svg>
      <div style={{fontSize:10,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase"}}>{label}</div>
    </div>
  );
}

function StreakBadge({trades}){
  if(!trades.length)return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
      <div style={{fontSize:28,fontWeight:800,color:B.textMuted,fontFamily:"'Space Mono',monospace"}}>--</div>
      <div style={{fontSize:10,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase"}}>Current Streak</div>
    </div>
  );

  // Sort by date descending, then group by trading day to get day results
  const dayResults = {};
  trades.forEach(t=>{
    if(!dayResults[t.date]) dayResults[t.date] = {wins:0, losses:0};
    if(t.result==="Win") dayResults[t.date].wins++;
    else dayResults[t.date].losses++;
  });

  // Get sorted days
  const days = Object.entries(dayResults)
    .sort((a,b)=>b[0].localeCompare(a[0]))
    .map(([date,d])=>({date, result: d.wins>d.losses?"Win":"Loss"}));

  // Count consecutive streak from most recent day
  let streak=0, type="";
  for(const day of days){
    if(streak===0){type=day.result;streak=1;}
    else if(day.result===type)streak++;
    else break;
  }

  if(!streak)return null;
  const isWin=type==="Win";
  const dots=Math.min(streak,7);

  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
      <div style={{fontSize:36,fontWeight:800,color:isWin?B.profit:B.loss,fontFamily:"'Space Mono',monospace",lineHeight:1}}>{streak}</div>
      <div style={{fontSize:10,color:isWin?B.profit:B.loss,letterSpacing:1.5,textTransform:"uppercase",fontWeight:700}}>{isWin?"🔥 Win Streak":"📉 Loss Streak"}</div>
      <div style={{display:"flex",gap:4,marginTop:4}}>
        {Array.from({length:dots}).map((_,i)=>(
          <div key={i} style={{
            width:8,height:8,borderRadius:"50%",
            background:isWin?B.profit:B.loss,
            opacity:1-((dots-1-i)*0.12),
            transform:`scale(${1-((dots-1-i)*0.06)})`,
          }}/>
        ))}
      </div>
      <div style={{fontSize:9,color:B.textMuted,marginTop:2}}>consecutive {isWin?"winning":"losing"} days</div>
    </div>
  );
}

function Overview({trades, onGradeUpdate, session, onEdit}){
  const wins=trades.filter(t=>t.result==="Win"),losses=trades.filter(t=>t.result==="Loss");
  const totalPnl=trades.reduce((a,t)=>a+t.pnl,0);
  const winRate=trades.length?Math.round((wins.length/trades.length)*100):0;
  // Starting balance - sum of selected account(s) starting balance
  const startingBalance = activeAccount==="all"
    ? accounts.reduce((a,acc)=>a+(acc.startingBalance||0),0)
    : (accounts.find(a=>a.id===activeAccount)?.startingBalance||0);
  const currentBalance = startingBalance + totalPnl;
  const profitFactor=losses.length?parseFloat(Math.abs(wins.reduce((a,t)=>a+t.pnl,0)/(losses.reduce((a,t)=>a+t.pnl,0)||1)).toFixed(2)):0;
  const equity=buildEquity(trades, startingBalance);

  const [selectedDay,setSelectedDay]=useState(null);
  const [editMode,setEditMode]=useState(false);
  const [saveStatus,setSaveStatus]=useState("saved");
  const [dragWidget,setDragWidget]=useState(null);
  const [dragOver,setDragOver]=useState(null);
  const [expandedWidget,setExpandedWidget]=useState(null);

  // Listen for edit toggle from header button
  useEffect(()=>{
    const handler=()=>setEditMode(e=>!e);
    document.addEventListener("tca-toggle-edit",handler);
    return()=>document.removeEventListener("tca-toggle-edit",handler);
  },[]);

  // Grid: 6 slots below the fixed header (2 cols x 3 rows)
  const LAYOUT_KEY="tca_grid_layout_v4";
  const DEFAULT_LAYOUT=["calendar","equity","session","setups","timeof",null];
  const [layout,setLayout]=useState(DEFAULT_LAYOUT);
  const [loaded,setLoaded]=useState(false);

  useEffect(()=>{
    if(!session?.user?.id)return;
    // Load instantly from localStorage, then sync latest from Supabase
    try{
      const local=localStorage.getItem(`pref_${LAYOUT_KEY}`);
      if(local){
        const parsed=JSON.parse(local);
        if(Array.isArray(parsed)){
          const padded=[...parsed];
          while(padded.length<6)padded.push(null);
          setLayout(padded.slice(0,6));
        }
      }
    }catch(e){}
    // Then fetch latest from Supabase (may override local if newer)
    (async()=>{
      try{
        const val=await getPref(session.user.id, LAYOUT_KEY);
        if(val){
          const parsed=JSON.parse(val);
          if(Array.isArray(parsed)){
            const padded=[...parsed];
            while(padded.length<6)padded.push(null);
            setLayout(padded.slice(0,6));
          }
        }
      }catch(e){}
      setLoaded(true);
    })();
  },[session]);

  const persist=(newLayout)=>{
    setSaveStatus("saving");
    if(!session?.user?.id){setSaveStatus("unsaved");return;}
    setPref(session.user.id, LAYOUT_KEY, JSON.stringify(newLayout))
      .then(()=>setSaveStatus("saved"))
      .catch(()=>setSaveStatus("unsaved"));
  };

  const updateLayout=(nl)=>{setLayout(nl);persist(nl);};
  const removeFromSlot=(i)=>{const n=[...layout];n[i]=null;updateLayout(n);};
  const addToSlot=(i,wid)=>{
    const n=[...layout];
    const ex=n.indexOf(wid);
    if(ex!==-1)n[ex]=null;
    n[i]=wid;
    updateLayout(n);
  };

  const handleSlotDragStart=(e,i)=>{
    if(!layout[i])return;
    setDragWidget({type:"slot",idx:i,wid:layout[i]});
    e.dataTransfer.effectAllowed="move";
  };
  const handleSlotDrop=(e,target)=>{
    e.preventDefault();
    if(!dragWidget)return;
    if(dragWidget.type==="slot"){
      const n=[...layout];
      [n[dragWidget.idx],n[target]]=[n[target],n[dragWidget.idx]];
      updateLayout(n);
    }else if(dragWidget.type==="picker"){
      addToSlot(target,dragWidget.wid);
    }
    setDragWidget(null);setDragOver(null);
  };

  const ALL_WIDGETS=[
    {id:"equity",     label:"Equity Curve",        icon:"📈"},
    {id:"dailypnl",   label:"Daily P&L",            icon:"📊"},
    {id:"setups",     label:"Setup Performance",    icon:"🏆"},
    {id:"session",    label:"Session Heatmap",      icon:"🌡️"},
    {id:"timeof",     label:"Time of Day",          icon:"🕐"},
    {id:"cumulative", label:"Daily & Cumulative",   icon:"📉"},
    {id:"drawdown",   label:"Drawdown",             icon:"⚠️"},
    {id:"winAvg",     label:"Win%/Avg Win/Loss",    icon:"💹"},
    {id:"duration",   label:"Trade Duration",       icon:"⏱️"},
    {id:"leaderboard",label:"Setup Leaderboard",    icon:"🥇"},
    {id:"yearly",     label:"Yearly Calendar",      icon:"🗓️"},
    {id:"progress",   label:"Progress Tracker",     icon:"✅"},
    {id:"report",     label:"Report",               icon:"📋"},
    {id:"aicoach",    label:"AI Trade Coach",       icon:"🧠"},
    {id:"calendar",   label:"Calendar (main)",      icon:"[ ]"},
    {id:"dailygoals", label:"Daily Goals",           icon:"🎯"},
    {id:"apex",       label:"Apex Account Tracker",  icon:"📈"},
    {id:"ictags",     label:"ICT Concept Tagger",    icon:"🧠"},
    {id:"emotions",   label:"Emotional Tracker",     icon:"😤"},
    {id:"achievements",label:"Achievements",          icon:"🏆"},
    {id:"patterns",   label:"Recurring Patterns AI",   icon:"🔁"},
  ];

  // Calendar state
  const allDates=trades.map(t=>t.date).sort();
  const latestDate=allDates[allDates.length-1]||new Date().toISOString().slice(0,10);
  const [calYear,setCalYear]=useState(parseInt(latestDate.slice(0,4)));
  const [calMonth,setCalMonth]=useState(parseInt(latestDate.slice(5,7))-1);
  const [manualNav,setManualNav]=useState(false);
  useEffect(()=>{if(manualNav)return;const d=trades.map(t=>t.date).sort();const l=d[d.length-1];if(l){setCalYear(parseInt(l.slice(0,4)));setCalMonth(parseInt(l.slice(5,7))-1);}},[trades,manualNav]);
  const prevMonth=()=>{setManualNav(true);if(calMonth===0){setCalMonth(11);setCalYear(y=>y-1);}else setCalMonth(m=>m-1);};
  const nextMonth=()=>{setManualNav(true);if(calMonth===11){setCalMonth(0);setCalYear(y=>y+1);}else setCalMonth(m=>m+1);};
  const nowDate=new Date();
  const canGoForward=!(calYear===nowDate.getFullYear()&&calMonth===nowDate.getMonth());
  const calMap=buildCalendar(trades);
  const yr=calYear,mo=calMonth;
  const mn=new Date(yr,mo,1).toLocaleString("default",{month:"long",year:"numeric"}).toUpperCase();
  const fd=new Date(yr,mo,1).getDay(),dim=new Date(yr,mo+1,0).getDate();
  const cells=[];for(let i=0;i<fd;i++)cells.push(null);for(let d=1;d<=dim;d++)cells.push(d);
  const weeks=[];for(let i=0;i<cells.length;i+=7)weeks.push(cells.slice(i,i+7));
  const calDays=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const monthKey=`${yr}-${String(mo+1).padStart(2,"0")}`;
  const monthTrades=trades.filter(t=>t.date.startsWith(monthKey));
  const monthPnl=monthTrades.reduce((a,t)=>a+t.pnl,0);
  const greenDays=Object.entries(calMap).filter(([k,v])=>k.startsWith(monthKey)&&v.pnl>0).length;
  const redDays=Object.entries(calMap).filter(([k,v])=>k.startsWith(monthKey)&&v.pnl<0).length;
  const weeklyPnl=weeks.map((week,wi)=>{let wpnl=0,wdays=0;week.forEach(day=>{if(!day)return;const ds=`${yr}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;if(calMap[ds]){wpnl+=calMap[ds].pnl;wdays++;}});return{week:wi+1,pnl:wpnl,days:wdays};});

  const renderCalendar=()=>(
    <div style={{display:"flex",flexDirection:"column",height:"100%"}}>
      {/* Cal header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:14,flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button onClick={prevMonth} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:8,color:B.textMuted,cursor:"pointer",fontSize:16,width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center"}}>‹</button>
          <span style={{fontSize:13,fontWeight:800,background:GL,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",letterSpacing:2,minWidth:160,textAlign:"center"}}>{mn}</span>
          <button onClick={nextMonth} disabled={!canGoForward} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:8,color:!canGoForward?B.textDim:B.textMuted,cursor:!canGoForward?"default":"pointer",fontSize:16,width:28,height:28,display:"flex",alignItems:"center",justifyContent:"center"}}>›</button>
        </div>
        <div style={{display:"flex",gap:14,alignItems:"center",fontSize:11}}>
          <span style={{fontWeight:700,fontFamily:"monospace",color:pnlColor(monthPnl)}}>{fmt(monthPnl)}</span>
          <span style={{color:B.textMuted}}><span style={{color:B.profit,fontWeight:700}}>{greenDays}</span> green · <span style={{color:B.loss,fontWeight:700}}>{redDays}</span> red</span>
        </div>
      </div>
      {/* Cal + weekly sidebar */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 140px",gap:12,flex:1,minHeight:0}}>
        <div style={{display:"flex",flexDirection:"column",minHeight:0}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,marginBottom:6}}>
            {calDays.map(d=><div key={d} style={{textAlign:"center",fontSize:10,color:B.textMuted,letterSpacing:1,paddingBottom:4}}>{d}</div>)}
          </div>
          <div style={{flex:1,display:"flex",flexDirection:"column",gap:4}}>
            {weeks.map((w,wi)=>(
              <div key={wi} style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:4,flex:1}}>
                {w.map((day,di)=>{
                  if(!day)return <div key={di}/>;
                  const ds=`${yr}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
                  const data=calMap[ds];
                  const isToday=ds===new Date().toISOString().slice(0,10);
                  return(
                    <div key={di} onClick={()=>setSelectedDay(ds)} style={{
                      flex:1,minHeight:60,borderRadius:8,padding:"6px 8px",
                      background:data?(data.pnl>0?`${B.teal}12`:`${B.loss}12`):"rgba(255,255,255,0.015)",
                      border:`1px solid ${data?(data.pnl>0?`${B.teal}35`:`${B.loss}35`):B.border}`,
                      outline:isToday?`2px solid ${B.blue}50`:"none",
                      cursor:"pointer",transition:"all 0.15s",
                    }}>
                      <div style={{fontSize:11,color:data?B.text:B.textDim,fontWeight:700,marginBottom:3}}>{day}</div>
                      {data?<>
                        <div style={{fontSize:11,fontWeight:800,fontFamily:"monospace",color:pnlColor(data.pnl),lineHeight:1.2}}>{fmt(data.pnl)}</div>
                        <div style={{fontSize:9,color:B.textMuted,marginTop:2}}>{data.count} trade{data.count>1?"s":""}</div>
                        <div style={{fontSize:9,color:data.pnl>0?B.profit:B.loss}}>{data.pnl>0?"▲":"▼"} {Math.round(data.count>0?100:0)}%</div>
                      </>:<div style={{fontSize:8,color:B.textDim,marginTop:4,lineHeight:1.4}}>click to<br/>journal</div>}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
        {/* Weekly P&L sidebar */}
        <div style={{display:"flex",flexDirection:"column",gap:6}}>
          <div style={{fontSize:9,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:2}}>Weekly P&L</div>
          {weeklyPnl.map(w=>(
            <div key={w.week} style={{
              flex:1,background:"rgba(0,0,0,0.3)",
              border:`1px solid ${w.pnl>0?`${B.teal}30`:w.pnl<0?`${B.loss}30`:B.border}`,
              borderRadius:8,padding:"10px 12px",
              borderLeft:`3px solid ${w.pnl>0?B.teal:w.pnl<0?B.loss:B.border}`
            }}>
              <div style={{fontSize:10,color:B.textMuted,marginBottom:3}}>Week {w.week}</div>
              <div style={{fontSize:14,fontWeight:800,fontFamily:"monospace",color:w.pnl>0?B.profit:w.pnl<0?B.loss:B.textMuted}}>{w.pnl===0?"$0":fmt(w.pnl)}</div>
              <div style={{fontSize:9,color:B.textMuted,marginTop:2}}>{w.days} day{w.days!==1?"s":""}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  const renderWidget=(id)=>{
    if(id==="calendar")return renderCalendar();
    switch(id){
      case "equity": return(
        <div style={{height:"100%",display:"flex",flexDirection:"column"}}>
          <div style={{fontSize:9,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Equity Curve</div>
          <div style={{flex:1}}><ResponsiveContainer width="100%" height="100%"><AreaChart data={equity}><defs><linearGradient id="eqOv" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#00D4A8" stopOpacity={0.25}/><stop offset="100%" stopColor="#8B5CF6" stopOpacity={0}/></linearGradient><linearGradient id="eqLOv" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#00D4A8"/><stop offset="100%" stopColor="#8B5CF6"/></linearGradient></defs><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/><XAxis dataKey="date" tick={{fill:B.textDim,fontSize:8}} axisLine={false} tickLine={false} interval={Math.ceil(equity.length/6)}/><YAxis tick={{fill:B.textDim,fontSize:8}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/><Tooltip content={<CTip/>}/><ReferenceLine y={0} stroke="rgba(255,255,255,0.07)"/><Area type="monotone" dataKey="equity" stroke="url(#eqLOv)" strokeWidth={2} fill="url(#eqOv)" name="Balance"/></AreaChart></ResponsiveContainer></div>
        </div>
      );
      case "dailypnl": return(
        <div style={{height:"100%",display:"flex",flexDirection:"column"}}>
          <div style={{fontSize:9,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Daily P&L</div>
          <div style={{flex:1}}><ResponsiveContainer width="100%" height="100%"><BarChart data={Object.entries(trades.reduce((m,t)=>{m[t.date]=(m[t.date]||0)+t.pnl;return m;},{})).sort((a,b)=>a[0].localeCompare(b[0])).map(([d,p])=>({date:d.slice(5),pnl:Math.round(p*100)/100}))}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false}/><XAxis dataKey="date" tick={{fill:B.textDim,fontSize:8}} axisLine={false} tickLine={false}/><YAxis tick={{fill:B.textDim,fontSize:8}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/><Tooltip content={<CTip/>}/><ReferenceLine y={0} stroke="rgba(255,255,255,0.1)"/><Bar dataKey="pnl" radius={[3,3,0,0]}>{Object.entries(trades.reduce((m,t)=>{m[t.date]=(m[t.date]||0)+t.pnl;return m;},{})).map(([d,p],i)=>(<Cell key={i} fill={p>=0?B.teal:B.loss}/>))}</Bar></BarChart></ResponsiveContainer></div>
        </div>
      );
      case "setups": return(
        <div style={{height:"100%",display:"flex",flexDirection:"column"}}>
          <div style={{fontSize:9,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Setup Performance</div>
          <div style={{flex:1,overflowY:"auto"}}>{Object.entries(trades.reduce((m,t)=>{if(!m[t.setup])m[t.setup]={wins:0,total:0,pnl:0};m[t.setup].total++;m[t.setup].pnl+=t.pnl;if(t.result==="Win")m[t.setup].wins++;return m;},{})).sort((a,b)=>b[1].pnl-a[1].pnl).slice(0,5).map(([s,d],i)=>{const sg=[GL,GTB,GBP,GTB,GL];return(<div key={s} style={{marginBottom:10}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:11,color:B.text}}>{s}</span><span style={{fontSize:11,fontFamily:"monospace",color:pnlColor(d.pnl),fontWeight:700}}>{fmt(d.pnl)}</span></div><div style={{height:4,background:"rgba(255,255,255,0.05)",borderRadius:2}}><div style={{height:"100%",width:Math.round((d.wins/d.total)*100)+"%",background:sg[i],borderRadius:2}}/></div><div style={{fontSize:9,color:B.textMuted,marginTop:2}}>{Math.round((d.wins/d.total)*100)}% WR · {d.total} trades</div></div>);})}</div>
        </div>
      );
      case "session":    return <SessionHeatmapWidget trades={trades}/>;
      case "timeof":     return <TradeTimeWidget trades={trades}/>;
      case "cumulative": return <DailyCumulativeWidget trades={trades}/>;
      case "drawdown":   return <DrawdownWidget trades={trades}/>;
      case "winAvg":     return <WinAvgWidget trades={trades}/>;
      case "duration":   return <TradeDurationWidget trades={trades}/>;
      case "leaderboard":return <SetupLeaderboardWidget trades={trades}/>;
      case "yearly":     return <YearlyCalendarWidget trades={trades}/>;
      case "progress":   return <ProgressTrackerWidget trades={trades}/>;
      case "report":     return <ReportWidget trades={trades}/>;
      case "aicoach":    return <AICoachWidget trades={trades} session={session}/>;
      case "dailygoals": return <DailyGoalsWidget trades={trades} session={session}/>;
      case "apex":       return <ApexTrackerWidget trades={trades} session={session}/>;
      case "ictags":     return <ICTTaggerWidget trades={trades} session={session}/>;
      case "emotions":   return <EmotionalTrackerWidget trades={trades} session={session}/>;
      case "achievements":return <AchievementsWidget trades={trades} session={session}/>;
      case "patterns":   return <RecurringPatternsWidget trades={trades} session={session}/>;
      default: return null;
    }
  };

  // Grid layout: slot 0+1 = top row (each 50%), slots 2-5 = bottom 2x2
  // But we use a flexible 2-col layout where calendar can be big
  const SLOT_HEIGHTS=[460,460,300,300,300,300];
  // Slots 0-1 side by side, slots 2-3 side by side, slots 4-5 side by side

  if(!trades.length)return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:400,gap:16}}>
      <TCAIcon size={64}/>
      <div style={{fontSize:15,color:B.textMuted}}>No trades yet. Log your first trade or import a CSV.</div>
    </div>
  );

  return(
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      {selectedDay&&<DayJournalModal date={selectedDay} trades={trades} onClose={()=>setSelectedDay(null)} onGradeUpdate={onGradeUpdate} onEdit={onEdit}/>}

      {/* ── WIDGET POPOUT MODAL ── */}
      {expandedWidget&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:150,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(6px)"}}
          onClick={()=>setExpandedWidget(null)}>
          <div style={{background:"#13121A",border:`1px solid ${B.border}`,borderRadius:20,width:"75vw",maxWidth:1100,maxHeight:"82vh",overflow:"hidden",display:"flex",flexDirection:"column"}}
            onClick={e=>e.stopPropagation()}>
            {/* Popout header */}
            <div style={{height:3,background:GL,borderRadius:"20px 20px 0 0",flexShrink:0}}/>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"16px 22px",borderBottom:`1px solid ${B.border}`,flexShrink:0}}>
              <div style={{fontSize:15,fontWeight:700,color:B.text}}>
                {{"gauges":"🎯 Performance Gauges","calendar":"[ ] Calendar","equity":"📈 Equity Curve","dailypnl":"📊 Daily P&L","setups":"🏆 Setup Performance","session":"🌡️ Session Heatmap","timeof":"🕐 Time of Day","cumulative":"📉 Daily & Cumulative","drawdown":"⚠️ Drawdown","winAvg":"💹 Win% / Avg Win / Loss","duration":"⏱️ Trade Duration","leaderboard":"🥇 Setup Leaderboard","yearly":"🗓️ Yearly Calendar","progress":"✅ Progress Tracker","report":"📋 Report","aicoach":"🧠 AI Trade Coach"}[expandedWidget]||expandedWidget}
              </div>
              <button onClick={()=>setExpandedWidget(null)} style={{background:"rgba(255,255,255,0.05)",border:`1px solid ${B.border}`,borderRadius:8,color:B.textMuted,cursor:"pointer",fontSize:18,width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
            </div>
            {/* Popout content */}
            <div style={{flex:1,overflowY:"auto",padding:24,minHeight:400}}>
              {renderWidget(expandedWidget)}
            </div>
          </div>
        </div>
      )}

      {/* ── PINNED STAT ROW — always visible ── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",gap:12}}>
        {/* Account Balance */}
        <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:"14px 18px",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:GTB}}/>
          <div style={{fontSize:10,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:8}}>Account Balance</div>
          {/* Current balance = starting + P&L */}
          {startingBalance>0&&(
            <div style={{fontSize:22,fontWeight:800,color:pnlColor(currentBalance),fontFamily:"monospace",letterSpacing:-1,marginBottom:2}}>
              {fmt(currentBalance)}
            </div>
          )}
          {/* Net P&L */}
          <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
            <div style={{fontSize:startingBalance>0?13:24,fontWeight:startingBalance>0?600:800,color:pnlColor(totalPnl),fontFamily:"monospace"}}>
              {startingBalance>0?"P&L: ":""}{fmt(totalPnl)}
            </div>
          </div>
          {/* Starting balance editor */}
          <div style={{display:"flex",alignItems:"center",gap:6,marginTop:4}}>
            <div style={{fontSize:9,color:B.textDim,flexShrink:0}}>Start:</div>
            <input
              type="number"
              value={(()=>{
                if(activeAccount==="all") return "";
                return accounts.find(a=>a.id===activeAccount)?.startingBalance||"";
              })()}
              onChange={e=>{
                if(activeAccount==="all") return;
                const val = parseFloat(e.target.value)||0;
                setAccounts(prev=>prev.map(a=>a.id===activeAccount?{...a,startingBalance:val}:a));
              }}
              placeholder={activeAccount==="all"?"Select account":"e.g. 50000"}
              disabled={activeAccount==="all"}
              style={{flex:1,background:"rgba(0,0,0,0.3)",border:`1px solid ${B.border}`,borderRadius:6,
                padding:"3px 8px",color:B.text,fontSize:11,outline:"none",
                opacity:activeAccount==="all"?0.4:1}}
            />
          </div>
          <div style={{fontSize:10,color:B.textMuted,marginTop:4}}>{trades.length} trades total</div>
        </div>

        {/* Win % gauge */}
        <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <GaugeChart value={winRate} label="Trade Win %" color={winRate>=50?B.profit:B.loss}/>
        </div>
        {/* Profit factor gauge */}
        <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <GaugeChart value={profitFactor} max={3} label="Profit Factor" color={profitFactor>=1?B.teal:B.loss}/>
        </div>
        {/* Day win % gauge */}
        <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <GaugeChart value={(()=>{const td=Object.values(calMap);const g=td.filter(d=>d.pnl>0).length;return td.length?Math.round((g/td.length)*100):0;})()} label="Day Win %" color={B.blue}/>
        </div>
        {/* Streak */}
        <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:"12px 16px",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <StreakBadge trades={trades}/>
        </div>
      </div>

      {/* Edit mode banner */}
      {editMode&&(
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 16px",borderRadius:12,background:`${B.teal}08`,border:`1px solid ${B.borderTeal}`}}>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{width:6,height:6,borderRadius:"50%",background:saveStatus==="saved"?B.teal:B.blue}}/>
            <span style={{fontSize:12,color:B.teal,fontWeight:600}}>{saveStatus==="saved"?"Layout saved":"Saving..."}</span>
            <span style={{fontSize:11,color:B.textMuted}}>· Drag to swap · Click + to add · Remove to clear</span>
          </div>
          <button onClick={()=>setEditMode(false)} style={{padding:"6px 16px",borderRadius:8,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:12,fontWeight:800}}>✓ Done</button>
        </div>
      )}

      {/* ── WIDGET GRID ── 2 columns, 3 rows */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        {[0,1,2,3,4,5].map(slotIdx=>{
          const wid=layout[slotIdx];
          const isEmpty=!wid;
          const isDragTarget=dragOver===slotIdx;
          const h=SLOT_HEIGHTS[slotIdx];

          return(
            <div key={slotIdx}
              onDragOver={e=>{e.preventDefault();setDragOver(slotIdx);}}
              onDragLeave={()=>setDragOver(null)}
              onDrop={e=>handleSlotDrop(e,slotIdx)}
              style={{height:h}}
            >
              {isEmpty?(
                editMode?(
                  <div onClick={()=>setDragWidget({type:"picker",slotIdx})}
                    style={{
                      height:"100%",borderRadius:14,
                      border:`2px dashed ${isDragTarget?B.teal:"rgba(255,255,255,0.15)"}`,
                      background:isDragTarget?`${B.teal}08`:"rgba(255,255,255,0.02)",
                      display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",
                      gap:8,cursor:"pointer",transition:"all 0.2s",
                    }}>
                    <div style={{width:40,height:40,borderRadius:"50%",border:"2px dashed rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center"}}>
                      <span style={{fontSize:22,color:B.textDim}}>+</span>
                    </div>
                    <span style={{fontSize:11,color:B.textDim}}>Click to add widget</span>
                  </div>
                ):null
              ):(
                <div style={{position:"relative",height:"100%"}}>
                  {editMode&&(
                    <div style={{position:"absolute",inset:0,zIndex:20,borderRadius:14,border:`2px solid ${B.teal}50`,background:"rgba(0,0,0,0.12)",display:"flex",alignItems:"flex-start",justifyContent:"flex-end",padding:10,pointerEvents:"none"}}>
                      <div style={{display:"flex",gap:6,pointerEvents:"auto"}}>
                        <div draggable onDragStart={e=>handleSlotDragStart(e,slotIdx)}
                          style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${B.border}`,background:"rgba(0,0,0,0.7)",color:B.textMuted,cursor:"grab",fontSize:10}}>⠿ move</div>
                        <button onClick={()=>removeFromSlot(slotIdx)}
                          style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${B.loss}50`,background:`${B.loss}20`,color:B.loss,cursor:"pointer",fontSize:10,fontWeight:700}}>Remove</button>
                      </div>
                    </div>
                  )}
  <div
                    onClick={()=>!editMode&&wid!=="calendar"&&setExpandedWidget(wid)}
                    style={{height:"100%",borderRadius:14,background:B.surface,border:`1px solid ${B.border}`,padding:20,overflow:"hidden",cursor:editMode||wid==="calendar"?"default":"pointer",transition:"border-color 0.15s"}}
                    onMouseEnter={e=>{if(!editMode&&wid!=="calendar")e.currentTarget.style.borderColor=B.teal+"60";}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor=B.border;}}
                  >
                    {!editMode&&wid!=="calendar"&&<div style={{position:"absolute",top:10,right:10,zIndex:5,opacity:0,transition:"opacity 0.2s"}}
                      onMouseEnter={e=>e.currentTarget.style.opacity=1}
                      className="expand-hint">
                      <div style={{padding:"2px 7px",borderRadius:5,background:"rgba(0,0,0,0.7)",border:`1px solid ${B.border}`,fontSize:9,color:B.textMuted}}>⤢ expand</div>
                    </div>}
                    {renderWidget(wid)}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Widget picker */}
      {editMode&&dragWidget?.type==="picker"&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:150,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)"}}
          onClick={()=>setDragWidget(null)}>
          <div style={{background:"#13121A",border:`1px solid ${B.border}`,borderRadius:20,width:600,maxHeight:"80vh",overflowY:"auto"}}
            onClick={e=>e.stopPropagation()}>
            <div style={{height:3,background:GL,borderRadius:"20px 20px 0 0"}}/>
            <div style={{padding:"22px 28px 0",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
              <div>
                <div style={{fontSize:18,fontWeight:800,color:B.text}}>Choose a Widget</div>
                <div style={{fontSize:12,color:B.textMuted,marginTop:3}}>Select a widget for this slot</div>
              </div>
              <button onClick={()=>setDragWidget(null)} style={{background:"rgba(255,255,255,0.05)",border:`1px solid ${B.border}`,borderRadius:8,color:B.textMuted,cursor:"pointer",fontSize:18,width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
            </div>
            <div style={{padding:"0 28px 28px",display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              {ALL_WIDGETS.map(w=>{
                const placed=layout.includes(w.id);
                return(
                  <div key={w.id} onClick={()=>{if(!placed){addToSlot(dragWidget.slotIdx,w.id);setDragWidget(null);}}}
                    style={{padding:"12px 14px",borderRadius:10,cursor:placed?"not-allowed":"pointer",
                      background:placed?"rgba(255,255,255,0.02)":B.surface,
                      border:`1px solid ${B.border}`,opacity:placed?0.4:1,
                      display:"flex",alignItems:"center",gap:10,transition:"all 0.15s"}}
                    onMouseEnter={e=>{if(!placed)e.currentTarget.style.borderColor=B.teal;e.currentTarget.style.background=placed?"":"rgba(0,212,168,0.05)";}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor=B.border;e.currentTarget.style.background=placed?"rgba(255,255,255,0.02)":B.surface;}}>
                    <span style={{fontSize:20}}>{w.icon}</span>
                    <div>
                      <div style={{fontSize:12,fontWeight:700,color:B.text}}>{w.label}</div>
                      {placed&&<div style={{fontSize:10,color:B.textMuted}}>Already placed</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function Journal({trades,onEdit,onDelete,onGradeUpdate}){
  const [selectedTrade,setSelectedTrade]=useState(null);
  const [filterInst,setFilterInst]=useState("All");
  const [filterResult,setFilterResult]=useState("All");
  const [filterGrade,setFilterGrade]=useState("All");
  const [filterSession,setFilterSession]=useState("All");
  const [filterSetup,setFilterSetup]=useState("All");
  const [filterAccount,setFilterAccount]=useState("All");
  const [sort,setSort]=useState("date");
  const [sortDir,setSortDir]=useState("desc");
  const [search,setSearch]=useState("");

  const insts=["All",...[...new Set(trades.map(t=>t.instrument))]];
  const setups=["All",...[...new Set(trades.map(t=>t.setup).filter(Boolean))]];
  const accounts=["All",...[...new Set(trades.map(t=>t.account_id).filter(Boolean))]];

  const filtered=trades.filter(t=>{
    if(filterInst!=="All"&&t.instrument!==filterInst)return false;
    if(filterResult!=="All"&&t.result!==filterResult)return false;
    if(filterGrade!=="All"&&t.grade!==filterGrade)return false;
    if(filterSession!=="All"&&t.session!==filterSession)return false;
    if(filterSetup!=="All"&&t.setup!==filterSetup)return false;
    if(filterAccount!=="All"&&t.account_id!==filterAccount)return false;
    if(search){
      const s=search.toLowerCase();
      if(!t.instrument?.toLowerCase().includes(s)&&
         !t.setup?.toLowerCase().includes(s)&&
         !t.notes?.toLowerCase().includes(s)&&
         !t.date?.includes(s))return false;
    }
    return true;
  });

  const sortFns={
    date:(a,b)=>sortDir==="desc"?b.date.localeCompare(a.date):a.date.localeCompare(b.date),
    pnl:(a,b)=>sortDir==="desc"?b.pnl-a.pnl:a.pnl-b.pnl,
    grade:(a,b)=>{const g=["A+","A","B","C","D"];return sortDir==="desc"?g.indexOf(a.grade)-g.indexOf(b.grade):g.indexOf(b.grade)-g.indexOf(a.grade);},
    rr:(a,b)=>{const rv=v=>parseFloat((v||"0").toString().replace("R",""))||0;return sortDir==="desc"?rv(b.rr)-rv(a.rr):rv(a.rr)-rv(b.rr);},
  };
  const sorted=[...filtered].sort(sortFns[sort]||sortFns.date);
  const activeFilters=[filterInst!=="All",filterResult!=="All",filterGrade!=="All",filterSession!=="All",filterSetup!=="All",filterAccount!=="All",search].filter(Boolean).length;
  if(!trades.length)return(<div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:400,gap:16}}><TCAIcon size={64}/><div style={{fontSize:15,color:B.textMuted}}>No trades yet.</div></div>);
  return(<div style={{display:"flex",flexDirection:"column",gap:16}}>{selectedTrade&&<TradeDetailModal trade={selectedTrade} onClose={()=>setSelectedTrade(null)} onEdit={t=>{onEdit(t);setSelectedTrade(null);}} onGradeUpdate={onGradeUpdate}/>}<div style={{display:"flex",flexDirection:"column",gap:10}}>
    {/* Search bar */}
    <div style={{display:"flex",gap:8,alignItems:"center"}}>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="🔍 Search trades by setup, notes, date..." style={{...iS,flex:1,padding:"8px 14px",fontSize:12}}/>
      {activeFilters>0&&<button onClick={()=>{setFilterInst("All");setFilterResult("All");setFilterGrade("All");setFilterSession("All");setFilterSetup("All");setFilterAccount("All");setSearch("");}} style={{padding:"7px 12px",borderRadius:8,border:`1px solid ${B.loss}40`,background:`${B.loss}12`,color:B.loss,cursor:"pointer",fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>✕ Clear {activeFilters} filter{activeFilters!==1?"s":""}</button>}
      <div style={{fontSize:11,color:B.textMuted,whiteSpace:"nowrap"}}>{sorted.length}/{trades.length} trades</div>
    </div>
    {/* Filter rows */}
    <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
      <span style={{fontSize:10,color:B.textMuted,letterSpacing:1}}>INSTRUMENT</span>
      {insts.map(i=>(<button key={i} onClick={()=>setFilterInst(i)} style={{padding:"4px 12px",borderRadius:20,border:"1px solid",borderColor:filterInst===i?B.teal:B.border,background:filterInst===i?`${B.teal}18`:"transparent",color:filterInst===i?B.teal:B.textMuted,cursor:"pointer",fontSize:11,fontWeight:700}}>{i}</button>))}
      <span style={{fontSize:10,color:B.textMuted,letterSpacing:1,marginLeft:8}}>RESULT</span>
      {["All","Win","Loss"].map(r=>(<button key={r} onClick={()=>setFilterResult(r)} style={{padding:"4px 12px",borderRadius:20,border:"1px solid",borderColor:filterResult===r?(r==="Win"?B.profit:r==="Loss"?B.loss:B.teal):B.border,background:filterResult===r?(r==="Win"?`${B.profit}18`:r==="Loss"?`${B.loss}18`:`${B.teal}18`):"transparent",color:filterResult===r?(r==="Win"?B.profit:r==="Loss"?B.loss:B.teal):B.textMuted,cursor:"pointer",fontSize:11,fontWeight:700}}>{r}</button>))}
      <span style={{fontSize:10,color:B.textMuted,letterSpacing:1,marginLeft:8}}>GRADE</span>
      {["All","A+","A","B","C","D"].map(g=>(<button key={g} onClick={()=>setFilterGrade(g)} style={{padding:"4px 10px",borderRadius:20,border:"1px solid",borderColor:filterGrade===g?(GRADE_COLOR[g]||B.teal):B.border,background:filterGrade===g?`${GRADE_COLOR[g]||B.teal}18`:"transparent",color:filterGrade===g?(GRADE_COLOR[g]||B.teal):B.textMuted,cursor:"pointer",fontSize:11,fontWeight:700}}>{g}</button>))}
    </div>
    <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
      <span style={{fontSize:10,color:B.textMuted,letterSpacing:1}}>SESSION</span>
      {["All","AM","Mid","PM","After"].map(s=>(<button key={s} onClick={()=>setFilterSession(s)} style={{padding:"4px 12px",borderRadius:20,border:"1px solid",borderColor:filterSession===s?B.blue:B.border,background:filterSession===s?`${B.blue}18`:"transparent",color:filterSession===s?B.blue:B.textMuted,cursor:"pointer",fontSize:11,fontWeight:700}}>{s}</button>))}
      <span style={{fontSize:10,color:B.textMuted,letterSpacing:1,marginLeft:8}}>SORT</span>
      {[{k:"date",l:"Date"},{k:"pnl",l:"P&L"},{k:"grade",l:"Grade"},{k:"rr",l:"R:R"}].map(s=>(<button key={s.k} onClick={()=>{if(sort===s.k)setSortDir(d=>d==="desc"?"asc":"desc");else{setSort(s.k);setSortDir("desc");}}} style={{padding:"4px 12px",borderRadius:20,border:"1px solid",borderColor:sort===s.k?B.purple:B.border,background:sort===s.k?`${B.purple}18`:"transparent",color:sort===s.k?B.purple:B.textMuted,cursor:"pointer",fontSize:11,fontWeight:700}}>{s.l}{sort===s.k?(sortDir==="desc"?" ↓":" ↑"):""}</button>))}
    </div>
  </div><div style={{display:"grid",gridTemplateColumns:"70px 72px 68px 52px 110px 72px 56px 56px 1fr 78px",padding:"8px 14px",fontSize:10,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",borderBottom:`1px solid ${B.border}`}}>{["Date","Symbol","Dir","Grade","Setup","P&L","R:R","Result","Notes",""].map((h,i)=><div key={i}>{h}</div>)}</div><div style={{display:"flex",flexDirection:"column",gap:4}}>{sorted.map(t=>(<div key={t.id} onClick={()=>setSelectedTrade(t)} style={{display:"grid",gridTemplateColumns:"70px 72px 68px 52px 110px 72px 56px 56px 1fr 78px",padding:"11px 14px",borderRadius:10,background:B.surface,border:`1px solid ${B.border}`,borderLeft:`3px solid ${t.result==="Win"?B.teal:B.loss}`,cursor:"pointer",transition:"background 0.15s"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"} onMouseLeave={e=>e.currentTarget.style.background=B.surface}><div style={{fontSize:11,color:B.textMuted}}>{t.date.slice(5)}</div><div><span style={{fontSize:11,padding:"2px 7px",borderRadius:5,fontWeight:700,background:`${INST_COLOR[t.instrument]||B.teal}20`,color:INST_COLOR[t.instrument]||B.teal}}>{t.instrument}</span></div><div style={{fontSize:12,color:t.direction==="Long"?"#4ade80":"#f87171"}}>{t.direction}</div><GradeBadge grade={t.grade||"B"} tradeId={t.id} onSave={g=>onGradeUpdate&&onGradeUpdate(t.id,g)} size="small"/><div style={{fontSize:11,color:"#9CA0BC",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{t.setup}</div><div style={{fontSize:13,fontWeight:800,fontFamily:"monospace",color:pnlColor(t.pnl)}}>{fmt(t.pnl)}</div><div style={{fontSize:11,fontFamily:"monospace",color:B.textMuted}}>{t.rr}</div><div style={{fontSize:11,fontWeight:700,color:t.result==="Win"?B.profit:B.loss}}>{t.result}</div><div style={{fontSize:11,color:B.textDim,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{t.notes}</div><div style={{display:"flex",gap:5}}><button onClick={()=>onEdit(t)} style={{padding:"4px 8px",borderRadius:6,border:`1px solid ${B.blue}40`,background:`${B.blue}12`,color:B.blue,cursor:"pointer",fontSize:10,fontWeight:700}}>Edit</button><button onClick={()=>onDelete(t)} style={{padding:"4px 8px",borderRadius:6,border:`1px solid ${B.loss}40`,background:`${B.loss}12`,color:B.loss,cursor:"pointer",fontSize:10,fontWeight:700}}>Del</button></div></div>))}</div></div>);
}

function Analytics({trades}){
  const wins=trades.filter(t=>t.result==="Win");
  const losses=trades.filter(t=>t.result==="Loss");
  if(trades.length<2)return(<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:300,color:B.textMuted,fontSize:14}}>Add more trades to see analytics.</div>);

  // Core calculations
  const groupBy=k=>trades.reduce((m,t)=>{if(!m[t[k]])m[t[k]]={wins:0,total:0,pnl:0};m[t[k]].total++;m[t[k]].pnl+=t.pnl;if(t.result==="Win")m[t[k]].wins++;return m;},{});
  const byInst=groupBy("instrument"),bySess=groupBy("session"),byDay=groupBy("day"),byGrade=groupBy("grade"),byContracts=groupBy("contracts");
  const dOrder=["Mon","Tue","Wed","Thu","Fri"],dayData=dOrder.filter(d=>byDay[d]).map(d=>({day:d,...byDay[d]}));
  const gOrder=["A+","A","B","C","D"],gradeData=gOrder.filter(g=>byGrade[g]).map(g=>({grade:g,...byGrade[g]}));
  const grossWin=wins.reduce((a,t)=>a+t.pnl,0);
  const grossLoss=Math.abs(losses.reduce((a,t)=>a+t.pnl,0));
  const pf=grossLoss?Math.abs(grossWin/grossLoss).toFixed(2):"N/A";
  const equity=buildEquity(trades, startingBalance);
  const maxDD=(()=>{let pk=0,dd=0,r=0;equity.forEach(e=>{r=e.equity;if(r>pk)pk=r;const d=pk-r;if(d>dd)dd=d;});return Math.round(dd);})();
  const exp=Math.round(trades.reduce((a,t)=>a+t.pnl,0)/trades.length);
  const avgWin=wins.length?Math.round(grossWin/wins.length):0;
  const avgLoss=losses.length?Math.round(grossLoss/losses.length):0;
  const winRate=Math.round((wins.length/trades.length)*100);
  const breakEvenWR=avgWin+avgLoss>0?Math.round((avgLoss/(avgWin+avgLoss))*100):50;

  // Monthly P&L
  const monthMap={};
  trades.forEach(t=>{
    const m=t.date.slice(0,7);
    if(!monthMap[m])monthMap[m]={pnl:0,wins:0,total:0};
    monthMap[m].pnl+=t.pnl;monthMap[m].total++;
    if(t.result==="Win")monthMap[m].wins++;
  });
  const monthData=Object.entries(monthMap).sort((a,b)=>a[0].localeCompare(b[0])).map(([m,d])=>({
    month:new Date(m+"-01").toLocaleString("default",{month:"short",year:"2-digit"}),
    pnl:Math.round(d.pnl*100)/100,
    wr:Math.round((d.wins/d.total)*100),
    total:d.total,
  }));

  // Rolling 10-trade win rate
  const sorted=[...trades].sort((a,b)=>a.date.localeCompare(b.date));
  const rollingWR=sorted.slice(9).map((_,i)=>{
    const window=sorted.slice(i,i+10);
    const w=window.filter(t=>t.result==="Win").length;
    return{trade:i+10,wr:Math.round((w/10)*100),date:sorted[i+9].date.slice(5)};
  });

  // P&L distribution buckets
  const bucketSize=25;
  const distMap={};
  trades.forEach(t=>{
    const b=Math.round(t.pnl/bucketSize)*bucketSize;
    const key=`${b}`;
    if(!distMap[key])distMap[key]={bucket:b,count:0,wins:0};
    distMap[key].count++;
    if(t.result==="Win")distMap[key].wins++;
  });
  const distData=Object.values(distMap).sort((a,b)=>a.bucket-b.bucket);

  // Streak analysis
  let curStreak=0,maxWinStreak=0,maxLossStreak=0,curWin=0,curLoss=0;
  let afterLossWins=0,afterLossTotal=0;
  sorted.forEach((t,i)=>{
    if(t.result==="Win"){curWin++;curLoss=0;maxWinStreak=Math.max(maxWinStreak,curWin);}
    else{curLoss++;curWin=0;maxLossStreak=Math.max(maxLossStreak,curLoss);}
    if(i>0&&sorted[i-1].result==="Loss"){afterLossTotal++;if(t.result==="Win")afterLossWins++;}
  });
  const afterLossWR=afterLossTotal?Math.round((afterLossWins/afterLossTotal)*100):null;
  // Current streak
  let streak=0,streakType="";
  for(let i=sorted.length-1;i>=0;i--){
    if(!streakType){streakType=sorted[i].result;streak=1;}
    else if(sorted[i].result===streakType)streak++;
    else break;
  }

  // Contracts analysis
  const contractData=Object.entries(byContracts)
    .sort((a,b)=>parseInt(a[0])-parseInt(b[0]))
    .map(([k,d])=>({contracts:parseInt(k),pnl:Math.round(d.pnl*100)/100,wr:Math.round((d.wins/d.total)*100),total:d.total}));

  const GRADE_COLORS={"A+":B.teal,"A":B.blue,"B":B.spark,"C":"#F59E0B","D":B.loss};

  const PBar=({label,data,grads,keyField="name"})=>(<div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:22}}><div style={{fontSize:10,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:18}}>{label}</div>{Object.entries(data).map(([k,d],i)=>{const g=grads[i%grads.length];const maxPnl=Math.max(...Object.values(data).map(x=>Math.abs(x.pnl)),1);return(<div key={k} style={{marginBottom:16}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:7}}><span style={{fontSize:13,color:B.text,fontWeight:600}}>{k}</span><div style={{display:"flex",gap:12}}><span style={{fontSize:11,color:B.textMuted}}>{Math.round((d.wins/d.total)*100)}% WR · {d.total}t</span><span style={{fontSize:12,fontFamily:"monospace",color:pnlColor(d.pnl),fontWeight:700}}>{fmt(d.pnl)}</span></div></div><div style={{height:6,background:"rgba(255,255,255,0.05)",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",width:`${(Math.abs(d.pnl)/maxPnl)*100}%`,background:d.pnl>=0?g:GBP,borderRadius:4,transition:"width 0.8s"}}/></div></div>);})}</div>);

  return(
    <div style={{display:"flex",flexDirection:"column",gap:20}}>

      {/* ── ROW 1: Core stats ── */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:12}}>
        {[
          {label:"Profit Factor",  value:pf,              sub:"Gross win / loss",       grad:GTB, accent:B.teal},
          {label:"Expectancy",     value:`$${exp}`,        sub:"Per trade average",      grad:GBP, accent:B.blue},
          {label:"Avg Win",        value:`$${avgWin}`,     sub:`${wins.length} winners`, grad:GTB, accent:B.profit},
          {label:"Avg Loss",       value:`-$${avgLoss}`,   sub:`${losses.length} losers`,grad:GBP, accent:B.loss},
          {label:"Max Drawdown",   value:`$${maxDD}`,      sub:"Peak to trough",         grad:null,accent:B.loss},
          {label:"Break-even WR",  value:`${breakEvenWR}%`,sub:`You're at ${winRate}%`,  grad:null,accent:winRate>=breakEvenWR?B.teal:B.loss},
        ].map(s=><StatCard key={s.label} label={s.label} value={s.value} sub={s.sub} grad={s.grad} accent={s.accent}/>)}
      </div>

      {/* ── ROW 2: Monthly P&L ── */}
      <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:22}}>
        <div style={{fontSize:10,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:16}}>Monthly P&L Trend</div>
        <ResponsiveContainer width="100%" height={180}>
          <ComposedChart data={monthData}>
            <defs>
              <linearGradient id="monthG" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={B.teal} stopOpacity={0.3}/>
                <stop offset="100%" stopColor={B.teal} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false}/>
            <XAxis dataKey="month" tick={{fill:B.textDim,fontSize:10}} axisLine={false} tickLine={false}/>
            <YAxis yAxisId="l" tick={{fill:B.textDim,fontSize:9}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/>
            <YAxis yAxisId="r" orientation="right" tick={{fill:B.textDim,fontSize:9}} axisLine={false} tickLine={false} tickFormatter={v=>v+"%"} domain={[0,100]}/>
            <Tooltip content={({active,payload,label})=>{
              if(!active||!payload?.length)return null;
              return(<div style={{background:"#16151C",border:`1px solid ${B.border}`,borderRadius:8,padding:"10px 14px",fontSize:12}}>
                <div style={{color:B.textMuted,marginBottom:5}}>{label}</div>
                {payload.map((p,i)=><div key={i} style={{color:p.color,fontFamily:"monospace"}}>{p.name}: {p.value}{p.name==="Win %"?"%":""}</div>)}
              </div>);
            }}/>
            <ReferenceLine yAxisId="l" y={0} stroke="rgba(255,255,255,0.1)"/>
            <Bar yAxisId="l" dataKey="pnl" name="P&L" maxBarSize={36} radius={[4,4,0,0]}>
              {monthData.map((d,i)=><Cell key={i} fill={d.pnl>=0?B.teal:B.loss} fillOpacity={0.85}/>)}
            </Bar>
            <Line yAxisId="r" type="monotone" dataKey="wr" stroke={B.blue} strokeWidth={2} dot={false} name="Win %"/>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* ── ROW 3: Risk/Reward + Rolling WR ── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        {/* Risk/Reward Analysis */}
        <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:22}}>
          <div style={{fontSize:10,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:18}}>Risk / Reward Analysis</div>
          {/* Avg win vs avg loss bar comparison */}
          <div style={{marginBottom:20}}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
              <span style={{fontSize:13,color:B.profit,fontWeight:700}}>Avg Win: ${avgWin}</span>
              <span style={{fontSize:13,color:B.loss,fontWeight:700}}>Avg Loss: -${avgLoss}</span>
            </div>
            <div style={{position:"relative",height:28,borderRadius:6,overflow:"hidden",background:"rgba(255,255,255,0.04)"}}>
              <div style={{position:"absolute",left:0,top:0,bottom:0,width:`${Math.min((avgWin/(avgWin+avgLoss))*100,100)}%`,background:GTB,borderRadius:6,transition:"width 0.8s"}}/>
              <div style={{position:"absolute",right:0,top:0,bottom:0,width:`${Math.min((avgLoss/(avgWin+avgLoss))*100,100)}%`,background:GBP,borderRadius:6}}/>
              <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:700,color:"#fff"}}>
                R:R {avgLoss?Math.round((avgWin/avgLoss)*10)/10:"∞"}:1
              </div>
            </div>
          </div>
          {/* Break-even analysis */}
          <div style={{padding:"12px 14px",borderRadius:10,background:`${winRate>=breakEvenWR?B.teal:B.loss}08`,border:`1px solid ${winRate>=breakEvenWR?B.borderTeal:`${B.loss}30`}`}}>
            <div style={{fontSize:11,color:B.textMuted,marginBottom:4}}>Break-even win rate at your R:R</div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div>
                <span style={{fontSize:22,fontWeight:800,fontFamily:"monospace",color:winRate>=breakEvenWR?B.teal:B.loss}}>{breakEvenWR}%</span>
                <span style={{fontSize:11,color:B.textMuted,marginLeft:8}}>needed</span>
              </div>
              <div style={{textAlign:"right"}}>
                <div style={{fontSize:13,fontWeight:700,color:winRate>=breakEvenWR?B.profit:B.loss}}>You: {winRate}%</div>
                <div style={{fontSize:10,color:B.textMuted}}>{winRate>=breakEvenWR?`+${winRate-breakEvenWR}% buffer`:`${breakEvenWR-winRate}% below`}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Rolling Win Rate */}
        <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:22}}>
          <div style={{fontSize:10,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>Rolling Win Rate (10-trade window)</div>
          <div style={{fontSize:11,color:B.textMuted,marginBottom:14}}>Shows if you're improving over time</div>
          {rollingWR.length<2?(
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:140,color:B.textMuted,fontSize:12}}>Need 10+ trades</div>
          ):(
            <ResponsiveContainer width="100%" height={160}>
              <AreaChart data={rollingWR}>
                <defs>
                  <linearGradient id="rwG" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={B.blue} stopOpacity={0.3}/>
                    <stop offset="100%" stopColor={B.blue} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/>
                <XAxis dataKey="date" tick={{fill:B.textDim,fontSize:8}} axisLine={false} tickLine={false} interval={Math.ceil(rollingWR.length/6)}/>
                <YAxis tick={{fill:B.textDim,fontSize:9}} axisLine={false} tickLine={false} tickFormatter={v=>v+"%"} domain={[0,100]}/>
                <Tooltip content={({active,payload,label})=>{
                  if(!active||!payload?.length)return null;
                  return(<div style={{background:"#16151C",border:`1px solid ${B.border}`,borderRadius:8,padding:"8px 12px",fontSize:12}}>
                    <div style={{color:B.textMuted}}>{label}</div>
                    <div style={{color:B.blue,fontFamily:"monospace",fontWeight:700}}>{payload[0]?.value}% WR</div>
                  </div>);
                }}/>
                <ReferenceLine y={50} stroke="rgba(255,255,255,0.15)" strokeDasharray="4 4"/>
                <ReferenceLine y={breakEvenWR} stroke={B.teal} strokeDasharray="4 4" label={{value:`BE:${breakEvenWR}%`,fill:B.teal,fontSize:9}}/>
                <Area type="monotone" dataKey="wr" stroke={B.blue} fill="url(#rwG)" strokeWidth={2} dot={false} name="Win Rate"/>
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── ROW 4: P&L Distribution + Streak Analysis ── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        {/* P&L Distribution */}
        <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:22}}>
          <div style={{fontSize:10,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>P&L Distribution</div>
          <div style={{fontSize:11,color:B.textMuted,marginBottom:14}}>Frequency of trade outcomes by P&L range</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={distData} barSize={16}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false}/>
              <XAxis dataKey="bucket" tick={{fill:B.textDim,fontSize:8}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/>
              <YAxis tick={{fill:B.textDim,fontSize:9}} axisLine={false} tickLine={false}/>
              <Tooltip content={({active,payload})=>{
                if(!active||!payload?.length)return null;
                const d=payload[0]?.payload;
                return(<div style={{background:"#16151C",border:`1px solid ${B.border}`,borderRadius:8,padding:"8px 12px",fontSize:12}}>
                  <div style={{color:B.textMuted}}>Range: ~${d.bucket}</div>
                  <div style={{color:B.text,fontWeight:700}}>{d.count} trade{d.count!==1?"s":""}</div>
                </div>);
              }}/>
              <ReferenceLine x={0} stroke="rgba(255,255,255,0.15)"/>
              <Bar dataKey="count" name="Trades" radius={[3,3,0,0]}>
                {distData.map((d,i)=><Cell key={i} fill={d.bucket>=0?B.teal:B.loss} fillOpacity={0.85}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Streak Analysis */}
        <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:22}}>
          <div style={{fontSize:10,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:18}}>Streak & Consecutive Analysis</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
            {[
              {label:"Max Win Streak",  value:maxWinStreak,  color:B.profit, icon:"🔥"},
              {label:"Max Loss Streak", value:maxLossStreak, color:B.loss,   icon:"📉"},
              {label:"Current Streak",  value:`${streak} ${streakType==="Win"?"W":"L"}`, color:streakType==="Win"?B.profit:B.loss, icon:streakType==="Win"?"✅":"⚠️"},
              {label:"After-Loss WR",   value:afterLossWR!==null?`${afterLossWR}%`:"—", color:afterLossWR>=50?B.profit:B.loss, icon:"🔄"},
            ].map(s=>(
              <div key={s.label} style={{padding:"12px 14px",borderRadius:10,background:"rgba(0,0,0,0.3)",border:`1px solid ${s.color}20`}}>
                <div style={{fontSize:18,marginBottom:4}}>{s.icon}</div>
                <div style={{fontSize:11,color:B.textMuted,marginBottom:4}}>{s.label}</div>
                <div style={{fontSize:20,fontWeight:800,color:s.color,fontFamily:"monospace"}}>{s.value}</div>
              </div>
            ))}
          </div>
          {afterLossWR!==null&&(
            <div style={{padding:"10px 14px",borderRadius:8,background:`${afterLossWR>=50?B.teal:B.loss}08`,border:`1px solid ${afterLossWR>=50?B.borderTeal:`${B.loss}30`}`}}>
              <div style={{fontSize:11,color:afterLossWR>=50?B.teal:B.loss}}>
                {afterLossWR>=50
                  ?`✅ You bounce back well — ${afterLossWR}% win rate after a loss`
                  :`⚠️ Caution: only ${afterLossWR}% win rate after a loss — consider taking a break`}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── ROW 5: P&L by Instrument + Session ── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <PBar label="P&L by Instrument" data={byInst} grads={[GL,GTB,GBP]}/>
        <PBar label="P&L by Session" data={bySess} grads={[GTB,GBP,GL]}/>
      </div>

      {/* ── ROW 6: Day of Week + Grade Performance ── */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        {/* Day of week */}
        <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:22}}>
          <div style={{fontSize:10,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:16}}>P&L by Day of Week</div>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={dayData} barSize={44}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false}/>
              <XAxis dataKey="day" tick={{fill:B.textDim,fontSize:12}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fill:B.textDim,fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/>
              <Tooltip content={<CTip/>}/><ReferenceLine y={0} stroke="rgba(255,255,255,0.08)"/>
              <Bar dataKey="pnl" name="P&L" radius={[5,5,0,0]} isAnimationActive>
                {dayData.map((d,i)=><Cell key={i} fill={d.pnl>=0?B.teal:B.loss}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Grade performance */}
        <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:22}}>
          <div style={{fontSize:10,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:16}}>Grade Performance</div>
          {gradeData.length===0?(
            <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:140,color:B.textMuted,fontSize:12}}>No graded trades yet</div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {gradeData.map(g=>{
                const color=GRADE_COLORS[g.grade]||B.textMuted;
                const maxAbs=Math.max(...gradeData.map(x=>Math.abs(x.pnl)),1);
                return(
                  <div key={g.grade}>
                    <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,alignItems:"center"}}>
                      <div style={{display:"flex",gap:8,alignItems:"center"}}>
                        <span style={{width:28,height:28,borderRadius:6,background:`${color}20`,border:`1px solid ${color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color,flexShrink:0}}>{g.grade}</span>
                        <span style={{fontSize:12,color:B.textMuted}}>{g.total} trades · {g.wr}% WR</span>
                      </div>
                      <span style={{fontSize:13,fontWeight:800,fontFamily:"monospace",color:pnlColor(g.pnl)}}>{fmt(g.pnl)}</span>
                    </div>
                    <div style={{height:5,background:"rgba(255,255,255,0.05)",borderRadius:3}}>
                      <div style={{height:"100%",width:`${(Math.abs(g.pnl)/maxAbs)*100}%`,background:g.pnl>=0?`linear-gradient(90deg,${color},${color}90)`:GBP,borderRadius:3,transition:"width 0.8s"}}/>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* ── ROW 7: Contracts Size Analysis ── */}
      {contractData.length>1&&(
        <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:22}}>
          <div style={{fontSize:10,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>Contracts Size Analysis</div>
          <div style={{fontSize:11,color:B.textMuted,marginBottom:16}}>How your performance changes as you scale</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10}}>
            {contractData.map(c=>(
              <div key={c.contracts} style={{padding:"14px 16px",borderRadius:12,background:"rgba(0,0,0,0.3)",border:`1px solid ${c.pnl>=0?`${B.teal}25`:B.border}`,position:"relative",overflow:"hidden"}}>
                <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:c.pnl>=0?GTB:GBP}}/>
                <div style={{fontSize:22,fontWeight:800,color:B.textMuted,marginBottom:4}}>{c.contracts}<span style={{fontSize:12}}> ct</span></div>
                <div style={{fontSize:14,fontWeight:800,fontFamily:"monospace",color:pnlColor(c.pnl),marginBottom:2}}>{fmt(c.pnl)}</div>
                <div style={{fontSize:10,color:B.textMuted}}>{c.wr}% WR</div>
                <div style={{fontSize:9,color:B.textDim}}>{c.total} trade{c.total!==1?"s":""}</div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}


// ── Strategy Checklist (used inside TradeDetailModal) ────────────────────────
function StrategyChecklist({trade}){
  const [checked,setChecked]=useState(()=>{
    try{return JSON.parse(localStorage.getItem(`tca_tradeck_${trade.id}`)||"{}");}catch(e){return {};}
  });
  try{
    const strats=JSON.parse(localStorage.getItem("tca_strategies_v1")||"[]");
    const strat=strats.find(s=>s.name===trade.setup);
    if(!strat)return null;
    const rules=Array.isArray(strat.rules)?strat.rules:
      (strat.rules?strat.rules.split("\n").filter(Boolean).map((r,i)=>({id:i,text:r})):[]);
    if(!rules.length)return null;
    const toggle=(id)=>{
      const next={...checked,[id]:!checked[id]};
      setChecked(next);
      try{localStorage.setItem(`tca_tradeck_${trade.id}`,JSON.stringify(next));}catch(e){}
    };
    const doneCount=rules.filter((r,i)=>checked[r.id??i]===true).length;
    return(
      <div style={{padding:"0 28px",marginBottom:20}}>
        <div style={{background:"rgba(0,0,0,0.3)",borderRadius:12,padding:"16px 20px",border:`1px solid ${B.borderPurp}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
            <div style={{fontSize:10,color:B.purple,letterSpacing:1.5,textTransform:"uppercase"}}>⚡ {strat.name} — Entry Checklist</div>
            <div style={{fontSize:11,color:doneCount===rules.length?B.teal:B.textMuted,fontWeight:700}}>{doneCount}/{rules.length}</div>
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {rules.map((r,i)=>{
              const id=r.id??i;
              const done=!!checked[id];
              return(
                <div key={id} onClick={()=>toggle(id)} style={{display:"flex",alignItems:"flex-start",gap:10,cursor:"pointer",padding:"6px 0",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                  <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${done?B.teal:B.border}`,background:done?B.teal:"transparent",flexShrink:0,marginTop:1,display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.15s"}}>
                    {done&&<span style={{color:"#0E0E10",fontSize:10,fontWeight:800}}>✓</span>}
                  </div>
                  <div style={{fontSize:12,color:done?B.textMuted:B.text,textDecoration:done?"line-through":"none",lineHeight:1.5}}>{r.text||r}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }catch(e){return null;}
}

function TradeDetailModal({trade, onClose, onEdit, onGradeUpdate}){
  const isWin = trade.result === "Win";
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [screenshot, setScreenshot] = useState(null);
  const [screenshotUrl, setScreenshotUrl] = useState(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const fileInputRef = useRef(null);
  const SCREENSHOT_KEY = `tca_screenshot_${trade.id}`;
  const [tradeTags, setTradeTags] = useState({});

  // Load ICT tags
  useEffect(()=>{
    try{const l=localStorage.getItem("pref_tca_ict_tags_v1");if(l)setTradeTags(JSON.parse(l));}catch(e){}
    (async()=>{try{const{data}=await supabase.from("user_preferences").select("value").eq("key","tca_ict_tags_v1").single();if(data?.value){setTradeTags(JSON.parse(data.value));localStorage.setItem("pref_tca_ict_tags_v1",data.value);}}catch(e){}})();
  },[]);

  // Load existing screenshot from user_preferences (base64)
  useEffect(()=>{
    // Try localStorage first (fast)
    try{const cached=localStorage.getItem(SCREENSHOT_KEY);if(cached){setScreenshotUrl(cached);return;}}catch(e){}
    // Then Supabase
    (async()=>{
      try{
        const{data}=await supabase.from("user_preferences").select("value").eq("key",SCREENSHOT_KEY).single();
        if(data?.value){setScreenshotUrl(data.value);localStorage.setItem(SCREENSHOT_KEY,data.value);}
      }catch(e){}
    })();
  },[trade.id]);

  const uploadScreenshot=async(file)=>{
    if(!file)return;
    setUploadLoading(true);setUploadError(null);
    setScreenshotUrl(null);setScreenshot(null);
    try{
      // Convert to base64 and store in user_preferences - no bucket needed
      const reader=new FileReader();
      reader.onload=async(e)=>{
        const base64=e.target.result;
        setScreenshotUrl(base64);
        setScreenshot(file);
        // Save to localStorage immediately
        try{localStorage.setItem(SCREENSHOT_KEY,base64);}catch(ex){}
        // Save to Supabase
        try{
          const{data:{user}}=await supabase.auth.getUser();
          if(user?.id){
            await supabase.from("user_preferences").upsert(
              {user_id:user.id,key:SCREENSHOT_KEY,value:base64,updated_at:new Date().toISOString()},
              {onConflict:"user_id,key"}
            );
          }
        }catch(ex){console.warn("Could not save screenshot to Supabase:",ex.message);}
        if(fileInputRef.current)fileInputRef.current.value="";
        setUploadLoading(false);
      };
      reader.onerror=()=>{setUploadError("Could not read image file.");setUploadLoading(false);};
      reader.readAsDataURL(file);
    }catch(e){setUploadError("Upload failed: "+e.message);setUploadLoading(false);}
  };


  const removeScreenshot=async()=>{
    setScreenshotUrl(null);setScreenshot(null);
    try{localStorage.removeItem(SCREENSHOT_KEY);}catch(e){}
    try{
      const{data:{user}}=await supabase.auth.getUser();
      if(user?.id){await supabase.from("user_preferences").delete().eq("key",SCREENSHOT_KEY).eq("user_id",user.id);}
    }catch(e){}
    if(fileInputRef.current)fileInputRef.current.value="";
  };

  const runAI = async () => {
    setAiLoading(true);
    try {
      const tradeData = {
        instrument: trade.instrument,
        direction: trade.direction,
        contracts: trade.contracts,
        date: trade.date,
        session: trade.session || "unknown",
        entry: trade.entry || null,
        exit: trade.exit || null,
        points: trade.entry && trade.exit
          ? (trade.direction === "Long" ? trade.exit - trade.entry : trade.entry - trade.exit).toFixed(2)
          : null,
        pnl: trade.pnl,
        rr: trade.rr || "--",
        grade: trade.grade || "B",
        setup: trade.setup || "unknown",
        result: trade.result,
        notes: trade.notes || "none",
      };

      // If screenshot exists, compress and include
      let imageData = null;
      if(screenshotUrl && screenshotUrl.startsWith("data:")){
        // Compress the image to reduce payload size and avoid timeout
        imageData = await new Promise((res)=>{
          const img=new Image();
          img.onload=()=>{
            const canvas=document.createElement("canvas");
            const MAX=800;
            let w=img.width,h=img.height;
            if(w>MAX){h=Math.round(h*MAX/w);w=MAX;}
            if(h>MAX){w=Math.round(w*MAX/h);h=MAX;}
            canvas.width=w;canvas.height=h;
            canvas.getContext("2d").drawImage(img,0,0,w,h);
            // Get compressed jpeg base64 (strip data:image/jpeg;base64, prefix)
            const b64=canvas.toDataURL("image/jpeg",0.7).split(",")[1];
            res(b64);
          };
          img.onerror=()=>res(null);
          img.src=screenshotUrl;
        });
      } else if(screenshot){
        imageData = await new Promise((res)=>{
          const reader=new FileReader();
          reader.onload=e=>res(e.target.result.split(",")[1]);
          reader.readAsDataURL(screenshot);
        });
      }

      const res = await fetch("/api/coach", {
        method: "POST",
        headers: {"Content-Type": "application/json"},
        body: JSON.stringify({ type: "trade", stats: tradeData, chartImage: imageData }),
      });
      if(!res.ok) throw new Error("Server error "+res.status);
      const data = await res.json();
      // coach.js returns parsed JSON directly for trade type
      if(data.score !== undefined) {
        setAiAnalysis(data);
      } else if(data.content?.[0]?.text) {
        const clean = data.content[0].text.split("```json").join("").split("```").join("").trim();
        setAiAnalysis(JSON.parse(clean));
      } else {
        throw new Error(data.error || "Invalid response");
      }
    } catch(e) {
      console.error("Trade AI error:", e);
      setAiAnalysis({score:50, verdict:"Could not analyze this trade. Please check your connection and try again.", strengths:[], improvements:[], lesson:""});
    }
    setAiLoading(false);
  };
  const pts = trade.entry && trade.exit
    ? trade.direction === "Long"
      ? Math.round((trade.exit - trade.entry) * 4) / 4
      : Math.round((trade.entry - trade.exit) * 4) / 4
    : null;

  const stats = [
    {label:"Side",        value:trade.direction,    color:trade.direction==="Long"?"#4ade80":"#f87171"},
    {label:"Contracts",   value:trade.contracts,    color:B.text},
    {label:"Entry Price", value:trade.entry||"--",  color:B.text},
    {label:"Exit Price",  value:trade.exit||"--",   color:B.text},
    {label:"Points",      value:pts!=null?(pts>0?"+":"")+pts:"--", color:pts>0?B.profit:pts<0?B.loss:B.text},
    {label:"Gross P&L",   value:fmt(trade.pnl),     color:pnlColor(trade.pnl)},
    {label:"R:R",         value:trade.rr||"--",     color:B.blue},
    {label:"Session",     value:trade.session||"--",color:B.text},
    {label:"Grade",       value:trade.grade||"--",  color:GRADE_COLOR[trade.grade]||B.textMuted,isGrade:true},
    {label:"Setup",       value:trade.setup||"--",  color:B.purple},
  ];

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(10px)"}}
      onClick={onClose}>
      <div style={{background:"#13121A",border:`1px solid ${B.border}`,borderRadius:20,width:680,maxHeight:"88vh",overflowY:"auto"}}
        onClick={e=>e.stopPropagation()}>

        {/* Top accent bar */}
        <div style={{height:3,background:isWin?GTB:"linear-gradient(90deg,#F05A7E,#8B5CF6)",borderRadius:"20px 20px 0 0"}}/>

        {/* Header */}
        <div style={{padding:"22px 28px 0",display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
              <span style={{fontSize:11,padding:"3px 10px",borderRadius:6,fontWeight:700,background:`${INST_COLOR[trade.instrument]||B.teal}20`,color:INST_COLOR[trade.instrument]||B.teal}}>{trade.instrument}</span>
              <span style={{fontSize:13,fontWeight:700,color:trade.direction==="Long"?"#4ade80":"#f87171"}}>{trade.direction}</span>
              <span style={{fontSize:11,padding:"2px 10px",borderRadius:20,fontWeight:700,background:isWin?`${B.profit}15`:`${B.loss}15`,color:isWin?B.profit:B.loss}}>{trade.result}</span>
            </div>
            <div style={{fontSize:11,color:B.textMuted}}>{new Date(trade.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"})}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:30,fontWeight:800,fontFamily:"monospace",color:pnlColor(trade.pnl)}}>{fmt(trade.pnl)}</div>
              <div style={{fontSize:11,color:B.textMuted}}>Net P&L</div>
            </div>
            <button onClick={onClose} style={{background:"rgba(255,255,255,0.05)",border:`1px solid ${B.border}`,borderRadius:8,color:B.textMuted,cursor:"pointer",fontSize:18,width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center",marginLeft:8}}>×</button>
          </div>
        </div>

        {/* Stats grid */}
        <div style={{padding:"0 28px",marginBottom:20}}>
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:1,background:`${B.border}`,borderRadius:12,overflow:"hidden",border:`1px solid ${B.border}`}}>
            {stats.map((s,i)=>(
              <div key={s.label} style={{padding:"14px 16px",background:"#13121A",borderRight:i%5!==4?`1px solid ${B.border}`:"none",borderBottom:i<5?`1px solid ${B.border}`:"none"}}>
                <div style={{fontSize:9,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:6}}>{s.label}</div>
                {s.isGrade
                  ? <GradeBadge grade={trade.grade||"B"} tradeId={trade.id} onSave={g=>{if(onGradeUpdate)onGradeUpdate(trade.id,g);}}/>
                  : <div style={{fontSize:15,fontWeight:700,color:s.color,fontFamily:"monospace"}}>{String(s.value)}</div>
                }
              </div>
            ))}
          </div>
        </div>

        {/* Performance visual */}
        <div style={{padding:"0 28px",marginBottom:20}}>
          <div style={{background:"rgba(0,0,0,0.4)",borderRadius:12,padding:"16px 20px",border:`1px solid ${B.border}`}}>
            <div style={{fontSize:10,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:12}}>Trade Performance</div>
            <div style={{display:"flex",alignItems:"center",gap:16}}>
              {/* P&L bar visual */}
              <div style={{flex:1}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6,fontSize:11,color:B.textMuted}}>
                  <span>Entry: {trade.entry||"--"}</span>
                  <span>Exit: {trade.exit||"--"}</span>
                </div>
                <div style={{height:8,background:"rgba(255,255,255,0.05)",borderRadius:4,overflow:"hidden",position:"relative"}}>
                  <div style={{
                    position:"absolute",left:"50%",height:"100%",
                    width:pts?Math.min(Math.abs(pts)/50*50,50)+"%":"0%",
                    background:isWin?GTB:GBP,
                    borderRadius:4,
                    transform:isWin?"translateX(0)":"translateX(-100%)",
                  }}/>
                  <div style={{position:"absolute",left:"50%",top:0,bottom:0,width:2,background:"rgba(255,255,255,0.2)",transform:"translateX(-50%)"}}/>
                </div>
                <div style={{display:"flex",justifyContent:"space-between",marginTop:6}}>
                  <span style={{fontSize:10,color:B.textMuted}}>{trade.contracts} contract{trade.contracts!==1?"s":""}</span>
                  {pts!=null&&<span style={{fontSize:11,fontWeight:700,color:pnlColor(trade.pnl),fontFamily:"monospace"}}>{pts>0?"+":""}{pts} pts</span>}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Strategy Entry Rules Checklist */}
        {trade.setup&&trade.setup!=="Auto-synced"&&<StrategyChecklist trade={trade}/>}

        {/* Notes */}
        {trade.notes&&(
          <div style={{padding:"0 28px",marginBottom:20}}>
            <div style={{background:"rgba(0,0,0,0.3)",borderRadius:12,padding:"16px 20px",border:`1px solid ${B.border}`}}>
              <div style={{fontSize:10,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:8}}>Notes</div>
              <div style={{fontSize:13,color:"#C8C4D8",lineHeight:1.7}}>{trade.notes}</div>
            </div>
          </div>
        )}

        {/* ICT Concept Tags */}
        <div style={{padding:"0 28px",marginBottom:20}}>
          <div style={{background:"rgba(0,0,0,0.3)",borderRadius:12,padding:"16px 20px",border:`1px solid ${B.border}`}}>
            <div style={{fontSize:10,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>ICT Concepts Used</div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
              {ICT_CONCEPTS.map(c=>{
                const active=(tradeTags[trade.id]||[]).includes(c);
                return(
                  <button key={c} onClick={()=>{
                    const current=tradeTags[trade.id]||[];
                    const updated=active?current.filter(x=>x!==c):[...current,c];
                    const newTags={...tradeTags,[trade.id]:updated};
                    setTradeTags(newTags);
                    const val=JSON.stringify(newTags);
                    localStorage.setItem("pref_tca_ict_tags_v1",val);
                    (async()=>{try{const{data:{user}}=await supabase.auth.getUser();await supabase.from("user_preferences").upsert({user_id:user?.id,key:"tca_ict_tags_v1",value:val,updated_at:new Date().toISOString()},{onConflict:"user_id,key"});}catch(e){}})();
                  }} style={{
                    padding:"4px 10px",borderRadius:20,cursor:"pointer",fontSize:11,fontWeight:active?700:400,
                    border:`1px solid ${active?B.teal:B.border}`,
                    background:active?`${B.teal}15`:"transparent",
                    color:active?B.teal:B.textMuted,transition:"all 0.15s",
                  }}>{c}</button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Screenshot Section */}
        <div style={{padding:"0 28px",marginBottom:20}}>
          <input ref={fileInputRef} type="file" accept="image/*" style={{display:"none"}}
            onChange={e=>e.target.files[0]&&uploadScreenshot(e.target.files[0])}/>
          {screenshotUrl?(
            <div style={{borderRadius:12,overflow:"hidden",border:`1px solid ${B.border}`,position:"relative"}}>
              <img src={screenshotUrl} alt="Trade chart" style={{width:"100%",maxHeight:300,objectFit:"cover",display:"block"}}/>
              <div style={{position:"absolute",top:8,right:8,display:"flex",gap:6}}>
                <button onClick={()=>fileInputRef.current?.click()}
                  style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${B.border}`,background:"rgba(0,0,0,0.8)",color:B.textMuted,cursor:"pointer",fontSize:11}}>
                  Replace
                </button>
                <button onClick={removeScreenshot}
                  style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${B.loss}50`,background:"rgba(0,0,0,0.8)",color:B.loss,cursor:"pointer",fontSize:11}}>
                  Remove
                </button>
              </div>
              <div style={{padding:"8px 12px",background:"rgba(0,0,0,0.6)",fontSize:10,color:B.teal}}>
                📸 Chart attached · AI will analyze this image with your trade data
              </div>
            </div>
          ):(
            <div onClick={()=>fileInputRef.current?.click()}
              style={{padding:"14px",borderRadius:12,border:`2px dashed ${B.border}`,display:"flex",alignItems:"center",justifyContent:"center",gap:10,cursor:"pointer",transition:"all 0.2s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=B.teal+"60";e.currentTarget.style.background=`${B.teal}05`;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=B.border;e.currentTarget.style.background="transparent";}}>
              {uploadLoading?(
                <span style={{fontSize:12,color:B.textMuted}}>Uploading...</span>
              ):(
                <>
                  <span style={{fontSize:20}}>📸</span>
                  <div>
                    <div style={{fontSize:12,fontWeight:700,color:B.text}}>Attach chart screenshot</div>
                    <div style={{fontSize:10,color:B.textMuted}}>AI coach will analyze your chart + trade data together</div>
                  </div>
                </>
              )}
            </div>
          )}
          {uploadError&&<div style={{fontSize:11,color:B.loss,marginTop:6}}>{uploadError}</div>}
        </div>

        {/* AI Coach Section */}
        <div style={{padding:"0 28px",marginBottom:20}}>
          {!aiAnalysis&&!aiLoading&&(
            <button onClick={runAI} style={{width:"100%",padding:"12px",borderRadius:12,border:`1px solid ${B.purple}40`,background:`${B.purple}10`,color:B.purple,cursor:"pointer",fontSize:13,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              🧠 Analyze This Trade with AI Coach
            </button>
          )}
          {aiLoading&&(
            <div style={{padding:"20px",borderRadius:12,background:"rgba(0,0,0,0.3)",border:`1px solid ${B.border}`,textAlign:"center"}}>
              <div style={{fontSize:13,color:B.textMuted}}>🧠 Analyzing trade...</div>
              <div style={{marginTop:8,height:3,background:`${B.border}`,borderRadius:2,overflow:"hidden"}}>
                <div style={{height:"100%",width:"60%",background:GL,borderRadius:2,animation:"pulse 1.5s infinite"}}/>
              </div>
            </div>
          )}
          {aiAnalysis&&(
            <div style={{borderRadius:12,background:"rgba(0,0,0,0.3)",border:`1px solid ${B.purple}30`,overflow:"hidden"}}>
              <div style={{padding:"12px 16px",background:`${B.purple}10`,borderBottom:`1px solid ${B.purple}20`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span>🧠</span>
                  <span style={{fontSize:11,fontWeight:700,color:B.purple,letterSpacing:1.5,textTransform:"uppercase"}}>AI Trade Analysis</span>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <div style={{fontSize:22,fontWeight:800,color:aiAnalysis.score>=70?B.profit:aiAnalysis.score>=50?B.spark:B.loss,fontFamily:"monospace"}}>{aiAnalysis.score}</div>
                  <div style={{fontSize:9,color:B.textMuted}}>/100</div>
                  <button onClick={()=>setAiAnalysis(null)} style={{background:"none",border:"none",color:B.textMuted,cursor:"pointer",fontSize:14,marginLeft:4}}>↺</button>
                </div>
              </div>
              <div style={{padding:"14px 16px",display:"flex",flexDirection:"column",gap:12}}>
                <div style={{fontSize:12,color:"#C8C4D8",lineHeight:1.7}}>{aiAnalysis.verdict}</div>
                {aiAnalysis.strengths?.length>0&&(
                  <div>
                    <div style={{fontSize:10,color:B.profit,letterSpacing:1.5,textTransform:"uppercase",marginBottom:6}}>✅ Strengths</div>
                    {aiAnalysis.strengths.map((s,i)=>(<div key={i} style={{fontSize:12,color:B.textMuted,padding:"4px 0",borderBottom:`1px solid ${B.border}20`}}>• {s}</div>))}
                  </div>
                )}
                {aiAnalysis.improvements?.length>0&&(
                  <div>
                    <div style={{fontSize:10,color:B.loss,letterSpacing:1.5,textTransform:"uppercase",marginBottom:6}}>⚠️ Improvements</div>
                    {aiAnalysis.improvements.map((s,i)=>(<div key={i} style={{fontSize:12,color:B.textMuted,padding:"4px 0",borderBottom:`1px solid ${B.border}20`}}>• {s}</div>))}
                  </div>
                )}
                {aiAnalysis.lesson&&(
                  <div style={{padding:"10px 14px",borderRadius:8,background:`${B.spark}10`,border:`1px solid ${B.spark}30`}}>
                    <div style={{fontSize:10,color:B.spark,letterSpacing:1.5,textTransform:"uppercase",marginBottom:4}}>💡 Key Lesson</div>
                    <div style={{fontSize:12,color:"#C8C4D8",lineHeight:1.6}}>{aiAnalysis.lesson}</div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div style={{padding:"0 28px 24px",display:"flex",gap:10}}>
          <button onClick={()=>{onEdit(trade);onClose();}}
            style={{flex:1,padding:"11px",borderRadius:10,border:`1px solid ${B.blue}40`,background:`${B.blue}12`,color:B.blue,cursor:"pointer",fontSize:13,fontWeight:700}}>
            ✏️ Edit Trade
          </button>
          <button onClick={onClose}
            style={{flex:1,padding:"11px",borderRadius:10,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:13,fontWeight:600}}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Journal Templates System ──────────────────────────────────────────────────
const DEFAULT_TEMPLATES = [
  {
    id: "premarket",
    name: "Pre-Market Plan",
    icon: "🌅",
    color: "#4F8EF7",
    locked: true,
    content: `📋 PRE-MARKET PLAN — {date}

🔍 MARKET CONTEXT
• Overnight range:
• Key levels to watch:
• Bias (Bull/Bear/Neutral):

📌 TRADE SETUPS TO WATCH
Setup 1:
• Instrument:
• Trigger:
• Entry zone:
• Target:
• Stop:
• R:R:

Setup 2:
• Instrument:
• Trigger:
• Entry zone:
• Target:
• Stop:
• R:R:

⚠️ RULES FOR TODAY
• Max contracts:
• Daily loss limit:
• Max trades:

🧠 MENTAL STATE CHECK
• Energy level (1-10):
• Focus level (1-10):
• Notes on mindset:

🎯 GOAL FOR TODAY:
`
  },
  {
    id: "posttrade",
    name: "Post-Trade Review",
    icon: "📊",
    color: "#00D4A8",
    locked: true,
    content: `📊 POST-TRADE REVIEW — {date}

✅ WHAT I DID WELL
•
•

❌ WHAT I NEED TO IMPROVE
•
•

🔍 TRADE BREAKDOWN
• Did I follow my plan? (Y/N):
• Did I respect my stop? (Y/N):
• Did I size correctly? (Y/N):
• Emotional state during trading:

📈 STATISTICS
• Trades taken:
• Winners:
• Losers:
• Net P&L:
• Best trade:
• Worst trade:

💡 KEY LESSON FROM TODAY:

🎯 FOCUS FOR TOMORROW:
`
  },
  {
    id: "weekly",
    name: "Weekly Review",
    icon: "[ ]",
    color: "#8B5CF6",
    locked: true,
    content: `WEEKLY REVIEW — Week of {date}

📊 PERFORMANCE SUMMARY
• Total trades:
• Win rate:
• Net P&L:
• Best day:
• Worst day:

✅ WINS THIS WEEK (trading habits)
•
•

❌ AREAS TO IMPROVE
•
•

🔍 PATTERN ANALYSIS
• Best performing setup:
• Worst performing setup:
• Best session (AM/Mid/PM):
• Worst session:

🧠 PSYCHOLOGICAL NOTES
• Biggest emotional challenge:
• How I handled losses:
• Discipline rating (1-10):

📚 WHAT I LEARNED THIS WEEK:

🎯 GOALS FOR NEXT WEEK:
1.
2.
3.
`
  },
];

const TEMPLATES_STORAGE_KEY = "tca_journal_templates_v1";

function useTemplates() {
  const [templates, setTemplates] = useState(DEFAULT_TEMPLATES);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Load from localStorage instantly
    try{
      const l=localStorage.getItem("pref_"+TEMPLATES_STORAGE_KEY);
      if(l){const saved=JSON.parse(l);const custom=saved.filter(t=>!t.locked);setTemplates([...DEFAULT_TEMPLATES,...custom]);}
    }catch(e){}
    // Sync from Supabase
    (async () => {
      try {
        const{data}=await supabase.from("user_preferences").select("value").eq("key",TEMPLATES_STORAGE_KEY).single();
        if(data?.value){
          localStorage.setItem("pref_"+TEMPLATES_STORAGE_KEY,data.value);
          const saved=JSON.parse(data.value);
          const custom=saved.filter(t=>!t.locked);
          setTemplates([...DEFAULT_TEMPLATES,...custom]);
        }
      } catch(e) {}
      setLoaded(true);
    })();
  }, []);

  const saveTemplates = async (newTemplates) => {
    setTemplates(newTemplates);
    const val=JSON.stringify(newTemplates);
    localStorage.setItem("pref_"+TEMPLATES_STORAGE_KEY,val);
    try{await (async()=>{const{data:{user}}=await supabase.auth.getUser();await supabase.from("user_preferences").upsert({user_id:user?.id,key:TEMPLATES_STORAGE_KEY,value:val,updated_at:new Date().toISOString()},{onConflict:"user_id,key"});})();}catch(e){}
  };

  const addTemplate = (template) => {
    const newTemplates = [...templates, { ...template, id: `custom_${Date.now()}` }];
    saveTemplates(newTemplates);
  };

  const updateTemplate = (id, updates) => {
    const newTemplates = templates.map(t => t.id === id ? { ...t, ...updates } : t);
    saveTemplates(newTemplates);
  };

  const deleteTemplate = (id) => {
    const newTemplates = templates.filter(t => t.id !== id);
    saveTemplates(newTemplates);
  };

  return { templates, addTemplate, updateTemplate, deleteTemplate, loaded };
}

function TemplatePanel({ date, currentNotes, onApply, onClose }) {
  const { templates, addTemplate, updateTemplate, deleteTemplate } = useTemplates();
  const [view, setView] = useState("list"); // list | edit | create | preview
  const [selected, setSelected] = useState(null);
  const [editForm, setEditForm] = useState({ name: "", icon: "📝", color: B.teal, content: "" });
  const [saving, setSaving] = useState(false);

  const applyTemplate = (template) => {
    const filled = template.content.replace(/{date}/g, new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" }));
    // If notes already exist, ask to append or replace
    if (currentNotes?.trim()) {
      const combined = currentNotes + "\n\n---\n\n" + filled;
      onApply(combined);
    } else {
      onApply(filled);
    }
    onClose();
  };

  const handleSave = () => {
    if (!editForm.name.trim() || !editForm.content.trim()) return;
    if (selected && !selected.locked) {
      updateTemplate(selected.id, editForm);
    } else {
      addTemplate({ ...editForm, locked: false });
    }
    setView("list");
    setSelected(null);
  };

  const handleSaveAsTemplate = () => {
    if (!currentNotes?.trim()) return;
    addTemplate({
      name: `Journal ${date}`,
      icon: "📝",
      color: B.spark,
      locked: false,
      content: currentNotes,
    });
    setSaving(true);
    setTimeout(() => setSaving(false), 1500);
  };

  const ICONS = ["📝","🌅","📊","[ ]","🎯","💡","⚡","🔥","📈","🧠","✅","⚠️"];
  const COLORS = [B.teal, B.blue, B.purple, B.spark, "#f97316", B.loss];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Panel header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: B.text }}>
          {view === "list" ? "Journal Templates" : view === "edit" ? "Edit Template" : view === "create" ? "New Template" : "Preview"}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {view === "list" && (
            <button onClick={() => { setView("create"); setEditForm({ name: "", icon: "📝", color: B.teal, content: "" }); }}
              style={{ padding: "5px 12px", borderRadius: 8, border: "none", background: GL, color: "#0E0E10", cursor: "pointer", fontSize: 11, fontWeight: 800 }}>
              + New
            </button>
          )}
          {view !== "list" && (
            <button onClick={() => { setView("list"); setSelected(null); }}
              style={{ padding: "5px 12px", borderRadius: 8, border: `1px solid ${B.border}`, background: "transparent", color: B.textMuted, cursor: "pointer", fontSize: 11 }}>
              ← Back
            </button>
          )}
        </div>
      </div>

      {/* Save current as template */}
      {view === "list" && currentNotes?.trim() && (
        <button onClick={handleSaveAsTemplate}
          style={{ width: "100%", padding: "9px", borderRadius: 10, border: `1px solid ${B.spark}40`, background: `${B.spark}10`, color: B.spark, cursor: "pointer", fontSize: 12, fontWeight: 700, marginBottom: 12, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
          {saving ? "✓ Saved!" : "💾 Save today's notes as template"}
        </button>
      )}

      {/* Template list */}
      {view === "list" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", flex: 1 }}>
          {templates.map(t => (
            <div key={t.id} style={{ borderRadius: 10, border: `1px solid ${B.border}`, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", background: "rgba(0,0,0,0.3)" }}>
                <span style={{ fontSize: 18 }}>{t.icon}</span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: B.text }}>{t.name}</div>
                  <div style={{ fontSize: 10, color: B.textMuted, marginTop: 2 }}>
                    {t.locked ? "Default template" : "Custom template"}
                  </div>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => { setSelected(t); setView("preview"); }}
                    style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${B.border}`, background: "transparent", color: B.textMuted, cursor: "pointer", fontSize: 10 }}>
                    Preview
                  </button>
                  {!t.locked && (
                    <button onClick={() => { setSelected(t); setEditForm({ name: t.name, icon: t.icon, color: t.color, content: t.content }); setView("edit"); }}
                      style={{ padding: "4px 10px", borderRadius: 6, border: `1px solid ${B.blue}40`, background: `${B.blue}10`, color: B.blue, cursor: "pointer", fontSize: 10 }}>
                      Edit
                    </button>
                  )}
                  <button onClick={() => applyTemplate(t)}
                    style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: `${t.color}20`, color: t.color, cursor: "pointer", fontSize: 10, fontWeight: 700 }}>
                    Apply
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preview */}
      {view === "preview" && selected && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ flex: 1, padding: "14px", borderRadius: 10, background: "rgba(0,0,0,0.3)", border: `1px solid ${B.border}`, overflowY: "auto", fontSize: 12, color: "#C8C4D8", lineHeight: 1.8, whiteSpace: "pre-wrap", fontFamily: "monospace" }}>
            {selected.content.replace(/{date}/g, date)}
          </div>
          <button onClick={() => applyTemplate(selected)}
            style={{ padding: "11px", borderRadius: 10, border: "none", background: GL, color: "#0E0E10", cursor: "pointer", fontSize: 13, fontWeight: 800 }}>
            Apply This Template →
          </button>
        </div>
      )}

      {/* Create / Edit form */}
      {(view === "create" || view === "edit") && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12, overflowY: "auto" }}>
          <div>
            <label style={lS}>Template Name</label>
            <input value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
              style={iS} placeholder="e.g. My Morning Routine" />
          </div>
          <div>
            <label style={lS}>Icon</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {ICONS.map(icon => (
                <button key={icon} onClick={() => setEditForm(f => ({ ...f, icon }))}
                  style={{ width: 36, height: 36, borderRadius: 8, border: `2px solid ${editForm.icon === icon ? B.teal : B.border}`, background: editForm.icon === icon ? `${B.teal}15` : "transparent", cursor: "pointer", fontSize: 18 }}>
                  {icon}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label style={lS}>Color</label>
            <div style={{ display: "flex", gap: 6 }}>
              {COLORS.map(color => (
                <button key={color} onClick={() => setEditForm(f => ({ ...f, color }))}
                  style={{ width: 28, height: 28, borderRadius: "50%", border: `3px solid ${editForm.color === color ? "#fff" : "transparent"}`, background: color, cursor: "pointer" }} />
              ))}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <label style={lS}>Template Content <span style={{ color: B.textMuted, fontSize: 9 }}>use {"{date}"} to auto-insert the date</span></label>
            <textarea value={editForm.content} onChange={e => setEditForm(f => ({ ...f, content: e.target.value }))}
              rows={10} style={{ ...iS, resize: "vertical", lineHeight: 1.7, fontSize: 12, fontFamily: "monospace" }}
              placeholder="Write your template here..." />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => { setView("list"); setSelected(null); }}
              style={{ flex: 1, padding: "10px", borderRadius: 10, border: `1px solid ${B.border}`, background: "transparent", color: B.textMuted, cursor: "pointer", fontSize: 13 }}>
              Cancel
            </button>
            <button onClick={handleSave}
              style={{ flex: 2, padding: "10px", borderRadius: 10, border: "none", background: GL, color: "#0E0E10", cursor: "pointer", fontSize: 13, fontWeight: 800 }}>
              {view === "edit" ? "Save Changes" : "Create Template"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DayJournalModal({date, trades, onClose, onGradeUpdate}){
  const STORAGE_KEY=`tca_dayjournal_${date}`;
  const [notes,setNotes]=useState("");
  const [checklist,setChecklist]=useState([]);
  const [newItem,setNewItem]=useState("");
  const [editingCheck,setEditingCheck]=useState(null);
  const [editCheckText,setEditCheckText]=useState("");
  const [ckTemplates,setCkTemplates]=useState([]);
  const [showCkTemplates,setShowCkTemplates]=useState(false);
  const [newTplName,setNewTplName]=useState("");

  // Load checklist templates
  useEffect(()=>{
    try{const l=localStorage.getItem("tca_ck_templates_v1");if(l)setCkTemplates(JSON.parse(l));}catch(e){}
  },[]);
  const saveCkTemplates=(tpls)=>{setCkTemplates(tpls);try{localStorage.setItem("tca_ck_templates_v1",JSON.stringify(tpls));}catch(e){}};
  const saveAsTemplate=()=>{
    if(!checklist.length||!newTplName.trim())return;
    const tpl={id:Date.now(),name:newTplName.trim(),items:checklist.map(i=>({...i,done:false}))};
    saveCkTemplates([...ckTemplates,tpl]);
    setNewTplName("");setShowCkTemplates(false);
  };
  const applyTemplate=(tpl)=>{
    const merged=[...checklist,...tpl.items.filter(ti=>!checklist.some(ci=>ci.text===ti.text))];
    setChecklist(merged);save(undefined,merged);setShowCkTemplates(false);
  };
  const deleteCkTemplate=(id)=>saveCkTemplates(ckTemplates.filter(t=>t.id!==id));
  const [selectedTrade,setSelectedTrade]=useState(null);
  const [loaded,setLoaded]=useState(false);
  const [saving,setSaving]=useState(false);
  const [tab,setTab]=useState("notes");

  const dayTrades=trades.filter(t=>t.date===date);
  const dayPnl=dayTrades.reduce((a,t)=>a+t.pnl,0);
  const dateLabel=new Date(date+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"long",day:"numeric",year:"numeric"});

  // Default pre-market checklist items
  const DEFAULT_CHECKLIST=[
    "Reviewed economic calendar for today",
    "Checked overnight globex session range",
    "Identified PDH and PDL levels",
    "Noted key support and resistance levels",
    "Checked /ES bias on 3H and 90M",
    "Set daily loss limit in mind",
    "Reviewed yesterday's trades",
    "Mental state check — ready to trade?",
  ];

  useEffect(()=>{
    (async()=>{
      // Load from localStorage instantly
      try{
        const l=localStorage.getItem("pref_"+STORAGE_KEY);
        if(l){const s=JSON.parse(l);setNotes(s.notes||"");setChecklist(s.checklist||DEFAULT_CHECKLIST.map(i=>({text:i,checked:false})));}
      }catch(e){}
      // Sync latest from Supabase
      try{
        const{data}=await supabase.from("user_preferences").select("value").eq("key",STORAGE_KEY).single();
        if(data?.value){
          localStorage.setItem("pref_"+STORAGE_KEY,data.value);
          const saved=JSON.parse(data.value);
          setNotes(saved.notes||"");
          setChecklist(saved.checklist||DEFAULT_CHECKLIST.map(item=>({text:item,checked:false})));
        }else{
          setChecklist(DEFAULT_CHECKLIST.map(item=>({text:item,checked:false})));
        }
      }catch(e){
        setChecklist(DEFAULT_CHECKLIST.map(item=>({text:item,checked:false})));
      }
      setLoaded(true);
    })();
  },[date]);

  const save=async(newNotes,newChecklist)=>{
    setSaving(true);
    const val=JSON.stringify({notes:newNotes??notes,checklist:newChecklist??checklist});
    localStorage.setItem("pref_"+STORAGE_KEY,val);
    try{await (async()=>{const{data:{user}}=await supabase.auth.getUser();await supabase.from("user_preferences").upsert({user_id:user?.id,key:STORAGE_KEY,value:val,updated_at:new Date().toISOString()},{onConflict:"user_id,key"});})();}catch(e){}
    setSaving(false);  };

  const toggleCheck=(i)=>{
    const updated=checklist.map((item,idx)=>idx===i?{...item,checked:!item.checked}:item);
    setChecklist(updated);
    save(undefined,updated);
  };

  const addItem=()=>{
    if(!newItem.trim())return;
    const updated=[...checklist,{text:newItem.trim(),checked:false}];
    setChecklist(updated);
    setNewItem("");
    save(undefined,updated);
  };

  const removeItem=(i)=>{
    const updated=checklist.filter((_,idx)=>idx!==i);
    setChecklist(updated);
    save(undefined,updated);
  };

  const completed=checklist.filter(i=>i.checked).length;
  const pct=checklist.length?Math.round((completed/checklist.length)*100):0;

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:150,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)"}}
      onClick={onClose}>
      <div style={{background:"#13121A",border:`1px solid ${B.border}`,borderRadius:20,width:680,maxHeight:"90vh",overflowY:"auto"}}
        onClick={e=>e.stopPropagation()}>
        <div style={{height:3,background:dayPnl>0?GTB:dayPnl<0?"linear-gradient(90deg,#F05A7E,#8B5CF6)":GL,borderRadius:"20px 20px 0 0"}}/>

        {/* Header */}
        <div style={{padding:"22px 28px 0",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div>
            <div style={{fontSize:12,color:B.textMuted,marginBottom:3}}>{dateLabel}</div>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              <div style={{fontSize:22,fontWeight:800,color:dayTrades.length?pnlColor(dayPnl):B.textMuted,fontFamily:"monospace"}}>
                {dayTrades.length?fmt(dayPnl):"No trades"}
              </div>
              {dayTrades.length>0&&<div style={{fontSize:12,color:B.textMuted}}>{dayTrades.length} trade{dayTrades.length!==1?"s":""}</div>}
            </div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            {saving&&<div style={{fontSize:11,color:B.textMuted}}>Saving...</div>}
            <button onClick={onClose} style={{background:"rgba(255,255,255,0.05)",border:`1px solid ${B.border}`,borderRadius:8,color:B.textMuted,cursor:"pointer",fontSize:18,width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{padding:"0 28px",display:"flex",gap:6,marginBottom:20}}>
          {[
            {id:"checklist",label:`Pre-Market Checklist ${checklist.length?`(${completed}/${checklist.length})`:""}` },
            {id:"notes",label:"Trading Notes"},
            {id:"templates",label:"Templates"},
            {id:"trades",label:`Trades (${dayTrades.length})`},
          ].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{
              padding:"8px 16px",borderRadius:9,border:"1px solid",cursor:"pointer",fontSize:12,fontWeight:700,
              borderColor:tab===t.id?B.teal:B.border,
              background:tab===t.id?`${B.teal}15`:"transparent",
              color:tab===t.id?B.teal:B.textMuted,
            }}>{t.label}</button>
          ))}
        </div>

        <div style={{padding:"0 28px 28px"}}>

          {/* Pre-Market Checklist Tab */}
          {tab==="checklist"&&(
            <div>
              {/* Progress bar */}
              <div style={{marginBottom:16}}>
                <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
                  <div style={{fontSize:12,color:B.textMuted}}>Pre-market preparation</div>
                  <div style={{fontSize:12,fontWeight:700,color:pct===100?B.teal:B.textMuted}}>{pct}% complete</div>
                </div>
                <div style={{height:6,background:"rgba(255,255,255,0.05)",borderRadius:3,overflow:"hidden"}}>
                  <div style={{height:"100%",width:`${pct}%`,background:pct===100?GTB:GBP,borderRadius:3,transition:"width 0.4s"}}/>
                </div>
                {pct===100&&<div style={{fontSize:11,color:B.teal,marginTop:6,fontWeight:700}}>✅ Pre-market prep complete — ready to trade!</div>}
              </div>

              {/* Checklist items */}
              <div style={{display:"flex",flexDirection:"column",gap:8,marginBottom:16}}>
                {checklist.map((item,i)=>(
                  <div key={i} style={{
                    display:"flex",alignItems:"center",gap:10,padding:"10px 14px",borderRadius:10,
                    background:item.checked?"rgba(0,212,168,0.06)":"rgba(255,255,255,0.02)",
                    border:`1px solid ${item.checked?`${B.teal}30`:B.border}`,
                    transition:"all 0.2s"
                  }}>
                    {/* Checkbox */}
                    <div onClick={()=>toggleCheck(i)} style={{
                      width:20,height:20,borderRadius:6,border:`2px solid ${item.checked?B.teal:B.textMuted}`,
                      background:item.checked?B.teal:"transparent",flexShrink:0,
                      display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s",cursor:"pointer"
                    }}>
                      {item.checked&&<span style={{color:"#0E0E10",fontSize:12,fontWeight:900}}>✓</span>}
                    </div>
                    {/* Text - click to edit inline */}
                    {editingCheck===i?(
                      <input
                        autoFocus
                        value={editCheckText}
                        onChange={e=>setEditCheckText(e.target.value)}
                        onBlur={()=>{
                          if(editCheckText.trim()){
                            const updated=checklist.map((it,idx)=>idx===i?{...it,text:editCheckText.trim()}:it);
                            setChecklist(updated);save(undefined,updated);
                          }
                          setEditingCheck(null);
                        }}
                        onKeyDown={e=>{
                          if(e.key==="Enter"){e.target.blur();}
                          if(e.key==="Escape"){setEditingCheck(null);}
                        }}
                        style={{...iS,flex:1,padding:"4px 8px",fontSize:13,height:28}}
                      />
                    ):(
                      <div
                        onClick={()=>{setEditingCheck(i);setEditCheckText(item.text);}}
                        style={{flex:1,fontSize:13,color:item.checked?B.textMuted:B.text,textDecoration:item.checked?"line-through":"none",cursor:"text",padding:"2px 4px",borderRadius:4}}
                        title="Click to edit"
                      >{item.text}</div>
                    )}
                    {/* Action buttons */}
                    <div style={{display:"flex",gap:4,flexShrink:0}}>
                      <button onClick={()=>{setEditingCheck(i);setEditCheckText(item.text);}}
                        style={{background:"none",border:"none",color:B.textMuted,cursor:"pointer",fontSize:12,padding:"2px 5px",opacity:0.6,borderRadius:4}}
                        title="Edit">✏️</button>
                      <button onClick={e=>{e.stopPropagation();removeItem(i);}}
                        style={{background:"none",border:"none",color:B.textMuted,cursor:"pointer",fontSize:12,padding:"2px 5px",opacity:0.6,borderRadius:4}}
                        title="Delete">🗑️</button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add new item */}
              <div style={{display:"flex",gap:8}}>
                <input value={newItem} onChange={e=>setNewItem(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&addItem()}
                  style={{...iS,flex:1}} placeholder="Add a checklist item..."/>
                <button onClick={addItem} style={{padding:"9px 18px",borderRadius:8,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:12,fontWeight:800,whiteSpace:"nowrap"}}>+ Add</button>
                <button onClick={()=>setShowCkTemplates(p=>!p)} title="Templates" style={{padding:"9px 12px",borderRadius:8,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:13}}>📋</button>
              </div>
              {showCkTemplates&&(
                <div style={{marginTop:12,padding:"14px 16px",borderRadius:10,background:"rgba(0,0,0,0.3)",border:`1px solid ${B.border}`}}>
                  <div style={{fontSize:11,color:B.textMuted,marginBottom:10,letterSpacing:1}}>CHECKLIST TEMPLATES</div>
                  {ckTemplates.length>0&&(
                    <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:12}}>
                      {ckTemplates.map(t=>(
                        <div key={t.id} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:8,background:`${B.teal}08`,border:`1px solid ${B.borderTeal}`}}>
                          <div style={{flex:1}}>
                            <div style={{fontSize:12,fontWeight:700,color:B.teal}}>{t.name}</div>
                            <div style={{fontSize:10,color:B.textMuted}}>{t.items.length} items</div>
                          </div>
                          <button onClick={()=>applyTemplate(t)} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${B.teal}40`,background:`${B.teal}12`,color:B.teal,cursor:"pointer",fontSize:11,fontWeight:700}}>Apply</button>
                          <button onClick={()=>deleteCkTemplate(t.id)} style={{background:"none",border:"none",color:B.textMuted,cursor:"pointer",fontSize:14}}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  {checklist.length>0&&(
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <input value={newTplName} onChange={e=>setNewTplName(e.target.value)} placeholder="Template name..." style={{...iS,flex:1,padding:"6px 10px",fontSize:12}}/>
                      <button onClick={saveAsTemplate} style={{padding:"6px 14px",borderRadius:7,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:11,fontWeight:800,whiteSpace:"nowrap"}}>Save Current</button>
                    </div>
                  )}
                  {ckTemplates.length===0&&checklist.length===0&&<div style={{fontSize:11,color:B.textMuted}}>Add items to your checklist first, then save as a template.</div>}
                </div>
              )}
            </div>
          )}

          {/* Notes Tab */}
          {tab==="notes"&&(
            <div>
              <div style={{fontSize:11,color:B.textMuted,marginBottom:10}}>Your trading journal for this day</div>
              <textarea
                value={typeof notes==="string"?notes.replace(/<[^>]*>/g,"").replace(/&nbsp;/g," ").replace(/&amp;/g,"&").replace(/&lt;/g,"<").replace(/&gt;/g,">"):""}
                onChange={e=>setNotes(e.target.value)}
                onBlur={e=>save(e.target.value,undefined)}
                placeholder="Write your trading notes here... What happened? What did you learn?"
                style={{
                  width:"100%",minHeight:260,background:"rgba(0,0,0,0.3)",
                  border:`1px solid ${B.border}`,borderRadius:10,
                  padding:"14px 16px",color:B.text,fontSize:13,
                  fontFamily:"'DM Sans',sans-serif",resize:"vertical",
                  outline:"none",lineHeight:1.8,direction:"ltr",
                  textAlign:"left",boxSizing:"border-box",
                }}
              />
              <div style={{display:"flex",justifyContent:"flex-end",marginTop:10}}>
                <button onClick={()=>save(notes,undefined)} style={{padding:"8px 20px",borderRadius:8,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:12,fontWeight:800}}>Save Notes</button>
              </div>
            </div>
          )}


          {/* Templates Tab */}
          {tab==="templates"&&(
            <div style={{minHeight:400}}>
              <TemplatePanel
                date={date}
                currentNotes={notes}
                onApply={(text)=>{setNotes(text);save(text,undefined);setTab("notes");}}
                onClose={()=>setTab("notes")}
              />
            </div>
          )}

          {/* Trades Tab */}
          {tab==="trades"&&(
            <div>
              {selectedTrade&&<TradeDetailModal trade={selectedTrade} onClose={()=>setSelectedTrade(null)} onEdit={(t)=>{setSelectedTrade(null);onClose();if(onEdit)onEdit(t);}} onGradeUpdate={onGradeUpdate}/>}
              {dayTrades.length===0?(
                <div style={{textAlign:"center",padding:"40px 0",color:B.textMuted,fontSize:13}}>No trades on this day.</div>
              ):(
                <>
                  <div style={{fontSize:11,color:B.textMuted,marginBottom:10}}>Click any trade to view details · 🧠 AI analysis available inside</div>
                  <div style={{display:"flex",flexDirection:"column",gap:8}}>
                    {dayTrades.map((t,i)=>(
                      <div key={t.id} onClick={()=>setSelectedTrade(t)} style={{
                        padding:"14px 16px",borderRadius:12,background:"rgba(0,0,0,0.3)",
                        border:`1px solid ${t.result==="Win"?`${B.teal}30`:`${B.loss}30`}`,
                        borderLeft:`4px solid ${t.result==="Win"?B.teal:B.loss}`,
                        cursor:"pointer",transition:"all 0.15s"
                      }}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                          <div style={{display:"flex",gap:8,alignItems:"center"}}>
                            <span style={{fontSize:11,padding:"2px 9px",borderRadius:5,fontWeight:700,background:`${INST_COLOR[t.instrument]||B.teal}20`,color:INST_COLOR[t.instrument]||B.teal}}>{t.instrument}</span>
                            <span style={{fontSize:13,fontWeight:700,color:t.direction==="Long"?"#4ade80":"#f87171"}}>{t.direction}</span>
                            <span style={{fontSize:11,color:B.textMuted}}>{t.contracts} contract{t.contracts!==1?"s":""}</span>
                          </div>
                          <div style={{display:"flex",alignItems:"center",gap:10}}>
                            <span style={{fontSize:18,fontWeight:800,fontFamily:"monospace",color:pnlColor(t.pnl)}}>{fmt(t.pnl)}</span>
                            <span style={{fontSize:11,color:B.textMuted}}>→</span>
                          </div>
                        </div>
                        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:8}}>
                          {[{l:"Entry",v:t.entry||"--"},{l:"Exit",v:t.exit||"--"},{l:"R:R",v:t.rr||"--"},{l:"Session",v:t.session||"--"}].map(s=>(
                            <div key={s.l} style={{background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"8px 10px"}}>
                              <div style={{fontSize:9,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:3}}>{s.l}</div>
                              <div style={{fontSize:13,fontWeight:700,color:B.text,fontFamily:"monospace"}}>{String(s.v)}</div>
                            </div>
                          ))}
                        </div>
                        <div style={{display:"flex",gap:8}}>
                          <span style={{fontSize:10,padding:"2px 10px",borderRadius:20,background:`${B.purple}15`,color:B.purple,fontWeight:700}}>{t.setup}</span>
                          <span style={{fontSize:10,padding:"2px 10px",borderRadius:20,background:`${GRADE_COLOR[t.grade]||"#aaa"}15`,color:GRADE_COLOR[t.grade]||"#aaa",fontWeight:700}}>Grade: {t.grade}</span>
                          <span style={{fontSize:10,padding:"2px 10px",borderRadius:20,background:t.result==="Win"?`${B.profit}15`:`${B.loss}15`,color:t.result==="Win"?B.profit:B.loss,fontWeight:700}}>{t.result}</span>
                        </div>
                        {t.notes&&<div style={{marginTop:8,fontSize:12,color:B.textMuted,fontStyle:"italic"}}>📝 {t.notes}</div>}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CalendarView({trades, onGradeUpdate, onEdit}){
  const calMap=buildCalendar(trades);
  const allDates=trades.map(t=>t.date).sort();
  const latestDate=allDates[allDates.length-1]||new Date().toISOString().slice(0,10);
  const [calYear,setCalYear]=useState(parseInt(latestDate.slice(0,4)));
  const [calMonth,setCalMonth]=useState(parseInt(latestDate.slice(5,7))-1);
  const [selectedDay,setSelectedDay]=useState(null);
  const [manualNavCal,setManualNavCal]=useState(false);

  // Auto-update when new trades sync
  useEffect(()=>{
    if(manualNavCal)return;
    const dates=trades.map(t=>t.date).sort();
    const ld=dates[dates.length-1];
    if(ld){setCalYear(parseInt(ld.slice(0,4)));setCalMonth(parseInt(ld.slice(5,7))-1);}
  },[trades,manualNavCal]);

  const prevMonth=()=>{setManualNavCal(true);if(calMonth===0){setCalMonth(11);setCalYear(y=>y-1);}else setCalMonth(m=>m-1);};
  const nextMonth=()=>{setManualNavCal(true);if(calMonth===11){setCalMonth(0);setCalYear(y=>y+1);}else setCalMonth(m=>m+1);};
  const nowCal=new Date();
  const canGoForward=!(calYear===nowCal.getFullYear()&&calMonth===nowCal.getMonth());

  const yr=calYear,mo=calMonth;
  const mn=new Date(yr,mo,1).toLocaleString("default",{month:"long",year:"numeric"}).toUpperCase();
  const fd=new Date(yr,mo,1).getDay(),dim=new Date(yr,mo+1,0).getDate();
  const cells=[];for(let i=0;i<fd;i++)cells.push(null);for(let d=1;d<=dim;d++)cells.push(d);
  const weeks=[];for(let i=0;i<cells.length;i+=7)weeks.push(cells.slice(i,i+7));
  const calDays=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  const monthKey=`${yr}-${String(mo+1).padStart(2,"0")}`;
  const monthTrades=trades.filter(t=>t.date.startsWith(monthKey));
  const monthPnl=monthTrades.reduce((a,t)=>a+t.pnl,0);
  const vals=Object.values(calMap).filter((_,i)=>Object.keys(calMap)[i].startsWith(monthKey));
  const greenDays=Object.entries(calMap).filter(([k,v])=>k.startsWith(monthKey)&&v.pnl>0).length;
  const redDays=Object.entries(calMap).filter(([k,v])=>k.startsWith(monthKey)&&v.pnl<0).length;

  // Compute weekly P&L for sidebar
  const weeklyPnl = weeks.map((week) => {
    let wpnl=0,wdays=0,wwins=0;
    week.forEach(day=>{
      if(!day)return;
      const ds=`${yr}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
      if(calMap[ds]){wpnl+=calMap[ds].pnl;wdays++;if(calMap[ds].pnl>0)wwins++;}
    });
    return{pnl:Math.round(wpnl*100)/100,days:wdays,wins:wwins};
  });

  return(
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      {selectedDay&&<DayJournalModal date={selectedDay} trades={trades} onClose={()=>setSelectedDay(null)} onGradeUpdate={onGradeUpdate} onEdit={onEdit}/>}

      {/* Stats */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}>
        <StatCard label="Month P&L" value={monthTrades.length?fmt(monthPnl):"--"} grad={monthPnl>=0?GTB:undefined} accent={monthPnl>=0?B.teal:B.loss} sub={`${monthTrades.length} trades`}/>
        <StatCard label="Green Days" value={greenDays} accent={B.profit} sub="Profitable days"/>
        <StatCard label="Red Days" value={redDays} accent={B.loss} sub="Losing days"/>
        <StatCard label="Best Day" value={Object.entries(calMap).filter(([k])=>k.startsWith(monthKey)).length?fmt(Math.max(...Object.entries(calMap).filter(([k])=>k.startsWith(monthKey)).map(([,v])=>v.pnl))):"--"} grad={GTB} accent={B.teal} sub="Single day high"/>
      </div>

      {/* Calendar */}
      <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:26}}>
        {/* Header with navigation */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <button onClick={prevMonth} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:8,color:B.textMuted,cursor:"pointer",fontSize:18,width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center"}}>‹</button>
            <span style={{fontSize:14,fontWeight:800,background:GL,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",letterSpacing:3,minWidth:200,textAlign:"center"}}>{mn}</span>
            <button onClick={nextMonth} disabled={!canGoForward} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:8,color:!canGoForward?B.textDim:B.textMuted,cursor:!canGoForward?"default":"pointer",fontSize:18,width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center"}}>›</button>
          </div>
          <div style={{display:"flex",gap:16,alignItems:"center"}}>
            <span style={{fontSize:13,fontWeight:700,fontFamily:"monospace",color:pnlColor(monthPnl)}}>{monthTrades.length?fmt(monthPnl):"$0"}</span>
            <span style={{fontSize:11,color:B.textMuted}}><span style={{color:B.profit,fontWeight:700}}>{greenDays}</span> green · <span style={{color:B.loss,fontWeight:700}}>{redDays}</span> red</span>
          </div>
        </div>

        {/* Day headers + Week total header */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr) 100px",gap:6,marginBottom:8}}>
          {calDays.map(d=><div key={d} style={{textAlign:"center",fontSize:10,color:B.textMuted,letterSpacing:1.5,paddingBottom:6}}>{d}</div>)}
        </div>

        {/* Weeks */}
        {weeks.map((w,wi)=>(
          <div key={wi} style={{display:"grid",gridTemplateColumns:"repeat(7,1fr) 100px",gap:6,marginBottom:6}}>
            {w.map((day,di)=>{
              if(!day)return <div key={di}/>;
              const ds=`${yr}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
              const data=calMap[ds];
              const isToday=ds===new Date().toISOString().slice(0,10);
              const isWeekend=di===0||di===6;
              return(
                <div key={di} onClick={()=>setSelectedDay(ds)} style={{
                  minHeight:72,borderRadius:10,padding:"8px 10px",
                  background:data?(data.pnl>0?`${B.teal}10`:`${B.loss}10`):isWeekend?"rgba(255,255,255,0.005)":"rgba(255,255,255,0.015)",
                  border:`1px solid ${data?(data.pnl>0?`${B.teal}35`:`${B.loss}35`):B.border}`,
                  outline:isToday?`2px solid ${B.blue}60`:"none",
                  cursor:"pointer",transition:"all 0.15s",
                  opacity:isWeekend&&!data?0.4:1,
                }}>
                  <div style={{fontSize:11,color:data?B.text:B.textDim,fontWeight:700,marginBottom:4}}>{day}</div>
                  {data?(
                    <>
                      <div style={{fontSize:12,fontWeight:800,fontFamily:"monospace",color:pnlColor(data.pnl),lineHeight:1}}>{fmt(data.pnl)}</div>
                      <div style={{fontSize:9,color:B.textMuted,marginTop:3}}>{data.count} trade{data.count!==1?"s":""}</div>
                      <div style={{fontSize:9,color:data.pnl>0?B.profit:B.loss,marginTop:2}}>{data.pnl>0?"▲":"▼"}</div>
                    </>
                  ):(
                    <div style={{fontSize:9,color:B.textDim,marginTop:4}}>click to journal</div>
                  )}
                </div>
              );
            })}
            {/* Weekly total */}
            <div style={{
              borderRadius:10,padding:"8px 10px",
              background:weeklyPnl[wi]?.pnl>0?`${B.teal}08`:weeklyPnl[wi]?.pnl<0?`${B.loss}08`:"rgba(255,255,255,0.01)",
              border:`1px solid ${weeklyPnl[wi]?.pnl>0?`${B.teal}30`:weeklyPnl[wi]?.pnl<0?`${B.loss}30`:B.border}`,
              display:"flex",flexDirection:"column",justifyContent:"center",alignItems:"center",minHeight:72,
            }}>
              <div style={{fontSize:9,color:B.textMuted,letterSpacing:1,marginBottom:3}}>WK {wi+1}</div>
              {weeklyPnl[wi]?.days>0?<>
                <div style={{fontSize:12,fontWeight:800,fontFamily:"monospace",color:weeklyPnl[wi].pnl>0?B.profit:B.loss,lineHeight:1.2}}>{weeklyPnl[wi].pnl>0?"+":""}{Math.round(weeklyPnl[wi].pnl)}</div>
                <div style={{fontSize:9,color:B.textMuted,marginTop:3}}>{weeklyPnl[wi].days}d</div>
              </>:<div style={{fontSize:9,color:B.textDim}}>—</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlaybookView({trades=[]}){
  const STORAGE_KEY="tca_strategies_v1";
  const [strategies,setStrategies]=useState([]);
  const [accounts,setAccounts]=useState([
    {id:"main",label:"Live Account",type:"live",color:"#00D4A8",startingBalance:0},
    {id:"apex_eval",label:"Apex Eval",type:"eval",color:"#4F8EF7",startingBalance:0},
    {id:"apex_demo",label:"Apex Demo",type:"demo",color:"#8B5CF6",startingBalance:0},
  ]);
  const [activeAccount,setActiveAccount]=useState("all");
  const [sel,setSel]=useState(null);
  const [showForm,setShowForm]=useState(false);
  const [editStrat,setEditStrat]=useState(null);
  const [loaded,setLoaded]=useState(false);

  useEffect(()=>{
    try{const l=localStorage.getItem("pref_"+STORAGE_KEY);if(l)setStrategies(JSON.parse(l));}catch(e){}
    (async()=>{
      try{
        const{data}=await supabase.from("user_preferences").select("value").eq("key",STORAGE_KEY).single();
        if(data?.value){setStrategies(JSON.parse(data.value));localStorage.setItem("pref_"+STORAGE_KEY,data.value);}
      }catch(e){}
      setLoaded(true);
    })();
  },[]);

  useEffect(()=>{
    if(!loaded)return;
    const val=JSON.stringify(strategies);
    localStorage.setItem("pref_"+STORAGE_KEY,val);
    (async()=>{const{data:{user}}=await supabase.auth.getUser();await supabase.from("user_preferences").upsert({user_id:user?.id,key:STORAGE_KEY,value:val,updated_at:new Date().toISOString()},{onConflict:"user_id,key"});})().catch(()=>{});
  },[strategies,loaded]);

  const handleSave=(strat)=>{
    if(editStrat){
      setStrategies(ss=>ss.map(s=>s.id===strat.id?strat:s));
      if(sel?.id===strat.id)setSel(strat);
    }else{
      setStrategies(ss=>[...ss,{...strat,id:`s_${Date.now()}`}]);
    }
    setShowForm(false);setEditStrat(null);
  };

  const handleDelete=(id)=>{
    setStrategies(ss=>ss.filter(s=>s.id!==id));
    if(sel?.id===id)setSel(null);
  };

  // Compute live stats from real trades for each strategy
  const getStratStats=(strat)=>{
    const matched=trades.filter(t=>
      (t.strategy&&t.strategy===strat.name)||
      (t.setup&&t.setup===strat.name)
    );
    const wins=matched.filter(t=>t.result==="Win");
    const losses=matched.filter(t=>t.result==="Loss");
    const pnl=Math.round(matched.reduce((a,t)=>a+t.pnl,0)*100)/100;
    const wr=matched.length?Math.round((wins.length/matched.length)*100):0;
    const grossWin=wins.reduce((a,t)=>a+t.pnl,0);
    const grossLoss=Math.abs(losses.reduce((a,t)=>a+t.pnl,0));
    const avgWin=wins.length?Math.round(grossWin/wins.length*100)/100:0;
    const avgLoss=losses.length?Math.round(grossLoss/losses.length*100)/100:0;
    const profitFactor=grossLoss>0?Math.round((grossWin/grossLoss)*100)/100:wins.length>0?"∞":0;
    const expectancy=matched.length?Math.round(pnl/matched.length*100)/100:0;
    // Max consecutive losses
    let maxConsecLoss=0,curLoss=0;
    [...matched].sort((a,b)=>a.date.localeCompare(b.date)).forEach(t=>{
      if(t.result==="Loss"){curLoss++;maxConsecLoss=Math.max(maxConsecLoss,curLoss);}
      else curLoss=0;
    });
    return{trades:matched.length,wins:wins.length,losses:losses.length,pnl,wr,avgWin,avgLoss,profitFactor,expectancy,maxConsecLoss};
  };

  return(
    <div style={{display:"flex",flexDirection:"column",gap:0}}>
      {showForm&&<StrategyForm strat={editStrat} onSave={handleSave} onClose={()=>{setShowForm(false);setEditStrat(null);}}/>}

      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <div>
          <div style={{fontSize:13,color:B.textMuted}}>Build and track your personal trading strategies</div>
        </div>
        <button onClick={()=>{setEditStrat(null);setShowForm(true);}} style={{padding:"9px 20px",borderRadius:10,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:13,fontWeight:800}}>+ Create Strategy</button>
      </div>

      {/* Stats row */}
      {strategies.length>0&&(
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14,marginBottom:20}}>
          {[
            {label:"Best Performing",value:strategies.length?strategies.map(s=>({...s,...getStratStats(s)})).sort((a,b)=>b.pnl-a.pnl)[0]?.name||"--":"--",sub:(()=>{const mx=strategies.length?Math.max(...strategies.map(s=>getStratStats(s).pnl)):0;return strategies.length?fmt(mx):"-";})(),color:B.teal},
            {label:"Least Performing",value:strategies.map(s=>({...s,...getStratStats(s)})).sort((a,b)=>a.pnl-b.pnl)[0]?.name||"--",sub:(()=>{const mn=strategies.length?Math.min(...strategies.map(s=>getStratStats(s).pnl)):0;return strategies.length?fmt(mn):"-";})(),color:B.loss},
            {label:"Most Active",value:strategies.map(s=>({...s,...getStratStats(s)})).sort((a,b)=>b.trades-a.trades)[0]?.name||"--",sub:(()=>{const mx=strategies.length?Math.max(...strategies.map(s=>getStratStats(s).trades)):0;return `${mx} trades`;})(),color:B.blue},
            {label:"Best Win Rate",value:strategies.map(s=>({...s,...getStratStats(s)})).sort((a,b)=>b.wr-a.wr)[0]?.name||"--",sub:(()=>{const mx=strategies.length?Math.max(...strategies.map(s=>getStratStats(s).wr)):0;return `${mx}% WR`;})(),color:B.purple},
          ].map(s=>(
            <div key={s.label} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:12,padding:"14px 18px",position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:`linear-gradient(90deg,${s.color},transparent)`}}/>
              <div style={{fontSize:9,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:6}}>{s.label}</div>
              <div style={{fontSize:13,fontWeight:700,color:B.text,marginBottom:3,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{s.value}</div>
              <div style={{fontSize:12,color:s.color,fontWeight:700}}>{s.sub}</div>
            </div>
          ))}
        </div>
      )}

      {strategies.length===0?(
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:360,gap:16,background:B.surface,border:`1px solid ${B.border}`,borderRadius:14}}>
          <TCAIcon size={56}/>
          <div style={{fontSize:16,fontWeight:700,color:B.text}}>No strategies yet</div>
          <div style={{fontSize:13,color:B.textMuted,textAlign:"center",lineHeight:1.6}}>Create your first trading strategy.<br/>Track setups, rules, and performance.</div>
          <button onClick={()=>setShowForm(true)} style={{padding:"10px 24px",borderRadius:10,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:13,fontWeight:800,marginTop:8}}>+ Create Strategy</button>
        </div>
      ):(
        <div style={{display:"grid",gridTemplateColumns:"280px 1fr",gap:16}}>
          {/* Strategy list */}
          <div style={{display:"flex",flexDirection:"column",gap:8}}>
            {strategies.map((s,i)=>{
              const grads=[GL,GTB,GBP,GTB,GL];
              const live=getStratStats(s);
              return(
                <div key={s.id} onClick={()=>setSel(s)} style={{
                  padding:"14px 16px",borderRadius:12,cursor:"pointer",
                  background:sel?.id===s.id?`${B.teal}07`:B.surface,
                  border:`1px solid ${sel?.id===s.id?`${B.teal}40`:B.border}`,
                  borderLeft:`3px solid ${sel?.id===s.id?B.teal:"transparent"}`,
                  transition:"all 0.15s"
                }}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:6}}>
                    <div style={{fontSize:13,fontWeight:700,color:B.text,flex:1,marginRight:8}}>{s.name}</div>
                    <div style={{fontSize:13,fontWeight:800,fontFamily:"monospace",color:pnlColor(live.pnl),whiteSpace:"nowrap"}}>{fmt(live.pnl)}</div>
                  </div>
                  <div style={{display:"flex",gap:8,alignItems:"center"}}>
                    {s.instruments?.map(inst=>(<span key={inst} style={{fontSize:10,padding:"1px 7px",borderRadius:4,background:`${B.purple}20`,color:B.purple,fontWeight:700}}>{inst}</span>))}
                    <span style={{fontSize:11,color:B.textMuted,marginLeft:"auto"}}>{s.trades||0} trades</span>
                  </div>
                  {s.winRate!=null&&(
                    <div style={{marginTop:8,height:3,background:"rgba(255,255,255,0.05)",borderRadius:2,overflow:"hidden"}}>
                      <div style={{height:"100%",width:`${s.winRate}%`,background:grads[i%grads.length],borderRadius:2}}/>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Strategy detail */}
          <div>
            {sel?(
              <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:28}}>
                <div style={{height:3,background:GL,borderRadius:3,marginBottom:24}}/>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
                  <div>
                    <div style={{fontSize:22,fontWeight:800,color:B.text,marginBottom:8}}>{sel.name}</div>
                    <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                      {sel.instruments?.map(i=>(<span key={i} style={{fontSize:11,padding:"3px 10px",borderRadius:6,background:`${B.purple}15`,color:B.purple,fontWeight:700}}>{i}</span>))}
                      {sel.tags?.split(",").filter(Boolean).map(t=>(<span key={t} style={{fontSize:11,padding:"3px 10px",borderRadius:6,background:`${B.blue}15`,color:B.blue,fontWeight:700}}>{t.trim()}</span>))}
                    </div>
                  </div>
                  <div style={{display:"flex",gap:8}}>
                    <button onClick={()=>{setEditStrat(sel);setShowForm(true);}} style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${B.blue}40`,background:`${B.blue}12`,color:B.blue,cursor:"pointer",fontSize:12,fontWeight:700}}>Edit</button>
                    <button onClick={()=>handleDelete(sel.id)} style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${B.loss}40`,background:`${B.loss}12`,color:B.loss,cursor:"pointer",fontSize:12,fontWeight:700}}>Delete</button>
                  </div>
                </div>

                {/* Stats */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:20}}>
                  {[
                    {label:"Total Net P&L",value:fmt(getStratStats(sel).pnl),color:pnlColor(getStratStats(sel).pnl)},
                    {label:"Win Rate",value:`${getStratStats(sel).wr}%`,color:B.teal},
                    {label:"Trades",value:getStratStats(sel).trades||"--",color:B.blue},
                    {label:"Avg Winner",value:getStratStats(sel).avgWin?`+$${getStratStats(sel).avgWin}`:"--",color:B.profit},
                    {label:"Avg Loser",value:getStratStats(sel).avgLoss?`-$${getStratStats(sel).avgLoss}`:"--",color:B.loss},
                    {label:"Profit Factor",value:getStratStats(sel).profitFactor||"--",color:B.purple},
                    {label:"Expectancy",value:getStratStats(sel).expectancy?`$${getStratStats(sel).expectancy}`:"--",color:B.spark},
                    {label:"Max Consec. Loss",value:getStratStats(sel).maxConsecLoss||"0",color:B.loss},
                    {label:"Missed Trades",value:sel.missedTrades||"0",color:B.textMuted},
                  ].map(s=>(
                    <div key={s.label} style={{background:"rgba(0,0,0,0.3)",borderRadius:10,padding:"12px 14px",border:`1px solid ${B.border}`}}>
                      <div style={{fontSize:9,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:5}}>{s.label}</div>
                      <div style={{fontSize:16,fontWeight:800,color:s.color,fontFamily:"monospace"}}>{s.value}</div>
                    </div>
                  ))}
                </div>

                {/* Description */}
                {sel.description&&(
                  <div style={{background:"rgba(0,0,0,0.3)",borderRadius:12,padding:18,marginBottom:16,border:`1px solid ${B.border}`}}>
                    <div style={{fontSize:10,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>Strategy Description</div>
                    <p style={{fontSize:14,color:"#C8C4D8",lineHeight:1.8,margin:0}}>{sel.description}</p>
                  </div>
                )}

                {/* Rules */}
                {sel.rules&&(
                  <div style={{background:"rgba(0,0,0,0.3)",borderRadius:12,padding:18,border:`1px solid ${B.border}`}}>
                    <div style={{fontSize:10,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>Entry Rules</div>
                    <p style={{fontSize:14,color:"#C8C4D8",lineHeight:1.8,margin:0,whiteSpace:"pre-line"}}>{sel.rules}</p>
                  </div>
                )}
              </div>
            ):(
              <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:360,gap:14,background:B.surface,border:`1px solid ${B.border}`,borderRadius:14}}>
                <TCAIcon size={52}/>
                <div style={{fontSize:13,color:B.textMuted}}>Select a strategy to view details</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StrategyForm({strat, onSave, onClose}){
  const blank={name:"",instruments:["MES"],tags:"",description:"",rules:"",winRate:"",trades:"",pnl:"",avgWin:"",avgLoss:"",profitFactor:"",expectancy:"",missedTrades:"0"};
  const [form,setForm]=useState(strat?{...strat,instruments:strat.instruments||["MES"]}:blank);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  // accounts from parent - we'll read from localStorage
  const [formAccounts,setFormAccounts]=useState([{id:"main",label:"Live Account"},{id:"apex_eval",label:"Apex Eval"},{id:"apex_demo",label:"Apex Demo"}]);
  useEffect(()=>{try{const l=localStorage.getItem("pref_tca_accounts_v1");if(l)setFormAccounts(JSON.parse(l));}catch(e){};},[]);
  const toggleInst=(inst)=>setForm(f=>({...f,instruments:f.instruments.includes(inst)?f.instruments.filter(i=>i!==inst):[...f.instruments,inst]}));
  const handleSave=()=>{
    if(!form.name.trim())return;
    onSave({...form,id:strat?.id||`s_${Date.now()}`,pnl:parseFloat(form.pnl)||0,winRate:parseFloat(form.winRate)||0,trades:parseInt(form.trades)||0,avgWin:parseFloat(form.avgWin)||0,avgLoss:parseFloat(form.avgLoss)||0});
  };
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(6px)"}}>
      <div style={{background:"#13121A",border:`1px solid ${B.border}`,borderRadius:18,padding:32,width:600,maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{height:3,background:GL,borderRadius:3,marginBottom:24}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
          <div style={{fontSize:18,fontWeight:800,color:B.text}}>{strat?"Edit Strategy":"Create Strategy"}</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:B.textMuted,cursor:"pointer",fontSize:22}}>×</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <div style={{gridColumn:"1/-1"}}>
            <label style={lS}>Strategy Name *</label>
            <input value={form.name} onChange={e=>set("name",e.target.value)} style={iS} placeholder="e.g. 10AM Triple TF Confluence"/>
          </div>
          <div style={{gridColumn:"1/-1"}}>
            <label style={lS}>Instruments</label>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {INSTRUMENTS.map(inst=>(
                <button key={inst} onClick={()=>toggleInst(inst)} style={{padding:"6px 14px",borderRadius:20,border:"1px solid",cursor:"pointer",fontSize:12,fontWeight:700,
                  borderColor:form.instruments?.includes(inst)?B.teal:B.border,
                  background:form.instruments?.includes(inst)?`${B.teal}15`:"transparent",
                  color:form.instruments?.includes(inst)?B.teal:B.textMuted}}>{inst}</button>
              ))}
            </div>
          </div>
          <div style={{gridColumn:"1/-1"}}>
            <label style={lS}>Tags (comma separated)</label>
            <input value={form.tags} onChange={e=>set("tags",e.target.value)} style={iS} placeholder="e.g. ICT, Confluence, AM Session"/>
          </div>
          <div><label style={lS}>Win Rate (%)</label><input type="number" value={form.winRate} onChange={e=>set("winRate",e.target.value)} style={iS} placeholder="0"/></div>
          <div><label style={lS}>Total Trades</label><input type="number" value={form.trades} onChange={e=>set("trades",e.target.value)} style={iS} placeholder="0"/></div>
          <div><label style={lS}>Total P&L ($)</label><input type="number" value={form.pnl} onChange={e=>set("pnl",e.target.value)} style={iS} placeholder="0"/></div>
          <div><label style={lS}>Profit Factor</label><input type="number" step="0.01" value={form.profitFactor} onChange={e=>set("profitFactor",e.target.value)} style={iS} placeholder="0.00"/></div>
          <div><label style={lS}>Avg Winner ($)</label><input type="number" value={form.avgWin} onChange={e=>set("avgWin",e.target.value)} style={iS} placeholder="0"/></div>
          <div><label style={lS}>Avg Loser ($)</label><input type="number" value={form.avgLoss} onChange={e=>set("avgLoss",e.target.value)} style={iS} placeholder="0"/></div>
          <div><label style={lS}>Expectancy ($)</label><input type="number" value={form.expectancy} onChange={e=>set("expectancy",e.target.value)} style={iS} placeholder="0"/></div>
          <div><label style={lS}>Missed Trades</label><input type="number" value={form.missedTrades} onChange={e=>set("missedTrades",e.target.value)} style={iS} placeholder="0"/></div>
          <div style={{gridColumn:"1/-1"}}>
            <label style={lS}>Strategy Description</label>
            <textarea value={form.description} onChange={e=>set("description",e.target.value)} rows={3} style={{...iS,resize:"vertical"}} placeholder="What is this strategy? When do you use it?"/>
          </div>
          <div style={{gridColumn:"1/-1"}}>
            <label style={lS}>Entry Rules</label>
            {/* Entry rules as checklist items */}
            <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:8}}>
              {(Array.isArray(form.rules)?form.rules:(form.rules?form.rules.split("\n").filter(Boolean).map((r,i)=>({id:i,text:r,required:true})):[]))
                .map((rule,i)=>(
                  <div key={rule.id||i} style={{display:"flex",gap:8,alignItems:"center"}}>
                    <div style={{width:14,height:14,borderRadius:3,border:`2px solid ${B.teal}`,flexShrink:0}}/>
                    <input value={rule.text} onChange={e=>{
                      const arr=Array.isArray(form.rules)?[...form.rules]:[];
                      arr[i]={...arr[i],text:e.target.value};
                      set("rules",arr);
                    }} style={{...iS,padding:"5px 10px",fontSize:12,flex:1}}/>
                    <button onClick={()=>{
                      const arr=Array.isArray(form.rules)?form.rules.filter((_,j)=>j!==i):[];
                      set("rules",arr);
                    }} style={{background:"none",border:"none",color:B.loss,cursor:"pointer",fontSize:14,padding:"2px 4px"}}>×</button>
                  </div>
                ))}
            </div>
            <button onClick={()=>{
              const arr=Array.isArray(form.rules)?[...form.rules]:[];
              arr.push({id:Date.now(),text:"",required:true});
              set("rules",arr);
            }} style={{padding:"5px 12px",borderRadius:7,border:`1px dashed ${B.teal}40`,background:"transparent",color:B.teal,cursor:"pointer",fontSize:11}}>
              + Add Rule
            </button>
          </div>
        </div>
        <div style={{display:"flex",gap:10,marginTop:24,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{padding:"10px 22px",borderRadius:10,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:13,fontWeight:600}}>Cancel</button>
          <button onClick={handleSave} style={{padding:"10px 28px",borderRadius:10,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:13,fontWeight:800}}>{strat?"Save Changes":"Create Strategy"}</button>
        </div>
      </div>
    </div>
  );
}


// ── WIDGETS PAGE ──────────────────────────────────────────────────────────────

// ── Time of Day P&L Chart ────────────────────────────────────────────────────
function TimeOfDayWidget({trades}){
  const hourMap={};
  trades.forEach(t=>{
    const hr=t.session==="AM"?9:t.session==="Mid"?11:t.session==="PM"?14:16;
    if(!hourMap[hr])hourMap[hr]={pnl:0,wins:0,total:0};
    hourMap[hr].pnl+=t.pnl;
    hourMap[hr].total++;
    if(t.result==="Win")hourMap[hr].wins++;
  });
  const hours=Array.from({length:9},(_,i)=>i+8).map(h=>({
    hour:`${h}:00`,
    h,
    pnl:hourMap[h]?.pnl||0,
    wr:hourMap[h]?Math.round((hourMap[h].wins/hourMap[h].total)*100):0,
    trades:hourMap[h]?.total||0,
  }));
  const maxAbs=Math.max(...hours.map(h=>Math.abs(h.pnl)),1);
  return(
    <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:20,height:"100%"}}>
      <div style={{fontSize:11,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:16}}>⏰ Best Hours to Trade</div>
      <div style={{display:"flex",alignItems:"flex-end",gap:6,height:120}}>
        {hours.map(h=>{
          const pct=Math.abs(h.pnl)/maxAbs;
          const barH=Math.max(pct*100,4);
          return(
            <div key={h.hour} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
              <div style={{fontSize:9,color:pnlColor(h.pnl),fontWeight:700,fontFamily:"monospace",whiteSpace:"nowrap"}}>
                {h.pnl!==0?fmt(h.pnl):""}
              </div>
              <div style={{
                width:"100%",height:barH,borderRadius:4,
                background:h.pnl>0?`${B.teal}${Math.round(40+pct*180).toString(16)}`:
                           h.pnl<0?`${B.loss}${Math.round(40+pct*180).toString(16)}`:"rgba(255,255,255,0.05)",
                transition:"height 0.6s ease",position:"relative"
              }}/>
              <div style={{fontSize:8,color:B.textMuted,textAlign:"center"}}>{h.hour}</div>
              {h.trades>0&&<div style={{fontSize:8,color:B.textMuted}}>{h.trades}t</div>}
            </div>
          );
        })}
      </div>
      <div style={{marginTop:12,display:"flex",gap:16,fontSize:10,color:B.textMuted}}>
        {hours.filter(h=>h.trades>0).sort((a,b)=>b.pnl-a.pnl).slice(0,1).map(h=>(
          <span key={h.hour}>✅ Best: <span style={{color:B.profit,fontWeight:700}}>{h.hour}</span></span>
        ))}
        {hours.filter(h=>h.trades>0).sort((a,b)=>a.pnl-b.pnl).slice(0,1).map(h=>(
          <span key={h.hour}>⚠️ Avoid: <span style={{color:B.loss,fontWeight:700}}>{h.hour}</span></span>
        ))}
      </div>
    </div>
  );
}

// ── Session Heatmap ──────────────────────────────────────────────────────────
function SessionHeatmapWidget({trades}){
  const sessions=["AM","Mid","PM","After"];
  const [selectedSession,setSelectedSession]=useState(null);

  const data=sessions.map(s=>{
    const st=trades.filter(t=>t.session===s);
    const wins=st.filter(t=>t.result==="Win");
    const pnl=st.reduce((a,t)=>a+t.pnl,0);
    const wr=st.length?Math.round((wins.length/st.length)*100):0;
    return{session:s,trades:st,count:st.length,wins:wins.length,pnl,wr};
  }).filter(s=>s.count>0);

  const maxPnl=Math.max(...data.map(d=>Math.abs(d.pnl)),1);
  const sessionTrades=selectedSession?data.find(d=>d.session===selectedSession)?.trades||[]:[];

  return(
    <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:20,height:"100%",display:"flex",flexDirection:"column"}}>
      <div style={{fontSize:11,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:16}}>🌡️ Session Heatmap</div>

      {/* Session cards */}
      <div style={{display:"flex",flexDirection:"column",gap:10,flexShrink:0}}>
        {data.map(d=>{
          const intensity=Math.abs(d.pnl)/maxPnl;
          const isSelected=selectedSession===d.session;
          const bg=d.pnl>0
            ?`rgba(0,212,168,${0.08+intensity*0.25})`
            :`rgba(240,90,126,${0.08+intensity*0.25})`;
          return(
            <div key={d.session}
              onClick={()=>setSelectedSession(isSelected?null:d.session)}
              style={{borderRadius:10,padding:"12px 16px",background:isSelected?`${d.pnl>0?B.teal:B.loss}20`:bg,
                border:`2px solid ${isSelected?(d.pnl>0?B.teal:B.loss):(d.pnl>0?B.borderTeal:B.borderPurp)}`,
                cursor:"pointer",transition:"all 0.15s"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{fontSize:13,fontWeight:700,color:B.text}}>{d.session} Session</div>
                    {isSelected&&<div style={{fontSize:9,padding:"1px 6px",borderRadius:4,background:`${B.teal}20`,color:B.teal,fontWeight:700}}>▼ open</div>}
                  </div>
                  <div style={{fontSize:10,color:B.textMuted,marginTop:2}}>{d.count} trades · {d.wr}% WR · click to view</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:18,fontWeight:800,fontFamily:"monospace",color:pnlColor(d.pnl)}}>{fmt(d.pnl)}</div>
                  <div style={{fontSize:10,color:B.textMuted}}>{d.wins}W / {d.count-d.wins}L</div>
                </div>
              </div>
              <div style={{marginTop:8,height:4,background:"rgba(255,255,255,0.05)",borderRadius:2,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${d.wr}%`,background:d.pnl>0?GTB:GBP,borderRadius:2,transition:"width 0.8s"}}/>
              </div>
            </div>
          );
        })}
      </div>

      {/* Drill-down trade list */}
      {selectedSession&&sessionTrades.length>0&&(
        <div style={{marginTop:14,flex:1,overflowY:"auto"}}>
          <div style={{fontSize:10,color:B.teal,letterSpacing:1.5,textTransform:"uppercase",marginBottom:8,fontWeight:700}}>
            {selectedSession} Session — {sessionTrades.length} Trades
          </div>
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {[...sessionTrades].sort((a,b)=>b.date.localeCompare(a.date)).map(t=>(
              <div key={t.id} style={{
                display:"grid",gridTemplateColumns:"80px 55px 1fr 75px",gap:8,
                padding:"8px 10px",borderRadius:8,
                background:t.result==="Win"?`${B.teal}08`:`${B.loss}08`,
                border:`1px solid ${t.result==="Win"?`${B.teal}20`:`${B.loss}20`}`,
                alignItems:"center",
              }}>
                <div style={{fontSize:10,color:B.textMuted,fontFamily:"monospace"}}>{t.date.slice(5)}</div>
                <div style={{fontSize:10}}>
                  <span style={{padding:"1px 6px",borderRadius:4,fontWeight:700,fontSize:9,
                    background:`${INST_COLOR[t.instrument]||B.teal}20`,
                    color:INST_COLOR[t.instrument]||B.teal}}>{t.instrument}</span>
                </div>
                <div style={{fontSize:11,color:t.direction==="Long"?"#4ade80":"#f87171",fontWeight:600}}>{t.direction} · {t.setup||"—"}</div>
                <div style={{fontSize:12,fontWeight:800,fontFamily:"monospace",color:pnlColor(t.pnl),textAlign:"right"}}>{fmt(t.pnl)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}


function SetupLeaderboardWidget({trades}){
  const setups=trades.reduce((m,t)=>{
    if(!m[t.setup])m[t.setup]={wins:0,total:0,pnl:0,name:t.setup};
    m[t.setup].total++;m[t.setup].pnl+=t.pnl;
    if(t.result==="Win")m[t.setup].wins++;
    return m;
  },{});
  const ranked=Object.values(setups).sort((a,b)=>b.pnl-a.pnl);
  const medals=["🥇","🥈","🥉"];
  return(
    <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:20,height:"100%"}}>
      <div style={{fontSize:11,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:16}}>🏆 Setup Leaderboard</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {ranked.map((s,i)=>(
          <div key={s.name} style={{
            display:"flex",alignItems:"center",gap:12,padding:"10px 14px",borderRadius:10,
            background:i===0?"rgba(0,212,168,0.07)":i===ranked.length-1?"rgba(240,90,126,0.05)":"rgba(255,255,255,0.02)",
            border:`1px solid ${i===0?B.borderTeal:i===ranked.length-1?`${B.loss}20`:B.border}`
          }}>
            <div style={{fontSize:18,width:24,textAlign:"center"}}>{medals[i]||`#${i+1}`}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:12,fontWeight:700,color:B.text,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{s.name}</div>
              <div style={{fontSize:10,color:B.textMuted,marginTop:2}}>{s.total} trades · {Math.round((s.wins/s.total)*100)}% WR</div>
            </div>
            <div style={{fontSize:14,fontWeight:800,fontFamily:"monospace",color:pnlColor(s.pnl),whiteSpace:"nowrap"}}>{fmt(s.pnl)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── AI Trade Coach ───────────────────────────────────────────────────────────
function AICoachWidget({trades, session}){
  const userId = session?.user?.id||"guest";
  const CACHE_KEY = "tca_aicoach_"+userId;
  const [analysis,setAnalysis]=useState(()=>{
    try{const c=localStorage.getItem("tca_aicoach_"+userId);if(c)return JSON.parse(c).data;}catch(e){}
    return null;
  });
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState("");
  const [tab,setTab]=useState("patterns"); // patterns | psychology | action

  const analyze=async()=>{
    if(!trades.length){setError("No trades to analyze yet.");return;}
    setLoading(true);setError("");setAnalysis(null);

    const stats={
      totalTrades:trades.length,
      winRate:Math.round((trades.filter(t=>t.result==="Win").length/trades.length)*100),
      totalPnl:trades.reduce((a,t)=>a+t.pnl,0),
      avgWin:Math.round(trades.filter(t=>t.result==="Win").reduce((a,t)=>a+t.pnl,0)/(trades.filter(t=>t.result==="Win").length||1)),
      avgLoss:Math.round(trades.filter(t=>t.result==="Loss").reduce((a,t)=>a+t.pnl,0)/(trades.filter(t=>t.result==="Loss").length||1)),
      sessions:["AM","Mid","PM","After"].map(s=>{
        const st=trades.filter(t=>t.session===s);
        return{session:s,trades:st.length,pnl:st.reduce((a,t)=>a+t.pnl,0),wr:st.length?Math.round((st.filter(t=>t.result==="Win").length/st.length)*100):0};
      }).filter(s=>s.trades>0),
      setups:Object.entries(trades.reduce((m,t)=>{if(!m[t.setup])m[t.setup]={wins:0,total:0,pnl:0};m[t.setup].total++;m[t.setup].pnl+=t.pnl;if(t.result==="Win")m[t.setup].wins++;return m;},{})).map(([k,v])=>({setup:k,...v,wr:Math.round((v.wins/v.total)*100)})),
      recentTrades:trades.slice(0,10).map(t=>({date:t.date,instrument:t.instrument,direction:t.direction,pnl:t.pnl,result:t.result,setup:t.setup,grade:t.grade,session:t.session})),
    };

    try{
      const res=await fetch("/api/coach",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({type:"full",stats})
      });
      if(!res.ok) throw new Error("Server error "+res.status);
      const data=await res.json();
      if(data.error) throw new Error(data.error);
      // Accept any response that has at least some useful data
      if(!data.score && !data.summary && !data.patterns) throw new Error("Invalid response format");
      setAnalysis(data);
      try{localStorage.setItem(CACHE_KEY,JSON.stringify({data,date:new Date().toISOString().slice(0,10)}));}catch(e){}
    }catch(e){
      setError("Analysis failed: "+e.message+". Please try again.");
      console.error("AI Coach error:", e.message);
    }
    setLoading(false);
  };

  const typeColor={positive:B.teal,negative:B.loss,neutral:B.blue};
  const typeIcon={positive:"✅",negative:"⚠️",neutral:"💡"};
  const priorityColor={high:B.loss,medium:"#f97316",low:B.blue};

  return(
    <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:20,height:"100%",display:"flex",flexDirection:"column"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontSize:11,color:B.textMuted,letterSpacing:2,textTransform:"uppercase"}}>🧠 AI Trade Coach</div>
        {!loading&&(
          <button onClick={analyze} style={{padding:"6px 14px",borderRadius:8,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:11,fontWeight:800}}>
            {analysis?"Re-analyze":"Analyze My Trades"}
          </button>
        )}
      </div>

      {!analysis&&!loading&&!error&&(
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,padding:"20px 0"}}>
          <div style={{fontSize:40}}>🧠</div>
          <div style={{fontSize:13,color:B.textMuted,textAlign:"center",lineHeight:1.6}}>
            Your personal AI trading coach.<br/>
            Spots patterns, flags psychology issues,<br/>
            gives you a concrete action plan.
          </div>
          <button onClick={analyze} style={{padding:"10px 24px",borderRadius:10,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:13,fontWeight:800,marginTop:8}}>
            Analyze My Trades →
          </button>
        </div>
      )}

      {loading&&(
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16}}>
          <div style={{width:40,height:40,border:`3px solid ${B.border}`,borderTop:`3px solid ${B.teal}`,borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
          <div style={{fontSize:13,color:B.textMuted}}>Analyzing your trading patterns...</div>
          <style>{`@keyframes spin{to{transform:rotate(360deg);}}`}</style>
        </div>
      )}

      {error&&(
        <div style={{padding:"12px 16px",borderRadius:8,background:`${B.loss}10`,border:`1px solid ${B.loss}30`,color:B.loss,fontSize:12,marginBottom:12}}>
          {error}
        </div>
      )}

      {analysis&&(
        <div style={{flex:1,display:"flex",flexDirection:"column",gap:12,overflowY:"auto"}}>
          {/* Score */}
          <div style={{display:"flex",alignItems:"center",gap:16,padding:"14px 16px",borderRadius:12,background:"rgba(0,0,0,0.3)",border:`1px solid ${B.border}`}}>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:32,fontWeight:800,background:GL,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",fontFamily:"monospace"}}>{analysis.score||analysis.overallScore||0}</div>
              <div style={{fontSize:9,color:B.textMuted,letterSpacing:1}}>/ 100</div>
            </div>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:B.text}}>{analysis.scoreLabel||(analysis.score>=80?"Excellent":analysis.score>=65?"Good":analysis.score>=50?"Average":"Needs Work")}</div>
              <div style={{fontSize:12,color:B.textMuted,lineHeight:1.5,marginTop:4}}>{analysis.summary||"Analysis complete."}</div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{display:"flex",gap:6}}>
            {[{id:"patterns",label:"Patterns"},
              {id:"psychology",label:"Psychology"},
              {id:"actions",label:"Action Plan"}
            ].map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{
                flex:1,padding:"7px",borderRadius:8,border:"1px solid",cursor:"pointer",fontSize:11,fontWeight:700,
                borderColor:tab===t.id?B.teal:B.border,
                background:tab===t.id?`${B.teal}15`:"transparent",
                color:tab===t.id?B.teal:B.textMuted
              }}>{t.label}</button>
            ))}
          </div>

          {/* Content */}
          {tab==="patterns"&&(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {analysis.patterns?.map((p,i)=>(
                <div key={i} style={{padding:"12px 14px",borderRadius:10,
                  background:`${typeColor[p.type]||B.blue}08`,
                  border:`1px solid ${typeColor[p.type]||B.blue}25`}}>
                  <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4}}>
                    <span>{typeIcon[p.type]||"💡"}</span>
                    <span style={{fontSize:12,fontWeight:700,color:typeColor[p.type]||B.blue}}>{p.title}</span>
                  </div>
                  <div style={{fontSize:11,color:B.textMuted,lineHeight:1.6}}>{p.detail}</div>
                </div>
              ))}
            </div>
          )}

          {tab==="psychology"&&(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {analysis.psychology?.map((p,i)=>(
                <div key={i} style={{padding:"12px 14px",borderRadius:10,
                  background:`${typeColor[p.type]||B.purple}08`,
                  border:`1px solid ${typeColor[p.type]||B.purple}25`}}>
                  <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:4}}>
                    <span>{typeIcon[p.type]||"💡"}</span>
                    <span style={{fontSize:12,fontWeight:700,color:typeColor[p.type]||B.purple}}>{p.title}</span>
                  </div>
                  <div style={{fontSize:11,color:B.textMuted,lineHeight:1.6}}>{p.detail}</div>
                </div>
              ))}
            </div>
          )}

          {tab==="actions"&&(
            <div style={{display:"flex",flexDirection:"column",gap:8}}>
              {analysis.actions?.map((a,i)=>(
                <div key={i} style={{padding:"12px 14px",borderRadius:10,
                  background:"rgba(0,0,0,0.3)",
                  border:`1px solid ${priorityColor[a.priority]||B.blue}30`,
                  borderLeft:`3px solid ${priorityColor[a.priority]||B.blue}`}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
                    <span style={{fontSize:12,fontWeight:700,color:B.text}}>{a.action}</span>
                    <span style={{fontSize:9,padding:"2px 8px",borderRadius:20,fontWeight:700,
                      background:`${priorityColor[a.priority]||B.blue}20`,
                      color:priorityColor[a.priority]||B.blue,
                      textTransform:"uppercase",letterSpacing:1}}>{a.priority}</span>
                  </div>
                  <div style={{fontSize:11,color:B.textMuted,lineHeight:1.5}}>{a.reasoning}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Win% / Avg Win / Avg Loss Chart ─────────────────────────────────────────
function WinAvgWidget({trades}){
  const sorted=[...trades].sort((a,b)=>a.date.localeCompare(b.date));
  const data=[];
  let wins=0,losses=0,winSum=0,lossSum=0;
  sorted.forEach(t=>{
    if(t.result==="Win"){wins++;winSum+=t.pnl;}
    else{losses++;lossSum+=t.pnl;}
    const total=wins+losses;
    data.push({date:t.date.slice(5),wr:total?Math.round((wins/total)*100):0,avgWin:wins?Math.round(winSum/wins):0,avgLoss:losses?Math.round(lossSum/losses):0});
  });
  if(!data.length)return(<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:200,color:B.textMuted,fontSize:13}}>No data yet</div>);
  const latest=data[data.length-1]||{};
  return(
    <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:20,height:"100%"}}>
      <div style={{fontSize:11,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Win% / Avg Win / Avg Loss</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:14}}>
        {[{l:"Win %",v:latest.wr+"%",c:B.teal},{l:"Avg Win",v:"$"+latest.avgWin,c:B.profit},{l:"Avg Loss",v:"$"+Math.abs(latest.avgLoss),c:B.loss}].map(s=>(
          <div key={s.l} style={{background:"rgba(0,0,0,0.3)",borderRadius:8,padding:"10px",textAlign:"center"}}>
            <div style={{fontSize:9,color:B.textMuted,letterSpacing:1,textTransform:"uppercase",marginBottom:4}}>{s.l}</div>
            <div style={{fontSize:16,fontWeight:800,color:s.c,fontFamily:"monospace"}}>{s.v}</div>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={130}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="wrG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={B.teal} stopOpacity={0.25}/><stop offset="100%" stopColor={B.teal} stopOpacity={0}/></linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/>
          <XAxis dataKey="date" tick={{fill:B.textDim,fontSize:9}} axisLine={false} tickLine={false} interval={Math.ceil(data.length/5)}/>
          <YAxis tick={{fill:B.textDim,fontSize:9}} axisLine={false} tickLine={false} tickFormatter={v=>v+"%"}/>
          <Tooltip content={({active,payload,label})=>{if(!active||!payload?.length)return null;return(<div style={{background:"#16151C",border:`1px solid ${B.border}`,borderRadius:8,padding:"8px 12px",fontSize:11}}><div style={{color:B.textMuted,marginBottom:4}}>{label}</div>{payload.map((p,i)=>(<div key={i} style={{color:p.color}}>{p.name}: {p.value}{p.name==="Win %"?"%":""}</div>))}</div>);}}/>
          <Area type="monotone" dataKey="wr" stroke={B.teal} fill="url(#wrG)" strokeWidth={2} name="Win %" dot={false}/>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function TradeTimeWidget({trades}){
  const hourMap={};
  trades.forEach(t=>{
    const hr=t.session==="AM"?9:t.session==="Mid"?11:t.session==="PM"?14:16;
    if(!hourMap[hr])hourMap[hr]={pnl:0,wins:0,total:0};
    hourMap[hr].pnl+=t.pnl;hourMap[hr].total++;
    if(t.result==="Win")hourMap[hr].wins++;
  });
  const data=Array.from({length:9},(_,i)=>i+8).map(h=>({hour:h+":00",pnl:Math.round((hourMap[h]?.pnl||0)*100)/100,trades:hourMap[h]?.total||0,wr:hourMap[h]?Math.round((hourMap[h].wins/hourMap[h].total)*100):0}));
  return(
    <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:20,height:"100%"}}>
      <div style={{fontSize:11,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:16}}>Trade Time Performance</div>
      <ResponsiveContainer width="100%" height={160}>
        <BarChart data={data} barSize={18}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false}/>
          <XAxis dataKey="hour" tick={{fill:B.textDim,fontSize:9}} axisLine={false} tickLine={false}/>
          <YAxis tick={{fill:B.textDim,fontSize:9}} axisLine={false} tickLine={false} tickFormatter={v=>"$"+v}/>
          <Tooltip content={({active,payload,label})=>{if(!active||!payload?.length)return null;const d=payload[0]?.payload;return(<div style={{background:"#16151C",border:`1px solid ${B.border}`,borderRadius:8,padding:"8px 12px",fontSize:11}}><div style={{color:B.textMuted}}>{label}</div><div style={{color:pnlColor(d.pnl),fontFamily:"monospace",fontWeight:700}}>{fmt(d.pnl)}</div><div style={{color:B.textMuted}}>{d.trades} trades</div></div>);}}/>
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)"/>
          <Bar dataKey="pnl" radius={[4,4,0,0]}>
            {data.map((d,i)=>(<Cell key={i} fill={d.pnl>=0?B.teal:B.loss} fillOpacity={d.trades>0?0.9:0.15}/>))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div style={{display:"flex",gap:6,marginTop:8,flexWrap:"wrap"}}>
        {data.filter(d=>d.trades>0).sort((a,b)=>b.pnl-a.pnl).slice(0,2).map((d,i)=>(
          <span key={d.hour} style={{fontSize:10,padding:"3px 10px",borderRadius:20,background:i===0?`${B.teal}15`:"rgba(255,255,255,0.04)",border:`1px solid ${i===0?B.borderTeal:B.border}`,color:i===0?B.teal:B.textMuted}}>Best: {d.hour} {fmt(d.pnl)}</span>
        ))}
      </div>
    </div>
  );
}

function TradeDurationWidget({trades}){
  const buckets={"<5m":{pnl:0,wins:0,total:0},"5-15m":{pnl:0,wins:0,total:0},"15-30m":{pnl:0,wins:0,total:0},"30-60m":{pnl:0,wins:0,total:0},">1h":{pnl:0,wins:0,total:0}};
  trades.forEach(t=>{
    const note=t.notes||"";
    const dm=note.match(/(\d+)h\s*(\d+)min|(\d+)min\s*(\d+)sec|(\d+)h|(\d+)min/);
    let mins=5;
    if(dm){if(dm[1])mins=parseInt(dm[1])*60+(parseInt(dm[2])||0);else if(dm[3])mins=parseInt(dm[3]);else if(dm[5])mins=parseInt(dm[5])*60;else if(dm[6])mins=parseInt(dm[6]);}
    const key=mins<5?"<5m":mins<15?"5-15m":mins<30?"15-30m":mins<60?"30-60m":">1h";
    buckets[key].pnl+=t.pnl;buckets[key].total++;
    if(t.result==="Win")buckets[key].wins++;
  });
  const data=Object.entries(buckets).map(([k,v])=>({d:k,...v,wr:v.total?Math.round((v.wins/v.total)*100):0}));
  const maxAbs=Math.max(...data.map(d=>Math.abs(d.pnl)),1);
  return(
    <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:20,height:"100%"}}>
      <div style={{fontSize:11,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:16}}>Trade Duration Performance</div>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        {data.map(d=>(
          <div key={d.d}>
            <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
              <span style={{fontSize:12,color:B.text,fontWeight:600}}>{d.d}</span>
              <div style={{display:"flex",gap:12,alignItems:"center"}}>
                <span style={{fontSize:10,color:B.textMuted}}>{d.total} trades · {d.wr}% WR</span>
                <span style={{fontSize:13,fontWeight:700,fontFamily:"monospace",color:pnlColor(d.pnl),minWidth:70,textAlign:"right"}}>{d.total?fmt(d.pnl):"--"}</span>
              </div>
            </div>
            <div style={{height:6,background:"rgba(255,255,255,0.05)",borderRadius:3,overflow:"hidden"}}>
              <div style={{height:"100%",width:d.total?(Math.abs(d.pnl)/maxAbs*100)+"%":"0%",background:d.pnl>=0?GTB:GBP,borderRadius:3,transition:"width 0.8s"}}/>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DailyCumulativeWidget({trades}){
  const sorted=[...trades].sort((a,b)=>a.date.localeCompare(b.date));
  const dayMap={};
  sorted.forEach(t=>{if(!dayMap[t.date])dayMap[t.date]=0;dayMap[t.date]+=t.pnl;});
  let cum=0;
  const data=Object.entries(dayMap).map(([date,daily])=>{cum+=daily;return{date:date.slice(5),daily:Math.round(daily*100)/100,cumulative:Math.round(cum*100)/100};});
  if(!data.length)return(<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:200,color:B.textMuted,fontSize:13}}>No data yet</div>);
  return(
    <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:20,height:"100%"}}>
      <div style={{fontSize:11,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:16}}>Daily & Cumulative Net P&L</div>
      <ResponsiveContainer width="100%" height={180}>
        <ComposedChart data={data}>
          <defs><linearGradient id="cumG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={B.blue} stopOpacity={0.2}/><stop offset="100%" stopColor={B.blue} stopOpacity={0}/></linearGradient></defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/>
          <XAxis dataKey="date" tick={{fill:B.textDim,fontSize:9}} axisLine={false} tickLine={false} interval={Math.ceil(data.length/7)}/>
          <YAxis yAxisId="l" tick={{fill:B.textDim,fontSize:9}} axisLine={false} tickLine={false} tickFormatter={v=>"$"+v}/>
          <YAxis yAxisId="r" orientation="right" tick={{fill:B.textDim,fontSize:9}} axisLine={false} tickLine={false} tickFormatter={v=>"$"+v}/>
          <Tooltip content={({active,payload,label})=>{if(!active||!payload?.length)return null;return(<div style={{background:"#16151C",border:`1px solid ${B.border}`,borderRadius:8,padding:"8px 12px",fontSize:11}}><div style={{color:B.textMuted,marginBottom:4}}>{label}</div>{payload.map((p,i)=>(<div key={i} style={{color:p.color,fontFamily:"monospace"}}>{p.name}: ${Math.abs(p.value)}</div>))}</div>);}}/>
          <ReferenceLine yAxisId="l" y={0} stroke="rgba(255,255,255,0.1)"/>
          <Bar yAxisId="l" dataKey="daily" name="Daily" maxBarSize={18} radius={[3,3,0,0]}>
            {data.map((d,i)=>(<Cell key={i} fill={d.daily>=0?B.teal:B.loss} fillOpacity={0.8}/>))}
          </Bar>
          <Area yAxisId="r" type="monotone" dataKey="cumulative" stroke={B.blue} fill="url(#cumG)" strokeWidth={2} name="Cumulative" dot={false}/>
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

function DrawdownWidget({trades}){
  const sorted=[...trades].sort((a,b)=>a.date.localeCompare(b.date));
  let peak=0,cum=0;
  const data=sorted.map(t=>{cum+=t.pnl;if(cum>peak)peak=cum;const dd=peak>0?Math.round(((peak-cum)/peak)*100*10)/10:0;return{date:t.date.slice(5),dd:-dd};});
  const maxDD=data.length?Math.min(...data.map(d=>d.dd)):0;
  if(!data.length)return(<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:200,color:B.textMuted,fontSize:13}}>No data yet</div>);
  return(
    <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:20,height:"100%"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontSize:11,color:B.textMuted,letterSpacing:2,textTransform:"uppercase"}}>Drawdown</div>
        <div style={{textAlign:"right"}}><div style={{fontSize:10,color:B.textMuted}}>Max Drawdown</div><div style={{fontSize:18,fontWeight:800,color:B.loss,fontFamily:"monospace"}}>{Math.abs(maxDD).toFixed(1)}%</div></div>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data}>
          <defs><linearGradient id="ddG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={B.loss} stopOpacity={0.3}/><stop offset="100%" stopColor={B.loss} stopOpacity={0}/></linearGradient></defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/>
          <XAxis dataKey="date" tick={{fill:B.textDim,fontSize:9}} axisLine={false} tickLine={false} interval={Math.ceil(data.length/7)}/>
          <YAxis tick={{fill:B.textDim,fontSize:9}} axisLine={false} tickLine={false} tickFormatter={v=>v+"%"}/>
          <Tooltip content={({active,payload,label})=>{if(!active||!payload?.length)return null;return(<div style={{background:"#16151C",border:`1px solid ${B.border}`,borderRadius:8,padding:"8px 12px",fontSize:11}}><div style={{color:B.textMuted}}>{label}</div><div style={{color:B.loss,fontFamily:"monospace"}}>{payload[0]?.value?.toFixed(1)}%</div></div>);}}/>
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)"/>
          <Area type="monotone" dataKey="dd" stroke={B.loss} fill="url(#ddG)" strokeWidth={2} dot={false} name="Drawdown"/>
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function YearlyCalendarWidget({trades}){
  const year=new Date().getFullYear();
  const dayMap={};
  trades.filter(t=>t.date.startsWith(String(year))).forEach(t=>{if(!dayMap[t.date])dayMap[t.date]=0;dayMap[t.date]+=t.pnl;});
  const maxAbs=Math.max(...Object.values(dayMap).map(v=>Math.abs(v)),1);
  const days=[];const d=new Date(year,0,1);
  while(d.getFullYear()===year){days.push({date:d.toISOString().slice(0,10),dow:d.getDay()});d.setDate(d.getDate()+1);}
  const weeks=[];let week=[];
  for(let i=0;i<days[0].dow;i++)week.push(null);
  days.forEach(dy=>{week.push(dy);if(week.length===7){weeks.push(week);week=[];}});
  if(week.length)weeks.push(week);
  const totalPnl=Object.values(dayMap).reduce((a,v)=>a+v,0);
  const greenDays=Object.values(dayMap).filter(v=>v>0).length;
  return(
    <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:20,height:"100%"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontSize:11,color:B.textMuted,letterSpacing:2,textTransform:"uppercase"}}>{year} Yearly Calendar</div>
        <div style={{display:"flex",gap:12,fontSize:11}}>
          <span style={{color:B.textMuted}}><span style={{color:B.profit,fontWeight:700}}>{greenDays}</span> green</span>
          <span style={{color:pnlColor(totalPnl),fontWeight:700,fontFamily:"monospace"}}>{totalPnl?fmt(Math.round(totalPnl)):""}</span>
        </div>
      </div>
      <div style={{overflowX:"auto"}}>
        <div style={{display:"flex",gap:2,minWidth:680}}>
          {weeks.map((wk,wi)=>(
            <div key={wi} style={{display:"flex",flexDirection:"column",gap:2}}>
              {wk.map((dy,di)=>{
                if(!dy)return <div key={di} style={{width:11,height:11}}/>;
                const pnl=dayMap[dy.date];
                const intensity=pnl?Math.min(Math.abs(pnl)/maxAbs,1):0;
                const bg=pnl>0?`rgba(0,212,168,${0.12+intensity*0.75})`:pnl<0?`rgba(240,90,126,${0.12+intensity*0.75})`:"rgba(255,255,255,0.04)";
                return(<div key={di} title={dy.date+(pnl?" "+fmt(pnl):"")} style={{width:11,height:11,borderRadius:2,background:bg,cursor:pnl?"pointer":"default"}}/>);
              })}
            </div>
          ))}
        </div>
        <div style={{display:"flex",marginTop:4,minWidth:680}}>
          {["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"].map(m=>(<div key={m} style={{flex:1,fontSize:7,color:B.textMuted,textAlign:"center"}}>{m}</div>))}
        </div>
      </div>
      <div style={{display:"flex",gap:4,alignItems:"center",marginTop:8,fontSize:8,color:B.textMuted,justifyContent:"flex-end"}}>
        <span>Less</span>
        {[0.12,0.3,0.5,0.7,0.87].map((o,i)=>(<div key={i} style={{width:9,height:9,borderRadius:2,background:`rgba(0,212,168,${o})`}}/>))}
        <span>More</span>
      </div>
    </div>
  );
}

function ProgressTrackerWidget({trades}){
  const SKEY="tca_progress_v2";
  const [rules,setRules]=useState([
    {id:1,text:"Followed my entry rules",color:B.teal},
    {id:2,text:"Respected my stop loss",color:B.blue},
    {id:3,text:"No revenge trading",color:B.purple},
    {id:4,text:"Stayed within max contracts",color:"#f97316"},
    {id:5,text:"Reviewed pre-market plan",color:B.spark},
  ]);
  const [checks,setChecks]=useState({});
  const [newRule,setNewRule]=useState("");
  const [loaded,setLoaded]=useState(false);
  useEffect(()=>{
    try{const l=localStorage.getItem("pref_"+SKEY);if(l){const s=JSON.parse(l);if(s.rules)setRules(s.rules);if(s.checks)setChecks(s.checks);}}catch(e){}
    (async()=>{
      try{const{data}=await supabase.from("user_preferences").select("value").eq("key",SKEY).single();if(data?.value){localStorage.setItem("pref_"+SKEY,data.value);const s=JSON.parse(data.value);if(s.rules)setRules(s.rules);if(s.checks)setChecks(s.checks);}}catch(e){}
      setLoaded(true);
    })();
  },[]);
  const save=async(nr,nc)=>{
    const val=JSON.stringify({rules:nr??rules,checks:nc??checks});
    localStorage.setItem("pref_"+SKEY,val);
    try{await (async()=>{const{data:{user}}=await supabase.auth.getUser();await supabase.from("user_preferences").upsert({user_id:user?.id,key:SKEY,value:val,updated_at:new Date().toISOString()},{onConflict:"user_id,key"});})();}catch(e){}
  };
  const today=new Date().toISOString().slice(0,10);
  const todayChecks=checks[today]||{};
  const toggle=(id)=>{const u={...checks,[today]:{...todayChecks,[id]:!todayChecks[id]}};setChecks(u);save(undefined,u);};
  const addRule=()=>{if(!newRule.trim())return;const colors=[B.teal,B.blue,B.purple,"#f97316",B.spark];const u=[...rules,{id:Date.now(),text:newRule.trim(),color:colors[rules.length%colors.length]}];setRules(u);setNewRule("");save(u,undefined);};
  const todayScore=rules.length?Math.round((Object.values(todayChecks).filter(Boolean).length/rules.length)*100):0;
  const last7=[...Array(7)].map((_,i)=>{const d=new Date();d.setDate(d.getDate()-i);return d.toISOString().slice(0,10);});
  const avgScore=Math.round(last7.map(d=>{const dc=checks[d]||{};return rules.length?Math.round((rules.filter(r=>dc[r.id]).length/rules.length)*100):0;}).reduce((a,b)=>a+b,0)/7);
  return(
    <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:20,height:"100%",display:"flex",flexDirection:"column"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontSize:11,color:B.textMuted,letterSpacing:2,textTransform:"uppercase"}}>Progress Tracker</div>
        <div style={{display:"flex",gap:12}}>
          <div style={{textAlign:"center"}}><div style={{fontSize:18,fontWeight:800,color:todayScore>=70?B.teal:todayScore>=40?"#f97316":B.loss,fontFamily:"monospace"}}>{todayScore}%</div><div style={{fontSize:8,color:B.textMuted}}>TODAY</div></div>
          <div style={{textAlign:"center"}}><div style={{fontSize:18,fontWeight:800,color:B.blue,fontFamily:"monospace"}}>{avgScore}%</div><div style={{fontSize:8,color:B.textMuted}}>7D AVG</div></div>
        </div>
      </div>
      <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:6,marginBottom:10}}>
        {rules.map(r=>(
          <div key={r.id} onClick={()=>toggle(r.id)} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",borderRadius:9,cursor:"pointer",background:todayChecks[r.id]?`${r.color}08`:"rgba(255,255,255,0.02)",border:`1px solid ${todayChecks[r.id]?r.color+"30":B.border}`,transition:"all 0.2s"}}>
            <div style={{width:18,height:18,borderRadius:5,border:`2px solid ${todayChecks[r.id]?r.color:B.textMuted}`,background:todayChecks[r.id]?r.color:"transparent",flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
              {todayChecks[r.id]&&<span style={{color:"#0E0E10",fontSize:11,fontWeight:900}}>✓</span>}
            </div>
            <div style={{fontSize:12,color:todayChecks[r.id]?B.textMuted:B.text,textDecoration:todayChecks[r.id]?"line-through":"none",flex:1}}>{r.text}</div>
          </div>
        ))}
      </div>
      <div style={{height:5,background:"rgba(255,255,255,0.05)",borderRadius:3,overflow:"hidden",marginBottom:10}}>
        <div style={{height:"100%",width:todayScore+"%",background:GL,borderRadius:3,transition:"width 0.5s"}}/>
      </div>
      <div style={{display:"flex",gap:6}}>
        <input value={newRule} onChange={e=>setNewRule(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addRule()} style={{...iS,flex:1,fontSize:11,padding:"7px 10px"}} placeholder="Add a trading rule..."/>
        <button onClick={addRule} style={{padding:"7px 14px",borderRadius:8,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:12,fontWeight:800}}>+</button>
      </div>
    </div>
  );
}

function ReportWidget({trades}){
  const ALL_METRICS=[
    {id:"netPnl",label:"Net P&L",fn:ts=>fmt(Math.round(ts.reduce((a,t)=>a+t.pnl,0)*100)/100)},
    {id:"winRate",label:"Win Rate",fn:ts=>{const w=ts.filter(t=>t.result==="Win").length;return ts.length?Math.round((w/ts.length)*100)+"%":"0%";}},
    {id:"profitFactor",label:"Profit Factor",fn:ts=>{const w=ts.filter(t=>t.result==="Win").reduce((a,t)=>a+t.pnl,0);const l=ts.filter(t=>t.result==="Loss").reduce((a,t)=>a+t.pnl,0);return l?Math.abs(w/l).toFixed(2):"N/A";}},
    {id:"avgWin",label:"Avg Win",fn:ts=>{const w=ts.filter(t=>t.result==="Win");return w.length?"$"+Math.round(w.reduce((a,t)=>a+t.pnl,0)/w.length):"--";}},
    {id:"avgLoss",label:"Avg Loss",fn:ts=>{const l=ts.filter(t=>t.result==="Loss");return l.length?"$"+Math.abs(Math.round(l.reduce((a,t)=>a+t.pnl,0)/l.length)):"--";}},
    {id:"totalTrades",label:"Total Trades",fn:ts=>String(ts.length)},
    {id:"bestDay",label:"Best Day",fn:ts=>{const dm={};ts.forEach(t=>{dm[t.date]=(dm[t.date]||0)+t.pnl;});const v=Object.values(dm);return v.length?fmt(Math.round(Math.max(...v)*100)/100):"--";}},
    {id:"worstDay",label:"Worst Day",fn:ts=>{const dm={};ts.forEach(t=>{dm[t.date]=(dm[t.date]||0)+t.pnl;});const v=Object.values(dm);return v.length?fmt(Math.round(Math.min(...v)*100)/100):"--";}},
    {id:"expectancy",label:"Expectancy",fn:ts=>ts.length?"$"+Math.round(ts.reduce((a,t)=>a+t.pnl,0)/ts.length):"--"},
  ];
  const SKEY="tca_report_v2";
  const [selected,setSelected]=useState(["netPnl","winRate","profitFactor"]);
  const [showPicker,setShowPicker]=useState(false);
  useEffect(()=>{
    try{const l=localStorage.getItem("pref_"+SKEY);if(l)setSelected(JSON.parse(l));}catch(e){}
    (async()=>{try{const{data}=await supabase.from("user_preferences").select("value").eq("key",SKEY).single();if(data?.value){localStorage.setItem("pref_"+SKEY,data.value);setSelected(JSON.parse(data.value));}}catch(e){}})();
  },[]);
  const toggle=(id)=>{
    let u;if(selected.includes(id)){u=selected.filter(s=>s!==id);}else if(selected.length<3){u=[...selected,id];}else{u=[...selected.slice(1),id];}
    setSelected(u);
    const val=JSON.stringify(u);
    localStorage.setItem("pref_"+SKEY,val);
    (async()=>{const{data:{user}}=await supabase.auth.getUser();await supabase.from("user_preferences").upsert({user_id:user?.id,key:SKEY,value:val,updated_at:new Date().toISOString()},{onConflict:"user_id,key"});})().catch(()=>{});
  };
  const grads=[GL,GTB,GBP];
  const selMetrics=ALL_METRICS.filter(m=>selected.includes(m.id));
  return(
    <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:20,height:"100%"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
        <div style={{fontSize:11,color:B.textMuted,letterSpacing:2,textTransform:"uppercase"}}>Report</div>
        <button onClick={()=>setShowPicker(p=>!p)} style={{padding:"4px 10px",borderRadius:8,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:10}}>Customize</button>
      </div>
      {showPicker?(
        <div>
          <div style={{fontSize:10,color:B.textMuted,marginBottom:8}}>Select up to 3 metrics:</div>
          <div style={{display:"flex",flexDirection:"column",gap:5,maxHeight:260,overflowY:"auto"}}>
            {ALL_METRICS.map(m=>(
              <div key={m.id} onClick={()=>toggle(m.id)} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:8,cursor:"pointer",background:selected.includes(m.id)?`${B.teal}10`:"transparent",border:`1px solid ${selected.includes(m.id)?B.borderTeal:B.border}`}}>
                <div style={{width:16,height:16,borderRadius:4,border:`2px solid ${selected.includes(m.id)?B.teal:B.textMuted}`,background:selected.includes(m.id)?B.teal:"transparent",display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {selected.includes(m.id)&&<span style={{color:"#0E0E10",fontSize:10,fontWeight:900}}>✓</span>}
                </div>
                <span style={{fontSize:12,color:B.text,flex:1}}>{m.label}</span>
                <span style={{fontSize:11,fontFamily:"monospace",color:B.textMuted}}>{m.fn(trades)}</span>
              </div>
            ))}
          </div>
          <button onClick={()=>setShowPicker(false)} style={{marginTop:10,width:"100%",padding:"8px",borderRadius:8,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:12,fontWeight:800}}>Done</button>
        </div>
      ):(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          {selMetrics.map((m,i)=>(
            <div key={m.id} style={{background:"rgba(0,0,0,0.3)",borderRadius:12,padding:"16px 20px",border:`1px solid ${B.border}`,position:"relative",overflow:"hidden"}}>
              <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:grads[i]}}/>
              <div style={{fontSize:9,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>{m.label}</div>
              <div style={{fontSize:26,fontWeight:800,background:grads[i],WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",fontFamily:"monospace"}}>{m.fn(trades)}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── WIDGETS DASHBOARD ────────────────────────────────────────────────────────
// ── Resources Page ────────────────────────────────────────────────────────────
function ResourcesPage({session}){
  const SKEY="tca_yt_videos_v1";
  const [videos,setVideos]=useState([]);
  const [showAdd,setShowAdd]=useState(false);
  const [editingVideo,setEditingVideo]=useState(null); // {idx, title, desc}
  const [newUrl,setNewUrl]=useState("");
  const [newTitle,setNewTitle]=useState("");
  const [newDesc,setNewDesc]=useState("");

  useEffect(()=>{
    // Load from localStorage instantly
    try{
      const local=localStorage.getItem(`pref_${SKEY}`);
      if(local)setVideos(JSON.parse(local));
    }catch(e){}
    // Then sync from Supabase
    if(!session?.user?.id)return;
    (async()=>{
      try{
        const val=await getPref(session.user.id, SKEY);
        if(val)setVideos(JSON.parse(val));
      }catch(e){}
    })();
  },[session]);

  const saveVideos=(vids)=>{
    setVideos(vids);
    if(session?.user?.id){
      setPref(session.user.id, SKEY, JSON.stringify(vids)).catch(()=>{});
    } else {
      try{localStorage.setItem(`pref_${SKEY}`,JSON.stringify(vids));}catch(e){}
    }
  };

  const extractId=(url)=>{
    const patterns=[
      /youtu\.be\/([^?&\s]+)/,
      /[?&]v=([^&\s]+)/,
      /embed\/([^?&\s]+)/,
      /^([a-zA-Z0-9_-]{11})$/,
    ];
    for(const p of patterns){const m=(url||"").match(p);if(m)return m[1];}
    return null;
  };

  const addVideo=()=>{
    const vid=extractId(newUrl.trim());
    if(!vid){alert("Couldn't find a YouTube video ID in that URL. Please try again.");return;}
    saveVideos([...videos,{id:vid,title:newTitle.trim()||"Untitled Video",desc:newDesc.trim()}]);
    setNewUrl("");setNewTitle("");setNewDesc("");setShowAdd(false);
  };

  const removeVideo=(i)=>saveVideos(videos.filter((_,j)=>j!==i));

  return(
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      {/* Header */}
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:36,height:36,borderRadius:10,background:"#FF0000",display:"flex",alignItems:"center",justifyContent:"center"}}>
            <svg viewBox="0 0 24 24" width="20" height="20" fill="white"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
          </div>
          <div>
            <div style={{fontSize:18,fontWeight:800,color:B.text}}>Educational Videos</div>
            <div style={{fontSize:12,color:B.textMuted}}>{videos.length} video{videos.length!==1?"s":""} saved</div>
          </div>
        </div>
        <button onClick={()=>setShowAdd(p=>!p)} style={{padding:"8px 18px",borderRadius:9,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:12,fontWeight:800}}>
          {showAdd?"✕ Cancel":"+ Add Video"}
        </button>
      </div>

      {/* Add form */}
      {showAdd&&(
        <div style={{padding:20,borderRadius:14,background:B.surface,border:`1px solid ${B.borderTeal}`}}>
          <div style={{fontSize:13,fontWeight:700,color:B.text,marginBottom:14}}>Add YouTube Video</div>
          <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:16}}>
            <div>
              <label style={lS}>YouTube URL or Video ID *</label>
              <input value={newUrl} onChange={e=>setNewUrl(e.target.value)}
                style={iS} placeholder="https://youtube.com/watch?v=xxxxx  or just the video ID"/>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
              <div>
                <label style={lS}>Title</label>
                <input value={newTitle} onChange={e=>setNewTitle(e.target.value)} style={iS} placeholder="e.g. 10AM Triple TF Setup"/>
              </div>
              <div>
                <label style={lS}>Description (optional)</label>
                <input value={newDesc} onChange={e=>setNewDesc(e.target.value)} style={iS} placeholder="What does this video cover?"/>
              </div>
            </div>
          </div>
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            <button onClick={()=>setShowAdd(false)} style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:12}}>Cancel</button>
            <button onClick={addVideo} style={{padding:"8px 24px",borderRadius:8,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:12,fontWeight:800}}>Save Video</button>
          </div>
        </div>
      )}

      {/* Video grid */}
      {videos.length===0?(
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"80px 20px",borderRadius:14,border:`2px dashed ${B.border}`,gap:14}}>
          <div style={{fontSize:48}}>🎬</div>
          <div style={{fontSize:15,fontWeight:700,color:B.text}}>No videos yet</div>
          <div style={{fontSize:12,color:B.textMuted,textAlign:"center",lineHeight:1.6}}>
            Add YouTube videos from The Candlestick Academy<br/>to build your personal educational library
          </div>
          <button onClick={()=>setShowAdd(true)} style={{marginTop:4,padding:"10px 24px",borderRadius:9,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:13,fontWeight:800}}>+ Add Your First Video</button>
        </div>
      ):(
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(360px,1fr))",gap:18}}>
          {videos.map((v,i)=>(
            <div key={i} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,overflow:"hidden"}}>
              <div style={{position:"relative",paddingBottom:"56.25%",height:0,background:"#000"}}>
                <iframe src={`https://www.youtube.com/embed/${v.id}?rel=0&modestbranding=1`} title={v.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen style={{position:"absolute",top:0,left:0,width:"100%",height:"100%",border:"none"}}/>
              </div>
              <div style={{padding:"12px 14px",display:"flex",gap:10,alignItems:"flex-start"}}>
                <div style={{flex:1}}>
                  {editingVideo?.idx===i?(
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      <input value={editingVideo.title} onChange={e=>setEditingVideo(x=>({...x,title:e.target.value}))} style={{...iS,fontSize:13,padding:"6px 10px"}} placeholder="Video title"/>
                      <input value={editingVideo.desc} onChange={e=>setEditingVideo(x=>({...x,desc:e.target.value}))} style={{...iS,fontSize:11,padding:"5px 10px"}} placeholder="Description (optional)"/>
                      <div style={{display:"flex",gap:6}}>
                        <button onClick={()=>{saveVideos(videos.map((vid,j)=>j===i?{...vid,title:editingVideo.title,desc:editingVideo.desc}:vid));setEditingVideo(null);}} style={{padding:"4px 12px",borderRadius:6,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:11,fontWeight:700}}>Save</button>
                        <button onClick={()=>setEditingVideo(null)} style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:11}}>Cancel</button>
                      </div>
                    </div>
                  ):(
                    <div>
                      <div style={{fontSize:13,fontWeight:700,color:B.text,marginBottom:3}}>{v.title}</div>
                      {v.desc&&<div style={{fontSize:11,color:B.textMuted,lineHeight:1.5}}>{v.desc}</div>}
                    </div>
                  )}
                </div>
                <div style={{display:"flex",gap:6,flexShrink:0}}>
                  {editingVideo?.idx!==i&&<button onClick={()=>setEditingVideo({idx:i,title:v.title,desc:v.desc||""})} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:6,color:B.textMuted,cursor:"pointer",fontSize:11,padding:"4px 8px"}}>✏</button>}
                  <button onClick={()=>removeVideo(i)} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:6,color:B.textMuted,cursor:"pointer",fontSize:11,padding:"3px 8px"}}>✕</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}



// ── Daily Goals & Targets ─────────────────────────────────────────────────────
function DailyGoalsWidget({trades, session}){
  const SKEY="tca_daily_goals_v1";
  const today=new Date().toISOString().slice(0,10);
  const [goals,setGoals]=useState({profitTarget:200,maxLoss:-100,maxTrades:5});
  const [showEdit,setShowEdit]=useState(false);
  const [draft,setDraft]=useState({});

  useEffect(()=>{
    try{const l=localStorage.getItem("pref_"+SKEY);if(l)setGoals(JSON.parse(l));}catch(e){}
    if(session?.user?.id)(async()=>{
      try{const{data}=await supabase.from("user_preferences").select("value").eq("key",SKEY).single();
        if(data?.value){const v=JSON.parse(data.value);setGoals(v);localStorage.setItem("pref_"+SKEY,data.value);}}catch(e){}
    })();
  },[session]);

  const saveGoals=async(g)=>{
    setGoals(g);const val=JSON.stringify(g);
    localStorage.setItem("pref_"+SKEY,val);
    if(session?.user?.id)(async()=>{try{await supabase.from("user_preferences").upsert({user_id:session.user.id,key:SKEY,value:val,updated_at:new Date().toISOString()},{onConflict:"user_id,key"});}catch(e){}})();
  };

  const todayTrades=trades.filter(t=>t.date===today);
  const todayPnl=todayTrades.reduce((a,t)=>a+t.pnl,0);
  const tradeCount=todayTrades.length;

  const pnlPct=goals.profitTarget>0?Math.min(Math.max(todayPnl/goals.profitTarget,0),1):0;
  const lossPct=goals.maxLoss<0?Math.min(Math.max(todayPnl/goals.maxLoss,0),1):0;
  const tradePct=Math.min(tradeCount/goals.maxTrades,1);

  const atMaxLoss=todayPnl<=goals.maxLoss;
  const atMaxTrades=tradeCount>=goals.maxTrades;
  const hitTarget=todayPnl>=goals.profitTarget;

  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column",gap:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontSize:9,color:B.textMuted,letterSpacing:2,textTransform:"uppercase"}}>Today's Goals</div>
        <button onClick={()=>{setDraft({...goals});setShowEdit(true);}} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:6,color:B.textMuted,cursor:"pointer",fontSize:10,padding:"3px 8px"}}>Edit</button>
      </div>

      {showEdit&&(
        <div style={{padding:14,borderRadius:10,background:"rgba(0,0,0,0.4)",border:`1px solid ${B.border}`}}>
          {[{key:"profitTarget",label:"Profit Target ($)",min:0},{key:"maxLoss",label:"Max Loss ($)",min:-9999},{key:"maxTrades",label:"Max Trades",min:1}].map(f=>(
            <div key={f.key} style={{marginBottom:10}}>
              <label style={lS}>{f.label}</label>
              <input type="number" value={draft[f.key]} onChange={e=>setDraft(d=>({...d,[f.key]:parseFloat(e.target.value)||0}))} style={{...iS,fontSize:13}}/>
            </div>
          ))}
          <div style={{display:"flex",gap:8}}>
            <button onClick={()=>setShowEdit(false)} style={{flex:1,padding:"7px",borderRadius:8,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:12}}>Cancel</button>
            <button onClick={()=>{saveGoals(draft);setShowEdit(false);}} style={{flex:2,padding:"7px",borderRadius:8,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:12,fontWeight:800}}>Save</button>
          </div>
        </div>
      )}

      {/* Profit target */}
      <div>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
          <span style={{fontSize:12,color:B.text}}>Profit Target</span>
          <span style={{fontSize:12,fontFamily:"monospace",color:hitTarget?B.profit:pnlColor(todayPnl),fontWeight:700}}>{fmt(todayPnl)} / ${goals.profitTarget}</span>
        </div>
        <div style={{height:8,background:"rgba(255,255,255,0.05)",borderRadius:4,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${pnlPct*100}%`,background:hitTarget?"linear-gradient(90deg,#00D4A8,#4F8EF7)":GTB,borderRadius:4,transition:"width 0.5s"}}/>
        </div>
        {hitTarget&&<div style={{fontSize:10,color:B.profit,marginTop:4,fontWeight:700}}>🎯 Target reached!</div>}
      </div>

      {/* Max loss */}
      <div>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
          <span style={{fontSize:12,color:atMaxLoss?B.loss:B.text}}>Max Loss Limit</span>
          <span style={{fontSize:12,fontFamily:"monospace",color:atMaxLoss?B.loss:B.textMuted,fontWeight:700}}>{fmt(todayPnl)} / ${goals.maxLoss}</span>
        </div>
        <div style={{height:8,background:"rgba(255,255,255,0.05)",borderRadius:4,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${lossPct*100}%`,background:atMaxLoss?GBP:`rgba(240,90,126,0.4)`,borderRadius:4,transition:"width 0.5s"}}/>
        </div>
        {atMaxLoss&&<div style={{fontSize:10,color:B.loss,marginTop:4,fontWeight:700}}>🛑 Max loss hit — stop trading for today</div>}
      </div>

      {/* Max trades */}
      <div>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>
          <span style={{fontSize:12,color:atMaxTrades?B.spark:B.text}}>Trades Taken</span>
          <span style={{fontSize:12,fontFamily:"monospace",color:atMaxTrades?B.spark:B.textMuted,fontWeight:700}}>{tradeCount} / {goals.maxTrades}</span>
        </div>
        <div style={{height:8,background:"rgba(255,255,255,0.05)",borderRadius:4,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${tradePct*100}%`,background:atMaxTrades?"linear-gradient(90deg,#F59E0B,#EF4444)":"linear-gradient(90deg,#4F8EF7,#8B5CF6)",borderRadius:4,transition:"width 0.5s"}}/>
        </div>
        {atMaxTrades&&<div style={{fontSize:10,color:B.spark,marginTop:4,fontWeight:700}}>⚠️ Max trades reached</div>}
      </div>

      {/* Today summary */}
      {todayTrades.length>0&&(
        <div style={{padding:"10px 14px",borderRadius:10,background:"rgba(0,0,0,0.3)",border:`1px solid ${B.border}`,marginTop:"auto"}}>
          <div style={{fontSize:10,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:6}}>Today</div>
          <div style={{display:"flex",gap:16}}>
            {[{l:"P&L",v:fmt(todayPnl),c:pnlColor(todayPnl)},{l:"Trades",v:tradeCount,c:B.text},{l:"Win %",v:todayTrades.length?Math.round(todayTrades.filter(t=>t.result==="Win").length/todayTrades.length*100)+"%":"--",c:B.blue}].map(s=>(
              <div key={s.l}><div style={{fontSize:9,color:B.textMuted}}>{s.l}</div><div style={{fontSize:14,fontWeight:800,fontFamily:"monospace",color:s.c}}>{s.v}</div></div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Apex Funding Tracker ──────────────────────────────────────────────────────
function ApexTrackerWidget({trades, session}){
  const SKEY="tca_apex_config_v1";
  const [config,setConfig]=useState({accountSize:50000,trailingDrawdown:2500,dailyLoss:1500,profitTarget:3000,consistency:50});
  const [showEdit,setShowEdit]=useState(false);
  const [draft,setDraft]=useState({});
  const [startingBalance,setStartingBalance]=useState(50000);

  useEffect(()=>{
    try{const l=localStorage.getItem("pref_"+SKEY);if(l){const v=JSON.parse(l);setConfig(v.config||config);setStartingBalance(v.balance||50000);}}catch(e){}
  },[]);

  const save=async(c,b)=>{
    const val=JSON.stringify({config:c,balance:b});
    localStorage.setItem("pref_"+SKEY,val);
    if(session?.user?.id)try{await supabase.from("user_preferences").upsert({user_id:session.user.id,key:SKEY,value:val,updated_at:new Date().toISOString()},{onConflict:"user_id,key"});}catch(e){}
  };

  const today=new Date().toISOString().slice(0,10);
  const todayPnl=trades.filter(t=>t.date===today).reduce((a,t)=>a+t.pnl,0);
  const totalPnl=trades.reduce((a,t)=>a+t.pnl,0);
  const currentBalance=startingBalance+totalPnl;

  // Trailing drawdown: highest balance reached - current
  let peak=startingBalance;
  let runningBal=startingBalance;
  const sorted=[...trades].sort((a,b)=>a.date.localeCompare(b.date));
  sorted.forEach(t=>{runningBal+=t.pnl;if(runningBal>peak)peak=runningBal;});
  const trailingDD=peak-currentBalance;
  const trailingDDPct=Math.min(trailingDD/config.trailingDrawdown,1);
  const dailyLossPct=Math.min(Math.abs(Math.min(todayPnl,0))/config.dailyLoss,1);
  const profitPct=Math.min(Math.max(totalPnl/config.profitTarget,0),1);

  // Consistency: biggest single day / total profit
  const dayMap={};
  sorted.forEach(t=>{if(!dayMap[t.date])dayMap[t.date]=0;dayMap[t.date]+=t.pnl;});
  const dayPnls=Object.values(dayMap).filter(v=>v>0);
  const biggestDay=dayPnls.length?Math.max(...dayPnls):0;
  const consistencyPct=totalPnl>0?Math.round((biggestDay/totalPnl)*100):0;
  const consistencyOk=consistencyPct<=config.consistency;

  const atDailyLimit=todayPnl<=-config.dailyLoss;
  const atTrailingDD=trailingDD>=config.trailingDrawdown;

  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontSize:9,color:B.textMuted,letterSpacing:2,textTransform:"uppercase"}}>Apex Account Tracker</div>
        <button onClick={()=>{setDraft({...config});setShowEdit(true);}} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:6,color:B.textMuted,cursor:"pointer",fontSize:10,padding:"3px 8px"}}>Configure</button>
      </div>

      {showEdit&&(
        <div style={{padding:14,borderRadius:10,background:"rgba(0,0,0,0.4)",border:`1px solid ${B.border}`}}>
          {[
            {key:"accountSize",label:"Account Size"},
            {key:"profitTarget",label:"Profit Target"},
            {key:"trailingDrawdown",label:"Trailing Drawdown"},
            {key:"dailyLoss",label:"Daily Loss Limit"},
            {key:"consistency",label:"Consistency % Max"},
          ].map(f=>(
            <div key={f.key} style={{marginBottom:8}}>
              <label style={lS}>{f.label}</label>
              <input type="number" value={draft[f.key]} onChange={e=>setDraft(d=>({...d,[f.key]:parseFloat(e.target.value)||0}))} style={{...iS,fontSize:12}}/>
            </div>
          ))}
          <div style={{marginBottom:8}}>
            <label style={lS}>Starting Balance</label>
            <input type="number" value={startingBalance} onChange={e=>setStartingBalance(parseFloat(e.target.value)||50000)} style={{...iS,fontSize:12}}/>
          </div>
          <div style={{display:"flex",gap:8,marginTop:8}}>
            <button onClick={()=>setShowEdit(false)} style={{flex:1,padding:"7px",borderRadius:8,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:11}}>Cancel</button>
            <button onClick={()=>{setConfig(draft);save(draft,startingBalance);setShowEdit(false);}} style={{flex:2,padding:"7px",borderRadius:8,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:11,fontWeight:800}}>Save</button>
          </div>
        </div>
      )}

      {/* Account balance */}
      <div style={{padding:"10px 14px",borderRadius:10,background:"rgba(0,0,0,0.3)",border:`1px solid ${B.border}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><div style={{fontSize:9,color:B.textMuted,letterSpacing:1}}>ACCOUNT BALANCE</div><div style={{fontSize:20,fontWeight:800,fontFamily:"monospace",color:pnlColor(totalPnl)}}>${Math.round(currentBalance).toLocaleString()}</div></div>
          <div style={{textAlign:"right"}}><div style={{fontSize:9,color:B.textMuted}}>TOTAL P&L</div><div style={{fontSize:16,fontWeight:700,fontFamily:"monospace",color:pnlColor(totalPnl)}}>{fmt(totalPnl)}</div></div>
        </div>
      </div>

      {/* Profit target progress */}
      {[
        {label:"Profit Target",pct:profitPct,current:fmt(totalPnl),target:`$${config.profitTarget}`,color:B.teal,ok:totalPnl>=config.profitTarget,okMsg:"✅ Target reached!"},
        {label:"Trailing Drawdown",pct:trailingDDPct,current:fmt(-trailingDD),target:`-$${config.trailingDrawdown}`,color:B.loss,ok:atTrailingDD,okMsg:"🚨 Account blown"},
        {label:"Daily Loss",pct:dailyLossPct,current:fmt(todayPnl),target:`-$${config.dailyLoss}`,color:B.spark,ok:atDailyLimit,okMsg:"🛑 Daily limit hit"},
      ].map(g=>(
        <div key={g.label}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <span style={{fontSize:11,color:g.ok?g.color:B.text}}>{g.label}</span>
            <span style={{fontSize:11,fontFamily:"monospace",color:g.ok?g.color:B.textMuted}}>{g.current} / {g.target}</span>
          </div>
          <div style={{height:6,background:"rgba(255,255,255,0.05)",borderRadius:3,overflow:"hidden"}}>
            <div style={{height:"100%",width:`${g.pct*100}%`,background:g.ok?g.color:`${g.color}60`,borderRadius:3,transition:"width 0.5s"}}/>
          </div>
          {g.ok&&<div style={{fontSize:10,color:g.color,marginTop:3,fontWeight:700}}>{g.okMsg}</div>}
        </div>
      ))}

      {/* Consistency rule */}
      <div style={{padding:"10px 14px",borderRadius:10,background:consistencyOk?`${B.teal}08`:`${B.loss}08`,border:`1px solid ${consistencyOk?B.borderTeal:`${B.loss}30`}`}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{fontSize:10,color:B.textMuted,letterSpacing:1}}>CONSISTENCY RULE</div>
            <div style={{fontSize:11,color:B.textMuted,marginTop:2}}>Biggest day must be ≤{config.consistency}% of total profit</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontSize:18,fontWeight:800,fontFamily:"monospace",color:consistencyOk?B.teal:B.loss}}>{consistencyPct}%</div>
            <div style={{fontSize:10,color:consistencyOk?B.teal:B.loss,fontWeight:700}}>{consistencyOk?"✓ Passing":"✗ Failing"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ICT Concept Tagger ────────────────────────────────────────────────────────
const ICT_CONCEPTS=[
  "FVG","OTE","CISD","Liquidity Sweep","PD Array","Order Block","Breaker Block",
  "Mitigation Block","Rejection Block","ICT Killzone","Power of 3","SMT Divergence",
  "PDH/PDL","Weekly High/Low","Turtle Soup","10AM Reversal","NWOG/NDOG",
];

function ICTTaggerWidget({trades, session}){
  const SKEY="tca_ict_tags_v1";
  const [tags,setTags]=useState({});// {tradeId: [concept,...]}

  useEffect(()=>{
    try{const l=localStorage.getItem("pref_"+SKEY);if(l)setTags(JSON.parse(l));}catch(e){}
    if(session?.user?.id)(async()=>{
      try{const{data}=await supabase.from("user_preferences").select("value").eq("key",SKEY).single();
        if(data?.value){setTags(JSON.parse(data.value));localStorage.setItem("pref_"+SKEY,data.value);}}catch(e){}
    })();
  },[session]);

  const saveTags=async(t)=>{
    setTags(t);const val=JSON.stringify(t);
    localStorage.setItem("pref_"+SKEY,val);
    if(session?.user?.id)try{await supabase.from("user_preferences").upsert({user_id:session.user.id,key:SKEY,value:val,updated_at:new Date().toISOString()},{onConflict:"user_id,key"});}catch(e){}
  };

  // Build concept stats
  const stats={};
  ICT_CONCEPTS.forEach(c=>{stats[c]={wins:0,losses:0,pnl:0,total:0};});
  trades.forEach(t=>{
    const tradeTags=tags[t.id]||[];
    tradeTags.forEach(c=>{
      if(!stats[c])stats[c]={wins:0,losses:0,pnl:0,total:0};
      stats[c].total++;stats[c].pnl+=t.pnl;
      if(t.result==="Win")stats[c].wins++;else stats[c].losses++;
    });
  });

  const ranked=Object.entries(stats).filter(([,v])=>v.total>0).sort((a,b)=>b[1].pnl-a[1].pnl);

  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column",gap:12}}>
      <div style={{fontSize:9,color:B.textMuted,letterSpacing:2,textTransform:"uppercase"}}>ICT Concept Performance</div>

      {ranked.length===0?(
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8,color:B.textMuted}}>
          <div style={{fontSize:24}}>🧠</div>
          <div style={{fontSize:12,textAlign:"center"}}>No ICT concepts tagged yet.<br/>Open a trade to add tags.</div>
        </div>
      ):(
        <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:6}}>
          {ranked.slice(0,8).map(([concept,s])=>(
            <div key={concept} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:8,background:"rgba(0,0,0,0.3)",border:`1px solid ${s.pnl>0?`${B.teal}25`:`${B.loss}25`}`}}>
              <div style={{flex:1}}>
                <div style={{fontSize:12,fontWeight:700,color:B.text}}>{concept}</div>
                <div style={{fontSize:10,color:B.textMuted}}>{s.total} trades · {Math.round((s.wins/s.total)*100)}% WR</div>
              </div>
              <div style={{fontSize:13,fontWeight:800,fontFamily:"monospace",color:pnlColor(s.pnl)}}>{fmt(s.pnl)}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{fontSize:10,color:B.textMuted,textAlign:"center",paddingTop:4,borderTop:`1px solid ${B.border}`}}>
        Tag ICT concepts when opening individual trades
      </div>
    </div>
  );
}

// ── Emotional State Tracker ───────────────────────────────────────────────────
const MOODS=[
  {id:"confident",label:"Confident",emoji:"😤",color:"#4ade80"},
  {id:"focused",label:"Focused",emoji:"🎯",color:"#00D4A8"},
  {id:"neutral",label:"Neutral",emoji:"😐",color:"#94a3b8"},
  {id:"anxious",label:"Anxious",emoji:"😰",color:"#f59e0b"},
  {id:"fomo",label:"FOMO",emoji:"😬",color:"#f97316"},
  {id:"revenge",label:"Revenge",emoji:"😤",color:"#f05a7e"},
];

function EmotionalTrackerWidget({trades, session}){
  const SKEY="tca_moods_v1";
  const today=new Date().toISOString().slice(0,10);
  const [moodLog,setMoodLog]=useState({});
  const [selectedMood,setSelectedMood]=useState(null);

  useEffect(()=>{
    try{const l=localStorage.getItem("pref_"+SKEY);if(l)setMoodLog(JSON.parse(l));}catch(e){}
    if(session?.user?.id)(async()=>{
      try{const{data}=await supabase.from("user_preferences").select("value").eq("key",SKEY).single();
        if(data?.value){setMoodLog(JSON.parse(data.value));localStorage.setItem("pref_"+SKEY,data.value);}}catch(e){}
    })();
  },[session]);

  useEffect(()=>{
    if(moodLog[today])setSelectedMood(moodLog[today]);
  },[moodLog,today]);

  const logMood=async(moodId)=>{
    setSelectedMood(moodId);
    const updated={...moodLog,[today]:moodId};
    setMoodLog(updated);const val=JSON.stringify(updated);
    localStorage.setItem("pref_"+SKEY,val);
    if(session?.user?.id)try{await supabase.from("user_preferences").upsert({user_id:session.user.id,key:SKEY,value:val,updated_at:new Date().toISOString()},{onConflict:"user_id,key"});}catch(e){}
  };

  // Correlate mood with P&L
  const moodStats={};
  MOODS.forEach(m=>{moodStats[m.id]={pnl:0,days:0,wins:0};});
  const dayMap={};
  trades.forEach(t=>{if(!dayMap[t.date])dayMap[t.date]={pnl:0,wins:0,total:0};dayMap[t.date].pnl+=t.pnl;dayMap[t.date].total++;if(t.result==="Win")dayMap[t.date].wins++;});
  Object.entries(moodLog).forEach(([date,moodId])=>{
    const day=dayMap[date];
    if(day&&moodStats[moodId]){moodStats[moodId].pnl+=day.pnl;moodStats[moodId].days++;if(day.pnl>0)moodStats[moodId].wins++;}
  });

  const rankedMoods=MOODS.filter(m=>moodStats[m.id]?.days>0).sort((a,b)=>moodStats[b.id].pnl-moodStats[a.id].pnl);

  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column",gap:14}}>
      <div style={{fontSize:9,color:B.textMuted,letterSpacing:2,textTransform:"uppercase"}}>Emotional State Tracker</div>

      {/* Today's mood */}
      <div>
        <div style={{fontSize:11,color:B.textMuted,marginBottom:8}}>How are you feeling today?</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {MOODS.map(m=>(
            <button key={m.id} onClick={()=>logMood(m.id)} style={{
              padding:"6px 12px",borderRadius:20,cursor:"pointer",
              border:`1px solid ${selectedMood===m.id?m.color:B.border}`,
              background:selectedMood===m.id?`${m.color}20`:"transparent",
              color:selectedMood===m.id?m.color:B.textMuted,
              fontSize:12,fontWeight:selectedMood===m.id?700:400,
              transition:"all 0.15s",
            }}>
              {m.emoji} {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mood vs P&L correlation */}
      {rankedMoods.length>0&&(
        <div style={{flex:1,overflowY:"auto"}}>
          <div style={{fontSize:10,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:8}}>Mood vs Performance</div>
          <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {rankedMoods.map(m=>{
              const s=moodStats[m.id];
              const avgPnl=s.days?Math.round(s.pnl/s.days):0;
              return(
                <div key={m.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:8,background:"rgba(0,0,0,0.3)",border:`1px solid ${s.pnl>0?`${m.color}30`:B.border}`}}>
                  <span style={{fontSize:16}}>{m.emoji}</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:700,color:B.text}}>{m.label}</div>
                    <div style={{fontSize:10,color:B.textMuted}}>{s.days} days · {Math.round((s.wins/s.days)*100)}% green days</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{fontSize:13,fontWeight:800,fontFamily:"monospace",color:pnlColor(avgPnl)}}>{avgPnl>=0?"+":""}{fmt(avgPnl)}</div>
                    <div style={{fontSize:9,color:B.textMuted}}>avg/day</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {rankedMoods.length===0&&(
        <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",color:B.textMuted,fontSize:12,textAlign:"center"}}>
          Log your mood daily to see<br/>how emotions affect your trading
        </div>
      )}
    </div>
  );
}

// ── Achievements System ───────────────────────────────────────────────────────
function AchievementsWidget({trades, session}){
  const dayMap={};
  trades.forEach(t=>{if(!dayMap[t.date])dayMap[t.date]={pnl:0,wins:0,total:0};dayMap[t.date].pnl+=t.pnl;dayMap[t.date].total++;if(t.result==="Win")dayMap[t.date].wins++;});
  const days=Object.values(dayMap);
  const totalPnl=trades.reduce((a,t)=>a+t.pnl,0);
  const winRate=trades.length?Math.round((trades.filter(t=>t.result==="Win").length/trades.length)*100):0;
  const greenDays=days.filter(d=>d.pnl>0).length;
  const bestDay=days.length?Math.max(...days.map(d=>d.pnl)):0;

  // Consecutive green days
  const sortedDays=Object.entries(dayMap).sort((a,b)=>b[0].localeCompare(a[0]));
  let streak=0;for(const[,d] of sortedDays){if(d.pnl>0)streak++;else break;}

  const ACHIEVEMENTS=[
    {id:"first_trade",icon:"🌱",name:"First Step",desc:"Log your first trade",unlocked:trades.length>=1},
    {id:"ten_trades",icon:"📊",name:"Getting Started",desc:"Complete 10 trades",unlocked:trades.length>=10,progress:Math.min(trades.length/10,1)},
    {id:"fifty_trades",icon:"💪",name:"In The Zone",desc:"Complete 50 trades",unlocked:trades.length>=50,progress:Math.min(trades.length/50,1)},
    {id:"green_week",icon:"🟢",name:"Green Week",desc:"5 consecutive green days",unlocked:streak>=5,progress:Math.min(streak/5,1)},
    {id:"win_rate_60",icon:"🎯",name:"Sharp Shooter",desc:"Achieve 60% win rate",unlocked:winRate>=60,progress:Math.min(winRate/60,1)},
    {id:"first_500",icon:"💰",name:"First $500",desc:"Reach $500 total P&L",unlocked:totalPnl>=500,progress:Math.min(Math.max(totalPnl/500,0),1)},
    {id:"first_1000",icon:"🚀",name:"Four Figures",desc:"Reach $1,000 total P&L",unlocked:totalPnl>=1000,progress:Math.min(Math.max(totalPnl/1000,0),1)},
    {id:"best_day_200",icon:"⚡",name:"Big Day",desc:"$200+ in a single day",unlocked:bestDay>=200,progress:Math.min(bestDay/200,1)},
    {id:"green_days_10",icon:"[ ]",name:"Consistent",desc:"10 green trading days",unlocked:greenDays>=10,progress:Math.min(greenDays/10,1)},
    {id:"discipline",icon:"🏆",name:"Disciplined Trader",desc:"30 green days total",unlocked:greenDays>=30,progress:Math.min(greenDays/30,1)},
  ];

  const unlocked=ACHIEVEMENTS.filter(a=>a.unlocked);
  const locked=ACHIEVEMENTS.filter(a=>!a.unlocked);

  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column",gap:12}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontSize:9,color:B.textMuted,letterSpacing:2,textTransform:"uppercase"}}>Achievements</div>
        <div style={{fontSize:11,color:B.spark,fontWeight:700}}>{unlocked.length}/{ACHIEVEMENTS.length} unlocked</div>
      </div>

      {/* Unlocked */}
      {unlocked.length>0&&(
        <div>
          <div style={{fontSize:10,color:B.teal,letterSpacing:1,marginBottom:6}}>✓ Unlocked</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
            {unlocked.map(a=>(
              <div key={a.id} title={a.desc} style={{padding:"6px 12px",borderRadius:20,background:`${B.teal}15`,border:`1px solid ${B.borderTeal}`,display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:14}}>{a.icon}</span>
                <span style={{fontSize:11,fontWeight:700,color:B.teal}}>{a.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* In progress */}
      <div style={{flex:1,overflowY:"auto"}}>
        <div style={{fontSize:10,color:B.textMuted,letterSpacing:1,marginBottom:6}}>In Progress</div>
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {locked.slice(0,4).map(a=>(
            <div key={a.id} style={{padding:"10px 12px",borderRadius:10,background:"rgba(0,0,0,0.3)",border:`1px solid ${B.border}`}}>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                <span style={{fontSize:16,opacity:0.4}}>{a.icon}</span>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:700,color:B.textMuted}}>{a.name}</div>
                  <div style={{fontSize:10,color:B.textDim}}>{a.desc}</div>
                </div>
                <span style={{fontSize:11,fontFamily:"monospace",color:B.textMuted}}>{Math.round((a.progress||0)*100)}%</span>
              </div>
              <div style={{height:4,background:"rgba(255,255,255,0.05)",borderRadius:2}}>
                <div style={{height:"100%",width:`${(a.progress||0)*100}%`,background:"linear-gradient(90deg,#4F8EF7,#8B5CF6)",borderRadius:2,transition:"width 0.8s"}}/>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}



// ── TCA Playbook Library ──────────────────────────────────────────────────────
const DEFAULT_PLAYBOOK = [
  {
    id:"section_1", type:"section", title:"The 10AM Triple Timeframe Setup",
    color:"#00D4A8", icon:"🎯",
    lessons:[
      {id:"l1",title:"What is the 10AM Setup?",content:"The 10AM Triple Timeframe Confluence is the core TCA entry model. It requires alignment across 3 timeframes at or near the 10AM NY session open.\n\n• 3H candle must show directional bias\n• 90M candle must confirm direction\n• 45M candle triggers the entry\n\nAll three must agree — no exceptions."},
      {id:"l2",title:"Entry Rules",content:"Entry Checklist:\n✓ Wait for 10:00 AM NY time\n✓ 3H candle is bullish (for longs) or bearish (for shorts)\n✓ 90M candle confirms same direction\n✓ 45M candle breaks structure in direction\n✓ Look for FVG or OTE entry on 15M or 5M\n✓ Stop below/above the 45M swing\n✓ Target: previous high/low or next PD array"},
      {id:"l3",title:"What Invalidates the Setup",content:"Do NOT take the trade if:\n✗ Candles across timeframes disagree\n✗ You're in a consolidation zone (choppy price)\n✗ Major news event within 30 minutes\n✗ Already missed the 10AM window (no chasing)\n✗ Daily bias is unclear"},
    ]
  },
  {
    id:"section_2", type:"section", title:"ICT Concepts Reference",
    color:"#4F8EF7", icon:"📚",
    lessons:[
      {id:"l4",title:"Fair Value Gap (FVG)",content:"A FVG is a 3-candle imbalance where price moves so fast it leaves an unfilled gap between candle 1's high and candle 3's low (bullish) or candle 1's low and candle 3's high (bearish).\n\n• Price tends to return to fill FVGs\n• Best used as entry zones, not standalone signals\n• OTE (0.62-0.79 fib) inside an FVG = high probability"},
      {id:"l5",title:"Order Blocks",content:"An order block is the last up-candle before a bearish move, or the last down-candle before a bullish move.\n\n• Represents institutional order activity\n• Price often retraces to test the order block\n• Stronger when combined with FVG or liquidity sweep"},
      {id:"l6",title:"Liquidity Sweeps",content:"ICT calls these 'judas swings' — price moves above old highs or below old lows to grab stop orders, then reverses.\n\n• Buy side liquidity = stops above swing highs\n• Sell side liquidity = stops below swing lows\n• A sweep + reversal = high probability entry signal"},
    ]
  },
  {
    id:"section_3", type:"section", title:"Risk Management Rules",
    color:"#8B5CF6", icon:"🛡️",
    lessons:[
      {id:"l7",title:"Position Sizing",content:"MES Futures Sizing Rules:\n\n• Never risk more than 1-2% of account per trade\n• For a $10,000 account: max risk = $100-200 per trade\n• 1 MES contract = $1.25 per tick, $5 per point\n• Calculate contracts from your dollar risk, not gut feel\n\nFormula: Contracts = Dollar Risk ÷ (Stop in points × $5)"},
      {id:"l8",title:"Daily Loss Limit",content:"Hard Rules:\n• Daily loss limit: Set before market open, never move it\n• Once hit — STOP. Log off. Walk away.\n• 3 consecutive losing days = take a day off\n• Never revenge trade. Ever.\n\nThe goal is longevity. One bad day shouldn't end your account."},
    ]
  },
  {
    id:"section_4", type:"section", title:"Pre-Market Routine",
    color:"#F59E0B", icon:"🌅",
    lessons:[
      {id:"l9",title:"Morning Checklist",content:"Every morning before 9:30 AM:\n\n1. Check economic calendar (FOMC, CPI, NFP = no trade days)\n2. Identify overnight globex high and low\n3. Mark PDH (Previous Day High) and PDL (Previous Day Low)\n4. Identify weekly high/low levels\n5. Determine bias: Are we above or below key levels?\n6. Identify 1-2 setups to watch at 10AM\n7. Set your daily profit target and loss limit\n8. Check mental state — are you ready to trade?"},
    ]
  },
];

function PlaybookLibrary({session}){
  const SKEY="tca_playbook_v1";
  const [sections,setSections]=useState(DEFAULT_PLAYBOOK);
  const [selectedSection,setSelectedSection]=useState(null);
  const [selectedLesson,setSelectedLesson]=useState(null);
  const [editMode,setEditMode]=useState(false);
  const [editingLesson,setEditingLesson]=useState(null);
  const [editingSection,setEditingSection]=useState(null);
  const [showAddSection,setShowAddSection]=useState(false);
  const [showAddLesson,setShowAddLesson]=useState(false);
  const [newSectionForm,setNewSectionForm]=useState({title:"",icon:"📖",color:"#00D4A8"});
  const [newLessonForm,setNewLessonForm]=useState({title:"",content:""});
  const [saveStatus,setSaveStatus]=useState("saved");
  const [loaded,setLoaded]=useState(false);

  const SECTION_COLORS=["#00D4A8","#4F8EF7","#8B5CF6","#F59E0B","#F05A7E","#10B981"];
  const SECTION_ICONS=["🎯","📚","🛡️","🌅","📊","💡","⚡","🔥","🧠","✅"];

  useEffect(()=>{
    try{const l=localStorage.getItem("pref_"+SKEY);if(l){const v=JSON.parse(l);setSections(v);}}catch(e){}
    if(session?.user?.id)(async()=>{
      try{
        const{data}=await supabase.from("user_preferences").select("value").eq("key",SKEY).single();
        if(data?.value){const v=JSON.parse(data.value);setSections(v);localStorage.setItem("pref_"+SKEY,data.value);}
      }catch(e){}
      setLoaded(true);
    })();
    else setLoaded(true);
  },[session]);

  const save=async(newSections)=>{
    setSections(newSections);setSaveStatus("saving");
    const val=JSON.stringify(newSections);
    localStorage.setItem("pref_"+SKEY,val);
    if(session?.user?.id)try{
      await supabase.from("user_preferences").upsert({user_id:session.user.id,key:SKEY,value:val,updated_at:new Date().toISOString()},{onConflict:"user_id,key"});
      setSaveStatus("saved");
    }catch(e){setSaveStatus("unsaved");}
    else setSaveStatus("saved");
  };

  const addSection=()=>{
    if(!newSectionForm.title.trim())return;
    const newSec={id:`s_${Date.now()}`,type:"section",title:newSectionForm.title,color:newSectionForm.color,icon:newSectionForm.icon,lessons:[]};
    save([...sections,newSec]);
    setNewSectionForm({title:"",icon:"📖",color:"#00D4A8"});
    setShowAddSection(false);
  };

  const deleteSection=(id)=>{
    if(!confirm("Delete this section and all its lessons?"))return;
    save(sections.filter(s=>s.id!==id));
    if(selectedSection?.id===id){setSelectedSection(null);setSelectedLesson(null);}
  };

  const addLesson=()=>{
    if(!newLessonForm.title.trim()||!selectedSection)return;
    const newLesson={id:`l_${Date.now()}`,title:newLessonForm.title,content:newLessonForm.content};
    const updated=sections.map(s=>s.id===selectedSection.id?{...s,lessons:[...s.lessons,newLesson]}:s);
    save(updated);
    const updatedSection=updated.find(s=>s.id===selectedSection.id);
    setSelectedSection(updatedSection);
    setNewLessonForm({title:"",content:""});
    setShowAddLesson(false);
  };

  const saveLesson=(sectionId,lessonId,updates)=>{
    const updated=sections.map(s=>s.id===sectionId?{...s,lessons:s.lessons.map(l=>l.id===lessonId?{...l,...updates}:l)}:s);
    save(updated);
    const updatedSection=updated.find(s=>s.id===sectionId);
    setSelectedSection(updatedSection);
    setSelectedLesson(updatedSection?.lessons.find(l=>l.id===lessonId));
  };

  const deleteLesson=(sectionId,lessonId)=>{
    const updated=sections.map(s=>s.id===sectionId?{...s,lessons:s.lessons.filter(l=>l.id!==lessonId)}:s);
    save(updated);
    setSelectedSection(updated.find(s=>s.id===sectionId));
    if(selectedLesson?.id===lessonId)setSelectedLesson(null);
  };

  const currentLesson=selectedSection&&selectedLesson?
    sections.find(s=>s.id===selectedSection.id)?.lessons.find(l=>l.id===selectedLesson.id):null;

  return(
    <div style={{display:"flex",height:"calc(100vh - 160px)",gap:0,borderRadius:14,overflow:"hidden",border:`1px solid ${B.border}`}}>

      {/* Left sidebar - sections */}
      <div style={{width:240,background:"rgba(0,0,0,0.4)",borderRight:`1px solid ${B.border}`,display:"flex",flexDirection:"column",flexShrink:0}}>
        {/* Header */}
        <div style={{padding:"16px 16px 12px",borderBottom:`1px solid ${B.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div>
            <div style={{fontSize:13,fontWeight:800,background:GL,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>TCA Playbook</div>
            <div style={{fontSize:9,color:B.textMuted,marginTop:1}}>{sections.reduce((a,s)=>a+s.lessons.length,0)} lessons</div>
          </div>
          <div style={{display:"flex",gap:4}}>
            <button onClick={()=>setEditMode(e=>!e)} style={{padding:"4px 8px",borderRadius:6,border:`1px solid ${editMode?B.teal:B.border}`,background:editMode?`${B.teal}15`:"transparent",color:editMode?B.teal:B.textMuted,cursor:"pointer",fontSize:10}}>
              {editMode?"✓ Done":"✏"}
            </button>
          </div>
        </div>

        {/* Section list */}
        <div style={{flex:1,overflowY:"auto",padding:"8px"}}>
          {sections.map(s=>(
            <div key={s.id}>
              <div onClick={()=>{setSelectedSection(s);setSelectedLesson(null);}}
                style={{
                  padding:"10px 12px",borderRadius:9,cursor:"pointer",marginBottom:4,
                  background:selectedSection?.id===s.id?`${s.color}15`:"transparent",
                  border:`1px solid ${selectedSection?.id===s.id?s.color+"40":B.border}`,
                  transition:"all 0.15s",
                }}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{fontSize:14}}>{s.icon}</span>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontWeight:700,color:selectedSection?.id===s.id?s.color:B.text,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{s.title}</div>
                    <div style={{fontSize:10,color:B.textMuted}}>{s.lessons.length} lesson{s.lessons.length!==1?"s":""}</div>
                  </div>
                  {editMode&&<button onClick={e=>{e.stopPropagation();deleteSection(s.id);}}
                    style={{background:"none",border:"none",color:B.loss,cursor:"pointer",fontSize:12,padding:"0 2px"}}>×</button>}
                </div>
              </div>

              {/* Lessons list under selected section */}
              {selectedSection?.id===s.id&&s.lessons.map(l=>(
                <div key={l.id} onClick={()=>setSelectedLesson(l)}
                  style={{
                    padding:"7px 12px 7px 32px",borderRadius:7,cursor:"pointer",marginBottom:2,
                    background:selectedLesson?.id===l.id?`${s.color}10`:"transparent",
                    borderLeft:`2px solid ${selectedLesson?.id===l.id?s.color:"transparent"}`,
                    transition:"all 0.15s",
                  }}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <div style={{fontSize:11,color:selectedLesson?.id===l.id?s.color:B.textMuted,flex:1,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{l.title}</div>
                    {editMode&&<button onClick={e=>{e.stopPropagation();deleteLesson(s.id,l.id);}}
                      style={{background:"none",border:"none",color:B.loss,cursor:"pointer",fontSize:11,padding:"0 2px",flexShrink:0}}>×</button>}
                  </div>
                </div>
              ))}

              {selectedSection?.id===s.id&&editMode&&(
                <button onClick={()=>setShowAddLesson(true)}
                  style={{width:"100%",padding:"6px",borderRadius:7,border:`1px dashed ${s.color}40`,background:"transparent",color:s.color,cursor:"pointer",fontSize:10,marginBottom:8}}>
                  + Add Lesson
                </button>
              )}
            </div>
          ))}

          {editMode&&(
            <button onClick={()=>setShowAddSection(true)}
              style={{width:"100%",padding:"10px",borderRadius:9,border:`2px dashed ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:11,marginTop:4}}>
              + New Section
            </button>
          )}
        </div>

        {/* Save status */}
        {saveStatus!=="saved"&&(
          <div style={{padding:"8px 16px",borderTop:`1px solid ${B.border}`,fontSize:10,color:B.textMuted,textAlign:"center"}}>
            {saveStatus==="saving"?"Saving...":"Unsaved changes"}
          </div>
        )}
      </div>

      {/* Main content area */}
      <div style={{flex:1,background:B.bg,display:"flex",flexDirection:"column",minWidth:0}}>
        {!selectedSection?(
          <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:16,padding:40}}>
            <div style={{fontSize:48}}>📚</div>
            <div style={{fontSize:18,fontWeight:800,color:B.text,textAlign:"center"}}>TCA Playbook Library</div>
            <div style={{fontSize:13,color:B.textMuted,textAlign:"center",maxWidth:400,lineHeight:1.7}}>
              Your complete reference for The Candlestick Academy methodology.<br/>
              Select a section from the sidebar to start learning.
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,marginTop:8,width:"100%",maxWidth:500}}>
              {sections.map(s=>(
                <div key={s.id} onClick={()=>setSelectedSection(s)} style={{padding:"14px 16px",borderRadius:12,border:`1px solid ${s.color}30`,background:`${s.color}08`,cursor:"pointer",transition:"all 0.15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.background=`${s.color}15`;}}
                  onMouseLeave={e=>{e.currentTarget.style.background=`${s.color}08`;}}>
                  <div style={{fontSize:20,marginBottom:6}}>{s.icon}</div>
                  <div style={{fontSize:12,fontWeight:700,color:s.color}}>{s.title}</div>
                  <div style={{fontSize:10,color:B.textMuted,marginTop:2}}>{s.lessons.length} lessons</div>
                </div>
              ))}
            </div>
          </div>
        ):!selectedLesson?(
          <div style={{flex:1,padding:32,overflowY:"auto"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:24}}>
              <span style={{fontSize:28}}>{selectedSection.icon}</span>
              <div>
                <div style={{fontSize:20,fontWeight:800,color:selectedSection.color}}>{selectedSection.title}</div>
                <div style={{fontSize:12,color:B.textMuted}}>{selectedSection.lessons.length} lessons</div>
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:10}}>
              {selectedSection.lessons.map((l,i)=>(
                <div key={l.id} onClick={()=>setSelectedLesson(l)} style={{padding:"16px 20px",borderRadius:12,background:B.surface,border:`1px solid ${B.border}`,cursor:"pointer",transition:"all 0.15s",display:"flex",alignItems:"center",gap:14}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor=selectedSection.color+"60";}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor=B.border;}}>
                  <div style={{width:28,height:28,borderRadius:"50%",background:`${selectedSection.color}20`,border:`1px solid ${selectedSection.color}40`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:selectedSection.color,flexShrink:0}}>{i+1}</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:700,color:B.text}}>{l.title}</div>
                    <div style={{fontSize:11,color:B.textMuted,marginTop:2}}>{l.content.slice(0,80)}...</div>
                  </div>
                  <span style={{color:B.textDim,fontSize:16}}>›</span>
                </div>
              ))}
              {selectedSection.lessons.length===0&&(
                <div style={{textAlign:"center",padding:"40px 0",color:B.textMuted,fontSize:13}}>
                  No lessons yet. Click ✏ Edit to add your first lesson.
                </div>
              )}
            </div>
          </div>
        ):(
          <div style={{flex:1,display:"flex",flexDirection:"column",minHeight:0}}>
            {/* Lesson header */}
            <div style={{padding:"20px 28px 16px",borderBottom:`1px solid ${B.border}`,flexShrink:0,display:"flex",alignItems:"center",gap:12}}>
              <button onClick={()=>setSelectedLesson(null)} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:7,color:B.textMuted,cursor:"pointer",fontSize:12,padding:"4px 10px"}}>← Back</button>
              <div style={{flex:1}}>
                {editMode&&editingLesson?.id===currentLesson?.id?(
                  <input value={editingLesson.title} onChange={e=>setEditingLesson(l=>({...l,title:e.target.value}))}
                    style={{...iS,fontSize:16,fontWeight:700,width:"100%"}}/>
                ):(
                  <div style={{fontSize:16,fontWeight:700,color:B.text}}>{currentLesson?.title}</div>
                )}
                <div style={{fontSize:11,color:selectedSection.color,marginTop:2}}>{selectedSection.icon} {selectedSection.title}</div>
              </div>
              {editMode&&(
                editingLesson?.id===currentLesson?.id?(
                  <div style={{display:"flex",gap:6}}>
                    <button onClick={()=>{saveLesson(selectedSection.id,currentLesson.id,{title:editingLesson.title,content:editingLesson.content});setEditingLesson(null);}}
                      style={{padding:"6px 14px",borderRadius:7,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:12,fontWeight:800}}>Save</button>
                    <button onClick={()=>setEditingLesson(null)}
                      style={{padding:"6px 10px",borderRadius:7,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:12}}>Cancel</button>
                  </div>
                ):(
                  <button onClick={()=>setEditingLesson({...currentLesson})}
                    style={{padding:"6px 14px",borderRadius:7,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:12}}>✏ Edit</button>
                )
              )}
            </div>

            {/* Lesson content */}
            <div style={{flex:1,padding:"24px 28px",overflowY:"auto"}}>
              {editMode&&editingLesson?.id===currentLesson?.id?(
                <textarea value={editingLesson.content} onChange={e=>setEditingLesson(l=>({...l,content:e.target.value}))}
                  style={{...iS,width:"100%",height:"100%",minHeight:400,resize:"none",fontSize:14,lineHeight:1.8,fontFamily:"'DM Sans',sans-serif"}}/>
              ):(
                <div style={{fontSize:14,color:"#D4D0E8",lineHeight:1.9,whiteSpace:"pre-wrap",fontFamily:"'DM Sans',sans-serif"}}>
                  {currentLesson?.content}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Add Section Modal */}
      {showAddSection&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)"}}
          onClick={()=>setShowAddSection(false)}>
          <div style={{background:"#13121A",border:`1px solid ${B.border}`,borderRadius:18,padding:28,width:420}} onClick={e=>e.stopPropagation()}>
            <div style={{height:3,background:GL,borderRadius:"18px 18px 0 0",margin:"-28px -28px 20px"}}/>
            <div style={{fontSize:16,fontWeight:800,color:B.text,marginBottom:20}}>New Section</div>
            <div style={{marginBottom:12}}>
              <label style={lS}>Section Title</label>
              <input value={newSectionForm.title} onChange={e=>setNewSectionForm(f=>({...f,title:e.target.value}))} style={iS} placeholder="e.g. Advanced ICT Concepts"/>
            </div>
            <div style={{marginBottom:12}}>
              <label style={lS}>Icon</label>
              <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
                {SECTION_ICONS.map(icon=>(<button key={icon} onClick={()=>setNewSectionForm(f=>({...f,icon}))}
                  style={{width:34,height:34,borderRadius:8,border:`2px solid ${newSectionForm.icon===icon?B.teal:B.border}`,background:newSectionForm.icon===icon?`${B.teal}15`:"transparent",cursor:"pointer",fontSize:16}}>{icon}</button>))}
              </div>
            </div>
            <div style={{marginBottom:20}}>
              <label style={lS}>Color</label>
              <div style={{display:"flex",gap:6}}>
                {SECTION_COLORS.map(c=>(<button key={c} onClick={()=>setNewSectionForm(f=>({...f,color:c}))}
                  style={{width:26,height:26,borderRadius:"50%",border:`3px solid ${newSectionForm.color===c?"#fff":"transparent"}`,background:c,cursor:"pointer"}}/>))}
              </div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowAddSection(false)} style={{flex:1,padding:"10px",borderRadius:9,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:13}}>Cancel</button>
              <button onClick={addSection} style={{flex:2,padding:"10px",borderRadius:9,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:13,fontWeight:800}}>Create Section</button>
            </div>
          </div>
        </div>
      )}

      {/* Add Lesson Modal */}
      {showAddLesson&&selectedSection&&(
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)"}}
          onClick={()=>setShowAddLesson(false)}>
          <div style={{background:"#13121A",border:`1px solid ${B.border}`,borderRadius:18,padding:28,width:560}} onClick={e=>e.stopPropagation()}>
            <div style={{height:3,background:GL,borderRadius:"18px 18px 0 0",margin:"-28px -28px 20px"}}/>
            <div style={{fontSize:16,fontWeight:800,color:B.text,marginBottom:20}}>New Lesson — {selectedSection.title}</div>
            <div style={{marginBottom:12}}>
              <label style={lS}>Lesson Title</label>
              <input value={newLessonForm.title} onChange={e=>setNewLessonForm(f=>({...f,title:e.target.value}))} style={iS} placeholder="e.g. Entry Triggers"/>
            </div>
            <div style={{marginBottom:20}}>
              <label style={lS}>Content</label>
              <textarea value={newLessonForm.content} onChange={e=>setNewLessonForm(f=>({...f,content:e.target.value}))}
                rows={8} style={{...iS,resize:"vertical",fontSize:13,lineHeight:1.7,fontFamily:"'DM Sans',sans-serif"}} placeholder="Write your lesson content here..."/>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowAddLesson(false)} style={{flex:1,padding:"10px",borderRadius:9,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:13}}>Cancel</button>
              <button onClick={addLesson} style={{flex:2,padding:"10px",borderRadius:9,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:13,fontWeight:800}}>Add Lesson</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}



// ── Recurring Patterns AI ─────────────────────────────────────────────────────
function RecurringPatternsWidget({trades, session}){
  const userId = session?.user?.id||"guest";
  const RP_CACHE = "tca_patterns_"+userId;
  const [analysis,setAnalysis]=useState(()=>{
    try{const c=localStorage.getItem("tca_patterns_"+userId);if(c)return JSON.parse(c).data;}catch(e){}
    return null;
  });
  const [loading,setLoading]=useState(false);
  const [lastRun,setLastRun]=useState(()=>{
    try{const c=localStorage.getItem("tca_patterns_"+userId);if(c)return JSON.parse(c).date;}catch(e){}
    return null;
  });

  const runAnalysis=async()=>{
    if(!trades.length)return;
    setLoading(true);
    try{
      // Build rich stats for the AI
      const dayMap={};
      trades.forEach(t=>{
        if(!dayMap[t.date])dayMap[t.date]={pnl:0,wins:0,total:0,day:t.day||new Date(t.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short"})};
        dayMap[t.date].pnl+=t.pnl;dayMap[t.date].total++;if(t.result==="Win")dayMap[t.date].wins++;
      });

      const byHour={};
      trades.forEach(t=>{
        const h=t.session||"AM";
        if(!byHour[h])byHour[h]={pnl:0,wins:0,total:0};
        byHour[h].pnl+=t.pnl;byHour[h].total++;if(t.result==="Win")byHour[h].wins++;
      });

      const bySetup={};
      trades.forEach(t=>{
        if(!bySetup[t.setup])bySetup[t.setup]={pnl:0,wins:0,total:0};
        bySetup[t.setup].pnl+=t.pnl;bySetup[t.setup].total++;if(t.result==="Win")bySetup[t.setup].wins++;
      });

      const byDay={};
      Object.values(dayMap).forEach(d=>{
        if(!byDay[d.day])byDay[d.day]={pnl:0,wins:0,total:0};
        byDay[d.day].pnl+=d.pnl;byDay[d.day].total++;if(d.pnl>0)byDay[d.day].wins++;
      });

      // Consecutive loss sequences
      const sorted=[...trades].sort((a,b)=>a.date.localeCompare(b.date));
      let maxConsecLoss=0,curLoss=0,maxConsecWin=0,curWin=0;
      sorted.forEach(t=>{
        if(t.result==="Loss"){curLoss++;curWin=0;maxConsecLoss=Math.max(maxConsecLoss,curLoss);}
        else{curWin++;curLoss=0;maxConsecWin=Math.max(maxConsecWin,curWin);}
      });

      // After loss behavior
      let afterLossWins=0,afterLossTotal=0;
      for(let i=1;i<sorted.length;i++){
        if(sorted[i-1].result==="Loss"){afterLossTotal++;if(sorted[i].result==="Win")afterLossWins++;}
      }

      const stats={
        totalTrades:trades.length,
        winRate:Math.round((trades.filter(t=>t.result==="Win").length/trades.length)*100),
        totalPnl:Math.round(trades.reduce((a,t)=>a+t.pnl,0)*100)/100,
        bySession:byHour,
        bySetup:Object.fromEntries(Object.entries(bySetup).slice(0,8)),
        byDayOfWeek:byDay,
        maxConsecLoss,maxConsecWin,
        afterLossWinRate:afterLossTotal?Math.round((afterLossWins/afterLossTotal)*100):null,
        avgTradesPerDay:Math.round(trades.length/Object.keys(dayMap).length*10)/10,
        tradeDays:Object.keys(dayMap).length,
      };

      const res=await fetch("/api/coach",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({type:"patterns",stats:stats}),
      });
      const data=await res.json();
      // coach.js returns parsed JSON directly
      if(data.error){throw new Error(data.error);}
      // Handle both direct object and wrapped content
      let parsed=data;
      if(data.content?.[0]?.text){
        const clean=data.content[0].text.replace(/```json|```/g,"").trim();
        parsed=JSON.parse(clean);
      }
      if(!parsed.patterns&&!parsed.score&&!parsed.topIssue){throw new Error("No patterns returned");}
      setAnalysis(parsed);
      const today=new Date().toISOString().slice(0,10);
      setLastRun(today);
      localStorage.setItem(RP_CACHE,JSON.stringify({data:parsed,date:today}));
    }catch(e){
      console.error("Patterns AI error:",e);
      setAnalysis({
        score:0,
        topIssue:"Analysis Failed",
        summary:`Could not complete analysis: ${e.message}. Make sure you have trades logged and try again.`,
        patterns:[{title:"Error",detail:e.message,type:"negative"}],
        actions:[]
      });
    }
    setLoading(false);
  };

  const TYPE_COLORS={positive:B.profit,negative:B.loss,neutral:B.textMuted,warning:B.spark};

  return(
    <div style={{height:"100%",display:"flex",flexDirection:"column",gap:14}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{fontSize:9,color:B.textMuted,letterSpacing:2,textTransform:"uppercase"}}>🔁 Recurring Patterns AI</div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          {lastRun&&<span style={{fontSize:9,color:B.textDim}}>Last: {lastRun}</span>}
          <button onClick={runAnalysis} disabled={loading||!trades.length}
            style={{padding:"5px 12px",borderRadius:8,border:"none",background:loading?B.border:GL,color:loading?"#666":"#0E0E10",cursor:loading?"not-allowed":"pointer",fontSize:11,fontWeight:700}}>
            {loading?"Analyzing...":"Run Analysis"}
          </button>
        </div>
      </div>

      {!analysis&&!loading&&(
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,color:B.textMuted}}>
          <div style={{fontSize:32}}>🔁</div>
          <div style={{fontSize:13,fontWeight:700,color:B.text}}>Recurring Patterns AI</div>
          <div style={{fontSize:12,textAlign:"center",lineHeight:1.6,maxWidth:280}}>
            Scans all your trades to find behavioral patterns, timing edges, and repeated mistakes you might not notice.
          </div>
          <button onClick={runAnalysis} disabled={!trades.length}
            style={{padding:"10px 24px",borderRadius:10,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:13,fontWeight:800,marginTop:4}}>
            🔍 Analyze My Patterns
          </button>
        </div>
      )}

      {loading&&(
        <div style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12}}>
          <div style={{fontSize:32}}>🧠</div>
          <div style={{fontSize:13,color:B.textMuted}}>Scanning {trades.length} trades for patterns...</div>
          <div style={{width:200,height:3,background:B.border,borderRadius:2,overflow:"hidden"}}>
            <div style={{height:"100%",width:"70%",background:GL,borderRadius:2,animation:"pulse 1.5s infinite"}}/>
          </div>
        </div>
      )}

      {analysis&&(
        <div style={{flex:1,overflowY:"auto",display:"flex",flexDirection:"column",gap:12}}>
          {/* Summary score */}
          <div style={{padding:"14px 16px",borderRadius:12,background:"rgba(0,0,0,0.3)",border:`1px solid ${B.border}`,display:"flex",alignItems:"center",gap:14}}>
            <div style={{textAlign:"center"}}>
              <div style={{fontSize:32,fontWeight:800,background:GL,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",fontFamily:"monospace"}}>{analysis.score||""}</div>
              <div style={{fontSize:9,color:B.textMuted}}>/100</div>
            </div>
            <div style={{flex:1}}>
              <div style={{fontSize:14,fontWeight:700,color:B.text,marginBottom:4}}>{analysis.topIssue||analysis.scoreLabel||"Behavioral Analysis"}</div>
              <div style={{fontSize:12,color:B.textMuted,lineHeight:1.6}}>{analysis.summary||(analysis.topStrength?"Strength: "+analysis.topStrength:"See patterns below.")}</div>
            </div>
          </div>

          {/* Pattern findings */}
          {analysis.patterns?.map((p,i)=>(
            <div key={i} style={{padding:"12px 14px",borderRadius:10,background:`${TYPE_COLORS[p.type]||B.textMuted}08`,border:`1px solid ${TYPE_COLORS[p.type]||B.textMuted}25`}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4}}>
                <span style={{fontSize:14}}>{p.type==="positive"?"✅":p.type==="negative"?"⚠️":"💡"}</span>
                <span style={{fontSize:12,fontWeight:700,color:TYPE_COLORS[p.type]||B.text}}>{p.title}</span>
              </div>
              <div style={{fontSize:12,color:B.textMuted,lineHeight:1.6}}>{p.description||p.detail||p.suggestion}</div>
            </div>
          ))}

          {/* Action items */}
          {analysis.actions?.length>0&&(
            <div style={{padding:"14px 16px",borderRadius:12,background:`${B.teal}08`,border:`1px solid ${B.borderTeal}`}}>
              <div style={{fontSize:10,color:B.teal,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>🎯 Action Plan</div>
              {analysis.actions.map((a,i)=>(
                <div key={i} style={{marginBottom:8,paddingBottom:8,borderBottom:i<analysis.actions.length-1?`1px solid ${B.border}`:"none"}}>
                  <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
                    <span style={{padding:"2px 6px",borderRadius:4,fontSize:9,fontWeight:700,background:a.priority==="high"?`${B.loss}20`:a.priority==="medium"?`${B.spark}20`:`${B.teal}20`,color:a.priority==="high"?B.loss:a.priority==="medium"?B.spark:B.teal,flexShrink:0}}>{a.priority}</span>
                    <div>
                      <div style={{fontSize:12,fontWeight:700,color:B.text}}>{a.action}</div>
                      <div style={{fontSize:11,color:B.textMuted,marginTop:2}}>{a.reasoning}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}



// ── Economic Calendar ─────────────────────────────────────────────────────────
// Uses Tradingeconomics free calendar scraper via a CORS proxy
// Falls back to a curated static list of known recurring US events

const RECURRING_US_EVENTS = [
  {time:"08:30",name:"Initial Jobless Claims",impact:"high",day:"Thursday"},
  {time:"08:30",name:"Non-Farm Payrolls",impact:"high",day:"Friday",note:"First Friday of month"},
  {time:"08:30",name:"CPI m/m",impact:"high",day:"",note:"~2nd Tuesday of month"},
  {time:"08:30",name:"Core CPI m/m",impact:"high",day:"",note:"~2nd Tuesday of month"},
  {time:"08:30",name:"PPI m/m",impact:"high",day:"",note:"~2nd Wednesday of month"},
  {time:"14:00",name:"FOMC Statement",impact:"high",day:"Wednesday",note:"8x per year"},
  {time:"08:30",name:"GDP q/q",impact:"high",day:"",note:"Quarterly"},
  {time:"08:30",name:"Trade Balance",impact:"high",day:""},
  {time:"08:30",name:"Unemployment Rate",impact:"high",day:"Friday",note:"First Friday of month"},
  {time:"10:00",name:"ISM Manufacturing PMI",impact:"high",day:"Monday",note:"First Monday of month"},
  {time:"10:00",name:"ISM Services PMI",impact:"high",day:"Wednesday",note:"~3rd Wednesday of month"},
  {time:"10:00",name:"CB Consumer Confidence",impact:"medium",day:"Tuesday",note:"Last Tuesday of month"},
  {time:"09:45",name:"S&P Global Manufacturing PMI",impact:"medium",day:"Monday"},
  {time:"10:00",name:"JOLTS Job Openings",impact:"medium",day:"Tuesday"},
  {time:"08:15",name:"ADP Non-Farm Employment",impact:"medium",day:"Wednesday",note:"~2nd Wednesday of month"},
  {time:"10:30",name:"Crude Oil Inventories",impact:"medium",day:"Wednesday"},
  {time:"08:30",name:"Retail Sales m/m",impact:"high",day:""},
  {time:"08:30",name:"Core Retail Sales m/m",impact:"high",day:""},
  {time:"08:30",name:"Average Hourly Earnings m/m",impact:"high",day:"Friday",note:"First Friday of month"},
];

function EconomicCalendar({isDark=true}){
  const [events,setEvents]=useState([]);
  const [loading,setLoading]=useState(false);
  const [selectedDate,setSelectedDate]=useState(new Date().toISOString().slice(0,10));
  const [filter,setFilter]=useState("high");
  const [view,setView]=useState("live");
  const [manualEvents,setManualEvents]=useState([]);
  const [showAdd,setShowAdd]=useState(false);
  const [newEvent,setNewEvent]=useState({date:"",time:"",name:"",impact:"high",forecast:"",previous:"",currency:"USD",actual:""});
  const [fetchError,setFetchError]=useState(false);

  useEffect(()=>{
    try{const l=localStorage.getItem("tca_eco_events_v1");if(l)setManualEvents(JSON.parse(l));}catch(e){}
  },[]);

  const saveManual=(evts)=>{
    setManualEvents(evts);
    try{localStorage.setItem("tca_eco_events_v1",JSON.stringify(evts));}catch(e){}
  };

  // Fetch from Tradingeconomics calendar API (free tier)
  const fetchEvents=async(date)=>{
    setLoading(true);setFetchError(false);

    const d=new Date(date+"T12:00:00");
    const dow=d.getDay();
    const mon=new Date(d);mon.setDate(d.getDate()-(dow===0?6:dow-1));
    const weekDatesArr=Array.from({length:5},(_,i)=>{
      const dd=new Date(mon);dd.setDate(mon.getDate()+i);
      return dd.toISOString().slice(0,10);
    });
    const from=weekDatesArr[0];
    const to=weekDatesArr[4];

    // Per-week cache
    const cacheKey=`tca_eco2_${from}`;
    try{
      const cached=sessionStorage.getItem(cacheKey);
      if(cached){
        const {events:ce,ts}=JSON.parse(cached);
        // Cache valid for 1 hour
        if(Date.now()-ts<3600000){setEvents(ce);setLoading(false);return;}
      }
    }catch(e){}

    // ── PRIMARY: Our Vercel proxy (no CORS, real data) ────────────────────────
    try{
      const res=await fetch(`/api/calendar?from=${from}&to=${to}`);
      if(res.ok){
        const data=await res.json();
        if(data.events?.length){
          const sorted=data.events.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));
          setEvents(sorted);
          setFetchError(false);
          try{sessionStorage.setItem(cacheKey,JSON.stringify({events:sorted,ts:Date.now()}));}catch(e){}
          setLoading(false);
          return;
        }
      }
    }catch(e){console.warn("Calendar proxy failed:",e.message);}

    // ── FALLBACK: AI coach generates the week ─────────────────────────────────
    try{
      const res=await fetch("/api/coach",{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          type:"economic",
          dayStats:{weekStart:from,weekEnd:to,weekDates:weekDatesArr,today:new Date().toISOString().slice(0,10)}
        }),
      });
      const data=await res.json();
      if(data.events?.length){
        const valid=data.events.filter(e=>e.date>=from&&e.date<=to)
          .sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));
        if(valid.length){
          setEvents(valid);
          try{sessionStorage.setItem(cacheKey,JSON.stringify({events:valid,ts:Date.now()}));}catch(e){}
          setLoading(false);
          return;
        }
      }
    }catch(e){console.warn("AI calendar failed:",e.message);}

    // ── FINAL FALLBACK: Smart day-aware static events ─────────────────────────
    setFetchError(true);
    const fallback=[];
    weekDatesArr.forEach(ds=>{
      const dd=new Date(ds+"T12:00:00");
      const dayName=dd.toLocaleDateString("en-US",{weekday:"long"});
      const wom=Math.ceil(dd.getDate()/7);
      if(dayName==="Tuesday"){
        fallback.push({date:ds,time:"10:00",name:"JOLTS Job Openings",impact:"high",currency:"USD",actual:"",forecast:"",previous:"",id:Math.random()});
        fallback.push({date:ds,time:"10:00",name:"CB Consumer Confidence",impact:"medium",currency:"USD",actual:"",forecast:"",previous:"",id:Math.random()});
        if(wom===2){fallback.push({date:ds,time:"08:30",name:"CPI m/m",impact:"high",currency:"USD",actual:"",forecast:"",previous:"",id:Math.random()});
          fallback.push({date:ds,time:"08:30",name:"Core CPI m/m",impact:"high",currency:"USD",actual:"",forecast:"",previous:"",id:Math.random()});}
      }
      if(dayName==="Wednesday"){
        fallback.push({date:ds,time:"08:15",name:"ADP Non-Farm Employment",impact:"high",currency:"USD",actual:"",forecast:"",previous:"",id:Math.random()});
        fallback.push({date:ds,time:"08:30",name:"Core Retail Sales m/m",impact:"high",currency:"USD",actual:"",forecast:"",previous:"",id:Math.random()});
        fallback.push({date:ds,time:"08:30",name:"Retail Sales m/m",impact:"high",currency:"USD",actual:"",forecast:"",previous:"",id:Math.random()});
        fallback.push({date:ds,time:"10:00",name:"ISM Manufacturing PMI",impact:"high",currency:"USD",actual:"",forecast:"",previous:"",id:Math.random()});
        fallback.push({date:ds,time:"10:30",name:"Crude Oil Inventories",impact:"medium",currency:"USD",actual:"",forecast:"",previous:"",id:Math.random()});
      }
      if(dayName==="Thursday"){
        fallback.push({date:ds,time:"08:30",name:"Initial Jobless Claims",impact:"high",currency:"USD",actual:"",forecast:"",previous:"",id:Math.random()});
        fallback.push({date:ds,time:"08:30",name:"Continuing Jobless Claims",impact:"medium",currency:"USD",actual:"",forecast:"",previous:"",id:Math.random()});
      }
      if(dayName==="Friday"&&wom===1){
        fallback.push({date:ds,time:"08:30",name:"Non-Farm Payrolls",impact:"high",currency:"USD",actual:"",forecast:"",previous:"",id:Math.random()});
        fallback.push({date:ds,time:"08:30",name:"Unemployment Rate",impact:"high",currency:"USD",actual:"",forecast:"",previous:"",id:Math.random()});
        fallback.push({date:ds,time:"08:30",name:"Average Hourly Earnings m/m",impact:"high",currency:"USD",actual:"",forecast:"",previous:"",id:Math.random()});
      }
    });
    setEvents(fallback.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)));
    setLoading(false);
  };
  useEffect(()=>{fetchEvents(selectedDate);},[selectedDate]);

  // Week navigation
  const getWeekDates=(date)=>{
    const d=new Date(date+"T12:00:00");
    const day=d.getDay();
    const mon=new Date(d);mon.setDate(d.getDate()-(day===0?6:day-1));
    return Array.from({length:5},(_,i)=>{
      const dd=new Date(mon);dd.setDate(mon.getDate()+i);
      return dd.toISOString().slice(0,10);
    });
  };
  const weekDates=getWeekDates(selectedDate);
  const prevWeek=()=>{const d=new Date(selectedDate+"T12:00:00");d.setDate(d.getDate()-7);setSelectedDate(d.toISOString().slice(0,10));};
  const nextWeek=()=>{const d=new Date(selectedDate+"T12:00:00");d.setDate(d.getDate()+7);setSelectedDate(d.toISOString().slice(0,10));};
  const today=new Date().toISOString().slice(0,10);

  const filtered=events.filter(e=>
    filter==="all"?true:filter==="high"?e.impact==="high":e.impact==="high"||e.impact==="medium"
  );

  // Group by date
  const grouped={};
  filtered.forEach(e=>{if(!grouped[e.date])grouped[e.date]=[];grouped[e.date].push(e);});
  const groupedDays=Object.entries(grouped).sort((a,b)=>a[0].localeCompare(b[0]));

  const IMPACT_COLORS={high:"#E53E3E",medium:"#D97706",low:"#6B7280"};
  const bg=isDark?"#0E0E10":"#FFFFFF";
  const rowBg=isDark?"#13121A":"#F7F8FC";
  const rowHover=isDark?"rgba(255,255,255,0.03)":"rgba(0,0,0,0.02)";
  const border=isDark?"rgba(255,255,255,0.07)":"rgba(0,0,0,0.09)";
  const textPrimary=isDark?"#F0EEF8":"#1A1A2E";
  const textMuted=isDark?"#6B6880":"#6B7280";
  const textDim=isDark?"#2E2C3A":"#D1D5DB";
  const headerBg=isDark?"#13121A":"#F1F3F9";
  const dayHeaderBg=isDark?"rgba(255,255,255,0.03)":"rgba(0,0,0,0.04)";
  const posColor=isDark?"#00D4A8":"#059669";
  const negColor=isDark?"#F05A7E":"#C53030";

  const addManual=()=>{
    if(!newEvent.name.trim()||!newEvent.date)return;
    saveManual([...manualEvents,{...newEvent,id:Date.now()}]);
    setNewEvent({date:"",time:"",name:"",impact:"high",forecast:"",previous:"",currency:"USD",actual:""});
    setShowAdd(false);
  };

  const formatVal=(val)=>{
    if(val===null||val===undefined||val===""||String(val).trim()==="null")return<span style={{color:textDim}}>—</span>;
    return<span style={{color:textMuted,fontFamily:"monospace"}}>{String(val).trim()}</span>;
  };

  const formatActual=(evt)=>{
    const val=evt.actual;
    if(val===null||val===undefined||val==="")return<span style={{color:textDim}}>—</span>;
    const str=String(val).trim();
    if(!str||str==="null")return<span style={{color:textDim}}>—</span>;
    // Try beat/miss coloring vs forecast
    const cleanA=parseFloat(str.replace(/[KMBkm%]/g,""));
    const cleanF=parseFloat(String(evt.forecast||"").replace(/[KMBkm%]/g,""));
    if(!isNaN(cleanA)&&!isNaN(cleanF)&&cleanF!==0){
      const beat=cleanA>=cleanF;
      return<span style={{color:beat?posColor:negColor,fontFamily:"monospace",fontWeight:700}}>{str}</span>;
    }
    return<span style={{color:textPrimary,fontFamily:"monospace",fontWeight:700}}>{str}</span>;
  };

  return(
    <div style={{display:"flex",flexDirection:"column",gap:16,fontFamily:"'DM Sans',sans-serif"}}>

      {/* My Events toggle */}
      <div style={{display:"flex",justifyContent:"flex-end"}}>
        <button onClick={()=>setView(v=>v==="live"?"manual":"live")} style={{
          padding:"7px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:700,
          border:`1px solid ${view==="manual"?B.teal:B.border}`,
          background:view==="manual"?`${B.teal}15`:"transparent",
          color:view==="manual"?B.teal:B.textMuted,
        }}>📋 My Events{manualEvents.length>0?` (${manualEvents.length})`:""}</button>
      </div>

      {/* LIVE CALENDAR - Investing.com iframe (best data, with actuals) */}
      {view==="live"&&(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,overflow:"hidden"}}>
            <div style={{padding:"12px 18px",borderBottom:`1px solid ${B.border}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <div style={{width:8,height:8,borderRadius:"50%",background:B.teal}}/>
                <span style={{fontSize:12,color:B.text,fontWeight:600}}>Live Economic Calendar — Powered by Investing.com</span>
              </div>
              <div style={{display:"flex",gap:8}}>
                <a href="https://www.forexfactory.com/calendar" target="_blank" rel="noopener noreferrer"
                  style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${B.border}`,color:B.textMuted,textDecoration:"none",fontSize:11}}>ForexFactory ↗</a>
                <a href="https://www.investing.com/economic-calendar/" target="_blank" rel="noopener noreferrer"
                  style={{padding:"4px 10px",borderRadius:6,border:`1px solid ${B.border}`,color:B.textMuted,textDecoration:"none",fontSize:11}}>Investing.com ↗</a>
              </div>
            </div>
            <div style={{background:isDark?"#0E0E10":"#f7f8fc"}}>
              <iframe
                src="https://sslecal2.investing.com?columns=exc_flags,exc_currency,exc_importance,exc_actual,exc_forecast,exc_previous&features=datepicker,timezone,filters&countries=5&importance=3&calType=week&timeZone=8&lang=1&theme=darkTheme&customWidth=100%25"
                width="100%"
                height="680"
                frameBorder="0"
                allowTransparency
                style={{
                  display:"block",
                  border:"none",
                  filter:isDark?"invert(1) hue-rotate(180deg) brightness(0.85) contrast(0.9) saturate(1.3)":"none",
                }}
                title="Economic Calendar"
              />
            </div>
            <div style={{padding:"8px 18px",borderTop:`1px solid ${B.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:10,color:B.textDim}}>Showing high-impact USD events · Updates in real time</span>
              <div style={{display:"flex",gap:8}}>
                <a href="https://www.cmegroup.com/markets/interest-rates/cme-fedwatch-tool.html" target="_blank" rel="noopener noreferrer"
                  style={{fontSize:10,padding:"3px 8px",borderRadius:5,border:`1px solid ${B.border}`,color:B.textMuted,textDecoration:"none"}}>CME FedWatch ↗</a>
                <a href="https://www.bls.gov/schedule/news_release/current.htm" target="_blank" rel="noopener noreferrer"
                  style={{fontSize:10,padding:"3px 8px",borderRadius:5,border:`1px solid ${B.border}`,color:B.textMuted,textDecoration:"none"}}>BLS.gov ↗</a>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* MANUAL EVENTS */}
      {view==="manual"&&(
        <div style={{display:"flex",flexDirection:"column",gap:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontSize:12,color:B.textMuted}}>Manually track events alongside your trades</div>
            <button onClick={()=>setShowAdd(p=>!p)} style={{padding:"7px 16px",borderRadius:8,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:12,fontWeight:800}}>{showAdd?"✕ Cancel":"+ Add Event"}</button>
          </div>
          {showAdd&&(
            <div style={{padding:18,borderRadius:14,background:B.surface,border:`1px solid ${B.borderTeal}`}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12,marginBottom:12}}>
                <div><label style={lS}>Date *</label><input type="date" value={newEvent.date} onChange={e=>setNewEvent(v=>({...v,date:e.target.value}))} style={iS}/></div>
                <div><label style={lS}>Time</label><input type="time" value={newEvent.time} onChange={e=>setNewEvent(v=>({...v,time:e.target.value}))} style={iS}/></div>
                <div><label style={lS}>Impact</label><select value={newEvent.impact} onChange={e=>setNewEvent(v=>({...v,impact:e.target.value}))} style={iS}><option value="high">🔴 High</option><option value="medium">🟡 Medium</option><option value="low">⚪ Low</option></select></div>
                <div style={{gridColumn:"1/-1"}}><label style={lS}>Event Name *</label><input value={newEvent.name} onChange={e=>setNewEvent(v=>({...v,name:e.target.value}))} style={iS} placeholder="e.g. CPI m/m, FOMC Statement, NFP"/></div>
                <div><label style={lS}>Forecast</label><input value={newEvent.forecast} onChange={e=>setNewEvent(v=>({...v,forecast:e.target.value}))} style={iS} placeholder="0.3%"/></div>
                <div><label style={lS}>Previous</label><input value={newEvent.previous} onChange={e=>setNewEvent(v=>({...v,previous:e.target.value}))} style={iS} placeholder="0.2%"/></div>
                <div><label style={lS}>Actual</label><input value={newEvent.actual} onChange={e=>setNewEvent(v=>({...v,actual:e.target.value}))} style={iS} placeholder="Fill after release"/></div>
              </div>
              <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
                <button onClick={()=>setShowAdd(false)} style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:12}}>Cancel</button>
                <button onClick={addManual} style={{padding:"8px 24px",borderRadius:8,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:12,fontWeight:800}}>Save Event</button>
              </div>
            </div>
          )}
          {manualEvents.length===0&&!showAdd?(
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"60px 20px",borderRadius:14,border:`2px dashed ${B.border}`,gap:12}}>
              <div style={{fontSize:36}}>📋</div>
              <div style={{fontSize:14,fontWeight:700,color:B.text}}>No manual events yet</div>
              <div style={{fontSize:12,color:B.textMuted,textAlign:"center"}}>Track specific events you want to watch around your trades</div>
              <button onClick={()=>setShowAdd(true)} style={{padding:"9px 20px",borderRadius:9,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:12,fontWeight:800}}>+ Add First Event</button>
            </div>
          ):(
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {[...manualEvents].sort((a,b)=>a.date.localeCompare(b.date)).map(evt=>(
                <div key={evt.id} style={{display:"grid",gridTemplateColumns:"100px 60px 1fr 70px 90px 90px 90px 36px",gap:0,padding:"12px 16px",borderRadius:10,background:B.surface,border:`1px solid ${B.border}`,borderLeft:`3px solid ${IMPACT_COLORS[evt.impact]||B.border}`,alignItems:"center"}}>
                  <div style={{fontSize:12,fontWeight:600,color:B.text}}>{new Date(evt.date+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
                  <div style={{fontSize:12,fontFamily:"monospace",color:B.textMuted}}>{evt.time||"—"}</div>
                  <div style={{fontSize:13,fontWeight:700,color:B.text}}>{evt.name}</div>
                  <div style={{fontSize:11,fontWeight:700,color:B.blue}}>{evt.currency}</div>
                  <div style={{fontSize:12,color:evt.actual?B.profit:B.textDim,fontFamily:"monospace"}}>{evt.actual||"—"}</div>
                  <div style={{fontSize:12,color:B.textMuted,fontFamily:"monospace"}}>{evt.forecast||"—"}</div>
                  <div style={{fontSize:12,color:B.textMuted,fontFamily:"monospace"}}>{evt.previous||"—"}</div>
                  <button onClick={()=>saveManual(manualEvents.filter(e=>e.id!==evt.id))} style={{background:"none",border:"none",color:B.textMuted,cursor:"pointer",fontSize:16,padding:"2px"}}>×</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}



// ── PDF Report Generator ──────────────────────────────────────────────────────
function PDFReportModal({trades, session, onClose}){
  const [period, setPeriod] = useState("week");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [generating, setGenerating] = useState(false);
  const [done, setDone] = useState(false);

  const getDateRange = ()=>{
    const now = new Date();
    const today = now.toISOString().slice(0,10);
    if(period==="week"){
      const d = new Date(); d.setDate(d.getDate()-7);
      return {from:d.toISOString().slice(0,10), to:today, label:"Last 7 Days"};
    }
    if(period==="this_week"){
      const d = new Date(); const dow = d.getDay();
      d.setDate(d.getDate()-(dow===0?6:dow-1));
      return {from:d.toISOString().slice(0,10), to:today, label:"This Week"};
    }
    if(period==="month"){
      return {from:today.slice(0,7)+"-01", to:today, label:"This Month"};
    }
    if(period==="last_month"){
      const d = new Date(); d.setMonth(d.getMonth()-1);
      const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0");
      const last=new Date(y,d.getMonth()+1,0).getDate();
      return {from:`${y}-${m}-01`, to:`${y}-${m}-${last}`, label:`${d.toLocaleString("en-US",{month:"long"})} ${y}`};
    }
    if(period==="custom") return {from:customFrom, to:customTo, label:`${customFrom} to ${customTo}`};
    return {from:today.slice(0,4)+"-01-01", to:today, label:"Year to Date"};
  };

  const filteredTrades = ()=>{
    const {from,to} = getDateRange();
    return trades.filter(t=>t.date>=from && t.date<=to).sort((a,b)=>a.date.localeCompare(b.date));
  };

  const generatePDF = async()=>{
    setGenerating(true);
    const ft = filteredTrades();
    if(!ft.length){alert("No trades found in this period.");setGenerating(false);return;}
    const range = getDateRange();
    const userName = session?.user?.user_metadata?.full_name || session?.user?.email?.split("@")[0] || "Trader";

    // Compute all stats
    const wins = ft.filter(t=>t.result==="Win");
    const losses = ft.filter(t=>t.result==="Loss");
    const totalPnl = ft.reduce((a,t)=>a+t.pnl,0);
    const wr = Math.round(wins.length/ft.length*100);
    const grossW = wins.reduce((a,t)=>a+t.pnl,0);
    const grossL = Math.abs(losses.reduce((a,t)=>a+t.pnl,0));
    const pf = grossL>0?(grossW/grossL).toFixed(2): wins.length>0?"Perfect":"0";
    const avgW = wins.length?(grossW/wins.length).toFixed(2):"0";
    const avgL = losses.length?(grossL/losses.length).toFixed(2):"0";
    const exp = (totalPnl/ft.length).toFixed(2);

    // By session
    const bySess={};
    ft.forEach(t=>{if(!bySess[t.session])bySess[t.session]={w:0,n:0,pnl:0};bySess[t.session].n++;bySess[t.session].pnl+=t.pnl;if(t.result==="Win")bySess[t.session].w++;});

    // By setup
    const bySetup={};
    ft.forEach(t=>{const s=t.strategy||t.setup||"Unknown";if(!bySetup[s])bySetup[s]={w:0,n:0,pnl:0};bySetup[s].n++;bySetup[s].pnl+=t.pnl;if(t.result==="Win")bySetup[s].w++;});

    // By day of week
    const byDay={};
    ft.forEach(t=>{const d=new Date(t.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short"});if(!byDay[d])byDay[d]={w:0,n:0,pnl:0};byDay[d].n++;byDay[d].pnl+=t.pnl;if(t.result==="Win")byDay[d].w++;});

    // Generate HTML for the PDF
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1a1a2e; background: #fff; padding: 0; }
  .page { width: 794px; min-height: 1123px; padding: 48px; position: relative; page-break-after: always; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 36px; padding-bottom: 20px; border-bottom: 3px solid #00B894; }
  .logo { font-size: 22px; font-weight: 900; color: #1a1a2e; letter-spacing: -0.5px; }
  .logo span { color: #00B894; }
  .report-meta { text-align: right; }
  .report-meta .period { font-size: 18px; font-weight: 800; color: #1a1a2e; }
  .report-meta .sub { font-size: 11px; color: #888; margin-top: 3px; }
  .section-title { font-size: 10px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: #888; margin-bottom: 14px; margin-top: 28px; }
  .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 4px; }
  .stat-box { background: #f8f9fa; border-radius: 10px; padding: 14px 16px; border: 1px solid #e9ecef; }
  .stat-label { font-size: 9px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #aaa; margin-bottom: 6px; }
  .stat-value { font-size: 22px; font-weight: 900; color: #1a1a2e; font-family: 'Courier New', monospace; }
  .stat-value.green { color: #00B894; }
  .stat-value.red { color: #FF6B6B; }
  .stat-value.blue { color: #4F8EF7; }
  .pnl-banner { background: linear-gradient(135deg, #00B894, #00CEC9); border-radius: 14px; padding: 24px 28px; margin-bottom: 4px; display: flex; justify-content: space-between; align-items: center; }
  .pnl-banner.loss { background: linear-gradient(135deg, #FF6B6B, #ee5a24); }
  .pnl-label { font-size: 11px; font-weight: 700; letter-spacing: 2px; text-transform: uppercase; color: rgba(255,255,255,0.75); margin-bottom: 6px; }
  .pnl-value { font-size: 40px; font-weight: 900; color: #fff; font-family: 'Courier New', monospace; letter-spacing: -1px; }
  .pnl-sub { font-size: 12px; color: rgba(255,255,255,0.8); margin-top: 4px; }
  .pnl-right { text-align: right; }
  .pnl-wr { font-size: 36px; font-weight: 900; color: #fff; font-family: 'Courier New', monospace; }
  table { width: 100%; border-collapse: collapse; font-size: 11px; }
  th { background: #f1f3f4; padding: 8px 10px; text-align: left; font-size: 9px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #888; border-bottom: 2px solid #e9ecef; }
  td { padding: 7px 10px; border-bottom: 1px solid #f1f3f4; color: #333; }
  tr:last-child td { border-bottom: none; }
  .win { color: #00B894; font-weight: 700; }
  .loss-c { color: #FF6B6B; font-weight: 700; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 9px; font-weight: 700; }
  .badge-win { background: #e8f8f4; color: #00B894; }
  .badge-loss { background: #fff0f0; color: #FF6B6B; }
  .footer { position: absolute; bottom: 28px; left: 48px; right: 48px; display: flex; justify-content: space-between; font-size: 9px; color: #bbb; border-top: 1px solid #f1f3f4; padding-top: 10px; }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .insight-box { background: #fff8e1; border: 1px solid #ffd54f; border-left: 4px solid #FFB700; border-radius: 8px; padding: 14px 16px; margin-top: 16px; }
  .insight-title { font-size: 10px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #e65100; margin-bottom: 8px; }
  .insight-item { font-size: 11px; color: #555; margin-bottom: 4px; padding-left: 12px; position: relative; }
  .insight-item:before { content: "→"; position: absolute; left: 0; color: #FFB700; font-weight: 700; }
</style>
</head><body>

<!-- PAGE 1: SUMMARY -->
<div class="page">
  <div class="header">
    <div>
      <div class="logo">TCA <span>Journal</span></div>
      <div style="font-size:11px;color:#888;margin-top:4px;">The Candlestick Academy</div>
    </div>
    <div class="report-meta">
      <div class="period">${range.label}</div>
      <div class="sub">Performance Report · ${userName}</div>
      <div class="sub">Generated ${new Date().toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</div>
    </div>
  </div>

  <!-- P&L Banner -->
  <div class="pnl-banner${totalPnl<0?" loss":""}">
    <div>
      <div class="pnl-label">Net P&L</div>
      <div class="pnl-value">${totalPnl>=0?"+":""}$${Math.abs(totalPnl).toFixed(2)}</div>
      <div class="pnl-sub">${ft.length} trades · ${wins.length}W / ${losses.length}L</div>
    </div>
    <div class="pnl-right">
      <div class="pnl-label">Win Rate</div>
      <div class="pnl-wr">${wr}%</div>
      <div class="pnl-sub">Profit Factor: ${pf}</div>
    </div>
  </div>

  <!-- Key Stats -->
  <div class="section-title">Performance Metrics</div>
  <div class="stat-grid">
    <div class="stat-box"><div class="stat-label">Avg Winner</div><div class="stat-value green">+$${avgW}</div></div>
    <div class="stat-box"><div class="stat-label">Avg Loser</div><div class="stat-value red">-$${avgL}</div></div>
    <div class="stat-box"><div class="stat-label">Expectancy</div><div class="stat-value ${parseFloat(exp)>=0?"green":"red"}">${parseFloat(exp)>=0?"+":""}$${exp}</div></div>
    <div class="stat-box"><div class="stat-label">Profit Factor</div><div class="stat-value blue">${pf}</div></div>
    <div class="stat-box"><div class="stat-label">Gross Wins</div><div class="stat-value green">+$${grossW.toFixed(2)}</div></div>
    <div class="stat-box"><div class="stat-label">Gross Loss</div><div class="stat-value red">-$${grossL.toFixed(2)}</div></div>
    <div class="stat-box"><div class="stat-label">Total Trades</div><div class="stat-value">${ft.length}</div></div>
    <div class="stat-box"><div class="stat-label">Win / Loss</div><div class="stat-value">${wins.length}<span style="color:#ccc;font-size:16px"> / </span>${losses.length}</div></div>
  </div>

  <!-- Session + Day breakdown -->
  <div class="two-col" style="margin-top:24px;">
    <div>
      <div class="section-title">By Session</div>
      <table>
        <tr><th>Session</th><th>Trades</th><th>Win %</th><th>P&L</th></tr>
        ${Object.entries(bySess).sort((a,b)=>b[1].pnl-a[1].pnl).map(([s,d])=>`
        <tr>
          <td><strong>${s}</strong></td>
          <td>${d.n}</td>
          <td class="${d.w/d.n>=0.5?"win":"loss-c"}">${Math.round(d.w/d.n*100)}%</td>
          <td class="${d.pnl>=0?"win":"loss-c"}">${d.pnl>=0?"+":""}$${d.pnl.toFixed(2)}</td>
        </tr>`).join("")}
      </table>
    </div>
    <div>
      <div class="section-title">By Day of Week</div>
      <table>
        <tr><th>Day</th><th>Trades</th><th>Win %</th><th>P&L</th></tr>
        ${Object.entries(byDay).map(([d,v])=>`
        <tr>
          <td><strong>${d}</strong></td>
          <td>${v.n}</td>
          <td class="${v.w/v.n>=0.5?"win":"loss-c"}">${Math.round(v.w/v.n*100)}%</td>
          <td class="${v.pnl>=0?"win":"loss-c"}">${v.pnl>=0?"+":""}$${v.pnl.toFixed(2)}</td>
        </tr>`).join("")}
      </table>
    </div>
  </div>

  <!-- Insights -->
  <div class="insight-box">
    <div class="insight-title">Key Insights</div>
    ${(()=>{
      const insights = [];
      const bestSess = Object.entries(bySess).sort((a,b)=>b[1].pnl-a[1].pnl)[0];
      const worstSess = Object.entries(bySess).sort((a,b)=>a[1].pnl-b[1].pnl)[0];
      const bestSetup = Object.entries(bySetup).sort((a,b)=>b[1].pnl-a[1].pnl)[0];
      if(bestSess)insights.push(`Best session: <strong>${bestSess[0]}</strong> with ${Math.round(bestSess[1].w/bestSess[1].n*100)}% win rate and $${bestSess[1].pnl.toFixed(2)} P&L`);
      if(worstSess&&worstSess[0]!==bestSess?.[0])insights.push(`Avoid: <strong>${worstSess[0]}</strong> session — $${worstSess[1].pnl.toFixed(2)} total loss`);
      if(bestSetup)insights.push(`Top setup: <strong>${bestSetup[0]}</strong> generating $${bestSetup[1].pnl.toFixed(2)} across ${bestSetup[1].n} trades`);
      if(parseFloat(avgW)>0&&parseFloat(avgL)>0)insights.push(`Risk/reward profile: avg win $${avgW} vs avg loss $${avgL} (ratio: ${(parseFloat(avgW)/parseFloat(avgL)).toFixed(2)}x)`);
      return insights.map(i=>`<div class="insight-item">${i}</div>`).join("");
    })()}
  </div>

  <div class="footer">
    <span>TCA Journal · The Candlestick Academy</span>
    <span>${range.label} Performance Report · Page 1 of 2</span>
    <span>${new Date().toLocaleDateString()}</span>
  </div>
</div>

<!-- PAGE 2: TRADE LOG -->
<div class="page">
  <div class="header">
    <div>
      <div class="logo">TCA <span>Journal</span></div>
      <div style="font-size:11px;color:#888;margin-top:4px;">Trade Log</div>
    </div>
    <div class="report-meta">
      <div class="period">${range.label}</div>
      <div class="sub">${userName} · ${ft.length} trades</div>
    </div>
  </div>

  <!-- Setup performance -->
  <div class="section-title">Setup / Strategy Performance</div>
  <table style="margin-bottom:24px;">
    <tr><th>Setup / Strategy</th><th>Trades</th><th>Win %</th><th>Gross P&L</th><th>Avg P&L</th></tr>
    ${Object.entries(bySetup).sort((a,b)=>b[1].pnl-a[1].pnl).slice(0,8).map(([s,d])=>`
    <tr>
      <td><strong>${s}</strong></td>
      <td>${d.n}</td>
      <td class="${d.w/d.n>=0.5?"win":"loss-c"}">${Math.round(d.w/d.n*100)}%</td>
      <td class="${d.pnl>=0?"win":"loss-c"}">${d.pnl>=0?"+":""}$${d.pnl.toFixed(2)}</td>
      <td class="${d.pnl/d.n>=0?"win":"loss-c"}">${d.pnl/d.n>=0?"+":""}$${(d.pnl/d.n).toFixed(2)}</td>
    </tr>`).join("")}
  </table>

  <!-- Full trade log -->
  <div class="section-title">Full Trade Log (${ft.length} trades)</div>
  <table>
    <tr><th>Date</th><th>Instrument</th><th>Dir</th><th>Entry</th><th>Exit</th><th>Contracts</th><th>Session</th><th>Setup</th><th>Grade</th><th>Result</th><th>P&L</th></tr>
    ${ft.slice(0,40).map(t=>`
    <tr>
      <td>${t.date}</td>
      <td><strong>${t.instrument||"—"}</strong></td>
      <td>${t.direction==="Long"?"▲ Long":"▼ Short"}</td>
      <td style="font-family:monospace">${t.entry||"—"}</td>
      <td style="font-family:monospace">${t.exit||"—"}</td>
      <td>${t.contracts||1}</td>
      <td>${t.session||"—"}</td>
      <td>${(t.strategy||t.setup||"—").slice(0,15)}</td>
      <td>${t.grade||"—"}</td>
      <td><span class="badge ${t.result==="Win"?"badge-win":"badge-loss"}">${t.result||"—"}</span></td>
      <td class="${t.pnl>=0?"win":"loss-c"}" style="font-family:monospace;font-weight:700">${t.pnl>=0?"+":""}$${t.pnl?.toFixed(2)||"0"}</td>
    </tr>`).join("")}
  </table>
  ${ft.length>40?`<div style="text-align:center;padding:10px;font-size:10px;color:#aaa;">Showing 40 of ${ft.length} trades</div>`:""}

  <div class="footer">
    <span>TCA Journal · The Candlestick Academy</span>
    <span>${range.label} Performance Report · Page 2 of 2</span>
    <span>${new Date().toLocaleDateString()}</span>
  </div>
</div>

</body></html>`;

    // Open in new window and trigger print-to-PDF
    const win = window.open("","_blank","width=900,height=700");
    if(!win){alert("Please allow popups to generate the PDF.");setGenerating(false);return;}
    win.document.write(html);
    win.document.close();
    win.onload = ()=>{
      setTimeout(()=>{
        win.print();
        setDone(true);
        setGenerating(false);
      }, 800);
    };
  };

  const {from,to,label} = getDateRange();
  const count = filteredTrades().length;
  const previewPnl = filteredTrades().reduce((a,t)=>a+t.pnl,0);

  const iS={padding:"8px 12px",borderRadius:9,border:`1px solid ${B.border}`,background:"rgba(0,0,0,0.3)",color:B.text,fontSize:12,outline:"none",width:"100%"};

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={onClose}>
      <div style={{background:"#13121A",border:`1px solid ${B.border}`,borderRadius:20,width:"100%",maxWidth:480,padding:28}} onClick={e=>e.stopPropagation()}>
        <div style={{height:3,background:"linear-gradient(90deg,#00D4A8,#4F8EF7,#8B5CF6)",borderRadius:"20px 20px 0 0",margin:"-28px -28px 24px"}}/>

        {/* Header */}
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:20}}>
          <div style={{width:40,height:40,borderRadius:10,background:"linear-gradient(135deg,#00D4A8,#4F8EF7)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>📄</div>
          <div>
            <div style={{fontSize:16,fontWeight:800,color:B.text}}>Export PDF Report</div>
            <div style={{fontSize:11,color:B.textMuted}}>Weekly or monthly trading summary</div>
          </div>
        </div>

        {/* Period selector */}
        <div style={{marginBottom:16}}>
          <label style={{fontSize:10,color:B.textMuted,letterSpacing:1.5,display:"block",marginBottom:8}}>REPORT PERIOD</label>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {[
              {id:"this_week",label:"This Week"},
              {id:"week",label:"Last 7 Days"},
              {id:"month",label:"This Month"},
              {id:"last_month",label:"Last Month"},
              {id:"ytd",label:"Year to Date"},
              {id:"custom",label:"Custom Range"},
            ].map(p=>(
              <button key={p.id} onClick={()=>setPeriod(p.id)} style={{
                padding:"9px",borderRadius:9,cursor:"pointer",fontSize:12,fontWeight:600,
                border:`1px solid ${period===p.id?B.teal:B.border}`,
                background:period===p.id?`${B.teal}15`:"transparent",
                color:period===p.id?B.teal:B.textMuted,transition:"all 0.12s",
              }}>{p.label}</button>
            ))}
          </div>
        </div>

        {/* Custom range */}
        {period==="custom"&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
            <div><label style={{fontSize:10,color:B.textMuted,display:"block",marginBottom:4}}>FROM</label><input type="date" value={customFrom} onChange={e=>setCustomFrom(e.target.value)} style={iS}/></div>
            <div><label style={{fontSize:10,color:B.textMuted,display:"block",marginBottom:4}}>TO</label><input type="date" value={customTo} onChange={e=>setCustomTo(e.target.value)} style={iS}/></div>
          </div>
        )}

        {/* Preview */}
        <div style={{padding:"14px 16px",borderRadius:10,background:"rgba(0,212,168,0.05)",border:`1px solid rgba(0,212,168,0.15)`,marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:B.text}}>{label}</div>
              <div style={{fontSize:11,color:B.textMuted,marginTop:2}}>{from} → {to}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:18,fontWeight:800,fontFamily:"monospace",color:previewPnl>=0?B.teal:B.loss}}>{(previewPnl>=0?"+":"-")+"$"+Math.abs(previewPnl).toFixed(2)}</div>
              <div style={{fontSize:10,color:B.textMuted}}>{count} trades</div>
            </div>
          </div>
        </div>

        {done&&(
          <div style={{padding:"10px 14px",borderRadius:9,background:"rgba(0,212,168,0.1)",border:`1px solid rgba(0,212,168,0.2)`,marginBottom:16,fontSize:12,color:B.teal}}>
            ✅ PDF opened in new tab — use your browser's print dialog to save as PDF. Set paper size to A4 or Letter.
          </div>
        )}

        {/* Buttons */}
        <div style={{display:"flex",gap:10}}>
          <button onClick={onClose} style={{flex:1,padding:"11px",borderRadius:10,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:13}}>Cancel</button>
          <button onClick={generatePDF} disabled={generating||count===0} style={{flex:2,padding:"11px",borderRadius:10,border:"none",
            background:count===0?"rgba(255,255,255,0.05)":generating?"rgba(0,212,168,0.3)":"linear-gradient(135deg,#00D4A8,#4F8EF7)",
            color:count===0||generating?"#6B6880":"#0E0E10",cursor:count===0?"not-allowed":"pointer",fontSize:13,fontWeight:800}}>
            {generating?"Generating...":count===0?"No trades in range":`📄 Generate PDF (${count} trades)`}
          </button>
        </div>
      </div>
    </div>
  );
}


// ── User Profile Modal ────────────────────────────────────────────────────────
function ProfileModal({session, onClose}){
  const [name, setName] = useState(session?.user?.user_metadata?.full_name||"");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [pwMode, setPwMode] = useState(false);
  const [newPw, setNewPw] = useState("");

  const saveProfile = async()=>{
    setLoading(true);setSuccess("");setError("");
    try{
      const{error:err}=await supabase.auth.updateUser({data:{full_name:name.trim()}});
      if(err)throw err;
      setSuccess("Profile updated!");
    }catch(e){setError(e.message);}
    setLoading(false);
  };

  const changePassword = async()=>{
    if(newPw.length<8){setError("Password must be at least 8 characters.");return;}
    setLoading(true);setSuccess("");setError("");
    try{
      const{error:err}=await supabase.auth.updateUser({password:newPw});
      if(err)throw err;
      setSuccess("Password changed!");setNewPw("");setPwMode(false);
    }catch(e){setError(e.message);}
    setLoading(false);
  };

  const joined = session?.user?.created_at ? new Date(session.user.created_at).toLocaleDateString("en-US",{month:"long",year:"numeric"}) : "—";
  const iS={width:"100%",padding:"10px 12px",borderRadius:9,border:`1px solid ${B.border}`,background:"rgba(0,0,0,0.3)",color:B.text,fontSize:13,outline:"none",fontFamily:"'DM Sans',sans-serif"};

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:"#13121A",border:`1px solid ${B.border}`,borderRadius:20,width:440,padding:28,maxHeight:"90vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{height:3,background:"linear-gradient(90deg,#00D4A8,#8B5CF6)",borderRadius:"20px 20px 0 0",margin:"-28px -28px 24px"}}/>

        {/* Avatar + header */}
        <div style={{display:"flex",alignItems:"center",gap:14,marginBottom:24}}>
          <div style={{width:52,height:52,borderRadius:"50%",background:"linear-gradient(135deg,#00D4A8,#8B5CF6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,fontWeight:800,color:"#0E0E10",flexShrink:0}}>
            {(name||session?.user?.email||"?")[0].toUpperCase()}
          </div>
          <div>
            <div style={{fontSize:16,fontWeight:800,color:B.text}}>{name||session?.user?.email?.split("@")[0]}</div>
            <div style={{fontSize:11,color:B.textMuted}}>{session?.user?.email}</div>
            <div style={{fontSize:10,color:B.textDim,marginTop:2}}>Member since {joined}</div>
          </div>
        </div>

        {/* Name field */}
        <div style={{marginBottom:14}}>
          <label style={{fontSize:10,color:B.textMuted,letterSpacing:1.5,display:"block",marginBottom:6}}>DISPLAY NAME</label>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" style={iS}/>
        </div>

        <button onClick={saveProfile} disabled={loading} style={{width:"100%",padding:"10px",borderRadius:9,border:"none",background:"linear-gradient(135deg,#00D4A8,#4F8EF7)",color:"#0E0E10",cursor:"pointer",fontSize:13,fontWeight:700,marginBottom:16}}>
          {loading?"Saving...":"Save Changes"}
        </button>

        {/* Password change */}
        <div style={{borderTop:`1px solid ${B.border}`,paddingTop:16,marginTop:4}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:pwMode?12:0}}>
            <div style={{fontSize:12,color:B.textMuted}}>Password</div>
            <button onClick={()=>{setPwMode(p=>!p);setError("");}} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:7,color:B.textMuted,cursor:"pointer",fontSize:11,padding:"3px 10px"}}>{pwMode?"Cancel":"Change"}</button>
          </div>
          {pwMode&&(
            <div style={{display:"flex",gap:8,marginTop:8}}>
              <input value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder="New password (8+ chars)" type="password" style={{...iS,flex:1}}/>
              <button onClick={changePassword} style={{padding:"10px 14px",borderRadius:9,border:"none",background:B.teal,color:"#0E0E10",cursor:"pointer",fontSize:12,fontWeight:700,flexShrink:0}}>Save</button>
            </div>
          )}
        </div>

        {error&&<div style={{marginTop:12,padding:"8px 12px",borderRadius:8,background:"rgba(240,90,126,0.1)",border:"1px solid rgba(240,90,126,0.2)",fontSize:12,color:"#F05A7E"}}>{error}</div>}
        {success&&<div style={{marginTop:12,padding:"8px 12px",borderRadius:8,background:"rgba(0,212,168,0.1)",border:"1px solid rgba(0,212,168,0.2)",fontSize:12,color:B.teal}}>{success}</div>}

        <button onClick={onClose} style={{width:"100%",marginTop:16,padding:"9px",borderRadius:9,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:12}}>Close</button>
      </div>
    </div>
  );
}

// ── Admin Panel ───────────────────────────────────────────────────────────────
function AdminPanel({onClose}){
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [userTrades, setUserTrades] = useState([]);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [tab, setTab] = useState("users"); // users | stats

  useEffect(()=>{loadUsers();},[]);

  const loadUsers = async()=>{
    setLoading(true);
    try{
      // Get all users via Supabase admin - uses service role if available
      // Otherwise falls back to user_preferences to detect registered users
      const{data,error}=await supabase.from("user_preferences")
        .select("user_id,updated_at")
        .eq("key","tca_grid_layout_v4")
        .order("updated_at",{ascending:false});
      if(error)throw error;
      
      // Get trade counts per user
      const{data:tradeCounts}=await supabase.from("trades")
        .select("user_id")
        .in("user_id", data?.map(u=>u.user_id)||[]);
      
      const countMap={};
      tradeCounts?.forEach(t=>{countMap[t.user_id]=(countMap[t.user_id]||0)+1;});
      
      setUsers((data||[]).map(u=>({
        id:u.user_id,
        lastSeen:u.updated_at,
        tradeCount:countMap[u.user_id]||0,
      })));
    }catch(e){console.error("Load users error:",e);}
    setLoading(false);
  };

  const loadUserTrades = async(userId)=>{
    setTradesLoading(true);
    try{
      const{data}=await supabase.from("trades").select("*").eq("user_id",userId).order("date",{ascending:false}).limit(50);
      setUserTrades(data||[]);
    }catch(e){}
    setTradesLoading(false);
  };

  const filtered = users.filter(u=>u.id.toLowerCase().includes(search.toLowerCase()));

  const selStats = selected && userTrades.length ? {
    total: userTrades.length,
    pnl: Math.round(userTrades.reduce((a,t)=>a+t.pnl,0)*100)/100,
    wr: Math.round(userTrades.filter(t=>t.result==="Win").length/userTrades.length*100),
    bestTrade: Math.max(...userTrades.map(t=>t.pnl)),
    worstTrade: Math.min(...userTrades.map(t=>t.pnl)),
  } : null;

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.9)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center"}} onClick={onClose}>
      <div style={{background:"#13121A",border:`1px solid ${B.border}`,borderRadius:20,width:"90%",maxWidth:900,maxHeight:"88vh",display:"flex",flexDirection:"column",overflow:"hidden"}} onClick={e=>e.stopPropagation()}>
        
        {/* Header */}
        <div style={{height:3,background:"linear-gradient(90deg,#FFB700,#FF6B35)",flexShrink:0}}/>
        <div style={{padding:"20px 24px",borderBottom:`1px solid ${B.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
          <div>
            <div style={{fontSize:16,fontWeight:800,color:B.text,display:"flex",alignItems:"center",gap:8}}>👑 Admin Panel</div>
            <div style={{fontSize:11,color:B.textMuted,marginTop:2}}>The Candlestick Academy · Student Management</div>
          </div>
          <div style={{display:"flex",gap:8,alignItems:"center"}}>
            <div style={{padding:"5px 12px",borderRadius:20,background:"rgba(255,183,0,0.1)",border:"1px solid rgba(255,183,0,0.2)",fontSize:11,color:"#FFB700",fontWeight:700}}>{users.length} students</div>
            <button onClick={onClose} style={{background:"rgba(255,255,255,0.05)",border:`1px solid ${B.border}`,borderRadius:8,color:B.textMuted,cursor:"pointer",width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>×</button>
          </div>
        </div>

        <div style={{flex:1,overflow:"hidden",display:"flex"}}>
          {/* User list */}
          <div style={{width:280,borderRight:`1px solid ${B.border}`,display:"flex",flexDirection:"column",flexShrink:0}}>
            <div style={{padding:"12px 16px",borderBottom:`1px solid ${B.border}`}}>
              <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search users..." style={{width:"100%",padding:"7px 10px",borderRadius:8,border:`1px solid ${B.border}`,background:"rgba(0,0,0,0.3)",color:B.text,fontSize:12,outline:"none"}}/>
            </div>
            <div style={{flex:1,overflowY:"auto"}}>
              {loading?(
                <div style={{padding:20,textAlign:"center",color:B.textMuted,fontSize:12}}>Loading students...</div>
              ):filtered.length===0?(
                <div style={{padding:20,textAlign:"center",color:B.textMuted,fontSize:12}}>No students found</div>
              ):filtered.map(u=>(
                <div key={u.id} onClick={()=>{setSelected(u);loadUserTrades(u.id);}}
                  style={{padding:"12px 16px",cursor:"pointer",borderBottom:`1px solid ${B.border}20`,
                    background:selected?.id===u.id?`${B.teal}08`:"transparent",
                    borderLeft:`3px solid ${selected?.id===u.id?B.teal:"transparent"}`}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <div style={{width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,#4F8EF7,#8B5CF6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#fff",flexShrink:0}}>
                      {u.id.slice(0,2).toUpperCase()}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:11,color:B.text,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.id.slice(0,18)}...</div>
                      <div style={{fontSize:10,color:B.textMuted,marginTop:1}}>{u.tradeCount} trades · {new Date(u.lastSeen).toLocaleDateString()}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Detail panel */}
          <div style={{flex:1,overflowY:"auto",padding:20}}>
            {!selected?(
              <div style={{height:"100%",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",color:B.textMuted}}>
                <div style={{fontSize:32,marginBottom:12}}>👥</div>
                <div style={{fontSize:14,fontWeight:700,color:B.text}}>Select a student</div>
                <div style={{fontSize:12,marginTop:4}}>Click any student to view their performance</div>
              </div>
            ):(
              <>
                {/* Student header */}
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
                  <div style={{width:44,height:44,borderRadius:"50%",background:"linear-gradient(135deg,#4F8EF7,#8B5CF6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,fontWeight:800,color:"#fff"}}>
                    {selected.id.slice(0,2).toUpperCase()}
                  </div>
                  <div>
                    <div style={{fontSize:14,fontWeight:800,color:B.text}}>Student {selected.id.slice(0,8)}...</div>
                    <div style={{fontSize:11,color:B.textMuted}}>Last active: {new Date(selected.lastSeen).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"})}</div>
                  </div>
                </div>

                {/* Stats */}
                {tradesLoading?(
                  <div style={{textAlign:"center",padding:20,color:B.textMuted,fontSize:12}}>Loading trades...</div>
                ):selStats?(
                  <>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:10,marginBottom:20}}>
                      {[
                        {label:"Trades",value:selStats.total,color:B.blue},
                        {label:"P&L",value:`$${selStats.pnl}`,color:selStats.pnl>=0?B.teal:B.loss},
                        {label:"Win Rate",value:`${selStats.wr}%`,color:B.teal},
                        {label:"Best Trade",value:`$${Math.round(selStats.bestTrade*100)/100}`,color:B.teal},
                        {label:"Worst Trade",value:`$${Math.round(selStats.worstTrade*100)/100}`,color:B.loss},
                      ].map(s=>(
                        <div key={s.label} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:10,padding:"10px 12px",textAlign:"center"}}>
                          <div style={{fontSize:9,color:B.textMuted,letterSpacing:1,marginBottom:4}}>{s.label}</div>
                          <div style={{fontSize:14,fontWeight:800,color:s.color,fontFamily:"monospace"}}>{s.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* Recent trades */}
                    <div style={{fontSize:10,color:B.textMuted,letterSpacing:1.5,marginBottom:10}}>RECENT TRADES</div>
                    <div style={{display:"flex",flexDirection:"column",gap:6}}>
                      {userTrades.slice(0,15).map(t=>(
                        <div key={t.id} style={{display:"grid",gridTemplateColumns:"80px 50px 1fr 60px 70px",gap:8,padding:"8px 12px",borderRadius:8,background:B.surface,border:`1px solid ${B.border}`,alignItems:"center"}}>
                          <div style={{fontSize:10,color:B.textMuted,fontFamily:"monospace"}}>{t.date}</div>
                          <div style={{fontSize:10}}><span style={{padding:"2px 6px",borderRadius:4,background:`${B.teal}15`,color:B.teal,fontSize:9,fontWeight:700}}>{t.instrument}</span></div>
                          <div style={{fontSize:11,color:B.text}}>{t.direction} · {t.setup||"—"}</div>
                          <div style={{fontSize:10,color:B.textMuted}}>{t.session} · {t.grade}</div>
                          <div style={{fontSize:12,fontWeight:700,fontFamily:"monospace",color:t.pnl>=0?B.teal:B.loss,textAlign:"right"}}>{t.pnl>=0?"+":""}{fmt(t.pnl)}</div>
                        </div>
                      ))}
                    </div>
                  </>
                ):(
                  <div style={{textAlign:"center",padding:20,color:B.textMuted,fontSize:12}}>No trades logged yet</div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


// ── Weekly Review Page ────────────────────────────────────────────────────────
function WeeklyReview({trades, session}){
  const [selectedWeek, setSelectedWeek] = useState(()=>{
    const d = new Date();
    const dow = d.getDay();
    const mon = new Date(d);
    mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    return mon.toISOString().slice(0,10);
  });
  const [saved, setSaved] = useState({});
  const [notes, setNotes] = useState("");
  const [focusNext, setFocusNext] = useState("");
  const [rulesKept, setRulesKept] = useState([]);
  const [rulesBroken, setRulesBroken] = useState([]);
  const SKEY = `tca_weekly_review_${selectedWeek}`;

  // Build week dates
  const weekDates = Array.from({length:5}, (_,i)=>{
    const d = new Date(selectedWeek+"T12:00:00");
    d.setDate(d.getDate()+i);
    return d.toISOString().slice(0,10);
  });
  const weekEnd = weekDates[4];
  const weekTrades = trades.filter(t=>t.date>=selectedWeek&&t.date<=weekEnd);

  // Load saved notes
  useEffect(()=>{
    try{
      const saved = JSON.parse(localStorage.getItem(SKEY)||"{}");
      if(saved.notes)setNotes(saved.notes);
      if(saved.focusNext)setFocusNext(saved.focusNext);
      if(saved.rulesKept)setRulesKept(saved.rulesKept);
      if(saved.rulesBroken)setRulesBroken(saved.rulesBroken);
    }catch(e){}
  },[selectedWeek]);

  const saveReview = ()=>{
    const data = {notes,focusNext,rulesKept,rulesBroken,savedAt:new Date().toISOString()};
    localStorage.setItem(SKEY, JSON.stringify(data));
    setSaved(s=>({...s,[selectedWeek]:true}));
    setTimeout(()=>setSaved(s=>({...s,[selectedWeek]:false})),2000);
  };

  const navWeek = (dir)=>{
    const d = new Date(selectedWeek+"T12:00:00");
    d.setDate(d.getDate()+(dir*7));
    const dow = d.getDay();
    const mon = new Date(d);
    mon.setDate(d.getDate()-(dow===0?6:dow-1));
    setSelectedWeek(mon.toISOString().slice(0,10));
    setReview(null);setNotes("");setFocusNext("");setRulesKept([]);setRulesBroken([]);
  };

  // Stats
  const wins = weekTrades.filter(t=>t.result==="Win");
  const losses = weekTrades.filter(t=>t.result==="Loss");
  const pnl = weekTrades.reduce((a,t)=>a+t.pnl,0);
  const wr = weekTrades.length ? Math.round(wins.length/weekTrades.length*100) : 0;

  // Past weeks for sidebar
  const pastWeeks = Array.from({length:8},(_,i)=>{
    const d = new Date(selectedWeek+"T12:00:00");
    d.setDate(d.getDate()-((i+1)*7));
    const dow = d.getDay();
    const mon = new Date(d);
    mon.setDate(d.getDate()-(dow===0?6:dow-1));
    const wStart = mon.toISOString().slice(0,10);
    const wEnd = new Date(mon.getTime()+4*86400000).toISOString().slice(0,10);
    const wTrades = trades.filter(t=>t.date>=wStart&&t.date<=wEnd);
    const wPnl = wTrades.reduce((a,t)=>a+t.pnl,0);
    const wWr = wTrades.length ? Math.round(wTrades.filter(t=>t.result==="Win").length/wTrades.length*100) : 0;
    const hasReview = !!localStorage.getItem("tca_weekly_review_"+wStart);
    return {start:wStart,end:wEnd,trades:wTrades.length,pnl:wPnl,wr:wWr,hasReview};
  }).filter(w=>w.trades>0);

  return(
    <div style={{display:"flex",gap:0,minHeight:"80vh"}}>
      {/* Sidebar */}
      <div style={{width:200,flexShrink:0,borderRight:`1px solid ${B.border}`,paddingRight:16,marginRight:24}}>
        <div style={{fontSize:10,color:B.textMuted,letterSpacing:1.5,marginBottom:10}}>PAST WEEKS</div>
        {pastWeeks.map(w=>(
          <div key={w.start} onClick={()=>{setSelectedWeek(w.start);setNotes("");setFocusNext("");}}
            style={{padding:"8px 10px",borderRadius:8,cursor:"pointer",marginBottom:4,
              background:selectedWeek===w.start?`${B.teal}10`:"transparent",
              border:`1px solid ${selectedWeek===w.start?B.teal:B.border}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{fontSize:11,color:B.text,fontWeight:600}}>{new Date(w.start+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric"})}</div>
              {w.hasReview&&<div style={{width:6,height:6,borderRadius:"50%",background:B.teal}}/>}
            </div>
            <div style={{fontSize:10,color:pnlColor(w.pnl),fontFamily:"monospace",fontWeight:700,marginTop:2}}>{(w.pnl>=0?"+":"-")+"$"+Math.abs(w.pnl).toFixed(2)}</div>
            <div style={{fontSize:9,color:B.textMuted}}>{w.trades} trades · {w.wr}% WR</div>
          </div>
        ))}
      </div>

      {/* Main */}
      <div style={{flex:1}}>
        {/* Week nav */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:24}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <button onClick={()=>navWeek(-1)} style={{width:32,height:32,borderRadius:8,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:16}}>&#8249;</button>
            <div>
              <div style={{fontSize:18,fontWeight:800,color:B.text}}>Week of {new Date(selectedWeek+"T12:00:00").toLocaleDateString("en-US",{month:"long",day:"numeric",year:"numeric"})}</div>
              <div style={{fontSize:11,color:B.textMuted}}>{selectedWeek} to {weekEnd}</div>
            </div>
            <button onClick={()=>navWeek(1)} style={{width:32,height:32,borderRadius:8,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:16}}>&#8250;</button>
          </div>
          <button onClick={saveReview} style={{padding:"8px 18px",borderRadius:9,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:12,fontWeight:600}}>
            {saved[selectedWeek]?"Saved!":"Save Notes"}
          </button>
        </div>

        {/* Stats bar */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:12,marginBottom:24}}>
          {[
            {label:"Trades",value:weekTrades.length,color:B.blue},
            {label:"Net P&L",value:(pnl>=0?"+":"-")+"$"+Math.abs(pnl).toFixed(2),color:pnlColor(pnl)},
            {label:"Win Rate",value:wr+"%",color:wr>=55?B.teal:wr>=45?"#FFB700":B.loss},
            {label:"Wins",value:wins.length,color:B.teal},
            {label:"Losses",value:losses.length,color:B.loss},
          ].map(s=>(
            <div key={s.label} style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:12,padding:"14px 16px",textAlign:"center"}}>
              <div style={{fontSize:9,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:6}}>{s.label}</div>
              <div style={{fontSize:20,fontWeight:800,color:s.color,fontFamily:"monospace"}}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Day grid */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:8,marginBottom:24}}>
          {weekDates.map(date=>{
            const dayTrades = weekTrades.filter(t=>t.date===date);
            const dayPnl = dayTrades.reduce((a,t)=>a+t.pnl,0);
            const dayWins = dayTrades.filter(t=>t.result==="Win").length;
            const dayName = new Date(date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short"});
            const isToday = date===new Date().toISOString().slice(0,10);
            return(
              <div key={date} style={{
                background:dayTrades.length?(dayPnl>=0?"rgba(0,212,168,0.06)":"rgba(240,90,126,0.06)"):B.surface,
                border:`1px solid ${isToday?B.teal:dayTrades.length?(dayPnl>=0?B.borderTeal:B.borderPurp):B.border}`,
                borderRadius:10,padding:"12px",textAlign:"center"}}>
                <div style={{fontSize:11,fontWeight:700,color:isToday?B.teal:B.textMuted,marginBottom:4}}>{dayName}</div>
                <div style={{fontSize:10,color:B.textDim,marginBottom:6}}>{date.slice(5)}</div>
                {dayTrades.length?(
                  <>
                    <div style={{fontSize:14,fontWeight:800,fontFamily:"monospace",color:pnlColor(dayPnl)}}>{(dayPnl>=0?"+":"-")+"$"+Math.abs(dayPnl).toFixed(2)}</div>
                    <div style={{fontSize:10,color:B.textMuted,marginTop:2}}>{dayTrades.length}t {dayWins+"/"+dayTrades.length}</div>
                  </>
                ):(
                  <div style={{fontSize:11,color:B.textDim}}>No trades</div>
                )}
              </div>
            );
          })}
        </div>

        {/* Notes */}
        <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:16,padding:20,marginBottom:16}}>
          <div style={{fontSize:11,color:B.textMuted,letterSpacing:1.5,marginBottom:12}}>MY NOTES THIS WEEK</div>
          <textarea value={notes} onChange={e=>setNotes(e.target.value)}
            placeholder="What did you learn? What will you do differently? Any market observations..."
            style={{width:"100%",minHeight:100,background:"rgba(0,0,0,0.3)",border:`1px solid ${B.border}`,borderRadius:10,padding:"12px 14px",color:B.text,fontSize:13,fontFamily:"'DM Sans',sans-serif",resize:"vertical",outline:"none",lineHeight:1.6}}/>
        </div>

        {/* Focus */}
        <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:16,padding:20,marginBottom:16}}>
          <div style={{fontSize:11,color:B.teal,letterSpacing:1.5,marginBottom:12}}>MY FOCUS FOR NEXT WEEK</div>
          <input value={focusNext} onChange={e=>setFocusNext(e.target.value)}
            placeholder="One thing I will improve next week..."
            style={{width:"100%",background:"rgba(0,0,0,0.3)",border:`1px solid ${B.border}`,borderRadius:10,padding:"11px 14px",color:B.text,fontSize:13,outline:"none"}}/>
        </div>

        {/* Trade list */}
        {weekTrades.length>0&&(
          <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:16,padding:20}}>
            <div style={{fontSize:11,color:B.textMuted,letterSpacing:1.5,marginBottom:12}}>TRADES THIS WEEK ({weekTrades.length})</div>
            <div style={{display:"flex",flexDirection:"column",gap:6}}>
              {weekTrades.sort((a,b)=>a.date.localeCompare(b.date)).map(t=>(
                <div key={t.id} style={{display:"grid",gridTemplateColumns:"80px 50px 60px 1fr 60px 75px 90px",gap:8,padding:"8px 12px",borderRadius:9,
                  background:t.result==="Win"?"rgba(0,212,168,0.04)":"rgba(240,90,126,0.04)",
                  border:"1px solid "+(t.result==="Win"?"rgba(0,212,168,0.15)":"rgba(240,90,126,0.15)"),
                  alignItems:"center"}}>
                  <div style={{fontSize:10,color:B.textMuted,fontFamily:"monospace"}}>{t.date.slice(5)}</div>
                  <div><span style={{padding:"2px 6px",borderRadius:4,background:`${B.teal}15`,color:B.teal,fontSize:9,fontWeight:700}}>{t.instrument}</span></div>
                  <div style={{fontSize:10,color:t.direction==="Long"?"#4ade80":"#f87171",fontWeight:700}}>{t.direction}</div>
                  <div style={{fontSize:11,color:B.textMuted}}>{t.strategy||t.setup||"--"} {t.session}</div>
                  <div style={{fontSize:10,color:B.textMuted,textAlign:"center"}}>{t.grade}</div>
                  <div style={{fontSize:12,fontWeight:800,fontFamily:"monospace",color:pnlColor(t.pnl),textAlign:"right"}}>{(t.pnl>=0?"+":"-")+"$"+Math.abs(t.pnl).toFixed(2)}</div>
                  <TradeReplayButton trade={t}/>
                </div>
              ))}
            </div>
          </div>
        )}

        {weekTrades.length===0&&(
          <div style={{textAlign:"center",padding:"60px 20px",color:B.textMuted}}>
            <div style={{fontSize:32,marginBottom:12}}>--</div>
            <div style={{fontSize:15,fontWeight:700,color:B.text}}>No trades this week</div>
            <div style={{fontSize:12,marginTop:4}}>Navigate to a week where you have trades logged</div>
          </div>
        )}
      </div>
    </div>
  );
}

function TradeReplayButton({trade}){
  const [open, setOpen] = useState(false);

  const getSymbol=(instrument)=>{
    const map={MES:"CME_MINI:MES1!",ES:"CME_MINI:ES1!",MNQ:"CME_MINI:MNQ1!",NQ:"CME:NQ1!",MGC:"COMEX:MGC1!",GC:"COMEX:GC1!",MCL:"NYMEX:MCL1!",CL:"NYMEX:CL1!",SPY:"AMEX:SPY",QQQ:"NASDAQ:QQQ",IWM:"AMEX:IWM"};
    return map[instrument]||instrument;
  };

  const getTVUrl=(tf="5")=>{
    const sym=encodeURIComponent(getSymbol(trade.instrument));
    return `https://www.tradingview.com/chart/?symbol=${sym}&interval=${tf}&theme=dark`;
  };

  if(!open){
    return(
      <button onClick={()=>setOpen(true)} style={{padding:"4px 8px",borderRadius:6,border:`1px solid rgba(79,142,247,0.3)`,background:"rgba(79,142,247,0.08)",color:B.blue,cursor:"pointer",fontSize:10,fontWeight:700,width:"100%"}}>
        Replay
      </button>
    );
  }

  // Price range for visual
  const entry = parseFloat(trade.entry)||0;
  const exit = parseFloat(trade.exit)||0;
  const sl = parseFloat(trade.stop_loss)||0;
  const tp = parseFloat(trade.take_profit)||0;
  const allPrices = [entry,exit,sl,tp].filter(p=>p>0);
  const minP = Math.min(...allPrices);
  const maxP = Math.max(...allPrices);
  const range = maxP-minP||10;
  const pad = range*0.3;
  const chartMin = minP-pad;
  const chartMax = maxP+pad;
  const chartRange = chartMax-chartMin;
  const pct=(p)=>Math.round((1-(p-chartMin)/chartRange)*100);

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.92)",zIndex:400,display:"flex",flexDirection:"column"}} onClick={()=>setOpen(false)}>
      <div style={{background:"#13121A",borderBottom:`1px solid ${B.border}`,padding:"12px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}} onClick={e=>e.stopPropagation()}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{padding:"4px 10px",borderRadius:6,background:`${B.teal}15`,color:B.teal,fontSize:12,fontWeight:700}}>{trade.instrument}</div>
          <div style={{fontSize:13,color:B.text,fontWeight:700}}>{trade.direction} · {trade.date} · {trade.session} Session</div>
          <div style={{fontSize:14,fontFamily:"monospace",color:pnlColor(trade.pnl),fontWeight:800}}>{(trade.pnl>=0?"+":"-")+"$"+Math.abs(trade.pnl||0).toFixed(2)}</div>
          <div style={{padding:"3px 8px",borderRadius:6,background:trade.result==="Win"?(B.teal+"15"):(B.loss+"15"),color:trade.result==="Win"?B.teal:B.loss,fontSize:11,fontWeight:700}}>{trade.result}</div>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {["1","5","15"].map(tf=>(
            <a key={tf} href={getTVUrl(tf)} target="_blank" rel="noopener noreferrer"
              style={{padding:"5px 10px",borderRadius:7,border:`1px solid ${B.border}`,color:B.textMuted,textDecoration:"none",fontSize:11,fontWeight:600}}>
              {tf}m Chart ↗
            </a>
          ))}
          <button onClick={()=>setOpen(false)} style={{background:"rgba(255,255,255,0.05)",border:`1px solid ${B.border}`,borderRadius:8,color:B.textMuted,cursor:"pointer",width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>×</button>
        </div>
      </div>
      <div style={{flex:1,display:"flex",overflow:"hidden"}} onClick={e=>e.stopPropagation()}>
        <div style={{width:260,borderRight:`1px solid ${B.border}`,padding:20,overflowY:"auto",flexShrink:0}}>
          <div style={{fontSize:10,color:B.textMuted,letterSpacing:1.5,marginBottom:12}}>TRADE DETAILS</div>
          {[
            {label:"Date",value:trade.date},
            {label:"Instrument",value:trade.instrument},
            {label:"Direction",value:trade.direction},
            {label:"Entry",value:trade.entry||"—"},
            {label:"Exit",value:trade.exit||"—"},
            {label:"Contracts",value:trade.contracts||1},
            {label:"Session",value:trade.session||"—"},
            {label:"Setup",value:trade.strategy||trade.setup||"—"},
            {label:"Grade",value:trade.grade||"—"},
            {label:"R:R",value:trade.rr||"—"},
            {label:"Stop Loss",value:trade.stop_loss||"—"},
            {label:"Take Profit",value:trade.take_profit||"—"},
          ].map(r=>(
            <div key={r.label} style={{display:"flex",justifyContent:"space-between",padding:"7px 0",borderBottom:`1px solid ${B.border}20`}}>
              <div style={{fontSize:11,color:B.textMuted}}>{r.label}</div>
              <div style={{fontSize:11,color:B.text,fontWeight:600,fontFamily:["Entry","Exit","Stop Loss","Take Profit"].includes(r.label)?"monospace":"inherit"}}>{r.value}</div>
            </div>
          ))}
          {trade.notes&&(
            <div style={{marginTop:14,padding:"10px 12px",borderRadius:8,background:"rgba(255,255,255,0.03)",border:`1px solid ${B.border}`}}>
              <div style={{fontSize:9,color:B.textMuted,letterSpacing:1,marginBottom:6}}>NOTES</div>
              <div style={{fontSize:11,color:B.text,lineHeight:1.6}}>{trade.notes}</div>
            </div>
          )}
        </div>
        <div style={{flex:1,display:"flex",flexDirection:"column",padding:28,gap:20,overflowY:"auto"}}>
          <div style={{padding:"18px 22px",borderRadius:14,background:"rgba(79,142,247,0.06)",border:`1px solid rgba(79,142,247,0.2)`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <div style={{fontSize:14,fontWeight:800,color:B.text,marginBottom:4}}>Open in TradingView to replay this trade</div>
              <div style={{fontSize:12,color:B.textMuted}}>Navigate to <strong style={{color:B.text}}>{trade.date}</strong> on the chart, set timeframe to 1m or 5m, and find your entry at <strong style={{color:B.text,fontFamily:"monospace"}}>{trade.entry||"entry price"}</strong></div>
            </div>
            <div style={{display:"flex",flexDirection:"column",gap:8,flexShrink:0,marginLeft:16}}>
              {["1","5","15"].map(tf=>(
                <a key={tf} href={getTVUrl(tf)} target="_blank" rel="noopener noreferrer"
                  style={{padding:"8px 16px",borderRadius:9,border:"none",background:tf==="5"?"linear-gradient(135deg,#4F8EF7,#8B5CF6)":B.surface,color:tf==="5"?"#0E0E10":B.textMuted,textDecoration:"none",fontSize:12,fontWeight:700,textAlign:"center",display:"block",border:`1px solid ${B.border}`}}>
                  Open {tf}m Chart ↗
                </a>
              ))}
            </div>
          </div>
          {allPrices.length>=2&&(
            <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:20}}>
              <div style={{fontSize:10,color:B.textMuted,letterSpacing:1.5,marginBottom:16}}>PRICE LEVEL MAP</div>
              <div style={{display:"flex",gap:16}}>
                <div style={{width:100,position:"relative",height:260,flexShrink:0}}>
                  <div style={{position:"absolute",inset:0,left:40,width:4,background:"rgba(255,255,255,0.05)",borderRadius:2}}/>
                  {tp>0&&<div style={{position:"absolute",top:`${pct(tp)}%`,left:0,right:0,display:"flex",alignItems:"center",gap:6}}>
                    <div style={{fontSize:9,color:B.teal,fontFamily:"monospace",textAlign:"right",width:36,fontWeight:700}}>{tp}</div>
                    <div style={{width:12,height:2,background:B.teal}}/>
                    <div style={{fontSize:8,color:B.teal,fontWeight:700}}>TP</div>
                  </div>}
                  {exit>0&&<div style={{position:"absolute",top:`${pct(exit)}%`,left:0,right:0,display:"flex",alignItems:"center",gap:6}}>
                    <div style={{fontSize:9,color:pnlColor(trade.pnl),fontFamily:"monospace",textAlign:"right",width:36,fontWeight:700}}>{exit}</div>
                    <div style={{width:12,height:2,background:pnlColor(trade.pnl)}}/>
                    <div style={{fontSize:8,color:pnlColor(trade.pnl),fontWeight:700}}>EXIT</div>
                  </div>}
                  {entry>0&&<div style={{position:"absolute",top:`${pct(entry)}%`,left:0,right:0,display:"flex",alignItems:"center",gap:6}}>
                    <div style={{fontSize:9,color:B.text,fontFamily:"monospace",textAlign:"right",width:36,fontWeight:700}}>{entry}</div>
                    <div style={{width:16,height:3,background:B.text}}/>
                    <div style={{fontSize:8,color:B.text,fontWeight:700}}>ENTRY</div>
                  </div>}
                  {sl>0&&<div style={{position:"absolute",top:`${pct(sl)}%`,left:0,right:0,display:"flex",alignItems:"center",gap:6}}>
                    <div style={{fontSize:9,color:B.loss,fontFamily:"monospace",textAlign:"right",width:36,fontWeight:700}}>{sl}</div>
                    <div style={{width:12,height:2,background:B.loss}}/>
                    <div style={{fontSize:8,color:B.loss,fontWeight:700}}>SL</div>
                  </div>}
                </div>
                <div style={{flex:1,display:"flex",flexDirection:"column",gap:10}}>
                  {[
                    {label:"Entry Price",value:trade.entry,color:B.text},
                    {label:"Exit Price",value:trade.exit,color:pnlColor(trade.pnl)},
                    tp>0&&{label:"Take Profit",value:trade.take_profit,color:B.teal},
                    sl>0&&{label:"Stop Loss",value:trade.stop_loss,color:B.loss},
                    {label:"Points captured",value:entry&&exit?Math.abs(exit-entry).toFixed(2)+" pts":null,color:pnlColor(trade.pnl)},
                    {label:"Net P&L",value:`${trade.pnl>=0?"+":""}$${trade.pnl?.toFixed(2)}`,color:pnlColor(trade.pnl)},
                  ].filter(Boolean).map(r=>(
                    <div key={r.label} style={{display:"flex",justifyContent:"space-between",padding:"8px 12px",borderRadius:8,background:"rgba(255,255,255,0.02)",border:`1px solid ${B.border}20`}}>
                      <div style={{fontSize:11,color:B.textMuted}}>{r.label}</div>
                      <div style={{fontSize:12,fontWeight:700,color:r.color,fontFamily:"monospace"}}>{r.value||"—"}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div style={{padding:"14px 18px",borderRadius:12,background:"rgba(255,183,0,0.05)",border:`1px solid rgba(255,183,0,0.2)`}}>
            <div style={{fontSize:10,color:"#FFB700",letterSpacing:1.5,fontWeight:700,marginBottom:10}}>REPLAY CHECKLIST</div>
            {[
              `Open TradingView and search for ${getSymbol(trade.instrument)}`,
              `Set chart date to ${trade.date} — use the date range picker`,
              `Switch to 1m or 5m timeframe for detailed view`,
              `Find the ${trade.session} session (${trade.session==="AM"?"9:30-11:30 AM":"10AM-12PM"} ET)`,
              `Locate entry near ${trade.entry||"your entry price"} and trace the move to ${trade.exit||"your exit"}`,
              `Ask: Was my entry valid? Did I follow my rules? Was my exit optimal?`,
            ].map((step,i)=>(
              <div key={i} style={{display:"flex",gap:10,marginBottom:8,alignItems:"flex-start"}}>
                <div style={{width:18,height:18,borderRadius:"50%",background:"rgba(255,183,0,0.15)",border:"1px solid rgba(255,183,0,0.3)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:9,color:"#FFB700",fontWeight:700,flexShrink:0,marginTop:1}}>{i+1}</div>
                <div style={{fontSize:12,color:B.text,lineHeight:1.5}}>{step}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}


// ── TCA AI Chatbot ────────────────────────────────────────────────────────────
function TCAChat({trades, strategies, isOpen, onClose}){
  const [messages, setMessages] = useState([{
    role:"assistant",
    content:"Hey! I'm your TCA trading coach. I have full access to your trade history, strategies, and performance data. Ask me anything — like \"what's my best session?\", \"why am I losing on Fridays?\", or \"review my last 10 trades\".",
    id:1,
  }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(()=>{bottomRef.current?.scrollIntoView({behavior:"smooth"});},[messages]);
  useEffect(()=>{if(isOpen)setTimeout(()=>inputRef.current?.focus(),150);},[isOpen]);

  const buildContext=()=>{
    const wins=trades.filter(t=>t.result==="Win");
    const losses=trades.filter(t=>t.result==="Loss");
    const totalPnl=trades.reduce((a,t)=>a+t.pnl,0);
    const winRate=trades.length?Math.round((wins.length/trades.length)*100):0;
    const bySession={};
    trades.forEach(t=>{if(!bySession[t.session])bySession[t.session]={wins:0,total:0,pnl:0};bySession[t.session].total++;bySession[t.session].pnl+=t.pnl;if(t.result==="Win")bySession[t.session].wins++;});
    const byDay={};
    trades.forEach(t=>{const d=new Date(t.date+"T12:00:00").toLocaleDateString("en-US",{weekday:"short"});if(!byDay[d])byDay[d]={wins:0,total:0,pnl:0};byDay[d].total++;byDay[d].pnl+=t.pnl;if(t.result==="Win")byDay[d].wins++;});
    const bySetup={};
    trades.forEach(t=>{const s=t.strategy||t.setup||"Unknown";if(!bySetup[s])bySetup[s]={wins:0,total:0,pnl:0};bySetup[s].total++;bySetup[s].pnl+=t.pnl;if(t.result==="Win")bySetup[s].wins++;});
    const recent=[...trades].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,15).map(t=>`${t.date}|${t.instrument}|${t.direction==="Long"?"L":"S"}|${t.result==="Win"?"W":"L"}|$${Math.round(t.pnl*100)/100}|${(t.strategy||t.setup||"?").slice(0,20)}|${t.session}|${t.grade}`);
    const avgWin=wins.length?Math.round(wins.reduce((a,t)=>a+t.pnl,0)/wins.length*100)/100:0;
    const avgLoss=losses.length?Math.round(Math.abs(losses.reduce((a,t)=>a+t.pnl,0))/losses.length*100)/100:0;
    const pf=wins.reduce((a,t)=>a+t.pnl,0)/(Math.abs(losses.reduce((a,t)=>a+t.pnl,0))||1);
    return `You are TCA Coach for The Candlestick Academy. Expert in MES futures + ICT methodology. You have this trader's data. Be direct, specific, use their numbers. Max 4 sentences unless asked for full review.

STATS: ${trades.length} trades | $${Math.round(totalPnl*100)/100} PnL | ${winRate}%WR | AvgW:$${avgWin} | AvgL:$${avgLoss} | PF:${Math.round(pf*100)/100}
SESSIONS: ${Object.entries(bySession).map(([s,d])=>s+"="+d.total+"t,"+Math.round(d.wins/d.total*100)+"%WR,$"+Math.round(d.pnl*100)/100).join("|")}
DAYS: ${Object.entries(byDay).map(([d,v])=>d+"="+v.total+"t,"+Math.round(v.wins/v.total*100)+"%WR,$"+Math.round(v.pnl*100)/100).join("|")}
SETUPS: ${Object.entries(bySetup).slice(0,6).map(([s,d])=>s.slice(0,15)+"="+d.total+"t,"+Math.round(d.wins/d.total*100)+"%WR,$"+Math.round(d.pnl*100)/100).join("|")}
STRATEGIES: ${strategies.map(s=>s.name).join(",")||"none"}
RECENT 15: ${recent.join(" / ")}`;
  };

  const send=async()=>{
    if(!input.trim()||loading)return;
    const userMsg={role:"user",content:input.trim(),id:Date.now()};
    const currentInput=input.trim();
    setMessages(m=>[...m,userMsg]);
    setInput("");setLoading(true);
    try{
      const res=await fetch("/api/coach",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({type:"chat",chatContext:buildContext(),chatHistory:[...messages.slice(-8).map(m=>({role:m.role,content:m.content})),{role:"user",content:currentInput}]}),
      });
      if(!res.ok){
        const errText=await res.text();
        console.error("Coach API error:",res.status,errText.slice(0,200));
        throw new Error(`Server error ${res.status}`);
      }
      const raw=await res.text();
      let data;
      try{data=JSON.parse(raw);}catch(e){console.error("Bad JSON:",raw.slice(0,200));throw new Error("Server returned invalid response");}
      const text=data.content?.[0]?.text||data.response||"I couldn't process that. Try again.";
      setMessages(m=>[...m,{role:"assistant",content:text,id:Date.now()}]);
    }catch(e){
      console.error("Chat error:",e);
      setMessages(m=>[...m,{role:"assistant",content:`Error: ${e.message}. Please try again.`,id:Date.now()}]);
    }
    setLoading(false);
  };

  const SUGGESTIONS=["What's my best session?","Why am I losing money?","Review my last 10 trades","What's my strongest setup?","How can I improve my win rate?","What day is best for me?"];

  if(!isOpen)return null;
  return(
    <div style={{position:"fixed",right:0,top:0,bottom:0,width:380,zIndex:300,background:"#13121A",borderLeft:"1px solid rgba(255,255,255,0.08)",display:"flex",flexDirection:"column",fontFamily:"'DM Sans',sans-serif"}}>
      <div style={{height:3,background:"linear-gradient(90deg,#00D4A8,#4F8EF7,#8B5CF6)",flexShrink:0}}/>
      <div style={{padding:"16px 18px",borderBottom:"1px solid rgba(255,255,255,0.07)",display:"flex",alignItems:"center",gap:10,flexShrink:0}}>
        <div style={{width:34,height:34,borderRadius:"50%",background:"linear-gradient(135deg,#00D4A8,#8B5CF6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>🧠</div>
        <div style={{flex:1}}>
          <div style={{fontSize:14,fontWeight:800,color:"#F0EEF8"}}>TCA Coach</div>
          <div style={{fontSize:10,color:"#6B6880"}}>{trades.length} trades · Always learning</div>
        </div>
        <button onClick={onClose} style={{background:"rgba(255,255,255,0.05)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:8,color:"#6B6880",cursor:"pointer",fontSize:18,width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"16px 16px 0",display:"flex",flexDirection:"column",gap:12}}>
        {messages.map(msg=>(
          <div key={msg.id} style={{display:"flex",gap:8,alignItems:"flex-start",flexDirection:msg.role==="user"?"row-reverse":"row"}}>
            {msg.role==="assistant"&&<div style={{width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,#00D4A8,#8B5CF6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0,marginTop:2}}>🧠</div>}
            <div style={{maxWidth:"85%",padding:"10px 14px",borderRadius:msg.role==="user"?"14px 14px 4px 14px":"14px 14px 14px 4px",background:msg.role==="user"?"rgba(0,212,168,0.1)":"rgba(255,255,255,0.04)",border:`1px solid ${msg.role==="user"?"rgba(0,212,168,0.2)":"rgba(255,255,255,0.06)"}`,fontSize:13,color:"#D4D0E8",lineHeight:1.65,whiteSpace:"pre-wrap"}}>
              {msg.content}
            </div>
          </div>
        ))}
        {loading&&(
          <div style={{display:"flex",gap:8,alignItems:"flex-start"}}>
            <div style={{width:28,height:28,borderRadius:"50%",background:"linear-gradient(135deg,#00D4A8,#8B5CF6)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>🧠</div>
            <div style={{padding:"12px 16px",borderRadius:"14px 14px 14px 4px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.06)",display:"flex",gap:5,alignItems:"center"}}>
              {[0,1,2].map(i=><div key={i} style={{width:6,height:6,borderRadius:"50%",background:"#00D4A8",opacity:0.7}}/>)}
            </div>
          </div>
        )}
        <div ref={bottomRef}/>
      </div>
      {messages.length<=2&&(
        <div style={{padding:"10px 16px 0",display:"flex",flexWrap:"wrap",gap:5}}>
          {SUGGESTIONS.map(s=><button key={s} onClick={()=>setInput(s)} style={{padding:"4px 10px",borderRadius:20,fontSize:11,cursor:"pointer",border:"1px solid rgba(0,212,168,0.25)",background:"rgba(0,212,168,0.05)",color:"#00D4A8",fontFamily:"'DM Sans',sans-serif"}}>{s}</button>)}
        </div>
      )}
      <div style={{padding:"12px 16px 16px",flexShrink:0}}>
        <div style={{display:"flex",gap:8,alignItems:"flex-end",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:12,padding:"8px 8px 8px 14px"}}>
          <textarea ref={inputRef} value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();send();}}} placeholder="Ask anything about your trading..." rows={1}
            style={{flex:1,background:"none",border:"none",outline:"none",resize:"none",color:"#F0EEF8",fontSize:13,fontFamily:"'DM Sans',sans-serif",lineHeight:1.5,maxHeight:100,overflowY:"auto"}}
            onInput={e=>{e.target.style.height="auto";e.target.style.height=e.target.scrollHeight+"px";}}/>
          <button onClick={send} disabled={!input.trim()||loading} style={{width:34,height:34,borderRadius:9,border:"none",flexShrink:0,background:input.trim()&&!loading?"linear-gradient(135deg,#00D4A8,#8B5CF6)":"rgba(255,255,255,0.06)",color:input.trim()&&!loading?"#0E0E10":"#6B6880",cursor:input.trim()&&!loading?"pointer":"not-allowed",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>↑</button>
        </div>
        <div style={{fontSize:9,color:"rgba(255,255,255,0.2)",textAlign:"center",marginTop:5}}>Enter to send · Shift+Enter for new line</div>
      </div>
    </div>
  );
}


// ── Tradovate Sync Modal ──────────────────────────────────────────────────────
function TradovateSyncModal({onClose, onSync, syncing, accounts=[]}){
  const [range,setRange]=useState("today");
  const [from,setFrom]=useState(new Date().toISOString().slice(0,10));
  const [to,setTo]=useState(new Date().toISOString().slice(0,10));
  const [syncAccount,setSyncAccount]=useState("main");

  const RANGES=[
    {id:"today",    label:"Today"},
    {id:"week",     label:"Last 7 Days"},
    {id:"month",    label:"This Month"},
    {id:"quarter",  label:"This Quarter"},
    {id:"year",     label:"This Year"},
    {id:"all",      label:"All Time"},
    {id:"custom",   label:"Custom Range"},
  ];

  const getRange=(id)=>{
    const now=new Date();
    const today=now.toISOString().slice(0,10);
    switch(id){
      case "today":   return{from:today,to:today};
      case "week":    {const d=new Date();d.setDate(d.getDate()-7);return{from:d.toISOString().slice(0,10),to:today};}
      case "month":   return{from:today.slice(0,7)+"-01",to:today};
      case "quarter": {const d=new Date();d.setMonth(d.getMonth()-3);return{from:d.toISOString().slice(0,10),to:today};}
      case "year":    return{from:today.slice(0,4)+"-01-01",to:today};
      case "all":     return{from:"2020-01-01",to:today};
      default:        return{from,to};
    }
  };

  const handleSync=()=>{
    const r=getRange(range);
    onSync(r.from,r.to,syncAccount);
  };

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)"}}
      onClick={onClose}>
      <div style={{background:"#13121A",border:`1px solid ${B.border}`,borderRadius:20,width:420,padding:28}}
        onClick={e=>e.stopPropagation()}>
        <div style={{height:3,background:GTB,borderRadius:"20px 20px 0 0",margin:"-28px -28px 24px"}}/>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div style={{fontSize:16,fontWeight:800,color:B.text}}>Tradovate Sync</div>
          <button onClick={onClose} style={{background:"none",border:"none",color:B.textMuted,cursor:"pointer",fontSize:20}}>×</button>
        </div>
        <div style={{fontSize:11,color:B.textMuted,marginBottom:14}}>Select date range to sync trades</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:16}}>
          {RANGES.map(r=>(
            <button key={r.id} onClick={()=>setRange(r.id)} style={{
              padding:"10px",borderRadius:9,cursor:"pointer",fontSize:12,fontWeight:600,
              border:`1px solid ${range===r.id?B.teal:B.border}`,
              background:range===r.id?`${B.teal}15`:"transparent",
              color:range===r.id?B.teal:B.textMuted,
            }}>{r.label}</button>
          ))}
        </div>
        {range==="custom"&&(
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
            <div><label style={lS}>From</label><input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={iS}/></div>
            <div><label style={lS}>To</label><input type="date" value={to} onChange={e=>setTo(e.target.value)} style={iS}/></div>
          </div>
        )}
        {/* Account selector */}
        <div style={{marginBottom:16}}>
          <div style={{fontSize:11,color:B.textMuted,marginBottom:8}}>Sync from account:</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {[{id:"main",label:"Live Account",color:B.teal},{id:"demo",label:"Apex Demo",color:B.purple},{id:"eval",label:"Apex Eval",color:B.blue}].map(a=>(
              <button key={a.id} onClick={()=>setSyncAccount(a.id)} style={{
                padding:"8px",borderRadius:8,cursor:"pointer",fontSize:11,fontWeight:600,
                border:`1px solid ${syncAccount===a.id?a.color:B.border}`,
                background:syncAccount===a.id?`${a.color}15`:"transparent",
                color:syncAccount===a.id?a.color:B.textMuted,
              }}>{a.label}</button>
            ))}
          </div>
        </div>
        <button onClick={handleSync} disabled={syncing} style={{width:"100%",padding:"12px",borderRadius:10,border:"none",background:syncing?"rgba(255,255,255,0.1)":GL,color:syncing?B.textMuted:"#0E0E10",cursor:syncing?"not-allowed":"pointer",fontSize:13,fontWeight:800}}>
          {syncing?"Syncing...":"↻ Sync Trades"}
        </button>
      </div>
    </div>
  );
}


const NAV=[{id:"overview",label:"Overview",icon:"▦"},{id:"journal",label:"Journal",icon:"⊟"},{id:"analytics",label:"Analytics",icon:"◈"},{id:"calendar",label:"P&L Calendar",icon:"⊞"},{id:"playbooks",label:"Strategies",icon:"⊕"},{id:"weeklyreview",label:"Weekly Review",icon:"🧠"},{id:"economiccalendar",label:"Eco Calendar",icon:"📰"},{id:"library",label:"Playbook",icon:"📚"},{id:"resources",label:"Resources",icon:"◎"}];

export default function App(){
  const ADMIN_EMAIL = "admin@thecandlestickacademy.com";
  const [session,setSession]=useState(null);
  const [chatOpen,setChatOpen]=useState(false);
  const [showAdmin,setShowAdmin]=useState(false);
  const [showProfile,setShowProfile]=useState(false);
  const [showReport,setShowReport]=useState(false);
  const [replayTrade,setReplayTrade]=useState(null);
    const [isDark,setIsDark]=useState(()=>{
    try{return localStorage.getItem("tca_theme")!=="light";}catch(e){return true;}
  });
  // Update B whenever theme changes
  B = isDark ? DARK_THEME : LIGHT_THEME;
  const [active,setActive]=useState("overview");
  const isAdmin=session?.user?.email===ADMIN_EMAIL;
  const [time,setTime]=useState(new Date());
  const [trades,setTrades]=useState([]);
  const [showForm,setShowForm]=useState(false);
  const [editTrade,setEditTrade]=useState(null);
  const [delTrade,setDelTrade]=useState(null);
  const [showImport,setShowImport]=useState(false);
  const [toast,setToast]=useState(null);
  const [loading,setLoading]=useState(true);
  const [syncStatus,setSyncStatus]=useState("idle");
  const [lastImport,setLastImport]=useState(null);
  const [strategies,setStrategies]=useState([]);
  const [accounts,setAccounts]=useState([
    {id:"main",label:"Live Account",type:"live",color:"#00D4A8",startingBalance:0},
    {id:"apex_eval",label:"Apex Eval",type:"eval",color:"#4F8EF7",startingBalance:0},
    {id:"apex_demo",label:"Apex Demo",type:"demo",color:"#8B5CF6",startingBalance:0},
  ]);
  const [activeAccount,setActiveAccount]=useState("all"); // idle | syncing | connected | error
  const [showSyncModal,setShowSyncModal]=useState(false);
  const [syncRange,setSyncRange]=useState({from:"",to:""});

  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>setSession(data.session));
    const{data:listener}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));
    return()=>listener.subscription.unsubscribe();
  },[]);

  useEffect(()=>{
    if(!session){setLoading(false);return;}
    (async()=>{
      try{
        const{data:{user}}=await supabase.auth.getUser();
        const{data,error}=await supabase.from("trades").select("*").eq("user_id",user.id).order("date",{ascending:false});
        if(error)console.error("Load error:",error);
        setTrades(data||[]);
        // Load saved accounts config
        try{const l=localStorage.getItem("pref_tca_accounts_v1");if(l)setAccounts(JSON.parse(l));}catch(e){}
      }catch(e){
        console.error("Failed to load trades:",e);
        setTrades([]);
      }
      // Load strategies for grading
      try{
        const{data}=await supabase.from("user_preferences").select("value").eq("key","tca_strategies_v1").single();
        if(data?.value)setStrategies(JSON.parse(data.value));
        else{const l=localStorage.getItem("pref_tca_strategies_v1");if(l)setStrategies(JSON.parse(l));}
      }catch(e){try{const l=localStorage.getItem("pref_tca_strategies_v1");if(l)setStrategies(JSON.parse(l));}catch(e2){}}
      setLoading(false);
    })();
  },[session]);

  // ── Tradovate Auto Sync ────────────────────────────────────────────────────
  const syncTradovate = useCallback(async (fromDate=null, toDate=null, accountId="main") => {
    if (!session) return;
    setSyncStatus("syncing");
    try {
      // Force fresh token for this account
      sessionStorage.removeItem(`tv_token_${accountId}`);
      sessionStorage.removeItem(`tv_expiry_${accountId}`);
      const token = await getToken(accountId);
      if (!token) { setSyncStatus("error"); return; }
      // Pass date range directly to proxy
      const execs = await fetchClosedTrades(token, fromDate, toDate, accountId);
      console.log("Synced trades from Tradovate:", execs.length);
      if (!execs.length) { setSyncStatus("connected"); showT("Tradovate connected — no new trades in range"); return; }

      // Get existing tradovate_ids to avoid duplicates
      const { data: existing } = await supabase
        .from("trades")
        .select("tradovate_id")
        .eq("user_id", session.user.id)
        .not("tradovate_id", "is", null);

      const existingIds = new Set((existing || []).map(e => e.tradovate_id));

      // Filter out already imported trades
      const newExecs = execs.filter(e => {
        const tid = e.tradovate_id || String(e.id);
        return !existingIds.has(tid);
      });

      console.log("New trades to insert:", newExecs.length, "of", execs.length);

      if (newExecs.length > 0) {
        const newTrades = newExecs.map(e => {
          const built = execToTrade(e);
          built.grade = autoGrade(built, strategies); // auto-grade synced trades
          const { id, ...rest } = built; // strip client ID
          return { ...rest, user_id: session.user.id, day: dayName(built.date) };
        });
        const { data, error } = await supabase.from("trades").insert(newTrades).select();
        if (error) { console.error("Supabase insert error:", error); }
        if (data?.length) {
          setTrades(ts => [...(ts.filter(t => !t.id?.startsWith("s"))), ...data]);
          showT(`${data.length} new trade${data.length > 1 ? "s" : ""} synced from Tradovate ✓`);
        }
      } else {
        showT("Already up to date — no new trades found");
      }
      setSyncStatus("connected");
    } catch (e) {
      console.error("Sync error:", e);
      setSyncStatus("error");
    }
  }, [session]);

  // Check connection on load, but don't auto-import trades
  useEffect(() => {
    if (!session || loading) return;
    // Just verify connection on load
    (async () => {
      setSyncStatus("syncing");
      try {
        sessionStorage.removeItem("tv_token");
        sessionStorage.removeItem("tv_expiry");
        const token = await getToken("main");
        if (token) setSyncStatus("connected");
        else setSyncStatus("error");
      } catch(e) { setSyncStatus("error"); }
    })();
  }, [session, loading]);

  useEffect(()=>{const t=setInterval(()=>setTime(new Date()),1000);return()=>clearInterval(t);},[]);

  const showT=(msg,type="success")=>{setToast({msg,type});setTimeout(()=>setToast(null),4000);};

  const handleSave=async(trade)=>{
    const{id,...rest}=trade;
    const row={...rest,user_id:session.user.id,day:dayName(trade.date)};
    if(editTrade){
      await supabase.from("trades").update(row).eq("id",trade.id);
      setTrades(ts=>ts.map(t=>t.id===trade.id?{...row,id:trade.id}:t));
      showT("Trade updated");
    }else{
      const{data,error}=await supabase.from("trades").insert(row).select();
      if(error){console.error(error);showT("Save failed","error");return;}
      setTrades(ts=>[...(ts.filter(t=>!t.id?.startsWith("s"))),data[0]]);
      showT("Trade logged");
    }
    setEditTrade(null);
  };

  const handleClearImported=async(accountId=null)=>{
    const toDelete=accountId
      ?trades.filter(t=>t.account_id===accountId)
      :trades.filter(t=>!t.tradovate_id||String(t.id).startsWith("perf_")||String(t.id).startsWith("imp_"));
    if(!toDelete.length){showT("No imported trades found.");return;}
    const msg=`Delete ${toDelete.length} imported trade${toDelete.length!==1?"s":""}${accountId?` from "${accountId}"`:""}? This cannot be undone.`;
    if(!confirm(msg))return;
    const ids=toDelete.map(t=>t.id).filter(Boolean);
    if(ids.length)await supabase.from("trades").delete().in("id",ids);
    setTrades(ts=>ts.filter(t=>!toDelete.some(d=>d.id===t.id)));
    showT(`Deleted ${toDelete.length} imported trade${toDelete.length!==1?"s":""}`);
  };

  const handleImport=async(imported, mode="add")=>{
    if(mode==="replace"){
      // Delete all existing trades first
      await supabase.from("trades").delete().eq("user_id",session.user.id);
    }
    const rows=imported.map(t=>{
      const{id,...rest}=t;
      const graded={...rest,user_id:session.user.id,day:dayName(t.date)};
      // Apply auto-grade if grade is still default B
      if(!graded.grade||graded.grade==="B")graded.grade=autoGrade(graded,strategies);
      return graded;
    });
    const{data,error}=await supabase.from("trades").insert(rows).select();
    if(error){
      console.error("Import error:",error);
      showT("Import failed: "+error.message,"error");
      return;
    }
    const newData=data||[];
    if(mode==="replace"){
      setTrades(newData);
    }else{
      setTrades(ts=>[...(ts.filter(t=>!t.id?.startsWith("s"))),...newData]);
    }
    setLastImport(new Date().toLocaleString("en-US",{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"}));
    showT(`${newData.length} trades imported and saved ✓`);
  };

  const handleManualSync=async(from,to,accountId="main")=>{
    setShowSyncModal(false);
    showT(`Connecting to Tradovate (${accountId})...`);
    await syncTradovate(from,to,accountId);
  };

  const handleGradeUpdate=async(tradeId, newGrade)=>{
    await supabase.from("trades").update({grade:newGrade}).eq("id",tradeId);
    setTrades(ts=>ts.map(t=>t.id===tradeId?{...t,grade:newGrade}:t));
    showT("Grade updated to "+newGrade);
  };

  const handleDelete=async()=>{
    await supabase.from("trades").delete().eq("id",delTrade.id);
    setTrades(ts=>ts.filter(t=>t.id!==delTrade.id));
    showT("Trade deleted","error");
    setDelTrade(null);
  };

  const handleEdit=t=>{setEditTrade(t);setShowForm(true);};
  const nyTime=time.toLocaleTimeString("en-US",{timeZone:"America/New_York",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false});
  const totalPnl=trades.reduce((a,t)=>a+t.pnl,0);
  const hasSample=trades.some(t=>t.id?.startsWith("s"));

  const syncDot = syncStatus==="connected"?B.teal:syncStatus==="syncing"?B.blue:syncStatus==="error"?B.loss:"#444";
  const syncLabel = syncStatus==="connected"?"Live":syncStatus==="syncing"?"Syncing...":syncStatus==="error"?"Sync Error":"Connecting";

  if(!session)return <LoginScreen/>;
  if(loading)return(<div style={{minHeight:"100vh",background:B.bg,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{fontSize:14,color:B.textMuted}}>Loading your trades...</div></div>);

  return(<div style={{minHeight:"100vh",background:B.bg,fontFamily:"'DM Sans','Segoe UI',sans-serif",color:B.text,transition:"background 0.3s,color 0.3s"}}><style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,600;0,9..40,700;0,9..40,800&family=Space+Mono:wght@400;700&display=swap');*{box-sizing:border-box;}body{margin:0;}::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:rgba(0,212,168,0.2);border-radius:2px;}input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.5);}select option{background:#13121A;color:#F0EEF8;}`}</style>
    {toast&&(<div style={{position:"fixed",top:20,right:24,zIndex:200,padding:"12px 20px",borderRadius:10,background:toast.type==="error"?`${B.loss}18`:`${B.teal}15`,border:`1px solid ${toast.type==="error"?`${B.loss}40`:`${B.teal}40`}`,color:toast.type==="error"?B.loss:B.teal,fontWeight:700,fontSize:13,boxShadow:"0 8px 32px rgba(0,0,0,0.5)"}}>{toast.msg}</div>)}
    {showSyncModal&&<TradovateSyncModal onClose={()=>setShowSyncModal(false)} onSync={handleManualSync} syncing={syncStatus==="syncing"} accounts={accounts}/>}
    {showForm&&<TradeFormModal onClose={()=>{setShowForm(false);setEditTrade(null);}} onSave={handleSave} editTrade={editTrade}/>}
    {showImport&&<ImportModal onClose={()=>setShowImport(false)} onImport={handleImport} existingTrades={trades}/>}
    {delTrade&&<DeleteConfirm trade={delTrade} onConfirm={handleDelete} onCancel={()=>setDelTrade(null)}/>}
    <div style={{position:"fixed",top:0,left:0,bottom:0,width:216,background:B.sidebarBg,borderRight:`1px solid ${B.border}`,display:"flex",flexDirection:"column",zIndex:100}}>
      <div style={{padding:"22px 18px 18px",borderBottom:`1px solid ${B.border}`}}><div style={{display:"flex",alignItems:"center",gap:12}}><TCAIcon size={36}/><div><div style={{fontSize:13,fontWeight:800,background:GL,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",letterSpacing:-0.3}}>TCA Journal</div><div style={{fontSize:9,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginTop:1}}>Candlestick Academy</div><div style={{marginTop:4,display:"inline-block",padding:"2px 8px",borderRadius:20,background:GL,fontSize:8,fontWeight:800,letterSpacing:2,color:"#0E0E10"}}>TRADE JOURNAL</div></div></div></div>
      <nav style={{padding:"16px 12px",flex:1}}>{NAV.map(n=>(<button key={n.id} onClick={()=>setActive(n.id)} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"10px 12px",borderRadius:9,border:"none",background:active===n.id?"rgba(0,212,168,0.07)":"transparent",borderLeft:active===n.id?`2px solid ${B.teal}`:"2px solid transparent",color:active===n.id?B.teal:B.textMuted,cursor:"pointer",fontSize:13,fontWeight:600,textAlign:"left",transition:"all 0.15s",marginBottom:2}}><span style={{fontSize:14}}>{n.icon}</span>{n.label}</button>))}</nav>
      <div style={{padding:"16px 18px",borderTop:`1px solid ${B.border}`}}>
        <div style={{fontSize:9,color:B.textDim,letterSpacing:2,marginBottom:3}}>NY SESSION</div>
        <div style={{fontSize:13,fontFamily:"monospace",color:B.textMuted}}>{nyTime}</div>
        {/* Tradovate sync status */}
        <div style={{marginTop:10,display:"flex",alignItems:"center",gap:6,padding:"8px 12px",borderRadius:8,background:"rgba(0,0,0,0.3)",border:`1px solid ${B.border}`}}>
          <div style={{width:7,height:7,borderRadius:"50%",background:syncDot,boxShadow:syncStatus==="connected"?`0 0 6px ${B.teal}`:"none"}}/>
          <div style={{fontSize:10,color:syncStatus==="connected"?B.teal:B.textMuted,fontWeight:600}}>Tradovate {syncLabel}</div>
          <button onClick={()=>setShowSyncModal(true)} style={{marginLeft:"auto",background:"none",border:"none",color:B.textMuted,cursor:"pointer",fontSize:10,padding:0}} title="Sync with date range">↻</button>
        </div>
        <div style={{marginTop:10,padding:"12px 14px",borderRadius:10,background:`${B.teal}08`,border:`1px solid ${B.teal}22`,position:"relative",overflow:"hidden"}}><div style={{position:"absolute",top:0,left:0,right:0,height:2,background:GTB}}/><div style={{fontSize:9,color:B.textMuted,marginBottom:3,letterSpacing:1}}>MONTH P&L</div><div style={{fontSize:20,fontWeight:800,fontFamily:"monospace",color:pnlColor(totalPnl)}}>{fmt(totalPnl)}</div></div>
        <div style={{marginTop:10,fontSize:10,color:B.textMuted,textAlign:"center"}}>{trades.filter(t=>!t.id?.startsWith("s")).length} trades logged</div>
        {lastImport&&<div style={{fontSize:9,color:B.textDim,textAlign:"center",marginTop:3}}>Last import: {lastImport}</div>}
        <button onClick={()=>setChatOpen(c=>!c)} style={{marginTop:8,width:"100%",padding:"9px",borderRadius:8,border:`1px solid ${chatOpen?"#8B5CF6":"rgba(139,92,246,0.3)"}`,background:chatOpen?"rgba(139,92,246,0.12)":"rgba(139,92,246,0.05)",color:"#8B5CF6",cursor:"pointer",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>🧠 {chatOpen?"Close Coach":"TCA Coach"}</button>
        {isAdmin&&<button onClick={()=>setShowAdmin(true)} style={{marginTop:6,width:"100%",padding:"7px",borderRadius:8,border:`1px solid rgba(255,183,0,0.3)`,background:"rgba(255,183,0,0.05)",color:"#FFB700",cursor:"pointer",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>👑 Admin Panel</button>}
        <button onClick={()=>setShowProfile(true)} style={{marginTop:6,width:"100%",padding:"7px",borderRadius:8,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:11,fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:5}}>
          👤 {session?.user?.user_metadata?.full_name||session?.user?.email?.split("@")[0]||"Profile"}
        </button>
        <button onClick={()=>{
              // Clear user-specific caches on sign out
              const uid = session?.user?.id;
              if(uid){
                localStorage.removeItem("tca_aicoach_"+uid);
                localStorage.removeItem("tca_patterns_"+uid);
              }
              supabase.auth.signOut();
            }} style={{marginTop:6,width:"100%",padding:"7px",borderRadius:8,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:11,fontWeight:600}}>Sign Out</button>
      </div>
    </div>
    <style>{`[contenteditable]{direction:ltr!important;text-align:left!important;unicode-bidi:embed!important;}`}</style>
    <div style={{marginLeft:216,marginRight:chatOpen?380:0,padding:"28px 32px",minHeight:"100vh",transition:"margin-right 0.3s"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
        <div><h1 style={{margin:0,fontSize:20,fontWeight:800,color:B.text,letterSpacing:-0.5}}>{NAV.find(n=>n.id===active)?.label}</h1></div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {hasSample&&(<button onClick={()=>setTrades([])} style={{padding:"8px 14px",borderRadius:9,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:11,fontWeight:600}}>Clear Sample Data</button>)}
          <button onClick={()=>setShowReport(true)} style={{padding:"7px 14px",borderRadius:9,border:`1px solid rgba(0,212,168,0.3)`,background:"rgba(0,212,168,0.06)",color:B.teal,cursor:"pointer",fontSize:11,fontWeight:700,display:"flex",alignItems:"center",gap:5}}>📄 Export PDF</button>
          {active==="overview"&&<button onClick={()=>document.dispatchEvent(new CustomEvent("tca-toggle-edit"))} style={{padding:"8px 14px",borderRadius:9,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:12,fontWeight:600}}>✏ Edit Layout</button>}
          {/* Theme toggle */}
          <button onClick={()=>{const next=!isDark;setIsDark(next);try{localStorage.setItem("tca_theme",next?"dark":"light");}catch(e){}}} title={isDark?"Switch to Light Mode":"Switch to Dark Mode"}
            style={{padding:"7px 14px",borderRadius:9,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:13,display:"flex",alignItems:"center",gap:6}}>
            {isDark?"☀️ Light":"🌙 Dark"}
          </button>
          <select value={activeAccount} onChange={e=>setActiveAccount(e.target.value)}
            style={{padding:"7px 12px",borderRadius:9,border:`1px solid ${B.border}`,background:"rgba(0,0,0,0.5)",color:B.text,cursor:"pointer",fontSize:12,fontFamily:"'DM Sans',sans-serif"}}>
            <option value="all">All Accounts</option>
            {accounts.map(a=>(<option key={a.id} value={a.id}>{a.label}</option>))}
          </select>
          <button onClick={()=>setShowImport(true)} style={{padding:"8px 16px",borderRadius:9,border:`1px solid ${B.blue}40`,background:`${B.blue}12`,color:B.blue,cursor:"pointer",fontSize:12,fontWeight:700}}>⬆ Import CSV</button>
          <button onClick={()=>handleClearImported()} style={{padding:"8px 14px",borderRadius:9,border:`1px solid ${B.loss}40`,background:`${B.loss}10`,color:B.loss,cursor:"pointer",fontSize:12,fontWeight:600}} title="Delete all imported trades">🗑 Clear Imports</button>
          <button onClick={()=>{setEditTrade(null);setShowForm(true);}} style={{padding:"8px 18px",borderRadius:9,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:12,fontWeight:800}}>+ Log Trade</button>
        </div>
      </div>
      {hasSample&&(<div style={{marginBottom:18,padding:"10px 16px",borderRadius:10,background:"rgba(79,142,247,0.07)",border:"1px solid rgba(79,142,247,0.2)",fontSize:12,color:B.blue,display:"flex",alignItems:"center",justifyContent:"space-between"}}><span>Viewing sample data. Import your Tradovate CSV or log a real trade to get started.</span><button onClick={()=>setTrades([])} style={{background:"none",border:"none",color:B.blue,cursor:"pointer",fontWeight:700,fontSize:12,textDecoration:"underline"}}>Clear it</button></div>)}
      {active==="overview"&&<Overview trades={activeAccount==="all"?trades:trades.filter(t=>t.account_id===activeAccount)} onGradeUpdate={handleGradeUpdate} session={session} accounts={accounts} activeAccount={activeAccount} setAccounts={setAccounts}/>}
      {active==="journal"&&<Journal trades={activeAccount==="all"?trades:trades.filter(t=>t.account_id===activeAccount)} onEdit={handleEdit} onDelete={setDelTrade} onGradeUpdate={handleGradeUpdate}/>}
      {active==="analytics"&&<Analytics trades={activeAccount==="all"?trades:trades.filter(t=>t.account_id===activeAccount)}/>}
      {active==="calendar"&&<CalendarView trades={activeAccount==="all"?trades:trades.filter(t=>t.account_id===activeAccount)} onGradeUpdate={handleGradeUpdate} onEdit={handleEdit}/>}
      {active==="playbooks"&&<PlaybookView trades={activeAccount==="all"?trades:trades.filter(t=>t.account_id===activeAccount)}/>}
      {active==="resources"&&<ResourcesPage session={session}/>}
      {active==="weeklyreview"&&<WeeklyReview trades={activeAccount==="all"?trades:trades.filter(t=>t.account_id===activeAccount)} session={session}/>}
      {active==="economiccalendar"&&<EconomicCalendar isDark={isDark}/>}
      {active==="library"&&<PlaybookLibrary session={session}/>}
    </div>
  <TCAChat trades={trades} strategies={strategies} isOpen={chatOpen} onClose={()=>setChatOpen(false)}/>
  {showReport&&<PDFReportModal trades={trades} session={session} onClose={()=>setShowReport(false)}/>}
  {showProfile&&<ProfileModal session={session} onClose={()=>setShowProfile(false)}/>}
  {showAdmin&&isAdmin&&<AdminPanel onClose={()=>setShowAdmin(false)}/>}
  </div>);
}
