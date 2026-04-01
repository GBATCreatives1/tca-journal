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

      // Try multiple endpoints to find trades
      console.log("Fetching fills with token:", token.slice(0,20)+"...");

      const fillsRes = await fetch(`${TV_URL}/executionreport/list`, {
        headers: { Authorization: `Bearer ${token}`, "accept": "application/json" },
      });
      const fills = await fillsRes.json();
      console.log("Raw fills count:", Array.isArray(fills) ? fills.length : "not array", typeof fills);
      if (Array.isArray(fills) && fills.length > 0) {
        console.log("First fill sample:", JSON.stringify(fills[0]).slice(0, 200));
      }
      return res.status(200).json(fills);
    }

    if (action === "orders") {
      const { token } = req.query;
      if (!token) return res.status(401).json({ error: "No token" });
      const ordersRes = await fetch(`${TV_URL}/order/list`, {
        headers: { Authorization: `Bearer ${token}`, "accept": "application/json" },
      });
      const orders = await ordersRes.json();
      console.log("Orders count:", Array.isArray(orders) ? orders.length : "not array");
      if (Array.isArray(orders) && orders.length > 0) {
        console.log("First order sample:", JSON.stringify(orders[0]).slice(0, 200));
      }
      return res.status(200).json(orders);
    }

    return res.status(400).json({ error: "Unknown action" });

  } catch (err) {
    console.error("Proxy error:", err);
    return res.status(500).json({ error: err.message });
  }
}
