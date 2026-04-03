export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const { from, to } = req.query;
  if (!from || !to) return res.status(400).json({ error: "from and to required" });

  // Try multiple sources in order
  const errors = [];

  // ── Source 1: TradingEconomics (server-side, no CORS issue) ──────────────────
  try {
    const url = `https://api.tradingeconomics.com/calendar/country/united%20states/${from}/${to}?c=guest:guest&f=json`;
    const r = await fetch(url, { headers: { "Accept": "application/json" } });
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data) && data.length > 0) {
        const mapped = data
          .filter(e => e.Importance >= 1)
          .map(e => ({
            date: e.Date?.slice(0, 10) || "",
            time: e.Date?.slice(11, 16) || "",
            name: e.Event || "",
            impact: e.Importance === 3 ? "high" : e.Importance === 2 ? "medium" : "low",
            currency: e.Currency || "USD",
            actual: e.Actual != null ? String(e.Actual) : "",
            forecast: e.Forecast != null ? String(e.Forecast) : "",
            previous: e.Previous != null ? String(e.Previous) : "",
            id: e.CalendarId || Math.random(),
            source: "tradingeconomics",
          }))
          .filter(e => e.date >= from && e.date <= to)
          .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

        if (mapped.length > 0) {
          console.log(`TradingEconomics: ${mapped.length} events for ${from}-${to}`);
          return res.status(200).json({ events: mapped, source: "tradingeconomics" });
        }
      }
    }
  } catch (e) {
    errors.push(`TradingEconomics: ${e.message}`);
  }

  // ── Source 2: Investing.com scraper via AllOrigins proxy ─────────────────────
  try {
    const payload = new URLSearchParams({
      country: "5", // US
      dateFrom: from,
      dateTo: to,
      timeZone: "8", // EST
      timeFilter: "timeRemain",
      currentTab: "custom",
      limit_from: "0",
    });

    const r = await fetch("https://www.investing.com/economic-calendar/Service/getCalendarFilteredData", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "X-Requested-With": "XMLHttpRequest",
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://www.investing.com/economic-calendar/",
      },
      body: payload.toString(),
    });

    if (r.ok) {
      const data = await r.json();
      if (data.data) {
        // Parse HTML table rows from investing.com response
        const rows = data.data.match(/<tr[^>]*event_attr_id[^>]*>[\s\S]*?<\/tr>/g) || [];
        const events = rows.map(row => {
          const timeMatch = row.match(/class="first left time"[^>]*>([\d:]+)<\/td>/);
          const currMatch = row.match(/class="left flagCur[^"]*"[^>]*>\s*<span[^>]*><\/span>\s*([A-Z]+)/);
          const impMatch = row.match(/title="([^"]+)" class="[^"]*grayFullBullishIcon[^"]*"/);
          const nameMatch = row.match(/class="left event"[^>]*><a[^>]*>([^<]+)<\/a>/);
          const actMatch = row.match(/id="[^"]*"[^>]*class="[^"]*act[^"]*"[^>]*>([^<]*)<\/td>/);
          const fcMatch = row.match(/class="[^"]*fore[^"]*"[^>]*>([^<]*)<\/td>/);
          const prevMatch = row.match(/class="[^"]*prev[^"]*"[^>]*>([^<]*)<\/td>/);
          const dateMatch = row.match(/event_timestamp="([^"]+)"/);

          if (!nameMatch) return null;
          const dateStr = dateMatch?.[1]?.slice(0, 10) || from;
          const timeStr = timeMatch?.[1] || "";
          const imp = (impMatch?.[1] || "").toLowerCase();

          return {
            date: dateStr,
            time: timeStr,
            name: nameMatch[1].trim(),
            impact: imp.includes("high") ? "high" : imp.includes("moderate") ? "medium" : "low",
            currency: currMatch?.[1] || "USD",
            actual: actMatch?.[1]?.trim() || "",
            forecast: fcMatch?.[1]?.trim() || "",
            previous: prevMatch?.[1]?.trim() || "",
            id: Math.random(),
            source: "investing",
          };
        }).filter(Boolean).filter(e => e.currency === "USD" && e.date >= from && e.date <= to);

        if (events.length > 0) {
          console.log(`Investing.com: ${events.length} events`);
          return res.status(200).json({ events, source: "investing" });
        }
      }
    }
  } catch (e) {
    errors.push(`Investing.com: ${e.message}`);
  }

  // ── Source 3: ForexFactory RSS (reliable, no key needed) ─────────────────────
  try {
    const ffDate = new Date(from + "T12:00:00");
    const month = ffDate.toLocaleString("en-US", { month: "short" }).toLowerCase();
    const year = ffDate.getFullYear();
    const url = `https://nfs.faireconomy.media/ff_calendar_thisweek.json?version=${Date.now()}`;

    const r = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (r.ok) {
      const data = await r.json();
      if (Array.isArray(data)) {
        const events = data
          .filter(e => e.country === "USD" || e.currency === "USD")
          .map(e => {
            const dateStr = e.date ? new Date(e.date).toISOString().slice(0, 10) : "";
            const timeStr = e.date ? new Date(e.date).toTimeString().slice(0, 5) : "";
            return {
              date: dateStr,
              time: timeStr,
              name: e.title || e.name || "",
              impact: e.impact === "High" ? "high" : e.impact === "Medium" ? "medium" : "low",
              currency: "USD",
              actual: e.actual || "",
              forecast: e.forecast || "",
              previous: e.previous || e.prev || "",
              id: Math.random(),
              source: "forexfactory",
            };
          })
          .filter(e => e.date >= from && e.date <= to)
          .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));

        if (events.length > 0) {
          console.log(`ForexFactory: ${events.length} events`);
          return res.status(200).json({ events, source: "forexfactory" });
        }
      }
    }
  } catch (e) {
    errors.push(`ForexFactory: ${e.message}`);
  }

  // All sources failed
  console.error("All calendar sources failed:", errors);
  return res.status(503).json({ error: "All sources unavailable", details: errors });
}
