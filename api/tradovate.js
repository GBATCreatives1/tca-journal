// Vercel Serverless Function — Tradovate Proxy
// File location: api/tradovate.js (in your project root)

export default async function handler(req, res) {
  // Allow requests from your app
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const { action } = req.query;
  const TV_URL = "https://live.tradovateapi.com/v1";

  try {
    if (action === "auth") {
      // Authenticate with Tradovate
      const response = await fetch(`${TV_URL}/auth/accesstokenrequest`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "accept": "application/json",
        },
        body: JSON.stringify({
          name:       process.env.VITE_TV_USERNAME,
          password:   process.env.VITE_TV_PASSWORD,
          appId:      "TCA Journal",
          appVersion: "0.0.1",
          deviceId:   process.env.VITE_TV_DEVICE_ID,
          cid:        parseInt(process.env.VITE_TV_CID),
          sec:        process.env.VITE_TV_SECRET,
        }),
      });
      const data = await response.json();
      return res.status(200).json(data);
    }

    if (action === "fills") {
      // Fetch execution reports (closed trades)
      const { token } = req.query;
      if (!token) return res.status(401).json({ error: "No token" });

      const response = await fetch(`${TV_URL}/executionreport/list`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "accept": "application/json",
        },
      });
      const data = await response.json();
      return res.status(200).json(data);
    }

    return res.status(400).json({ error: "Unknown action" });

  } catch (err) {
    console.error("Tradovate proxy error:", err);
    return res.status(500).json({ error: err.message });
  }
}
