import { useState, useEffect, useRef, useCallback } from "react";
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ── Tradovate Sync ────────────────────────────────────────────────────────────
// ── Tradovate via Vercel Proxy (avoids CORS) ─────────────────────────────────
const PROXY = "/api/tradovate";

async function tvAuth() {
  try {
    const res = await fetch(`${PROXY}?action=auth`);
    const data = await res.json();
    if (data.accessToken) {
      sessionStorage.setItem("tv_token", data.accessToken);
      sessionStorage.setItem("tv_expiry", Date.now() + 75 * 60 * 1000);
      return data.accessToken;
    }
    console.error("Tradovate auth failed:", data);
    return null;
  } catch (e) {
    console.error("Tradovate auth error:", e);
    return null;
  }
}

async function getToken() {
  const expiry = sessionStorage.getItem("tv_expiry");
  const token  = sessionStorage.getItem("tv_token");
  if (token && expiry && Date.now() < parseInt(expiry)) return token;
  return await tvAuth();
}

async function fetchClosedTrades(token, fromDate=null, toDate=null) {
  try {
    let url = `${PROXY}?action=fills&token=${token}`;
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
  if (exec.date && exec.instrument) return exec; // already built by proxy
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
const B={teal:"#00D4A8",blue:"#4F8EF7",purple:"#8B5CF6",spark:"#7B61FF",profit:"#00D4A8",loss:"#F05A7E",bg:"#0E0E10",surface:"rgba(255,255,255,0.025)",border:"rgba(255,255,255,0.07)",borderTeal:"rgba(0,212,168,0.25)",borderPurp:"rgba(139,92,246,0.25)",text:"#F0EEF8",textMuted:"#6B6880",textDim:"#2E2C3A"};
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

function buildCalendar(trades){const m={};trades.forEach(t=>{if(!m[t.date])m[t.date]={pnl:0,count:0};m[t.date].pnl+=t.pnl;m[t.date].count++;});return m;}
function buildEquity(trades){const s=[...trades].sort((a,b)=>a.date.localeCompare(b.date));let c=0;return s.map(t=>{c+=t.pnl;return{date:t.date.slice(5),equity:c};});}

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

    trades.push({
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
    });
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

    trades.push({
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
    });
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
    trades.push({id:`imp_${Date.now()}_${i}`,date:safeDate,instrument:(row.symbol||row.instrument||"MES").replace(/\d+/g,"").toUpperCase()||"MES",direction:(row.side||row.direction||"Long").includes("ell")?"Short":"Long",contracts:parseInt(row.qty||row.contracts||"1")||1,entry:0,exit:0,pnl,rr:"--",setup:"Imported",grade:"B",notes:"Imported from CSV",session:"AM",result:pnl>=0?"Win":"Loss"});
  }
  return trades;
}

const iS={background:"rgba(0,0,0,0.4)",border:`1px solid ${B.border}`,borderRadius:8,color:B.text,padding:"9px 12px",fontSize:13,width:"100%",outline:"none",fontFamily:"'DM Sans',sans-serif"};
const lS={fontSize:10,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:5,display:"block"};

function TCAIcon({size=34}){return(<svg width={size} height={size} viewBox="0 0 100 100" fill="none"><defs><linearGradient id="tcaB" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#00D4A8"/><stop offset="55%" stopColor="#4F8EF7"/><stop offset="100%" stopColor="#8B5CF6"/></linearGradient><linearGradient id="tcaF" x1="0.5" y1="1" x2="0.5" y2="0"><stop offset="0%" stopColor="#4F8EF7"/><stop offset="100%" stopColor="#8B5CF6"/></linearGradient><linearGradient id="tcaW" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#8B5CF6"/><stop offset="100%" stopColor="#00D4A8"/></linearGradient></defs><rect x="47" y="74" width="6" height="16" rx="3" fill="url(#tcaW)"/><rect x="30" y="42" width="40" height="34" rx="7" fill="url(#tcaB)"/><path d="M50 40 C50 40 41 29 44 20 C45.5 15 43 11 43 11 C52 15 60 25 57 34 C55 40 50 40 50 40Z" fill="url(#tcaF)"/><path d="M70 24 L72 19 L74 24 L79 26 L74 28 L72 33 L70 28 L65 26 Z" fill="#7B61FF" opacity="0.85"/></svg>);}
function StatCard({label,value,sub,accent,grad}){return(<div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:"20px 22px",position:"relative",overflow:"hidden"}}><div style={{position:"absolute",top:0,left:0,right:0,height:2,background:grad||`linear-gradient(90deg,${accent},transparent)`}}/><div style={{position:"absolute",top:-20,right:-20,width:90,height:90,background:`radial-gradient(circle,${accent}14 0%,transparent 70%)`,pointerEvents:"none"}}/><div style={{fontSize:10,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:8}}>{label}</div>{grad?<div style={{fontSize:26,fontWeight:800,background:grad,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",fontFamily:"'Space Mono',monospace",letterSpacing:-1}}>{value}</div>:<div style={{fontSize:26,fontWeight:800,color:accent,fontFamily:"'Space Mono',monospace",letterSpacing:-1}}>{value}</div>}{sub&&<div style={{fontSize:11,color:B.textMuted,marginTop:5}}>{sub}</div>}</div>);}
function Tag({label}){const c=TAG_COLOR[label]||"#666";return <span style={{fontSize:10,padding:"2px 9px",borderRadius:20,border:`1px solid ${c}44`,color:c,background:"rgba(0,0,0,0.35)",letterSpacing:0.5,fontWeight:700}}>{label}</span>;}
const CTip=({active,payload,label})=>{if(!active||!payload?.length)return null;return(<div style={{background:"#16151C",border:`1px solid ${B.borderTeal}`,borderRadius:10,padding:"10px 16px",fontSize:12}}><div style={{color:B.textMuted,marginBottom:5}}>{label}</div>{payload.map((p,i)=>(<div key={i} style={{color:p.value>=0?B.profit:B.loss,fontFamily:"monospace",fontWeight:700}}>{p.name}: {p.value>=0?"+":""}${p.value}</div>))}</div>);};

function LoginScreen(){
  const [email,setEmail]=useState("");const [password,setPassword]=useState("");const [mode,setMode]=useState("login");const [error,setError]=useState("");const [loading,setLoading]=useState(false);
  const handle=async()=>{setLoading(true);setError("");const{error:err}=mode==="login"?await supabase.auth.signInWithPassword({email,password}):await supabase.auth.signUp({email,password});if(err)setError(err.message);setLoading(false);};
  return(<div style={{minHeight:"100vh",background:B.bg,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans','Segoe UI',sans-serif"}}><style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700;800&family=Space+Mono:wght@400;700&display=swap');*{box-sizing:border-box;}body{margin:0;}`}</style><div style={{width:400,padding:44,borderRadius:20,background:"#13121A",border:`1px solid ${B.border}`,position:"relative",overflow:"hidden"}}><div style={{position:"absolute",top:0,left:0,right:0,height:3,background:GL}}/><div style={{textAlign:"center",marginBottom:36}}><div style={{display:"flex",justifyContent:"center",marginBottom:16}}><TCAIcon size={52}/></div><div style={{fontSize:11,fontWeight:800,color:B.text,letterSpacing:2,textTransform:"uppercase"}}>The Candlestick Academy</div><div style={{marginTop:6,display:"inline-block",padding:"2px 12px",borderRadius:20,background:GL,fontSize:9,fontWeight:800,letterSpacing:2,color:"#0E0E10"}}>TRADE JOURNAL</div></div><div style={{marginBottom:12}}><label style={lS}>Email</label><input type="email" value={email} onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handle()} placeholder="you@email.com" style={iS}/></div><div style={{marginBottom:20}}><label style={lS}>Password</label><input type="password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handle()} placeholder="password" style={iS}/></div>{error&&<div style={{marginBottom:14,padding:"10px 14px",borderRadius:8,background:"rgba(240,90,126,0.1)",border:"1px solid rgba(240,90,126,0.3)",color:B.loss,fontSize:12}}>{error}</div>}<button onClick={handle} disabled={loading} style={{width:"100%",padding:"12px",borderRadius:10,border:"none",background:GL,color:"#0E0E10",fontWeight:800,fontSize:14,cursor:"pointer",opacity:loading?0.7:1}}>{loading?"Loading...":(mode==="login"?"Sign In":"Create Account")}</button><div style={{textAlign:"center",marginTop:18,fontSize:12,color:B.textMuted}}>{mode==="login"?"Don't have an account? ":"Already have an account? "}<span onClick={()=>{setMode(m=>m==="login"?"signup":"login");setError("");}} style={{color:B.teal,cursor:"pointer",fontWeight:700}}>{mode==="login"?"Sign up free":"Sign in"}</span></div></div></div>);
}

function TradeFormModal({onClose,onSave,editTrade}){
  const blank={date:new Date().toISOString().slice(0,10),instrument:"MES",direction:"Long",contracts:1,entry:"",exit:"",pnl:"",rr:"",setup:SETUPS[0],grade:"A",session:"AM",notes:"",result:"Win"};
  const [form,setForm]=useState(editTrade?{...editTrade}:blank);const [auto,setAuto]=useState(!editTrade);
  const set=(k,v)=>setForm(f=>({...f,[k]:v}));
  useEffect(()=>{if(!auto)return;const en=parseFloat(form.entry),ex=parseFloat(form.exit),qty=parseInt(form.contracts)||1;if(isNaN(en)||isNaN(ex))return;const inst=form.instrument;let tv=1,ts=0.25;if(inst==="MES"){tv=1.25;ts=0.25;}else if(inst==="ES"){tv=12.5;ts=0.25;}else if(inst==="NQ"){tv=5;ts=0.25;}else if(inst==="MNQ"){tv=0.5;ts=0.25;}const pts=form.direction==="Long"?ex-en:en-ex;const p=Math.round((pts/ts)*tv*qty*100)/100;set("pnl",p);set("result",p>=0?"Win":"Loss");},[form.entry,form.exit,form.contracts,form.instrument,form.direction,auto]);
  const handleSave=()=>{onSave({...form,id:editTrade?.id||`t_${Date.now()}`,pnl:parseFloat(form.pnl)||0,contracts:parseInt(form.contracts)||1,entry:parseFloat(form.entry)||0,exit:parseFloat(form.exit)||0,result:parseFloat(form.pnl)>=0?"Win":"Loss"});onClose();};
  return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.82)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(6px)"}}><div style={{background:"#13121A",border:`1px solid ${B.border}`,borderRadius:18,padding:32,width:580,maxHeight:"90vh",overflowY:"auto"}}><div style={{height:3,background:GL,borderRadius:3,marginBottom:24}}/><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}><div style={{fontSize:18,fontWeight:800,color:B.text}}>{editTrade?"Edit Trade":"Log New Trade"}</div><button onClick={onClose} style={{background:"none",border:"none",color:B.textMuted,cursor:"pointer",fontSize:22}}>x</button></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}><div><label style={lS}>Date</label><input type="date" value={form.date} onChange={e=>set("date",e.target.value)} style={iS}/></div><div><label style={lS}>Instrument</label><select value={form.instrument} onChange={e=>set("instrument",e.target.value)} style={iS}>{INSTRUMENTS.map(i=><option key={i}>{i}</option>)}</select></div><div><label style={lS}>Direction</label><div style={{display:"flex",gap:8}}>{["Long","Short"].map(d=>(<button key={d} onClick={()=>set("direction",d)} style={{flex:1,padding:"9px",borderRadius:8,border:"1px solid",cursor:"pointer",fontWeight:700,fontSize:13,borderColor:form.direction===d?(d==="Long"?"#4ade80":"#f87171"):B.border,background:form.direction===d?(d==="Long"?"rgba(74,222,128,0.1)":"rgba(248,113,113,0.1)"):"transparent",color:form.direction===d?(d==="Long"?"#4ade80":"#f87171"):B.textMuted}}>{d}</button>))}</div></div><div><label style={lS}>Contracts</label><input type="number" value={form.contracts} onChange={e=>set("contracts",e.target.value)} style={iS} min="1"/></div><div><label style={lS}>Entry Price</label><input type="number" step="0.01" value={form.entry} onChange={e=>set("entry",e.target.value)} style={iS} placeholder="e.g. 5780.25"/></div><div><label style={lS}>Exit Price</label><input type="number" step="0.01" value={form.exit} onChange={e=>set("exit",e.target.value)} style={iS} placeholder="e.g. 5794.00"/></div><div><label style={lS}>P&L ($) <span onClick={()=>setAuto(a=>!a)} style={{marginLeft:8,cursor:"pointer",color:auto?B.teal:B.textMuted,fontSize:9}}>{auto?"AUTO":"MANUAL"}</span></label><input type="number" step="0.01" value={form.pnl} onChange={e=>{set("pnl",e.target.value);setAuto(false);}} style={{...iS,color:parseFloat(form.pnl)>=0?B.profit:B.loss,fontWeight:700}} placeholder="0.00"/></div><div><label style={lS}>R:R Ratio</label><input value={form.rr} onChange={e=>set("rr",e.target.value)} style={iS} placeholder="e.g. 2.1R"/></div><div><label style={lS}>Setup</label><select value={form.setup} onChange={e=>set("setup",e.target.value)} style={iS}>{SETUPS.map(s=><option key={s}>{s}</option>)}</select></div><div><label style={lS}>Session</label><select value={form.session} onChange={e=>set("session",e.target.value)} style={iS}>{SESSIONS.map(s=><option key={s}>{s}</option>)}</select></div><div style={{gridColumn:"1/-1"}}><label style={lS}>Grade</label><div style={{display:"flex",gap:6}}>{GRADES.map(g=>(<button key={g} onClick={()=>set("grade",g)} style={{flex:1,padding:"7px 0",borderRadius:8,border:"1px solid",cursor:"pointer",fontWeight:800,fontSize:12,borderColor:form.grade===g?GRADE_COLOR[g]:B.border,background:form.grade===g?`${GRADE_COLOR[g]}18`:"transparent",color:form.grade===g?GRADE_COLOR[g]:B.textMuted}}>{g}</button>))}</div></div><div style={{gridColumn:"1/-1"}}><label style={lS}>Notes</label><textarea value={form.notes} onChange={e=>set("notes",e.target.value)} rows={3} style={{...iS,resize:"vertical"}} placeholder="What happened?"/></div></div><div style={{display:"flex",gap:10,marginTop:24,justifyContent:"flex-end"}}><button onClick={onClose} style={{padding:"10px 22px",borderRadius:10,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:13,fontWeight:600}}>Cancel</button><button onClick={handleSave} style={{padding:"10px 28px",borderRadius:10,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:13,fontWeight:800}}>{editTrade?"Save Changes":"Log Trade"}</button></div></div></div>);
}

function ImportModal({onClose,onImport,existingTrades}){
  const [step,setStep]=useState("upload");
  const [parsed,setParsed]=useState([]);
  const [error,setError]=useState("");
  const [drag,setDrag]=useState(false);
  const [mode,setMode]=useState("add"); // "add" | "replace"
  const [fileType,setFileType]=useState("");
  const ref=useRef();

  const handle=(file)=>{
    if(!file)return;
    setError("");
    const r=new FileReader();
    r.onload=(e)=>{
      try{
        const t=e.target.result;
        const firstLine=t.split("
")[0].toLowerCase();
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
              <div style={{display:"flex",gap:10}}>
                <button onClick={onClose} style={{flex:1,padding:"11px",borderRadius:10,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:13,fontWeight:600}}>Cancel</button>
                <button onClick={()=>{onImport(mode==="replace"?parsed:newTrades,mode);onClose();}} style={{flex:2,padding:"11px",borderRadius:10,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:13,fontWeight:800}}>
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
  const sorted=[...trades].sort((a,b)=>b.date.localeCompare(a.date));
  let streak=0, type="";
  for(const t of sorted){
    if(streak===0){type=t.result;streak=1;}
    else if(t.result===type)streak++;
    else break;
  }
  if(!streak)return null;
  const isWin=type==="Win";
  return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
      <div style={{fontSize:28,fontWeight:800,color:isWin?B.profit:B.loss,fontFamily:"'Space Mono',monospace"}}>{streak}</div>
      <div style={{fontSize:10,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase"}}>{isWin?"Win":"Loss"} Streak</div>
      <div style={{display:"flex",gap:3,marginTop:2}}>
        {Array.from({length:Math.min(streak,7)}).map((_,i)=>(
          <div key={i} style={{width:8,height:8,borderRadius:"50%",background:isWin?B.profit:B.loss,opacity:1-(i*0.08)}}/>
        ))}
      </div>
    </div>
  );
}

function Overview({trades}){
  const wins=trades.filter(t=>t.result==="Win"),losses=trades.filter(t=>t.result==="Loss");
  const totalPnl=trades.reduce((a,t)=>a+t.pnl,0);
  const winRate=trades.length?Math.round((wins.length/trades.length)*100):0;
  const profitFactor=losses.length?parseFloat(Math.abs(wins.reduce((a,t)=>a+t.pnl,0)/(losses.reduce((a,t)=>a+t.pnl,0)||1)).toFixed(2)):0;
  const equity=buildEquity(trades);

  // Day modal state
  const [selectedDay,setSelectedDay]=useState(null);

  // Calendar with month navigation
  const allDates=trades.map(t=>t.date).sort();
  const latestDate=allDates[allDates.length-1]||new Date().toISOString().slice(0,10);
  const [calYear,setCalYear]=useState(parseInt(latestDate.slice(0,4)));
  const [calMonth,setCalMonth]=useState(parseInt(latestDate.slice(5,7))-1);
  const [manualNav,setManualNav]=useState(false);

  // Auto-update calendar when new trades sync in (unless user manually navigated)
  useEffect(()=>{
    if(manualNav)return;
    const dates=trades.map(t=>t.date).sort();
    const ld=dates[dates.length-1];
    if(ld){
      setCalYear(parseInt(ld.slice(0,4)));
      setCalMonth(parseInt(ld.slice(5,7))-1);
    }
  },[trades,manualNav]);

  const prevMonth=()=>{
    setManualNav(true);
    if(calMonth===0){setCalMonth(11);setCalYear(y=>y-1);}
    else setCalMonth(m=>m-1);
  };
  const nextMonth=()=>{
    setManualNav(true);
    if(calMonth===11){setCalMonth(0);setCalYear(y=>y+1);}
    else setCalMonth(m=>m+1);
  };
  const now=new Date();
  const canGoForward=!(calYear===now.getFullYear()&&calMonth===now.getMonth());

  const calMap=buildCalendar(trades);
  const yr=calYear,mo=calMonth;
  const mn=new Date(yr,mo,1).toLocaleString("default",{month:"long",year:"numeric"}).toUpperCase();
  const fd=new Date(yr,mo,1).getDay(),dim=new Date(yr,mo+1,0).getDate();
  const cells=[];for(let i=0;i<fd;i++)cells.push(null);for(let d=1;d<=dim;d++)cells.push(d);
  const weeks=[];for(let i=0;i<cells.length;i+=7)weeks.push(cells.slice(i,i+7));
  const calDays=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  // Monthly stats for selected month
  const monthKey=`${yr}-${String(mo+1).padStart(2,"0")}`;
  const monthTrades=trades.filter(t=>t.date.startsWith(monthKey));
  const monthPnl=monthTrades.reduce((a,t)=>a+t.pnl,0);

  // Weekly P&L
  const weeklyPnl=weeks.map((week,wi)=>{
    let wpnl=0,wdays=0;
    week.forEach(day=>{
      if(!day)return;
      const ds=`${yr}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
      if(calMap[ds]){wpnl+=calMap[ds].pnl;wdays++;}
    });
    return{week:wi+1,pnl:wpnl,days:wdays};
  });

  // Day win %
  const tradeDays=Object.values(calMap);
  const greenDays=tradeDays.filter(d=>d.pnl>0).length;
  const dayWinPct=tradeDays.length?Math.round((greenDays/tradeDays.length)*100):0;

  if(!trades.length)return(
    <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:400,gap:16}}>
      <TCAIcon size={64}/>
      <div style={{fontSize:15,color:B.textMuted}}>No trades yet. Log your first trade or import a CSV.</div>
    </div>
  );

  return(<div style={{display:"flex",flexDirection:"column",gap:18}}>

    {/* Top stats row */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",gap:14}}>
      {/* Net P&L */}
      <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:"18px 20px",position:"relative",overflow:"hidden"}}>
        <div style={{position:"absolute",top:0,left:0,right:0,height:2,background:GTB}}/>
        <div style={{fontSize:10,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:6}}>Account P&L</div>
        <div style={{fontSize:28,fontWeight:800,color:pnlColor(totalPnl),fontFamily:"'Space Mono',monospace",letterSpacing:-1}}>{fmt(totalPnl)}</div>
        <div style={{fontSize:11,color:B.textMuted,marginTop:4}}>{trades.length} trades total</div>
      </div>

      {/* Win % gauge */}
      <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:"14px 20px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        <GaugeChart value={winRate} label="Trade Win %" color={winRate>=50?B.profit:B.loss}/>
      </div>

      {/* Profit factor gauge */}
      <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:"14px 20px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        <GaugeChart value={profitFactor} max={3} label="Profit Factor" color={profitFactor>=1?B.teal:B.loss}/>
      </div>

      {/* Day win % gauge */}
      <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:"14px 20px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        <GaugeChart value={dayWinPct} label="Day Win %" color={dayWinPct>=50?B.blue:B.loss}/>
      </div>

      {/* Streak */}
      <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:"14px 20px",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
        <StreakBadge trades={trades}/>
      </div>
    </div>

    {/* Calendar + Weekly P&L */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 180px",gap:14}}>
      {/* Main Calendar */}
      <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:22}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:18}}>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <button onClick={prevMonth} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:8,color:B.textMuted,cursor:"pointer",fontSize:16,width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center"}}>‹</button>
            <span style={{fontSize:13,fontWeight:800,background:GL,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",letterSpacing:3,minWidth:180,textAlign:"center"}}>{mn}</span>
            <button onClick={nextMonth} disabled={!canGoForward} style={{background:"none",border:`1px solid ${B.border}`,borderRadius:8,color:!canGoForward?B.textDim:B.textMuted,cursor:!canGoForward?"default":"pointer",fontSize:16,width:30,height:30,display:"flex",alignItems:"center",justifyContent:"center"}}>›</button>
          </div>
          <div style={{display:"flex",gap:16,alignItems:"center"}}>
            <span style={{fontSize:12,fontWeight:700,fontFamily:"monospace",color:pnlColor(monthPnl)}}>{fmt(monthPnl)}</span>
            <span style={{fontSize:11,color:B.textMuted}}><span style={{color:B.profit,fontWeight:700}}>{greenDays}</span> green · <span style={{color:B.loss,fontWeight:700}}>{tradeDays.length-greenDays}</span> red</span>
          </div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6,marginBottom:8}}>
          {calDays.map(d=><div key={d} style={{textAlign:"center",fontSize:10,color:B.textMuted,letterSpacing:1,paddingBottom:6}}>{d}</div>)}
        </div>
        {weeks.map((w,wi)=>(
          <div key={wi} style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6,marginBottom:6}}>
            {w.map((day,di)=>{
              if(!day)return <div key={di}/>;
              const ds=`${yr}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
              const data=calMap[ds];
              const isToday=ds===new Date().toISOString().slice(0,10);
              return(
                <div key={di} onClick={()=>setSelectedDay(ds)} style={{
                  minHeight:68,borderRadius:10,padding:"8px 10px",
                  background:data?(data.pnl>0?`${B.teal}10`:`${B.loss}10`):"rgba(255,255,255,0.015)",
                  border:`1px solid ${data?(data.pnl>0?`${B.teal}35`:`${B.loss}35`):B.border}`,
                  outline:isToday?`2px solid ${B.blue}60`:"none",
                  cursor:"pointer",transition:"all 0.15s",
                }}>
                  <div style={{fontSize:11,color:data?B.text:B.textDim,fontWeight:700,marginBottom:4}}>{day}</div>
                  {data&&<>
                    <div style={{fontSize:12,fontWeight:800,fontFamily:"monospace",color:pnlColor(data.pnl),lineHeight:1}}>{fmt(data.pnl)}</div>
                    <div style={{fontSize:9,color:B.textMuted,marginTop:3}}>{data.count} trade{data.count>1?"s":""}</div>
                    <div style={{fontSize:9,color:data.pnl>0?B.profit:B.loss,marginTop:2}}>
                      {data.pnl>0?"▲":"▼"}
                    </div>
                  </>}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* Weekly P&L sidebar */}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        <div style={{fontSize:10,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>Weekly P&L</div>
        {weeklyPnl.map(w=>(
          <div key={w.week} style={{
            background:B.surface,border:`1px solid ${w.pnl>0?`${B.teal}25`:w.pnl<0?`${B.loss}25`:B.border}`,
            borderRadius:10,padding:"12px 14px",borderLeft:`3px solid ${w.pnl>0?B.teal:w.pnl<0?B.loss:B.border}`
          }}>
            <div style={{fontSize:10,color:B.textMuted,marginBottom:4}}>Week {w.week}</div>
            <div style={{fontSize:15,fontWeight:800,fontFamily:"monospace",color:w.pnl>0?B.profit:w.pnl<0?B.loss:B.textMuted}}>
              {w.pnl===0?"$0":fmt(w.pnl)}
            </div>
            <div style={{fontSize:9,color:B.textMuted,marginTop:2}}>{w.days} day{w.days!==1?"s":""}</div>
          </div>
        ))}
      </div>
    </div>

    {/* Equity curve */}
    <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:22}}>
      <div style={{fontSize:10,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:16}}>Account Balance Curve</div>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={equity}>
          <defs>
            <linearGradient id="eqF2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#00D4A8" stopOpacity={0.25}/>
              <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0}/>
            </linearGradient>
            <linearGradient id="eqL2" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#00D4A8"/>
              <stop offset="50%" stopColor="#4F8EF7"/>
              <stop offset="100%" stopColor="#8B5CF6"/>
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)"/>
          <XAxis dataKey="date" tick={{fill:B.textDim,fontSize:10}} axisLine={false} tickLine={false} interval={Math.ceil(equity.length/8)}/>
          <YAxis tick={{fill:B.textDim,fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/>
          <Tooltip content={<CTip/>}/>
          <ReferenceLine y={0} stroke="rgba(255,255,255,0.07)"/>
          <Area type="monotone" dataKey="equity" stroke="url(#eqL2)" strokeWidth={2.5} fill="url(#eqF2)" name="Balance"/>
        </AreaChart>
      </ResponsiveContainer>
    </div>

    {/* Day Detail Modal */}
    {selectedDay&&<DayJournalModal date={selectedDay} trades={trades} onClose={()=>setSelectedDay(null)}/>}

  </div>);
}

function Journal({trades,onEdit,onDelete}){
  const [filter,setFilter]=useState("All");const [sort,setSort]=useState("date");
  const insts=["All",...[...new Set(trades.map(t=>t.instrument))]];
  const filtered=filter==="All"?trades:trades.filter(t=>t.instrument===filter);
  const sorted=[...filtered].sort((a,b)=>sort==="date"?b.date.localeCompare(a.date):b.pnl-a.pnl);
  if(!trades.length)return(<div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:400,gap:16}}><TCAIcon size={64}/><div style={{fontSize:15,color:B.textMuted}}>No trades yet.</div></div>);
  return(<div style={{display:"flex",flexDirection:"column",gap:16}}><div style={{display:"flex",gap:8,alignItems:"center"}}><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{insts.map(i=>(<button key={i} onClick={()=>setFilter(i)} style={{padding:"5px 14px",borderRadius:20,border:"1px solid",borderColor:filter===i?B.teal:B.border,background:filter===i?`${B.teal}18`:"transparent",color:filter===i?B.teal:B.textMuted,cursor:"pointer",fontSize:12,fontWeight:700}}>{i}</button>))}</div><div style={{marginLeft:"auto",display:"flex",gap:6}}>{["date","pnl"].map(s=>(<button key={s} onClick={()=>setSort(s)} style={{padding:"5px 12px",borderRadius:8,border:"1px solid",borderColor:sort===s?B.purple:B.border,background:sort===s?`${B.purple}18`:"transparent",color:sort===s?B.purple:B.textMuted,cursor:"pointer",fontSize:11,fontWeight:600}}>{s==="date"?"Date":"P&L"}</button>))}</div></div><div style={{display:"grid",gridTemplateColumns:"70px 72px 68px 52px 110px 72px 56px 56px 1fr 78px",padding:"8px 14px",fontSize:10,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",borderBottom:`1px solid ${B.border}`}}>{["Date","Symbol","Dir","Grade","Setup","P&L","R:R","Result","Notes",""].map((h,i)=><div key={i}>{h}</div>)}</div><div style={{display:"flex",flexDirection:"column",gap:4}}>{sorted.map(t=>(<div key={t.id} style={{display:"grid",gridTemplateColumns:"70px 72px 68px 52px 110px 72px 56px 56px 1fr 78px",padding:"11px 14px",borderRadius:10,background:B.surface,border:`1px solid ${B.border}`,borderLeft:`3px solid ${t.result==="Win"?B.teal:B.loss}`}}><div style={{fontSize:11,color:B.textMuted}}>{t.date.slice(5)}</div><div><span style={{fontSize:11,padding:"2px 7px",borderRadius:5,fontWeight:700,background:`${INST_COLOR[t.instrument]||B.teal}20`,color:INST_COLOR[t.instrument]||B.teal}}>{t.instrument}</span></div><div style={{fontSize:12,color:t.direction==="Long"?"#4ade80":"#f87171"}}>{t.direction}</div><div style={{fontSize:12,fontWeight:800,color:GRADE_COLOR[t.grade]||"#aaa"}}>{t.grade}</div><div style={{fontSize:11,color:"#9CA0BC",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{t.setup}</div><div style={{fontSize:13,fontWeight:800,fontFamily:"monospace",color:pnlColor(t.pnl)}}>{fmt(t.pnl)}</div><div style={{fontSize:11,fontFamily:"monospace",color:B.textMuted}}>{t.rr}</div><div style={{fontSize:11,fontWeight:700,color:t.result==="Win"?B.profit:B.loss}}>{t.result}</div><div style={{fontSize:11,color:B.textDim,overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis"}}>{t.notes}</div><div style={{display:"flex",gap:5}}><button onClick={()=>onEdit(t)} style={{padding:"4px 8px",borderRadius:6,border:`1px solid ${B.blue}40`,background:`${B.blue}12`,color:B.blue,cursor:"pointer",fontSize:10,fontWeight:700}}>Edit</button><button onClick={()=>onDelete(t)} style={{padding:"4px 8px",borderRadius:6,border:`1px solid ${B.loss}40`,background:`${B.loss}12`,color:B.loss,cursor:"pointer",fontSize:10,fontWeight:700}}>Del</button></div></div>))}</div></div>);
}

function Analytics({trades}){
  const wins=trades.filter(t=>t.result==="Win"),losses=trades.filter(t=>t.result==="Loss");
  if(trades.length<2)return(<div style={{display:"flex",alignItems:"center",justifyContent:"center",height:300,color:B.textMuted,fontSize:14}}>Add more trades to see analytics.</div>);
  const groupBy=k=>trades.reduce((m,t)=>{if(!m[t[k]])m[t[k]]={wins:0,total:0,pnl:0};m[t[k]].total++;m[t[k]].pnl+=t.pnl;if(t.result==="Win")m[t[k]].wins++;return m;},{});
  const byInst=groupBy("instrument"),bySess=groupBy("session"),byDay=groupBy("day");
  const dOrder=["Mon","Tue","Wed","Thu","Fri"],dayData=dOrder.filter(d=>byDay[d]).map(d=>({day:d,...byDay[d]}));
  const pf=losses.length?Math.abs(wins.reduce((a,t)=>a+t.pnl,0)/(losses.reduce((a,t)=>a+t.pnl,0)||1)).toFixed(2):"N/A";
  const equity=buildEquity(trades);
  const maxDD=(()=>{let pk=0,dd=0,r=0;equity.forEach(e=>{r=e.equity;if(r>pk)pk=r;const d=pk-r;if(d>dd)dd=d;});return Math.round(dd);})();
  const exp=Math.round(trades.reduce((a,t)=>a+t.pnl,0)/trades.length);
  const PBar=({label,data,grads})=>(<div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:22}}><div style={{fontSize:10,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:18}}>{label}</div>{Object.entries(data).map(([k,d],i)=>{const g=grads[i%grads.length];return(<div key={k} style={{marginBottom:16}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:7}}><span style={{fontSize:13,color:B.text,fontWeight:600}}>{k}</span><span style={{fontSize:12,fontFamily:"monospace",color:pnlColor(d.pnl),fontWeight:700}}>{fmt(d.pnl)}</span></div><div style={{height:6,background:"rgba(255,255,255,0.05)",borderRadius:4,overflow:"hidden"}}><div style={{height:"100%",width:`${(d.wins/d.total)*100}%`,background:g,borderRadius:4,transition:"width 0.8s"}}/></div><div style={{fontSize:10,color:B.textMuted,marginTop:4}}>{Math.round((d.wins/d.total)*100)}% WR - {d.total} trades</div></div>);})}</div>);
  return(<div style={{display:"flex",flexDirection:"column",gap:20}}><div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}><StatCard label="Profit Factor" value={pf} sub="Gross win / Gross loss" grad={GTB} accent={B.teal}/><StatCard label="Expectancy" value={`+$${exp}`} sub="Per trade avg" grad={GBP} accent={B.blue}/><StatCard label="Max Drawdown" value={`$${maxDD}`} sub="Peak to trough" accent={B.loss}/><StatCard label="Total Trades" value={trades.length} sub={`${wins.length}W - ${losses.length}L`} accent={B.spark}/></div><div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}><PBar label="P&L by Instrument" data={byInst} grads={[GL,GTB,GBP]}/><PBar label="P&L by Session" data={bySess} grads={[GTB,GBP,GL]}/></div><div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:22}}><div style={{fontSize:10,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:16}}>P&L by Day of Week</div><ResponsiveContainer width="100%" height={160}><BarChart data={dayData} barSize={44}><CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false}/><XAxis dataKey="day" tick={{fill:"#6B6880",fontSize:12}} axisLine={false} tickLine={false}/><YAxis tick={{fill:B.textDim,fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>`$${v}`}/><Tooltip content={<CTip/>}/><ReferenceLine y={0} stroke="rgba(255,255,255,0.08)"/><Bar dataKey="pnl" name="P&L" radius={[5,5,0,0]} fill={B.teal} isAnimationActive/></BarChart></ResponsiveContainer></div></div>);
}

function DayJournalModal({date, trades, onClose}){
  const STORAGE_KEY=`tca_dayjournal_${date}`;
  const [notes,setNotes]=useState("");
  const [checklist,setChecklist]=useState([]);
  const [newItem,setNewItem]=useState("");
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
      try{
        const r=await window.storage.get(STORAGE_KEY);
        if(r?.value){
          const saved=JSON.parse(r.value);
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
    try{
      await window.storage.set(STORAGE_KEY,JSON.stringify({notes:newNotes??notes,checklist:newChecklist??checklist}));
    }catch(e){}
    setSaving(false);
  };

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
                    display:"flex",alignItems:"center",gap:12,padding:"12px 16px",borderRadius:10,
                    background:item.checked?"rgba(0,212,168,0.06)":"rgba(255,255,255,0.02)",
                    border:`1px solid ${item.checked?`${B.teal}30`:B.border}`,
                    transition:"all 0.2s",cursor:"pointer"
                  }} onClick={()=>toggleCheck(i)}>
                    <div style={{
                      width:20,height:20,borderRadius:6,border:`2px solid ${item.checked?B.teal:B.textMuted}`,
                      background:item.checked?B.teal:"transparent",flexShrink:0,
                      display:"flex",alignItems:"center",justifyContent:"center",transition:"all 0.2s"
                    }}>
                      {item.checked&&<span style={{color:"#0E0E10",fontSize:12,fontWeight:900}}>✓</span>}
                    </div>
                    <div style={{flex:1,fontSize:13,color:item.checked?B.textMuted:B.text,textDecoration:item.checked?"line-through":"none"}}>{item.text}</div>
                    <button onClick={e=>{e.stopPropagation();removeItem(i);}} style={{background:"none",border:"none",color:B.textDim,cursor:"pointer",fontSize:14,padding:"0 4px",opacity:0.5}}>×</button>
                  </div>
                ))}
              </div>

              {/* Add new item */}
              <div style={{display:"flex",gap:8}}>
                <input value={newItem} onChange={e=>setNewItem(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&addItem()}
                  style={{...iS,flex:1}} placeholder="Add a checklist item..."/>
                <button onClick={addItem} style={{padding:"9px 18px",borderRadius:8,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:12,fontWeight:800,whiteSpace:"nowrap"}}>+ Add</button>
              </div>
            </div>
          )}

          {/* Notes Tab */}
          {tab==="notes"&&(
            <div>
              <div style={{fontSize:11,color:B.textMuted,marginBottom:10}}>Your trading journal for this day — thoughts, observations, lessons learned.</div>
              <textarea
                value={notes}
                onChange={e=>{setNotes(e.target.value);}}
                onBlur={()=>save(notes,undefined)}
                rows={14}
                style={{...iS,resize:"vertical",lineHeight:1.7,fontSize:13}}
                placeholder={`Journal entry for ${dateLabel}...

What was your plan going into the session?
What did you do well?
What would you do differently?
Any key observations about market structure?`}
              />
              <div style={{display:"flex",justifyContent:"flex-end",marginTop:10}}>
                <button onClick={()=>save(notes,undefined)} style={{padding:"8px 20px",borderRadius:8,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:12,fontWeight:800}}>Save Notes</button>
              </div>
            </div>
          )}

          {/* Trades Tab */}
          {tab==="trades"&&(
            <div>
              {dayTrades.length===0?(
                <div style={{textAlign:"center",padding:"40px 0",color:B.textMuted,fontSize:13}}>No trades on this day.</div>
              ):(
                <div style={{display:"flex",flexDirection:"column",gap:10}}>
                  {dayTrades.map((t,i)=>(
                    <div key={t.id} style={{padding:"14px 16px",borderRadius:12,background:"rgba(0,0,0,0.3)",border:`1px solid ${t.result==="Win"?`${B.teal}30`:`${B.loss}30`}`,borderLeft:`4px solid ${t.result==="Win"?B.teal:B.loss}`}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                        <div style={{display:"flex",gap:8,alignItems:"center"}}>
                          <span style={{fontSize:11,padding:"2px 9px",borderRadius:5,fontWeight:700,background:`${INST_COLOR[t.instrument]||B.teal}20`,color:INST_COLOR[t.instrument]||B.teal}}>{t.instrument}</span>
                          <span style={{fontSize:13,fontWeight:700,color:t.direction==="Long"?"#4ade80":"#f87171"}}>{t.direction}</span>
                          <span style={{fontSize:11,color:B.textMuted}}>{t.contracts} contract{t.contracts!==1?"s":""}</span>
                        </div>
                        <span style={{fontSize:18,fontWeight:800,fontFamily:"monospace",color:pnlColor(t.pnl)}}>{fmt(t.pnl)}</span>
                      </div>
                      <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8,marginBottom:8}}>
                        {[{l:"Entry",v:t.entry||"--"},{l:"Exit",v:t.exit||"--"},{l:"R:R",v:t.rr||"--"},{l:"Session",v:t.session||"--"}].map(s=>(
                          <div key={s.l} style={{background:"rgba(255,255,255,0.03)",borderRadius:8,padding:"8px 10px"}}>
                            <div style={{fontSize:9,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:3}}>{s.l}</div>
                            <div style={{fontSize:13,fontWeight:700,color:B.text,fontFamily:"monospace"}}>{s.v}</div>
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
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CalendarView({trades}){
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

  return(
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      {selectedDay&&<DayJournalModal date={selectedDay} trades={trades} onClose={()=>setSelectedDay(null)}/>}

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

        {/* Day headers */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6,marginBottom:8}}>
          {calDays.map(d=><div key={d} style={{textAlign:"center",fontSize:10,color:B.textMuted,letterSpacing:1.5,paddingBottom:6}}>{d}</div>)}
        </div>

        {/* Weeks */}
        {weeks.map((w,wi)=>(
          <div key={wi} style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:6,marginBottom:6}}>
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
          </div>
        ))}
      </div>
    </div>
  );
}

function PlaybookView(){
  const STORAGE_KEY="tca_strategies_v1";
  const [strategies,setStrategies]=useState([]);
  const [sel,setSel]=useState(null);
  const [showForm,setShowForm]=useState(false);
  const [editStrat,setEditStrat]=useState(null);
  const [loaded,setLoaded]=useState(false);

  useEffect(()=>{
    (async()=>{
      try{
        const r=await window.storage.get(STORAGE_KEY);
        if(r?.value)setStrategies(JSON.parse(r.value));
      }catch(e){}
      setLoaded(true);
    })();
  },[]);

  useEffect(()=>{
    if(!loaded)return;
    (async()=>{
      try{await window.storage.set(STORAGE_KEY,JSON.stringify(strategies));}catch(e){}
    })();
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
            {label:"Best Performing",value:strategies.sort((a,b)=>b.pnl-a.pnl)[0]?.name||"--",sub:strategies.length?`+$${Math.max(...strategies.map(s=>s.pnl||0))}`:"-",color:B.teal},
            {label:"Least Performing",value:strategies.sort((a,b)=>a.pnl-b.pnl)[0]?.name||"--",sub:strategies.length?`$${Math.min(...strategies.map(s=>s.pnl||0))}`:"-",color:B.loss},
            {label:"Most Active",value:strategies.sort((a,b)=>(b.trades||0)-(a.trades||0))[0]?.name||"--",sub:`${Math.max(...strategies.map(s=>s.trades||0))} trades`,color:B.blue},
            {label:"Best Win Rate",value:strategies.sort((a,b)=>(b.winRate||0)-(a.winRate||0))[0]?.name||"--",sub:`${Math.max(...strategies.map(s=>s.winRate||0))}% WR`,color:B.purple},
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
                    <div style={{fontSize:13,fontWeight:800,fontFamily:"monospace",color:pnlColor(s.pnl||0),whiteSpace:"nowrap"}}>{s.pnl?fmt(s.pnl):"$0"}</div>
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
                    {label:"Total Net P&L",value:sel.pnl?fmt(sel.pnl):"--",color:pnlColor(sel.pnl||0)},
                    {label:"Win Rate",value:sel.winRate!=null?`${sel.winRate}%`:"--",color:B.teal},
                    {label:"Trades",value:sel.trades||"--",color:B.blue},
                    {label:"Avg Winner",value:sel.avgWin?`+$${sel.avgWin}`:"--",color:B.profit},
                    {label:"Avg Loser",value:sel.avgLoss?`-$${sel.avgLoss}`:"--",color:B.loss},
                    {label:"Profit Factor",value:sel.profitFactor||"--",color:B.purple},
                    {label:"Expectancy",value:sel.expectancy?`$${sel.expectancy}`:"--",color:B.spark},
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
            <textarea value={form.rules} onChange={e=>set("rules",e.target.value)} rows={4} style={{...iS,resize:"vertical"}} placeholder="List your specific entry rules, conditions, and checklist items..."/>
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
  const data=sessions.map(s=>{
    const st=trades.filter(t=>t.session===s);
    const wins=st.filter(t=>t.result==="Win");
    const pnl=st.reduce((a,t)=>a+t.pnl,0);
    const wr=st.length?Math.round((wins.length/st.length)*100):0;
    return{session:s,trades:st.length,wins:wins.length,pnl,wr};
  }).filter(s=>s.trades>0);
  const maxPnl=Math.max(...data.map(d=>Math.abs(d.pnl)),1);
  return(
    <div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:20,height:"100%"}}>
      <div style={{fontSize:11,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:16}}>🌡️ Session Heatmap</div>
      <div style={{display:"flex",flexDirection:"column",gap:10}}>
        {data.map(d=>{
          const intensity=Math.abs(d.pnl)/maxPnl;
          const bg=d.pnl>0
            ?`rgba(0,212,168,${0.08+intensity*0.25})`
            :`rgba(240,90,126,${0.08+intensity*0.25})`;
          return(
            <div key={d.session} style={{borderRadius:10,padding:"12px 16px",background:bg,border:`1px solid ${d.pnl>0?B.borderTeal:B.borderPurp}`}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <div>
                  <div style={{fontSize:13,fontWeight:700,color:B.text}}>{d.session} Session</div>
                  <div style={{fontSize:10,color:B.textMuted,marginTop:2}}>{d.trades} trades · {d.wr}% WR</div>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:18,fontWeight:800,fontFamily:"monospace",color:pnlColor(d.pnl)}}>{fmt(d.pnl)}</div>
                  <div style={{fontSize:10,color:B.textMuted}}>{d.wins}W / {d.trades-d.wins}L</div>
                </div>
              </div>
              <div style={{marginTop:8,height:4,background:"rgba(255,255,255,0.05)",borderRadius:2,overflow:"hidden"}}>
                <div style={{height:"100%",width:`${d.wr}%`,background:d.pnl>0?GTB:GBP,borderRadius:2,transition:"width 0.8s"}}/>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Setup Leaderboard ────────────────────────────────────────────────────────
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
function AICoachWidget({trades}){
  const [analysis,setAnalysis]=useState(null);
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
      const data=await res.json();
      if(data.error)throw new Error(data.error);
      setAnalysis(data);
    }catch(e){
      setError("Analysis failed. Please try again.");
      console.error(e);
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
              <div style={{fontSize:32,fontWeight:800,background:GL,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",fontFamily:"monospace"}}>{analysis.overallScore}</div>
              <div style={{fontSize:9,color:B.textMuted,letterSpacing:1}}>/ 100</div>
            </div>
            <div>
              <div style={{fontSize:15,fontWeight:700,color:B.text}}>{analysis.scoreLabel}</div>
              <div style={{fontSize:12,color:B.textMuted,lineHeight:1.5,marginTop:4}}>{analysis.summary}</div>
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

// ── WIDGETS DASHBOARD ────────────────────────────────────────────────────────
function WidgetsDashboard({trades}){
  const [layout,setLayout]=useState([
    {id:"timeofday",  col:0, row:0, w:2, h:1},
    {id:"session",    col:2, row:0, w:1, h:1},
    {id:"leaderboard",col:0, row:1, w:1, h:1},
    {id:"aicoach",    col:1, row:1, w:2, h:2},
  ]);

  const widgetMap={
    timeofday:  <TimeOfDayWidget trades={trades}/>,
    session:    <SessionHeatmapWidget trades={trades}/>,
    leaderboard:<SetupLeaderboardWidget trades={trades}/>,
    aicoach:    <AICoachWidget trades={trades}/>,
  };

  const widgetLabels={
    timeofday:"⏰ Time of Day",
    session:"🌡️ Session Heatmap",
    leaderboard:"🏆 Setup Leaderboard",
    aicoach:"🧠 AI Trade Coach",
  };

  return(
    <div style={{display:"flex",flexDirection:"column",gap:20}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <div style={{fontSize:12,color:B.textMuted}}>Your trading intelligence dashboard — powered by your real trade data</div>
        <div style={{fontSize:11,color:B.textMuted,background:`${B.teal}10`,border:`1px solid ${B.borderTeal}`,borderRadius:20,padding:"4px 12px"}}>
          ✦ AI-Powered
        </div>
      </div>

      {/* 2x2 widget grid */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gridTemplateRows:"auto",gap:16}}>
        <div style={{gridColumn:"1/3",minHeight:280}}>
          <TimeOfDayWidget trades={trades}/>
        </div>
        <div style={{minHeight:280}}>
          <SessionHeatmapWidget trades={trades}/>
        </div>
        <div style={{minHeight:320}}>
          <SetupLeaderboardWidget trades={trades}/>
        </div>
        <div style={{gridColumn:"2/4",minHeight:320}}>
          <AICoachWidget trades={trades}/>
        </div>
      </div>
    </div>
  );
}

// ── Tradovate Date Range Sync Modal ──────────────────────────────────────────
function TradovateSyncModal({onClose, onSync, syncing}){
  const today = new Date().toISOString().slice(0,10);
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10);
  const [fromDate, setFromDate] = useState(firstOfMonth);
  const [toDate, setToDate] = useState(today);
  const [preset, setPreset] = useState("month");

  const applyPreset = (p) => {
    setPreset(p);
    const now = new Date();
    const to = now.toISOString().slice(0,10);
    let from;
    if(p==="today"){
      from = to;
    }else if(p==="week"){
      const d = new Date(now);
      d.setDate(d.getDate() - 7);
      from = d.toISOString().slice(0,10);
    }else if(p==="month"){
      from = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0,10);
    }else if(p==="quarter"){
      from = new Date(now.getFullYear(), Math.floor(now.getMonth()/3)*3, 1).toISOString().slice(0,10);
    }else if(p==="year"){
      from = new Date(now.getFullYear(), 0, 1).toISOString().slice(0,10);
    }else if(p==="all"){
      from = "2020-01-01";
    }
    setFromDate(from);
    setToDate(to);
  };

  const PRESETS = [
    {id:"today", label:"Today"},
    {id:"week",  label:"Last 7 Days"},
    {id:"month", label:"This Month"},
    {id:"quarter",label:"This Quarter"},
    {id:"year",  label:"This Year"},
    {id:"all",   label:"All Time"},
  ];

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.88)",zIndex:200,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(8px)"}}>
      <div style={{background:"#13121A",border:`1px solid ${B.border}`,borderRadius:20,width:480,position:"relative",overflow:"hidden"}}>
        <div style={{height:3,background:GTB,borderRadius:"20px 20px 0 0"}}/>
        
        {/* Header */}
        <div style={{padding:"24px 28px 0",display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
          <div>
            <div style={{fontSize:18,fontWeight:800,color:B.text}}>Sync from Tradovate</div>
            <div style={{fontSize:12,color:B.textMuted,marginTop:3}}>Select the date range to import trades from</div>
          </div>
          <button onClick={onClose} style={{background:"rgba(255,255,255,0.05)",border:`1px solid ${B.border}`,borderRadius:8,color:B.textMuted,cursor:"pointer",fontSize:18,width:32,height:32,display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>
        </div>

        <div style={{padding:"0 28px 28px"}}>
          {/* Quick presets */}
          <div style={{marginBottom:20}}>
            <div style={{fontSize:10,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",marginBottom:10}}>Quick Select</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {PRESETS.map(p=>(
                <button key={p.id} onClick={()=>applyPreset(p.id)} style={{
                  padding:"7px 14px",borderRadius:20,border:"1px solid",cursor:"pointer",fontSize:12,fontWeight:700,
                  borderColor:preset===p.id?B.teal:B.border,
                  background:preset===p.id?`${B.teal}15`:"transparent",
                  color:preset===p.id?B.teal:B.textMuted,
                  transition:"all 0.15s"
                }}>{p.label}</button>
              ))}
            </div>
          </div>

          {/* Custom date range */}
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:24}}>
            <div>
              <label style={lS}>From Date</label>
              <input type="date" value={fromDate} onChange={e=>{setFromDate(e.target.value);setPreset("custom");}} style={iS}/>
            </div>
            <div>
              <label style={lS}>To Date</label>
              <input type="date" value={toDate} onChange={e=>{setToDate(e.target.value);setPreset("custom");}} style={iS}/>
            </div>
          </div>

          {/* Summary */}
          <div style={{padding:"12px 16px",borderRadius:10,background:"rgba(0,0,0,0.3)",border:`1px solid ${B.border}`,marginBottom:20}}>
            <div style={{fontSize:12,color:B.textMuted}}>
              Importing trades from <span style={{color:B.teal,fontWeight:700}}>{fromDate}</span> to <span style={{color:B.teal,fontWeight:700}}>{toDate}</span>
            </div>
            <div style={{fontSize:11,color:B.textMuted,marginTop:4}}>
              Duplicate trades will be skipped automatically
            </div>
          </div>

          {/* Buttons */}
          <div style={{display:"flex",gap:10}}>
            <button onClick={onClose} style={{flex:1,padding:"11px",borderRadius:10,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:13,fontWeight:600}}>Cancel</button>
            <button onClick={()=>onSync(fromDate,toDate)} disabled={syncing} style={{flex:2,padding:"11px",borderRadius:10,border:"none",background:GL,color:"#0E0E10",cursor:syncing?"default":"pointer",fontSize:13,fontWeight:800,opacity:syncing?0.7:1,display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>
              {syncing?(
                <>
                  <div style={{width:14,height:14,border:"2px solid #0E0E10",borderTop:"2px solid transparent",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
                  Syncing...
                </>
              ):"Sync Trades →"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const NAV=[{id:"overview",label:"Overview",icon:"▦"},{id:"journal",label:"Journal",icon:"⊟"},{id:"analytics",label:"Analytics",icon:"◈"},{id:"calendar",label:"Calendar",icon:"⊞"},{id:"widgets",label:"Widgets",icon:"⬡"},{id:"playbooks",label:"Strategies",icon:"⊕"}];

export default function App(){
  const [session,setSession]=useState(null);
  const [active,setActive]=useState("overview");
  const [time,setTime]=useState(new Date());
  const [trades,setTrades]=useState([]);
  const [showForm,setShowForm]=useState(false);
  const [editTrade,setEditTrade]=useState(null);
  const [delTrade,setDelTrade]=useState(null);
  const [showImport,setShowImport]=useState(false);
  const [toast,setToast]=useState(null);
  const [loading,setLoading]=useState(true);
  const [syncStatus,setSyncStatus]=useState("idle");
  const [lastImport,setLastImport]=useState(null); // idle | syncing | connected | error
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
      const{data}=await supabase.from("trades").select("*").order("date",{ascending:false});
      setTrades(data||[]);
      setLoading(false);
    })();
  },[session]);

  // ── Tradovate Auto Sync ────────────────────────────────────────────────────
  const syncTradovate = useCallback(async (fromDate=null, toDate=null) => {
    if (!session) return;
    setSyncStatus("syncing");
    try {
      // Force fresh token to pick up new permissions
      sessionStorage.removeItem("tv_token");
      sessionStorage.removeItem("tv_expiry");
      const token = await getToken();
      if (!token) { setSyncStatus("error"); return; }
      // Pass date range directly to proxy
      const execs = await fetchClosedTrades(token, fromDate, toDate);
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

  // Auto sync every 30 seconds
  useEffect(() => {
    if (!session || loading) return;
    syncTradovate();
    const interval = setInterval(syncTradovate, 30000);
    return () => clearInterval(interval);
  }, [session, loading, syncTradovate]);

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

  const handleImport=async(imported, mode="add")=>{
    if(mode==="replace"){
      // Delete all existing trades first
      await supabase.from("trades").delete().eq("user_id",session.user.id);
    }
    const rows=imported.map(t=>{
      const{id,...rest}=t;
      return{...rest,user_id:session.user.id,day:dayName(t.date)};
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

  const handleManualSync=async(from,to)=>{
    setShowSyncModal(false);
    await syncTradovate(from,to);
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

  return(<div style={{minHeight:"100vh",background:B.bg,fontFamily:"'DM Sans','Segoe UI',sans-serif",color:B.text}}><style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,600;0,9..40,700;0,9..40,800&family=Space+Mono:wght@400;700&display=swap');*{box-sizing:border-box;}body{margin:0;}::-webkit-scrollbar{width:4px;}::-webkit-scrollbar-track{background:transparent;}::-webkit-scrollbar-thumb{background:rgba(0,212,168,0.2);border-radius:2px;}input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.5);}select option{background:#13121A;color:#F0EEF8;}`}</style>
    {toast&&(<div style={{position:"fixed",top:20,right:24,zIndex:200,padding:"12px 20px",borderRadius:10,background:toast.type==="error"?`${B.loss}18`:`${B.teal}15`,border:`1px solid ${toast.type==="error"?`${B.loss}40`:`${B.teal}40`}`,color:toast.type==="error"?B.loss:B.teal,fontWeight:700,fontSize:13,boxShadow:"0 8px 32px rgba(0,0,0,0.5)"}}>{toast.msg}</div>)}
    {showSyncModal&&<TradovateSyncModal onClose={()=>setShowSyncModal(false)} onSync={handleManualSync} syncing={syncStatus==="syncing"}/>}
    {showForm&&<TradeFormModal onClose={()=>{setShowForm(false);setEditTrade(null);}} onSave={handleSave} editTrade={editTrade}/>}
    {showImport&&<ImportModal onClose={()=>setShowImport(false)} onImport={handleImport} existingTrades={trades}/>}
    {delTrade&&<DeleteConfirm trade={delTrade} onConfirm={handleDelete} onCancel={()=>setDelTrade(null)}/>}
    <div style={{position:"fixed",top:0,left:0,bottom:0,width:216,background:"rgba(8,8,10,0.98)",borderRight:`1px solid ${B.border}`,display:"flex",flexDirection:"column",zIndex:10,backdropFilter:"blur(24px)"}}>
      <div style={{padding:"22px 18px 18px",borderBottom:`1px solid ${B.border}`}}><div style={{display:"flex",alignItems:"center",gap:12}}><TCAIcon size={40}/><div><div style={{fontSize:10,fontWeight:800,color:B.text,letterSpacing:1,lineHeight:1.3,textTransform:"uppercase"}}>The Candlestick</div><div style={{fontSize:10,fontWeight:800,color:B.text,letterSpacing:1,lineHeight:1.3,textTransform:"uppercase"}}>Academy</div><div style={{marginTop:4,display:"inline-block",padding:"2px 8px",borderRadius:20,background:GL,fontSize:8,fontWeight:800,letterSpacing:2,color:"#0E0E10"}}>TRADE JOURNAL</div></div></div></div>
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
        <button onClick={()=>supabase.auth.signOut()} style={{marginTop:10,width:"100%",padding:"7px",borderRadius:8,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:11,fontWeight:600}}>Sign Out</button>
      </div>
    </div>
    <div style={{marginLeft:216,padding:"28px 32px",minHeight:"100vh"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
        <div><h1 style={{margin:0,fontSize:20,fontWeight:800,color:B.text,letterSpacing:-0.5}}>{NAV.find(n=>n.id===active)?.label}</h1><div style={{fontSize:12,color:B.textMuted,marginTop:4}}>{session.user.email} - {trades.filter(t=>!t.id?.startsWith("s")).length} trades logged</div></div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {hasSample&&(<button onClick={()=>setTrades([])} style={{padding:"8px 14px",borderRadius:9,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:11,fontWeight:600}}>Clear Sample Data</button>)}
          <button onClick={()=>setShowImport(true)} style={{padding:"8px 16px",borderRadius:9,border:`1px solid ${B.blue}40`,background:`${B.blue}12`,color:B.blue,cursor:"pointer",fontSize:12,fontWeight:700}}>Import CSV</button>
          <button onClick={()=>{setEditTrade(null);setShowForm(true);}} style={{padding:"8px 18px",borderRadius:9,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:12,fontWeight:800}}>+ Log Trade</button>
        </div>
      </div>
      {hasSample&&(<div style={{marginBottom:18,padding:"10px 16px",borderRadius:10,background:"rgba(79,142,247,0.07)",border:"1px solid rgba(79,142,247,0.2)",fontSize:12,color:B.blue,display:"flex",alignItems:"center",justifyContent:"space-between"}}><span>Viewing sample data. Import your Tradovate CSV or log a real trade to get started.</span><button onClick={()=>setTrades([])} style={{background:"none",border:"none",color:B.blue,cursor:"pointer",fontWeight:700,fontSize:12,textDecoration:"underline"}}>Clear it</button></div>)}
      {active==="overview"&&<Overview trades={trades}/>}
      {active==="journal"&&<Journal trades={trades} onEdit={handleEdit} onDelete={setDelTrade}/>}
      {active==="analytics"&&<Analytics trades={trades}/>}
      {active==="calendar"&&<CalendarView trades={trades}/>}
      {active==="widgets"&&<WidgetsDashboard trades={trades}/>}
      {active==="playbooks"&&<PlaybookView/>}
    </div>
  </div>);
}
