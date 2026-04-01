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

async function fetchClosedTrades(token) {
  try {
    const res  = await fetch(`${PROXY}?action=fills&token=${token}`);
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    // Accept all execution types - Tradovate uses "New", "Fill", "Canceled" etc
    // Filter for completed trades only (has realizedPnl or is a fill)
    return data.filter(e =>
      e.execType === "Fill" ||
      e.execType === "New" ||
      (e.ordStatus === "Filled" || e.ordStatus === "PartiallyFilled")
    );
  } catch (e) { return []; }
}

function execToTrade(exec) {
  const rawDate = exec.timestamp || exec.tradeDate || new Date().toISOString();
  const dateStr = new Date(rawDate).toISOString().slice(0, 10);
  // Handle Tradovate contract name formats like "MESH5", "MESM5" etc
  const rawSymbol = exec.name || exec.contractId?.name || exec.symbol || "MES";
  const symbol = rawSymbol.replace(/[FGHJKMNQUVXZ]\d+$/, "").replace(/\d+/g, "").toUpperCase() || "MES";
  const direction = (exec.action === "Sell" || exec.side === "Sell") ? "Short" : "Long";
  const pnl = Math.round((exec.realizedPnl || exec.pnl || 0) * 100) / 100;
  const hr = new Date(rawDate).getHours();
  const qty = exec.qty || exec.cumQty || exec.filledQty || 1;
  const price = exec.price || exec.avgPx || exec.lastPx || 0;
  return {
    date: dateStr,
    instrument: symbol,
    direction,
    contracts: qty,
    entry: price,
    exit: 0,
    pnl,
    rr: "--",
    setup: "Auto-synced",
    grade: "B",
    notes: `Tradovate auto-sync | ${rawSymbol}`,
    session: hr < 10 ? "AM" : hr < 13 ? "Mid" : "PM",
    result: pnl >= 0 ? "Win" : "Loss",
    tradovate_id: String(exec.id),
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

function ImportModal({onClose,onImport}){
  const [step,setStep]=useState("upload");const [parsed,setParsed]=useState([]);const [error,setError]=useState("");const [drag,setDrag]=useState(false);const ref=useRef();
  const handle=(file)=>{if(!file)return;setError("");const r=new FileReader();r.onload=(e)=>{try{const t=e.target.result;let tr=parseTradovateCSV(t);if(tr.length===0)tr=parseGenericCSV(t);if(tr.length===0){setError("No valid trades found.");return;}setParsed(tr);setStep("preview");}catch(err){setError("Failed to parse: "+err.message);}};r.readAsText(file);};
  return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center",backdropFilter:"blur(6px)"}}><div style={{background:"#13121A",border:`1px solid ${B.border}`,borderRadius:18,padding:32,width:620,maxHeight:"85vh",overflowY:"auto"}}><div style={{height:3,background:GL,borderRadius:3,marginBottom:24}}/><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}><div><div style={{fontSize:18,fontWeight:800,color:B.text}}>Import Trades</div><div style={{fontSize:12,color:B.textMuted,marginTop:3}}>Tradovate, Apex, Rithmic, or generic CSV</div></div><button onClick={onClose} style={{background:"none",border:"none",color:B.textMuted,cursor:"pointer",fontSize:22}}>x</button></div>{step==="upload"&&(<><div onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);handle(e.dataTransfer.files[0]);}} onClick={()=>ref.current.click()} style={{border:`2px dashed ${drag?B.teal:B.border}`,borderRadius:14,padding:"48px 24px",textAlign:"center",cursor:"pointer",background:drag?`${B.teal}08`:"rgba(0,0,0,0.2)"}}><div style={{fontSize:36,marginBottom:12}}>📁</div><div style={{fontSize:14,fontWeight:700,color:B.text,marginBottom:6}}>Drop your CSV file here</div><div style={{fontSize:12,color:B.textMuted}}>or click to browse</div><input ref={ref} type="file" accept=".csv,.txt" style={{display:"none"}} onChange={e=>handle(e.target.files[0])}/></div>{error&&<div style={{marginTop:12,padding:"10px 14px",borderRadius:8,background:"rgba(240,90,126,0.1)",border:"1px solid rgba(240,90,126,0.3)",color:B.loss,fontSize:12}}>{error}</div>}</>)}{step==="preview"&&(<><div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}><div style={{fontSize:13,color:B.textMuted}}><span style={{color:B.teal,fontWeight:700}}>{parsed.length}</span> trades ready</div><button onClick={()=>setStep("upload")} style={{fontSize:11,color:B.textMuted,background:"none",border:"none",cursor:"pointer"}}>Back</button></div><div style={{maxHeight:300,overflowY:"auto",borderRadius:10,border:`1px solid ${B.border}`}}><div style={{display:"grid",gridTemplateColumns:"90px 70px 60px 70px 80px 1fr",padding:"8px 14px",fontSize:10,color:B.textMuted,letterSpacing:1.5,textTransform:"uppercase",borderBottom:`1px solid ${B.border}`,background:"rgba(0,0,0,0.4)",position:"sticky",top:0}}>{["Date","Symbol","Dir","Qty","P&L","Setup"].map(h=><div key={h}>{h}</div>)}</div>{parsed.map((t,i)=>(<div key={i} style={{display:"grid",gridTemplateColumns:"90px 70px 60px 70px 80px 1fr",padding:"10px 14px",borderBottom:`1px solid ${B.border}`,fontSize:12,borderLeft:`2px solid ${t.pnl>=0?B.teal:B.loss}`}}><div style={{color:B.textMuted}}>{t.date}</div><div style={{color:INST_COLOR[t.instrument]||B.teal,fontWeight:700}}>{t.instrument}</div><div style={{color:t.direction==="Long"?"#4ade80":"#f87171"}}>{t.direction}</div><div style={{color:B.textMuted}}>{t.contracts}</div><div style={{color:pnlColor(t.pnl),fontWeight:700,fontFamily:"monospace"}}>{fmt(t.pnl)}</div><div style={{color:B.textMuted}}>{t.setup}</div></div>))}</div><div style={{display:"flex",gap:10,marginTop:20,justifyContent:"flex-end"}}><button onClick={onClose} style={{padding:"10px 22px",borderRadius:10,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontSize:13,fontWeight:600}}>Cancel</button><button onClick={()=>{onImport(parsed);onClose();}} style={{padding:"10px 28px",borderRadius:10,border:"none",background:GL,color:"#0E0E10",cursor:"pointer",fontSize:13,fontWeight:800}}>Import {parsed.length} Trades</button></div></>)}</div></div>);
}

function DeleteConfirm({trade,onConfirm,onCancel}){return(<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:110,display:"flex",alignItems:"center",justifyContent:"center"}}><div style={{background:"#13121A",border:"1px solid rgba(240,90,126,0.3)",borderRadius:16,padding:28,width:360,textAlign:"center"}}><div style={{fontSize:16,fontWeight:700,color:B.text,marginBottom:8}}>Delete Trade?</div><div style={{fontSize:13,color:B.textMuted,marginBottom:6}}>{trade.date} - {trade.instrument} - {trade.direction}</div><div style={{fontSize:15,fontWeight:700,fontFamily:"monospace",color:pnlColor(trade.pnl),marginBottom:20}}>{fmt(trade.pnl)}</div><div style={{display:"flex",gap:10,justifyContent:"center"}}><button onClick={onCancel} style={{padding:"9px 22px",borderRadius:9,border:`1px solid ${B.border}`,background:"transparent",color:B.textMuted,cursor:"pointer",fontWeight:600}}>Cancel</button><button onClick={onConfirm} style={{padding:"9px 22px",borderRadius:9,background:"rgba(240,90,126,0.15)",color:B.loss,cursor:"pointer",fontWeight:700,border:"1px solid rgba(240,90,126,0.3)"}}>Delete</button></div></div></div>);}

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

  // Calendar
  const calMap=buildCalendar(trades);
  const allDates=trades.map(t=>t.date).sort();
  const ld=allDates[allDates.length-1]||new Date().toISOString().slice(0,10);
  const yr=parseInt(ld.slice(0,4)),mo=parseInt(ld.slice(5,7))-1;
  const mn=new Date(yr,mo,1).toLocaleString("default",{month:"long",year:"numeric"}).toUpperCase();
  const fd=new Date(yr,mo,1).getDay(),dim=new Date(yr,mo+1,0).getDate();
  const cells=[];for(let i=0;i<fd;i++)cells.push(null);for(let d=1;d<=dim;d++)cells.push(d);
  const weeks=[];for(let i=0;i<cells.length;i+=7)weeks.push(cells.slice(i,i+7));
  const calDays=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

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
        <div style={{fontSize:28,fontWeight:800,background:GTB,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",fontFamily:"'Space Mono',monospace",letterSpacing:-1}}>{fmt(totalPnl)}</div>
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
          <span style={{fontSize:13,fontWeight:800,background:GL,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",letterSpacing:3}}>{mn}</span>
          <div style={{display:"flex",gap:16,fontSize:11,color:B.textMuted}}>
            <span><span style={{color:B.profit,fontWeight:700}}>{greenDays}</span> green</span>
            <span><span style={{color:B.loss,fontWeight:700}}>{tradeDays.length-greenDays}</span> red</span>
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
                <div key={di} style={{
                  minHeight:68,borderRadius:10,padding:"8px 10px",
                  background:data?(data.pnl>0?`${B.teal}10`:`${B.loss}10`):"rgba(255,255,255,0.01)",
                  border:`1px solid ${data?(data.pnl>0?`${B.teal}35`:`${B.loss}35`):B.border}`,
                  outline:isToday?`2px solid ${B.blue}60`:"none",
                  cursor:data?"pointer":"default",transition:"all 0.15s"
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

function CalendarView({trades}){
  const calMap=buildCalendar(trades);
  const allDates=trades.map(t=>t.date).sort();
  const ld=allDates[allDates.length-1]||new Date().toISOString().slice(0,10);
  const yr=parseInt(ld.slice(0,4)),mo=parseInt(ld.slice(5,7))-1;
  const mn=new Date(yr,mo,1).toLocaleString("default",{month:"long",year:"numeric"}).toUpperCase();
  const fd=new Date(yr,mo,1).getDay(),dim=new Date(yr,mo+1,0).getDate();
  const cells=[];for(let i=0;i<fd;i++)cells.push(null);for(let d=1;d<=dim;d++)cells.push(d);
  const weeks=[];for(let i=0;i<cells.length;i+=7)weeks.push(cells.slice(i,i+7));
  const calDays=["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const vals=Object.values(calMap);
  return(<div style={{display:"flex",flexDirection:"column",gap:20}}><div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:14}}><StatCard label="Green Days" value={vals.filter(d=>d.pnl>0).length} accent={B.profit} sub="Profitable days"/><StatCard label="Red Days" value={vals.filter(d=>d.pnl<0).length} accent={B.loss} sub="Losing days"/><StatCard label="Best Day" value={vals.length?fmt(Math.max(...vals.map(d=>d.pnl))):"--"} grad={GTB} accent={B.teal} sub="Single day high"/><StatCard label="Worst Day" value={vals.length?fmt(Math.min(...vals.map(d=>d.pnl))):"--"} accent="#f97316" sub="Single day low"/></div><div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:26}}><div style={{textAlign:"center",marginBottom:22}}><span style={{fontSize:14,fontWeight:800,background:GL,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",letterSpacing:4}}>{mn}</span></div><div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:8,marginBottom:10}}>{calDays.map(d=><div key={d} style={{textAlign:"center",fontSize:10,color:B.textMuted,letterSpacing:1.5}}>{d}</div>)}</div>{weeks.map((w,wi)=>(<div key={wi} style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:8,marginBottom:8}}>{w.map((day,di)=>{if(!day)return <div key={di}/>;const ds=`${yr}-${String(mo+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;const data=calMap[ds];return(<div key={di} style={{minHeight:72,borderRadius:10,padding:10,background:data?(data.pnl>0?`${B.teal}0C`:`${B.loss}0C`):"rgba(255,255,255,0.01)",border:`1px solid ${data?(data.pnl>0?`${B.teal}30`:`${B.loss}30`):B.border}`,cursor:data?"pointer":"default"}}><div style={{fontSize:12,color:data?B.text:B.textDim,fontWeight:700,marginBottom:5}}>{day}</div>{data&&<><div style={{fontSize:13,fontWeight:800,fontFamily:"monospace",color:pnlColor(data.pnl),lineHeight:1}}>{fmt(data.pnl)}</div><div style={{fontSize:9,color:B.textMuted,marginTop:4}}>{data.count} trade{data.count>1?"s":""}</div></>}</div>);})}</div>))}</div></div>);
}

function PlaybookView(){
  const [sel,setSel]=useState(null);const grads=[GL,GTB,GBP,GTB,GL];
  return(<div style={{display:"flex",gap:16}}><div style={{display:"flex",flexDirection:"column",gap:10,width:272,flexShrink:0}}>{PLAYBOOKS.map((pb,i)=>(<div key={pb.id} onClick={()=>setSel(pb)} style={{padding:"16px 18px",borderRadius:12,cursor:"pointer",background:sel?.id===pb.id?`${B.teal}07`:B.surface,border:`1px solid ${sel?.id===pb.id?`${B.teal}40`:B.border}`,borderLeft:`3px solid ${sel?.id===pb.id?B.teal:"transparent"}`,transition:"all 0.15s"}}><div style={{fontSize:13,fontWeight:700,color:B.text,marginBottom:8}}>{pb.name}</div><div style={{display:"flex",gap:5,marginBottom:8}}>{pb.instruments.map(i=>(<span key={i} style={{fontSize:10,padding:"2px 7px",borderRadius:5,background:`${B.purple}20`,color:B.purple,fontWeight:700}}>{i}</span>))}</div><div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:13,fontWeight:800,background:grads[i],WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>{pb.winRate}% WR</span><span style={{fontSize:11,color:B.textMuted}}>{pb.avgRR} avg</span></div></div>))}</div><div style={{flex:1}}>{sel?(<div style={{background:B.surface,border:`1px solid ${B.border}`,borderRadius:14,padding:30}}><div style={{height:3,background:GL,borderRadius:3,marginBottom:26}}/><div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:24}}><div><div style={{fontSize:22,fontWeight:800,color:B.text,marginBottom:10}}>{sel.name}</div><div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{sel.tags.map(t=><Tag key={t} label={t}/>)}</div></div><div style={{display:"flex",gap:10}}>{[{l:"WIN RATE",v:`${sel.winRate}%`,g:GTB,b:B.borderTeal},{l:"AVG R:R",v:sel.avgRR,g:GBP,b:B.borderPurp},{l:"TRADES",v:sel.trades,g:GL,b:"rgba(79,142,247,0.25)"}].map(s=>(<div key={s.l} style={{textAlign:"center",borderRadius:12,padding:"14px 20px",background:"rgba(0,0,0,0.4)",border:`1px solid ${s.b}`}}><div style={{fontSize:26,fontWeight:800,background:s.g,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent",fontFamily:"monospace"}}>{s.v}</div><div style={{fontSize:9,color:B.textMuted,letterSpacing:1.5,marginTop:4}}>{s.l}</div></div>))}</div></div><div style={{background:"rgba(0,0,0,0.35)",borderRadius:12,padding:20,marginBottom:22,border:`1px solid ${B.border}`}}><div style={{fontSize:10,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:10}}>Setup Description</div><p style={{fontSize:14,color:"#C8C4D8",lineHeight:1.8,margin:0}}>{sel.description}</p></div><div style={{fontSize:10,color:B.textMuted,letterSpacing:2,textTransform:"uppercase",marginBottom:12}}>Instruments</div><div style={{display:"flex",gap:8}}>{sel.instruments.map(i=>(<div key={i} style={{padding:"10px 22px",borderRadius:10,background:`${B.purple}14`,border:`1px solid ${B.borderPurp}`,color:B.purple,fontWeight:800,fontSize:14}}>{i}</div>))}</div></div>):(<div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",height:320,gap:14}}><TCAIcon size={52}/><div style={{fontSize:13,color:B.textMuted}}>Select a playbook to view details</div></div>)}</div></div>);
}

const NAV=[{id:"overview",label:"Overview",icon:"▦"},{id:"journal",label:"Journal",icon:"⊟"},{id:"analytics",label:"Analytics",icon:"◈"},{id:"calendar",label:"Calendar",icon:"⊞"},{id:"playbooks",label:"Playbooks",icon:"⊕"}];

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
  const [syncStatus,setSyncStatus]=useState("idle"); // idle | syncing | connected | error

  useEffect(()=>{
    supabase.auth.getSession().then(({data})=>setSession(data.session));
    const{data:listener}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s));
    return()=>listener.subscription.unsubscribe();
  },[]);

  useEffect(()=>{
    if(!session){setLoading(false);return;}
    (async()=>{
      const{data}=await supabase.from("trades").select("*").order("date",{ascending:false});
      setTrades(data?.length>0?data:SAMPLE);
      setLoading(false);
    })();
  },[session]);

  // ── Tradovate Auto Sync ────────────────────────────────────────────────────
  const syncTradovate = useCallback(async () => {
    if (!session) return;
    setSyncStatus("syncing");
    try {
      const token = await getToken();
      if (!token) { setSyncStatus("error"); return; }
      const execs = await fetchClosedTrades(token);
      if (!execs.length) { setSyncStatus("connected"); return; }

      // Get existing tradovate_ids to avoid duplicates
      const { data: existing } = await supabase
        .from("trades")
        .select("tradovate_id")
        .eq("user_id", session.user.id)
        .not("tradovate_id", "is", null);

      const existingIds = new Set((existing || []).map(e => e.tradovate_id));
      const newExecs = execs.filter(e => !existingIds.has(String(e.id)));

      if (newExecs.length > 0) {
        const newTrades = newExecs.map(e => ({
          ...execToTrade(e),
          user_id: session.user.id,
          day: dayName(execToTrade(e).date),
        }));
        const { data } = await supabase.from("trades").insert(newTrades).select();
        if (data?.length) {
          setTrades(ts => [...(ts.filter(t => !t.id?.startsWith("s"))), ...data]);
          showT(`${data.length} new trade${data.length > 1 ? "s" : ""} synced from Tradovate`);
        }
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

  const handleImport=async(imported)=>{
    const rows=imported.map(t=>({...t,user_id:session.user.id,day:dayName(t.date)}));
    const{data}=await supabase.from("trades").insert(rows).select();
    setTrades(ts=>[...(ts.filter(t=>!t.id?.startsWith("s"))),...(data||rows)]);
    showT(`${imported.length} trades imported`);
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
    {showForm&&<TradeFormModal onClose={()=>{setShowForm(false);setEditTrade(null);}} onSave={handleSave} editTrade={editTrade}/>}
    {showImport&&<ImportModal onClose={()=>setShowImport(false)} onImport={handleImport}/>}
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
          <button onClick={syncTradovate} style={{marginLeft:"auto",background:"none",border:"none",color:B.textMuted,cursor:"pointer",fontSize:10,padding:0}}>↻</button>
        </div>
        <div style={{marginTop:10,padding:"12px 14px",borderRadius:10,background:`${B.teal}08`,border:`1px solid ${B.teal}22`,position:"relative",overflow:"hidden"}}><div style={{position:"absolute",top:0,left:0,right:0,height:2,background:GTB}}/><div style={{fontSize:9,color:B.textMuted,marginBottom:3,letterSpacing:1}}>MONTH P&L</div><div style={{fontSize:20,fontWeight:800,fontFamily:"monospace",background:GTB,WebkitBackgroundClip:"text",WebkitTextFillColor:"transparent"}}>{fmt(totalPnl)}</div></div>
        <div style={{marginTop:10,fontSize:10,color:B.textMuted,textAlign:"center"}}>{trades.filter(t=>!t.id?.startsWith("s")).length} trades logged</div>
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
      {active==="playbooks"&&<PlaybookView/>}
    </div>
  </div>);
}
