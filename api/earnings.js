export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const apiKey = process.env.FINNHUB_API_KEY;
    if (!apiKey) return res.status(200).json({ error: "FINNHUB_API_KEY not configured", events: [] });

    const today = new Date();
    const dow = today.getDay();
    const mon = new Date(today);
    mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
    const fri = new Date(mon);
    fri.setDate(mon.getDate() + 4);
    const fmt = (d) => d.toISOString().slice(0, 10);
    const from = req.query.from || fmt(mon);
    const to = req.query.to || fmt(fri);

    const url = `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${apiKey}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error("Finnhub error: " + r.status);
    const data = await r.json();
    const earnings = data.earningsCalendar || [];

    const majorTickers = new Set([
      "AAPL","MSFT","AMZN","NVDA","GOOGL","GOOG","META","TSLA","AVGO","JPM",
      "V","UNH","XOM","WMT","MA","JNJ","PG","HD","ORCL","COST","ABBV","MRK",
      "CVX","BAC","LLY","KO","PEP","TMO","ACN","MCD","CSCO","ABT","CRM","ADBE",
      "AMD","INTC","QCOM","GS","MS","C","WFC","NFLX","DIS","GE","CAT","HON",
      "BA","RTX","LMT","NEE","AXP","BLK","SCHW","TGT","LOW","NKE","SBUX","T",
      "VZ","TMUS","MDT","ISRG","SYK","ZTS","IBM","NOW","UBER","LYFT","SNAP","PINS"
    ]);

    const sorted = earnings
      .filter(e => e.symbol && e.date)
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return (b.revenueEstimate || 0) - (a.revenueEstimate || 0);
      });

    const events = sorted.map(e => ({
      date: e.date,
      symbol: e.symbol,
      company: e.company || e.symbol,
      hour: e.hour || "amc",
      epsEstimate: e.epsEstimate !== undefined ? e.epsEstimate : null,
      epsActual: e.epsActual !== undefined ? e.epsActual : null,
      revenueEstimate: e.revenueEstimate || null,
      revenueActual: e.revenueActual || null,
      isMajor: majorTickers.has(e.symbol),
      quarter: e.quarter || null,
      year: e.year || null,
    }));

    return res.status(200).json({ events, from, to, total: events.length, major: events.filter(e=>e.isMajor).length });

  } catch (err) {
    console.error("Earnings error:", err.message);
    return res.status(200).json({ error: err.message, events: [] });
  }
}
