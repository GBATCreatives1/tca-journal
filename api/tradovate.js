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
      console.log("Auth attempt for:", body.name);
      const response = await fetch(`${TV_URL}/auth/accesstokenrequest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "accept": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      console.log("Auth result:", data.accessToken ? "SUCCESS" : data.errorText);
      if (data.accessToken) {
        // Decode and log the ACL so we can see permissions
        try {
          const payload = JSON.parse(Buffer.from(data.accessToken.split('.')[1], 'base64').toString());
          const acl = JSON.parse(payload.acl || '{}');
          console.log("Token permissions - reports:", JSON.stringify(acl.reports));
          console.log("Token permissions - entries:", JSON.stringify(acl.entries));
        } catch(e) {}
      }
      return res.status(200).json(data);
    }

    // ── FILLS / TRADE HISTORY ─────────────────────────────────────────────────
    if (action === "fills") {
      const { token, from, to } = req.query;
      if (!token) return res.status(401).json({ error: "No token" });

      console.log("Fetching trade history, date range:", from, "to", to);

      // Get account ID
      const accountRes = await fetch(`${TV_URL}/account/list`, {
        headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
      });
      const accounts = await accountRes.json();
      const accountId = Array.isArray(accounts) && accounts[0]?.id;
      console.log("Account ID:", accountId);

      if (!accountId) return res.status(200).json([]);

      // Strategy: Use order/list then fetch each filled order's execution details
      // to get avgPrice and filledQty
      const ordersRes = await fetch(`${TV_URL}/order/list`, {
        headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
      });
      const orders = await ordersRes.json();
      console.log("Total orders:", Array.isArray(orders) ? orders.length : 0);

      // Get filled orders
      const filledOrders = Array.isArray(orders)
        ? orders.filter(o => o.ordStatus === "Filled" || o.ordStatus === "PartiallyFilled")
        : [];
      console.log("Filled orders:", filledOrders.length);

      // For each filled order, get the execution report to get price
      const execRes = await fetch(`${TV_URL}/executionreport/list`, {
        headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
      });
      const execs = Array.isArray(await execRes.json()) ? await execRes.json() : [];

      // Try to get fills via the fill endpoint (requires reports permission)
      let fills = [];
      try {
        const fillRes = await fetch(`${TV_URL}/fill/list`, {
          headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
        });
        const fillData = await fillRes.json();
        fills = Array.isArray(fillData) ? fillData : [];
        console.log("Fills from fill/list:", fills.length);
        if (fills.length > 0) console.log("Fill sample:", JSON.stringify(fills[0]).slice(0, 400));
      } catch(e) {
        console.log("fill/list failed:", e.message);
      }

      // Try order/items for detailed order info including avgPrice
      let orderItems = [];
      try {
        const itemsRes = await fetch(`${TV_URL}/order/items`, {
          headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
        });
        const itemsData = await itemsRes.json();
        orderItems = Array.isArray(itemsData) ? itemsData : [];
        console.log("Order items:", orderItems.length);
        if (orderItems.length > 0) console.log("Order item sample:", JSON.stringify(orderItems[0]).slice(0, 400));
      } catch(e) {
        console.log("order/items failed:", e.message);
      }

      // Try the tradovate performance endpoint if available
      let performance = [];
      try {
        const perfRes = await fetch(`${TV_URL}/account/cashflow?accountId=${accountId}`, {
          headers: { Authorization: `Bearer ${token}`, accept: "application/json" },
        });
        const perfData = await perfRes.json();
        console.log("Cashflow response:", JSON.stringify(perfData).slice(0, 300));
      } catch(e) {
        console.log("cashflow failed:", e.message);
      }

      // Build trades from what we have
      // Match filled orders with execution reports to get prices
      const trades = [];
      const TICK_VAL = { MES: 1.25, ES: 12.5, MNQ: 0.5, NQ: 5, MYM: 0.5, YM: 5, MGC: 10 };

      // Group execs by orderId to find entry/exit pairs
      const execsByOrder = {};
      execs.forEach(e => {
        if (!execsByOrder[e.orderId]) execsByOrder[e.orderId] = [];
        execsByOrder[e.orderId].push(e);
      });

      // Use fills if we have them (most accurate)
      if (fills.length > 0) {
        // Match buy fills with sell fills to create round-trip trades
        const buyFills = fills.filter(f => f.action === "Buy");
        const sellFills = fills.filter(f => f.action === "Sell");
        console.log("Buy fills:", buyFills.length, "Sell fills:", sellFills.length);

        // Pair them up
        const used = new Set();
        buyFills.forEach((bf, i) => {
          if (used.has(bf.id)) return;
          // Find matching sell fill for same contract
          const sf = sellFills.find(s => !used.has(s.id) && s.contractId === bf.contractId);
          if (!sf) return;
          used.add(bf.id); used.add(sf.id);

          const rawDate = bf.timestamp || sf.timestamp;
          const dateStr = new Date(rawDate).toISOString().slice(0, 10);
          const hr = new Date(rawDate).getHours();

          // Determine direction: if buy happened first = Long, else Short
          const isLong = new Date(bf.timestamp) <= new Date(sf.timestamp);
          const entry = isLong ? bf.price : sf.price;
          const exit = isLong ? sf.price : bf.price;
          const qty = Math.min(bf.qty || 1, sf.qty || 1);

          // Get product name
          const contractName = bf.contractName || sf.contractName || "MES";
          const product = contractName.replace(/[FGHJKMNQUVXZ]\d+$/, "").replace(/\d+/g, "").toUpperCase() || "MES";
          const tv = TICK_VAL[product] || 1.25;
          const pnl = isLong
            ? Math.round(((exit - entry) / 0.25) * tv * qty * 100) / 100
            : Math.round(((entry - exit) / 0.25) * tv * qty * 100) / 100;

          // Apply date filter
          if (from && dateStr < from) return;
          if (to && dateStr > to) return;

          trades.push({
            tradovate_id: `${bf.id}_${sf.id}`,
            date: dateStr,
            instrument: product,
            direction: isLong ? "Long" : "Short",
            contracts: qty,
            entry,
            exit,
            pnl,
            rr: "--",
            setup: "Auto-synced",
            grade: "B",
            notes: `${contractName} | ${isLong ? "Long" : "Short"} | Tradovate sync`,
            session: hr < 10 ? "AM" : hr < 13 ? "Mid" : hr < 16 ? "PM" : "After",
            result: pnl >= 0 ? "Win" : "Loss",
          });
        });
      }

      // Fall back to order matching if no fills
      if (trades.length === 0 && filledOrders.length > 0) {
        console.log("Falling back to order matching...");
        // Use orderItems which may have avgPrice
        const itemsByOrderId = {};
        orderItems.forEach(item => { itemsByOrderId[item.orderId || item.id] = item; });

        filledOrders.forEach(order => {
          const item = itemsByOrderId[order.id] || order;
          const avgPx = item.avgPx || item.avgPrice || item.price || 0;
          const qty = item.filledQty || item.cumQty || item.qty || 1;
          if (!avgPx) return;

          const rawDate = order.timestamp;
          const dateStr = new Date(rawDate).toISOString().slice(0, 10);
          if (from && dateStr < from) return;
          if (to && dateStr > to) return;

          const hr = new Date(rawDate).getHours();
          const contractId = order.contractId;
          console.log(`Order ${order.id}: action=${order.action}, avgPx=${avgPx}, qty=${qty}`);

          trades.push({
            tradovate_id: String(order.id),
            date: dateStr,
            instrument: "MES",
            direction: order.action === "Buy" ? "Long" : "Short",
            contracts: qty,
            entry: avgPx,
            exit: 0,
            pnl: 0, // Can't calculate without paired order
            rr: "--",
            setup: "Auto-synced",
            grade: "B",
            notes: `Order #${order.id} | ${order.action} @ ${avgPx}`,
            session: hr < 10 ? "AM" : hr < 13 ? "Mid" : hr < 16 ? "PM" : "After",
            result: "Win",
          });
        });
      }

      console.log("Total trades built:", trades.length);
      return res.status(200).json(trades);
    }

    return res.status(400).json({ error: "Unknown action" });

  } catch (err) {
    console.error("Proxy error:", err.message);
    return res.status(500).json({ error: err.message });
  }
}
