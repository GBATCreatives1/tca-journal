export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.status(200).end();

  const TV_URL = "https://live.tradovateapi.com/v1";
  const { action } = req.query;

  try {
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
      console.log("Auth attempt for:", body.name, "cid:", body.cid);
      const response = await fetch(`${TV_URL}/auth/accesstokenrequest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "accept": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      console.log("Auth result:", data.accessToken ? "SUCCESS" : data.errorText);
      return res.status(200).json(data);
    }

    if (action === "fills") {
      const { token } = req.query;
      if (!token) return res.status(401).json({ error: "No token" });

      // Use the correct endpoint for historical trade performance data
      // cashFlow gives us realized P&L per trade
      console.log("Fetching trade history...");

      // Try multiple endpoints to get filled trades with P&L
      // 1. First try the position/list for current positions
      // 2. Then executionreport for fills
      // 3. Then account/list to get account ID

      // Get account info first
      const accountRes = await fetch(`${TV_URL}/account/list`, {
        headers: { Authorization: `Bearer ${token}`, "accept": "application/json" },
      });
      const accounts = await accountRes.json();
      console.log("Accounts:", JSON.stringify(accounts).slice(0, 200));

      const accountId = Array.isArray(accounts) && accounts[0]?.id;
      if (!accountId) {
        console.log("No account found");
        return res.status(200).json([]);
      }

      // Get execution reports - these are the actual fills
      const execRes = await fetch(`${TV_URL}/executionreport/list`, {
        headers: { Authorization: `Bearer ${token}`, "accept": "application/json" },
      });
      const execs = await execRes.json();
      console.log("Execution reports count:", Array.isArray(execs) ? execs.length : "not array");
      if (Array.isArray(execs) && execs.length > 0) {
        console.log("Exec sample:", JSON.stringify(execs[0]).slice(0, 300));
      }

      // Get orders - filled orders have avgPrice and filledQty
      const ordersRes = await fetch(`${TV_URL}/order/list`, {
        headers: { Authorization: `Bearer ${token}`, "accept": "application/json" },
      });
      const orders = await ordersRes.json();
      console.log("Orders count:", Array.isArray(orders) ? orders.length : "not array");
      
      // Filter to only filled orders
      const filledOrders = Array.isArray(orders) 
        ? orders.filter(o => o.ordStatus === "Filled" || o.ordStatus === "PartiallyFilled")
        : [];
      console.log("Filled orders:", filledOrders.length);
      if (filledOrders.length > 0) {
        console.log("Filled order sample:", JSON.stringify(filledOrders[0]).slice(0, 300));
      }

      // Try cash balance snapshots for P&L data
      const cashRes = await fetch(`${TV_URL}/cashBalance/getcashbalancesnapshot?accountId=${accountId}`, {
        headers: { Authorization: `Bearer ${token}`, "accept": "application/json" },
      });
      const cash = await cashRes.json();
      console.log("Cash balance:", JSON.stringify(cash).slice(0, 200));

      // Try trading activity / fills specifically
      const fillsRes = await fetch(`${TV_URL}/fill/list`, {
        headers: { Authorization: `Bearer ${token}`, "accept": "application/json" },
      });
      const fills = await fillsRes.json();
      console.log("Fills endpoint count:", Array.isArray(fills) ? fills.length : typeof fills);
      if (Array.isArray(fills) && fills.length > 0) {
        console.log("Fill sample:", JSON.stringify(fills[0]).slice(0, 300));
      }

      // Return all data for debugging
      return res.status(200).json({
        execs: Array.isArray(execs) ? execs : [],
        filledOrders,
        fills: Array.isArray(fills) ? fills : [],
        accountId,
      });
    }

    return res.status(400).json({ error: "Unknown action" });

  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: err.message });
  }
}
