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
import { appendFileSync, mkdirSync } from "node:fs";
import { buildQuest, loadEnv } from "./lib/quest.js";
import { resolveArea } from "./lib/area.js";

loadEnv();
const PORT = process.env.PORT || 8787;
const DATA_DIR = new URL("./data/", import.meta.url);

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*", // allow the app/browser to call during dev
  });
  res.end(JSON.stringify(body, null, 2));
}

// Read a request body, capped, and JSON.parse it. Returns the parsed object,
// or throws so the caller can answer 400. No framework — just collect chunks.
function readJsonBody(req, maxBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let raw = "";
    let aborted = false;
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > maxBytes) {
        aborted = true;
        reject(new Error("Body too large."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (aborted) return;
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON body."));
      }
    });
    req.on("error", reject);
  });
}

// Append one JSON line to data/<file>, server-stamping a receive time so we
// don't trust client clocks. Creates data/ on first write (it's gitignored).
function appendJsonl(file, obj) {
  mkdirSync(DATA_DIR, { recursive: true });
  const line = JSON.stringify({ ...obj, server_ts: new Date().toISOString() }) + "\n";
  appendFileSync(new URL(file, DATA_DIR), line);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === "/" || url.pathname === "/health") {
    return send(res, 200, {
      service: "dayquest",
      usage: "GET /quest?lat=40.7308&lng=-73.9973",
      key_configured: Boolean(process.env.ANTHROPIC_API_KEY),
    });
  }

  // Lightweight analytics: append one event line. No PII — just an anonymous
  // install id, an event name, and small numeric/string props.
  if (url.pathname === "/event" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      if (!body || typeof body.event !== "string" || !body.event) {
        return send(res, 400, { error: "Provide a string `event` field." });
      }
      appendJsonl("events.jsonl", {
        event: body.event,
        install_id: typeof body.install_id === "string" ? body.install_id : null,
        props: body.props && typeof body.props === "object" ? body.props : {},
        client_ts: typeof body.ts === "string" ? body.ts : null,
      });
      return send(res, 200, { ok: true });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
  }

  // Tester feedback: a thumbs signal + optional note, OR a per-stop flag.
  if (url.pathname === "/feedback" && req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      if (!body || typeof body !== "object") {
        return send(res, 400, { error: "Provide a JSON object." });
      }
      appendJsonl("feedback.jsonl", {
        kind: typeof body.kind === "string" ? body.kind : "quest", // "quest" | "stop_flag"
        install_id: typeof body.install_id === "string" ? body.install_id : null,
        rating: body.rating ?? null, // "up" | "down" | null
        text: typeof body.text === "string" ? body.text.slice(0, 1000) : null,
        stop_name: typeof body.stop_name === "string" ? body.stop_name : null,
        source_url: typeof body.source_url === "string" ? body.source_url : null,
        reason: typeof body.reason === "string" ? body.reason.slice(0, 1000) : null,
        theme: typeof body.theme === "string" ? body.theme : null,
        client_ts: typeof body.ts === "string" ? body.ts : null,
      });
      return send(res, 200, { ok: true });
    } catch (err) {
      return send(res, 400, { error: err.message });
    }
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
      // Resolve to an Area: if the caller passed an explicit label, honour it;
      // otherwise reverse-geocode coords into a human neighbourhood/town name so
      // origin.label is a real place (never raw coordinates). resolveArea never
      // throws — worst case it returns a generic "Your Area".
      const labelRaw = url.searchParams.get("label");
      const label = labelRaw && labelRaw.trim()
        ? labelRaw.trim()
        : (await resolveArea(lat, lng)).name;
      const quest = await buildQuest(lat, lng, label);
      console.log(`  ← ${quest.stops.length} stops: ${quest.theme} (area: ${label})`);
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
  console.log(`  Try: http://localhost:${PORT}/quest?lat=40.7308&lng=-73.9973`);
  console.log(`  Key configured: ${Boolean(process.env.ANTHROPIC_API_KEY)}\n`);
});
