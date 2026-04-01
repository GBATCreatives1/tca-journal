export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const TV_URL = "https://live.tradovateapi.com/v1";
  const { action } = req.query;

  try {
    // ── AUTH ──────────────────────────────────────────────────────────────────
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
      const response = await fetch(`${TV_URL}/auth/accesstokenrequest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      console.log("Auth:", data.accessToken ? "SUCCESS" : data.errorText);
      return res.status(200).json(data);
    }

    // ── FILLS ─────────────────────────────────────────────────────────────────
    if (action === "fills") {
      const { token, from, to } = req.query;
      if (!token) return res.status(401).json({ error: "No token" });

      console.log("Sync range:", from, "to", to);

      // Get contract library to resolve contractId → symbol
      const contractRes = await fetch(`${TV_URL}/contract/list`, {
        headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
      });
      const contracts = await contractRes.json();
      const contractMap = {};
      if (Array.isArray(contracts)) {
        contracts.forEach(c => {
          contractMap[c.id] = c.name || c.id;
        });
      }
      console.log("Contracts loaded:", Object.keys(contractMap).length);

      // Get ALL orders
      const ordersRes = await fetch(`${TV_URL}/order/list`, {
        headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
      });
      const orders = await ordersRes.json();
      const allOrders = Array.isArray(orders) ? orders : [];
      console.log("Total orders:", allOrders.length);

      // Get execution reports to find prices for filled orders
      const execRes = await fetch(`${TV_URL}/executionreport/list`, {
        headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
      });
      const execs = await execRes.json();
      const allExecs = Array.isArray(execs) ? execs : [];
      console.log("Total execs:", allExecs.length);

      // Build a price map: orderId → { price, qty, action, timestamp, contractId }
      // Use execution reports to get fill prices (avgPx field)
      const orderPriceMap = {};
      allExecs.forEach(e => {
        const oid = e.orderId;
        if (!oid) return;
        // Only use execs that have a price (avgPx > 0)
        const px = e.avgPx || e.price || 0;
        if (px > 0 && !orderPriceMap[oid]) {
          orderPriceMap[oid] = {
            price: px,
            qty: e.cumQty || e.qty || 1,
            action: e.action,
            timestamp: e.timestamp,
            contractId: e.contractId,
          };
        }
      });

      // Also grab prices from filled orders themselves
      allOrders.forEach(o => {
        if ((o.ordStatus === "Filled" || o.ordStatus === "PartiallyFilled") && !orderPriceMap[o.id]) {
          const px = o.avgPx || o.avgPrice || o.price || 0;
          if (px > 0) {
            orderPriceMap[o.id] = {
              price: px,
              qty: o.filledQty || o.cumQty || o.qty || 1,
              action: o.action,
              timestamp: o.timestamp,
              contractId: o.contractId,
            };
          }
        }
      });

      console.log("Orders with prices:", Object.keys(orderPriceMap).length);
      if (Object.keys(orderPriceMap).length > 0) {
        const sample = Object.entries(orderPriceMap)[0];
        console.log("Price map sample:", JSON.stringify(sample));
      }

      // Tick value lookup
      const TICK_VAL = { MES: 1.25, ES: 12.5, MNQ: 0.5, NQ: 5, MYM: 0.5, YM: 5, MGC: 10 };

      // Group filled orders by contractId and date to pair entries/exits
      const byContract = {};
      Object.entries(orderPriceMap).forEach(([orderId, info]) => {
        const key = `${info.contractId}`;
        if (!byContract[key]) byContract[key] = [];
        byContract[key].push({ orderId, ...info });
      });

      // Sort each contract's orders by timestamp and pair them
      const trades = [];
      Object.entries(byContract).forEach(([contractId, orderList]) => {
        const sorted = orderList.sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
        const used = new Set();
        const contractName = contractMap[contractId] || "MES";
        const product = contractName.replace(/[FGHJKMNQUVXZ]\d+$/, "").replace(/\d+/g, "").toUpperCase() || "MES";
        const tv = TICK_VAL[product] || 1.25;

        sorted.forEach((entry, i) => {
          if (used.has(entry.orderId)) return;

          // Find the matching exit (opposite action, same contract, after entry)
          const exitOrder = sorted.find((o, j) => {
            if (j <= i) return false;
            if (used.has(o.orderId)) return false;
            return o.action !== entry.action;
          });

          if (!exitOrder) return;

          used.add(entry.orderId);
          used.add(exitOrder.orderId);

          const entryDate = entry.timestamp ? new Date(entry.timestamp).toISOString().slice(0,10) : null;
          if (!entryDate) return;

          // Apply date filter
          if (from && entryDate < from) return;
          if (to && entryDate > to) return;

          const isLong = entry.action === "Buy";
          const entryPx = entry.price;
          const exitPx = exitOrder.price;
          const qty = Math.min(entry.qty, exitOrder.qty);
          const pts = isLong ? exitPx - entryPx : entryPx - exitPx;
          const pnl = Math.round((pts / 0.25) * tv * qty * 100) / 100;
          const hr = new Date(entry.timestamp).getHours();

          console.log(`Trade: ${product} ${isLong?"Long":"Short"} ${qty}x @ ${entryPx} → ${exitPx} = $${pnl}`);

          trades.push({
            tradovate_id: `${entry.orderId}_${exitOrder.orderId}`,
            date: entryDate,
            instrument: product,
            direction: isLong ? "Long" : "Short",
            contracts: qty,
            entry: entryPx,
            exit: exitPx,
            pnl,
            rr: "--",
            setup: "Auto-synced",
            grade: "B",
            notes: `${contractName} | ${isLong?"Long":"Short"} | Entry: ${entryPx} → Exit: ${exitPx}`,
            session: hr < 10 ? "AM" : hr < 13 ? "Mid" : hr < 16 ? "PM" : "After",
            result: pnl >= 0 ? "Win" : "Loss",
          });
        });
      });

      console.log("Round-trip trades built:", trades.length);
      return res.status(200).json(trades);
    }

    return res.status(400).json({ error: "Unknown action" });
  } catch (err) {
    console.error("Proxy error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
