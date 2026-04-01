export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const TV_URL = "https://live.tradovateapi.com/v1";
  const { action } = req.query;

  try {
    // ── AUTH ────────────────────────────────────────────────────────────────
    if (action === "auth") {
      const body = {
        name:       process.env.VITE_TV_USERNAME,
        password:   process.env.VITE_TV_PASSWORD,
        appId:      "TCA Journal",
        appVersion: "0.0.1",
        deviceId:   process.env.VITE_TV_DEVICE_ID,
        cid:        parseInt(process.env.VITE_TV_CID),
        sec:        process.env.VITE_TV_SECRET,
      };
      const r = await fetch(`${TV_URL}/auth/accesstokenrequest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      console.log("Auth:", data.accessToken ? "SUCCESS" : data.errorText);
      return res.status(200).json(data);
    }

    // ── FILLS ──────────────────────────────────────────────────────────────
    if (action === "fills") {
      const { token, from, to } = req.query;
      if (!token) return res.status(401).json({ error: "No token" });

      console.log("Fetching trades for range:", from, "→", to);

      // Step 1: Get contract names
      const contractMap = {};
      try {
        const cr = await fetch(`${TV_URL}/contract/list`, {
          headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
        });
        const contracts = await cr.json();
        if (Array.isArray(contracts)) {
          contracts.forEach(c => { contractMap[c.id] = c.name || ""; });
        }
        console.log("Contracts:", Object.keys(contractMap).length);
      } catch(e) { console.log("Contract fetch failed:", e.message); }

      // Step 2: Get execution reports - these have orderId + action + cumQty + avgPx
      const execMap = {}; // orderId -> exec data
      try {
        const er = await fetch(`${TV_URL}/executionreport/list`, {
          headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
        });
        const execs = await er.json();
        if (Array.isArray(execs)) {
          console.log("Execution reports:", execs.length);
          execs.forEach(e => {
            const px = e.avgPx || e.price || 0;
            const qty = e.cumQty || e.qty || 0;
            if (px > 0 && qty > 0) {
              execMap[e.orderId] = {
                price: px, qty, action: e.action,
                timestamp: e.timestamp, contractId: e.contractId,
                contractName: contractMap[e.contractId] || "",
                execId: e.id,
              };
            }
          });
          console.log("Execs with prices:", Object.keys(execMap).length);
          if (Object.keys(execMap).length > 0) {
            console.log("Exec sample:", JSON.stringify(Object.values(execMap)[0]));
          }
        }
      } catch(e) { console.log("Exec fetch failed:", e.message); }

      // Step 3: Get orders for any missing price data
      try {
        const or = await fetch(`${TV_URL}/order/list`, {
          headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
        });
        const orders = await or.json();
        if (Array.isArray(orders)) {
          console.log("Orders:", orders.length);
          orders.forEach(o => {
            if (!execMap[o.id]) {
              const px = o.avgPx || o.avgPrice || o.price || 0;
              const qty = o.filledQty || o.cumQty || o.qty || 0;
              if (px > 0 && qty > 0 && (o.ordStatus === "Filled" || o.ordStatus === "PartiallyFilled")) {
                execMap[o.id] = {
                  price: px, qty, action: o.action,
                  timestamp: o.timestamp, contractId: o.contractId,
                  contractName: contractMap[o.contractId] || "",
                  execId: o.id,
                };
              }
            }
          });
        }
      } catch(e) { console.log("Order fetch failed:", e.message); }

      console.log("Total fills with prices:", Object.keys(execMap).length);

      if (Object.keys(execMap).length === 0) {
        console.log("No priced fills found — API may not have historical data without reports permission");
        return res.status(200).json([]);
      }

      // Step 4: Group by contractId, sort by time, pair entries and exits
      const TICK_VAL = { MES: 1.25, ES: 12.5, MNQ: 0.5, NQ: 5, MYM: 0.5, YM: 5, MGC: 10 };
      const byContract = {};

      Object.values(execMap).forEach(e => {
        const key = String(e.contractId);
        if (!byContract[key]) byContract[key] = [];
        byContract[key].push(e);
      });

      const trades = [];
      const usedIds = new Set();

      Object.entries(byContract).forEach(([contractId, fills]) => {
        const sorted = fills.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        const contractName = sorted[0]?.contractName || "";
        const product = contractName.replace(/[FGHJKMNQUVXZ]\d+$/, "").replace(/\d+/g, "").toUpperCase() || "MES";
        const tv = TICK_VAL[product] || 1.25;

        sorted.forEach((entry, i) => {
          if (usedIds.has(entry.execId)) return;

          // Find matching exit: opposite action, same contract, not yet used
          const exit = sorted.find((o, j) => {
            if (j <= i) return false;
            if (usedIds.has(o.execId)) return false;
            return o.action !== entry.action;
          });

          if (!exit) return;

          usedIds.add(entry.execId);
          usedIds.add(exit.execId);

          const dateStr = new Date(entry.timestamp).toISOString().slice(0, 10);

          // Apply date filter
          if (from && dateStr < from) return;
          if (to && dateStr > to) return;

          const isLong = entry.action === "Buy";
          const entryPx = entry.price;
          const exitPx = exit.price;
          const qty = Math.min(entry.qty, exit.qty);
          const pts = isLong ? exitPx - entryPx : entryPx - exitPx;
          const pnl = Math.round((pts / 0.25) * tv * qty * 100) / 100;
          const hr = new Date(entry.timestamp).getHours();

          console.log(`Trade: ${product} ${isLong?"L":"S"} ${qty}x ${entryPx}→${exitPx} = $${pnl} on ${dateStr}`);

          trades.push({
            tradovate_id: `${entry.execId}_${exit.execId}`,
            date: dateStr,
            instrument: product,
            direction: isLong ? "Long" : "Short",
            contracts: qty,
            entry: entryPx,
            exit: exitPx,
            pnl,
            rr: "--",
            setup: "Auto-synced",
            grade: "B",
            notes: `${contractName} | ${isLong?"Long":"Short"} | ${entryPx}→${exitPx}`,
            session: hr < 10 ? "AM" : hr < 13 ? "Mid" : hr < 16 ? "PM" : "After",
            result: pnl >= 0 ? "Win" : "Loss",
          });
        });
      });

      console.log("Total round-trip trades:", trades.length);
      return res.status(200).json(trades);
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    console.error("Proxy error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
