// DayQuest — quest API server.
//
//   node server.js          (then open http://localhost:8787)
//
// The mobile app calls THIS, not Claude directly — so your API key stays on
// the server and never ships inside the app. One endpoint:
//
//   GET /quest?lat=<lat>&lng=<lng>   ->   the quest JSON
//
// Built on Node's standard library — no web framework dependency.

import { createServer } from "node:http";
import { buildQuest, loadEnv } from "./lib/quest.js";

loadEnv();
const PORT = process.env.PORT || 8787;

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*", // allow the app/browser to call during dev
  });
  res.end(JSON.stringify(body, null, 2));
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/" || url.pathname === "/health") {
    return send(res, 200, {
      service: "dayquest",
      usage: "GET /quest?lat=55.9496&lng=-3.1883",
      key_configured: Boolean(process.env.ANTHROPIC_API_KEY),
    });
  }

  if (url.pathname === "/quest") {
    const latRaw = url.searchParams.get("lat");
    const lngRaw = url.searchParams.get("lng");
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    // Note: Number(null)===0, so check for missing params explicitly.
    if (latRaw === null || lngRaw === null || latRaw === "" || lngRaw === "" ||
        !Number.isFinite(lat) || !Number.isFinite(lng) ||
        Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      return send(res, 400, { error: "Provide valid numeric lat (-90..90) and lng (-180..180) query params." });
    }
    try {
      console.log(`  → quest request for ${lat}, ${lng}`);
      const quest = await buildQuest(lat, lng);
      console.log(`  ← ${quest.stops.length} stops: ${quest.theme}`);
      return send(res, 200, quest);
    } catch (err) {
      if (err.code === "NO_KEY") return send(res, 503, { error: "Server has no ANTHROPIC_API_KEY configured." });
      if (err.code === "TOO_FEW") return send(res, 422, { error: err.message });
      console.error("  ! quest error:", err.message);
      return send(res, 500, { error: "Failed to build quest." });
    }
  }

  return send(res, 404, { error: "Not found. Try GET /quest?lat=..&lng=.." });
});

server.listen(PORT, () => {
  console.log(`\n  DayQuest API on http://localhost:${PORT}`);
  console.log(`  Try: http://localhost:${PORT}/quest?lat=55.9496&lng=-3.1883`);
  console.log(`  Key configured: ${Boolean(process.env.ANTHROPIC_API_KEY)}\n`);
});
