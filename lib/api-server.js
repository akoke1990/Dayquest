import { createHash, randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";

const DATA_DIR = new URL("../data/", import.meta.url);
const DEFAULT_ROUTE_TIMEOUT_MS = 25_000;
const DEFAULT_LIMITS = Object.freeze({
  quest: { max: 20, windowMs: 60_000 },
  resolvePlace: { max: 20, windowMs: 60_000 },
  sharedHunt: { max: 60, windowMs: 60_000 },
  event: { max: 120, windowMs: 60_000 },
  feedback: { max: 30, windowMs: 60_000 },
  score: { max: 20, windowMs: 60_000 },
  contentFailure: { max: 20, windowMs: 60_000 },
  default: { max: 60, windowMs: 60_000 },
});
const DEFAULT_BODY_LIMITS = Object.freeze({ default: 64 * 1024, event: 16 * 1024, feedback: 16 * 1024, score: 8 * 1024, contentFailure: 8 * 1024, photo: 1024 * 1024 });
const CONTENT_FAILURE_REASONS = new Set(["unsafe", "blocked_closed", "inaccessible", "missing", "incorrect"]);
const CONTENT_FAILURE_KEYS = new Set(["reason", "place_id", "slot", "excluded_place_ids", "quest_content_version_id"]);

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function defaultAppendRecord(file, record) {
  mkdirSync(DATA_DIR, { recursive: true });
  appendFileSync(new URL(file, DATA_DIR), `${JSON.stringify({ ...record, server_ts: new Date().toISOString() })}\n`);
}

function defaultDependencies() {
  return {
    loadCuratedQuest: async (...args) => (await import("./curated-quest.js")).loadCuratedQuest(...args),
    loadCuratedReplacement: async (...args) => (await import("./curated-quest.js")).loadCuratedReplacement(...args),
    buildQuest: async (...args) => (await import("./quest.js")).buildQuest(...args),
    resolveArea: async (...args) => (await import("./area.js")).resolveArea(...args),
    resolvePlace: async (...args) => (await import("./area.js")).resolvePlace(...args),
    fetchSharedHunt: async (...args) => (await import("./sharedhunts.js")).fetchSharedHunt(...args),
    upsertSharedHunt: async (...args) => (await import("./sharedhunts.js")).upsertSharedHunt(...args),
    sharedHuntsConfigured: () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY),
    contentFailuresConfigured: () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY),
    persistContentFailure: async (...args) => (await import("./content-failures.js")).persistContentFailure(...args),
    appendRecord: defaultAppendRecord,
  };
}

function endpointName(pathname) {
  if (pathname === "/quest") return "quest";
  if (pathname === "/resolve-place") return "resolvePlace";
  if (pathname.startsWith("/shared-hunt/")) return "sharedHunt";
  if (pathname === "/event") return "event";
  if (pathname === "/feedback") return "feedback";
  if (pathname === "/score") return "score";
  if (pathname === "/content-failure") return "contentFailure";
  if (pathname === "/photo") return "photo";
  return "default";
}

function clientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded) return forwarded.split(",", 1)[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function text(value, max) {
  return typeof value === "string" ? value.trim().slice(0, max) : null;
}

const SENSITIVE_PROP = /(?:token|secret|password|authorization|photo|image|route|path|lat|lng|longitude|latitude|location|coordinate)/i;
function safeProps(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 20)) {
    if (SENSITIVE_PROP.test(key)) continue;
    if (typeof item === "string") output[key.slice(0, 64)] = item.slice(0, 256);
    else if (typeof item === "number" && Number.isFinite(item)) output[key.slice(0, 64)] = item;
    else if (typeof item === "boolean") output[key.slice(0, 64)] = item;
  }
  return output;
}

function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      req.resume();
      reject(new ApiError(413, "BODY_TOO_LARGE", "Request body exceeds the endpoint limit."));
      return;
    }
    const chunks = [];
    let bytes = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        settled = true;
        chunks.length = 0;
        reject(new ApiError(413, "BODY_TOO_LARGE", "Request body exceeds the endpoint limit."));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      if (settled) return;
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new ApiError(400, "INVALID_JSON", "Request body must be valid JSON."));
      }
    });
    req.on("error", () => {
      if (!settled) reject(new ApiError(400, "REQUEST_READ_FAILED", "Request body could not be read."));
    });
  });
}

function readLimitedBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"]);
    if (Number.isFinite(declared) && declared > maxBytes) {
      req.resume();
      reject(new ApiError(413, "BODY_TOO_LARGE", "Request body exceeds the endpoint limit."));
      return;
    }
    let bytes = 0;
    let settled = false;
    req.on("data", (chunk) => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > maxBytes) {
        settled = true;
        reject(new ApiError(413, "BODY_TOO_LARGE", "Request body exceeds the endpoint limit."));
      }
    });
    req.on("end", () => { if (!settled) resolve(); });
    req.on("error", () => { if (!settled) reject(new ApiError(400, "REQUEST_READ_FAILED", "Request body could not be read.")); });
  });
}

function normalizeSize(value) {
  return value === "explore" || value === "epic" ? value : "quick";
}
function normalizeMode(value) { return value === "bike" ? "bike" : "walk"; }
function normalizeDifficulty(value) {
  return ["easy", "tricky", "hard", "impossible"].includes(value) ? value : "hard";
}
function parseExclude(params) {
  const excluded = new Set();
  for (const raw of params.getAll("exclude")) {
    for (const item of raw.split(",")) if (item.trim()) excluded.add(item.trim().slice(0, 500));
  }
  return excluded;
}
function cacheKey(lat, lng, options, exclude) {
  const digest = exclude.size ? createHash("sha256").update([...exclude].sort().join("\0")).digest("hex").slice(0, 12) : "";
  const day = Math.floor(Date.now() / 86_400_000);
  return `${lat.toFixed(3)},${lng.toFixed(3)}|${normalizeMode(options.mode)}|${normalizeSize(options.size)}|${normalizeDifficulty(options.difficulty)}|${options.radius || ""}|${options.type || ""}|${digest}|${day}`;
}
function sharedId(lat, lng, options) {
  const day = Math.floor(Date.now() / 86_400_000);
  return createHash("sha256").update(`${lat.toFixed(2)},${lng.toFixed(2)}|${normalizeMode(options.mode)}|${normalizeSize(options.size)}|${normalizeDifficulty(options.difficulty)}|${options.radius || ""}|${options.type || ""}|${day}`).digest("hex").slice(0, 12);
}

function routeDeadline(operation, timeoutMs, controller) {
  let timer;
  return Promise.race([
    operation(),
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ApiError(504, "ROUTE_TIMEOUT", "The request exceeded its processing deadline."));
      }, timeoutMs);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

export function createApiHandler(options = {}) {
  const dependencies = { ...defaultDependencies(), ...(options.dependencies || {}) };
  const production = options.production ?? process.env.NODE_ENV === "production";
  const allowedOrigins = new Set(options.allowedOrigins ?? String(process.env.CORS_ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean));
  const routeTimeoutMs = options.routeTimeoutMs ?? (Number(process.env.ROUTE_TIMEOUT_MS) || DEFAULT_ROUTE_TIMEOUT_MS);
  const rateLimits = { ...DEFAULT_LIMITS, ...(options.rateLimits || {}) };
  const bodyLimits = { ...DEFAULT_BODY_LIMITS, ...(options.bodyLimits || {}) };
  const buckets = new Map();
  const questCache = new Map();
  const sharedCache = new Map();
  const inflight = new Map();

  function corsOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return null; // Native clients do not send browser Origin.
    if (allowedOrigins.has(origin)) return origin;
    if (!production && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return origin;
    throw new ApiError(403, "ORIGIN_NOT_ALLOWED", "This browser origin is not allowed.");
  }

  function send(req, res, status, body, extraHeaders = {}) {
    if (res.writableEnded || res.destroyed) return;
    const headers = {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    };
    const origin = req.__corsOrigin;
    if (origin) {
      headers["access-control-allow-origin"] = origin;
      headers.vary = "Origin";
    }
    res.writeHead(status, headers);
    res.end(JSON.stringify(body));
  }

  function errorResponse(req, res, error, requestId) {
    const known = error instanceof ApiError;
    const status = known ? error.status : 500;
    const code = known ? error.code : "INTERNAL_ERROR";
    const message = known ? error.message : "The server could not complete the request.";
    if (!known) console.error(JSON.stringify({ level: "error", event: "request_failed", request_id: requestId, code }));
    send(req, res, status, { error: message, code, request_id: requestId });
  }

  function checkRate(req, pathname) {
    const endpoint = endpointName(pathname);
    if (["/", "/health", "/ready"].includes(pathname)) return null;
    const config = rateLimits[endpoint] || rateLimits.default;
    const key = `${clientIp(req)}|${endpoint}`;
    const now = Date.now();
    let entry = buckets.get(key);
    if (!entry || now - entry.start >= config.windowMs) entry = { start: now, count: 0 };
    entry.count += 1;
    buckets.set(key, entry);
    if (entry.count <= config.max) return null;
    return Math.max(1, Math.ceil((entry.start + config.windowMs - now) / 1000));
  }

  async function questResponse(req, url, signal) {
    if (req.method !== "GET") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use GET for this endpoint.");
    const latRaw = url.searchParams.get("lat");
    const lngRaw = url.searchParams.get("lng");
    const lat = Number(latRaw);
    const lng = Number(lngRaw);
    if (!latRaw || !lngRaw || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new ApiError(400, "INVALID_COORDINATES", "Provide valid lat and lng query parameters.");
    }
    const options = {
      size: url.searchParams.get("size") || undefined,
      mode: url.searchParams.get("mode") || undefined,
      difficulty: url.searchParams.get("difficulty") || undefined,
      radius: url.searchParams.get("radius") || undefined,
      type: url.searchParams.get("type") || undefined,
      exclude: parseExclude(url.searchParams),
      signal,
    };
    let curated = null;
    try {
      curated = await dependencies.loadCuratedQuest(lat, lng, options);
    } catch {
      // A corrupt/unreadable bank is isolated; live fallback remains available.
    }
    if (curated) return curated;

    const sharedFlag = url.searchParams.get("shared");
    const requestedId = text(url.searchParams.get("hunt_id"), 128) || "";
    const isShared = requestedId || sharedFlag === "1" || sharedFlag === "true";
    if (isShared) {
      const id = requestedId || sharedId(lat, lng, options);
      let existing = sharedCache.get(id) || await dependencies.fetchSharedHunt(id);
      if (existing) {
        sharedCache.set(id, existing);
        return existing;
      }
      const key = `shared:${id}`;
      let pending = inflight.get(key);
      if (!pending) {
        pending = (async () => {
          const label = text(url.searchParams.get("label"), 120) || (await dependencies.resolveArea(lat, lng, { signal })).name;
          const built = await dependencies.buildQuest(lat, lng, label, { ...options, exclude: new Set() });
          const value = { hunt_id: id, shared: true, ...built };
          sharedCache.set(id, value);
          await dependencies.upsertSharedHunt(id, value, { area: label, mode: normalizeMode(options.mode), size: normalizeSize(options.size) });
          return value;
        })().finally(() => inflight.delete(key));
        inflight.set(key, pending);
      }
      return pending;
    }

    const key = cacheKey(lat, lng, options, options.exclude);
    if (questCache.has(key)) return questCache.get(key);
    let pending = inflight.get(key);
    if (!pending) {
      pending = (async () => {
        const label = text(url.searchParams.get("label"), 120) || (await dependencies.resolveArea(lat, lng, { signal })).name;
        const result = await dependencies.buildQuest(lat, lng, label, options);
        questCache.set(key, result);
        if (questCache.size > 500) questCache.delete(questCache.keys().next().value);
        return result;
      })().finally(() => inflight.delete(key));
      inflight.set(key, pending);
    }
    return pending;
  }

  async function dispatch(req, res, url, requestId, signal) {
    if (url.pathname === "/health") return send(req, res, 200, { service: "dayquest", status: "live" });
    if (url.pathname === "/ready") return send(req, res, 200, { service: "dayquest", status: "ready" });
    if (url.pathname === "/") return send(req, res, 200, { service: "dayquest", status: "ok", usage: "GET /quest?lat=40.7308&lng=-73.9973" });

    if (url.pathname === "/quest") {
      try {
        return send(req, res, 200, await questResponse(req, url, signal));
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (error?.code === "TOO_FEW") throw new ApiError(422, "INSUFFICIENT_CONTENT", "Not enough safe nearby places are available.");
        throw new ApiError(503, "QUEST_UNAVAILABLE", "Quest generation is temporarily unavailable.");
      }
    }
    if (url.pathname === "/resolve-place") {
      if (req.method !== "GET") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use GET for this endpoint.");
      const query = text(url.searchParams.get("q"), 200);
      if (!query) throw new ApiError(400, "INVALID_QUERY", "Provide a non-empty q query parameter.");
      const place = await dependencies.resolvePlace(query, { signal });
      if (!place) throw new ApiError(404, "PLACE_NOT_FOUND", "No matching place was found.");
      return send(req, res, 200, place);
    }
    if (url.pathname.startsWith("/shared-hunt/")) {
      if (req.method !== "GET") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use GET for this endpoint.");
      const id = text(decodeURIComponent(url.pathname.slice(13)), 128);
      if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new ApiError(400, "INVALID_HUNT_ID", "Provide a valid hunt id.");
      const quest = sharedCache.get(id) || await dependencies.fetchSharedHunt(id);
      if (!quest) throw new ApiError(404, "HUNT_NOT_FOUND", "The shared hunt was not found or has expired.");
      sharedCache.set(id, quest);
      return send(req, res, 200, quest);
    }

    if (url.pathname === "/photo") {
      if (req.method !== "POST") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use POST for this endpoint.");
      await readLimitedBody(req, options.bodyLimits?.photo ?? bodyLimits.photo);
      throw new ApiError(501, "PHOTO_UPLOAD_UNSUPPORTED", "Raw photo upload is not supported by this API.");
    }

    if (url.pathname === "/content-failure") {
      if (req.method !== "POST") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use POST for this endpoint.");
      const body = await readJsonBody(req, options.bodyLimits?.contentFailure ?? bodyLimits.contentFailure);
      const keys = body && typeof body === "object" && !Array.isArray(body) ? Object.keys(body) : [];
      const reason = body?.reason;
      const placeId = text(body?.place_id, 200);
      const slot = body?.slot;
      const excluded = body?.excluded_place_ids;
      const valid = keys.every((key) => CONTENT_FAILURE_KEYS.has(key))
        && CONTENT_FAILURE_REASONS.has(reason)
        && placeId?.startsWith("place:")
        && Number.isInteger(slot) && slot > 0 && slot <= 20
        && Array.isArray(excluded) && excluded.length <= 20
        && excluded.every((item) => typeof item === "string" && item.startsWith("place:") && item.length <= 200)
        && excluded.includes(placeId);
      if (!valid) {
        throw new ApiError(400, "INVALID_CONTENT_FAILURE", "Choose a listed reason for the current curated stop.");
      }
      const priority = reason === "unsafe" ? "safety" : "content";
      const curatorAction = reason === "unsafe"
        ? "immediate_review"
        : reason === "blocked_closed"
          ? "availability_review"
          : reason === "inaccessible"
            ? "accessibility_review"
            : "content_review";
      const report = {
        reason,
        place_id: placeId,
        quest_content_version_id: text(body.quest_content_version_id, 200),
        priority,
        curator_action: curatorAction,
        accessibility_status: "unknown",
        request_id: requestId,
        status: "open",
      };
      dependencies.appendRecord("content-failures.jsonl", report);
      let durablePersisted = false;
      if (dependencies.contentFailuresConfigured()) {
        try {
          durablePersisted = await dependencies.persistContentFailure(report);
        } catch {
          console.error(JSON.stringify({ level: "error", event: "content_failure_persistence_failed", request_id: requestId }));
        }
      }
      if (production && !durablePersisted) {
        return send(req, res, 503, {
          error: "The safety report could not be durably stored. Retry before continuing.",
          code: "CONTENT_FAILURE_PERSISTENCE_UNAVAILABLE",
          penalty: false,
          request_id: requestId,
          report: { priority, curator_action: curatorAction, durable_persisted: false, request_id: requestId },
        });
      }
      let replacement = null;
      try {
        replacement = await dependencies.loadCuratedReplacement({
          reportedPlaceId: placeId,
          excludedPlaceIds: new Set(excluded),
          orderIndex: slot,
        });
      } catch {
        // Fail closed: replacement inventory errors never fall through to live generation.
      }
      if (!replacement) {
        return send(req, res, 409, {
          error: "No lifecycle-safe curated replacement is available right now.",
          code: "REPLACEMENT_UNAVAILABLE",
          penalty: false,
          request_id: requestId,
          report: { priority, curator_action: curatorAction, durable_persisted: durablePersisted, request_id: requestId },
        });
      }
      return send(req, res, 200, {
        replacement: { ...replacement, order_index: slot },
        penalty: false,
        report: { priority, curator_action: curatorAction, durable_persisted: durablePersisted, request_id: requestId },
      });
    }

    if (["/event", "/feedback", "/score"].includes(url.pathname)) {
      if (req.method !== "POST") throw new ApiError(405, "METHOD_NOT_ALLOWED", "Use POST for this endpoint.");
      const endpoint = endpointName(url.pathname);
      const maxBodyBytes = options.bodyLimits?.[endpoint]
        ?? options.bodyLimits?.default
        ?? bodyLimits[endpoint]
        ?? bodyLimits.default;
      const body = await readJsonBody(req, maxBodyBytes);
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "INVALID_BODY", "Provide a JSON object.");
      if (url.pathname === "/event") {
        const event = text(body.event, 80);
        if (!event || !/^[a-zA-Z0-9_.:-]+$/.test(event)) throw new ApiError(400, "INVALID_EVENT", "Provide a valid event name.");
        dependencies.appendRecord("events.jsonl", { event, install_id: text(body.install_id, 128), props: safeProps(body.props), client_ts: text(body.ts, 64) });
        return send(req, res, 200, { ok: true });
      }
      if (url.pathname === "/feedback") {
        dependencies.appendRecord("feedback.jsonl", {
          kind: text(body.kind, 32) || "quest", rating: text(body.rating, 16), text: text(body.text, 1000),
          stop_name: text(body.stop_name, 200), source_url: text(body.source_url, 500), reason: text(body.reason, 1000),
          theme: text(body.theme, 120), install_id: text(body.install_id, 128), client_ts: text(body.ts, 64),
        });
        return send(req, res, 200, { ok: true });
      }
      dependencies.appendRecord("score-submissions.jsonl", {
        area: text(body.area, 120), theme: text(body.theme, 120),
        points: Number.isFinite(body.points) ? body.points : null,
        time_s: Number.isFinite(body.time_s) ? body.time_s : null,
        install_id: text(body.install_id, 128), client_ts: text(body.ts, 64),
        authoritative: false, authority: "client_reported",
      });
      return send(req, res, 202, { accepted: true, authoritative: false });
    }

    throw new ApiError(404, "NOT_FOUND", "Endpoint not found.");
  }

  return async function apiHandler(req, res) {
    const requestId = randomUUID();
    try {
      const host = typeof req.headers.host === "string" ? req.headers.host : "localhost";
      const url = new URL(req.url || "/", `http://${host}`);
      req.__corsOrigin = corsOrigin(req);
      if (req.method === "OPTIONS") {
        return send(req, res, 204, null, {
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "Content-Type",
          "access-control-max-age": "600",
        });
      }
      const retryAfter = checkRate(req, url.pathname);
      if (retryAfter) throw Object.assign(new ApiError(429, "RATE_LIMITED", "Too many requests for this endpoint."), { retryAfter });
      const controller = new AbortController();
      await routeDeadline(() => dispatch(req, res, url, requestId, controller.signal), routeTimeoutMs, controller);
    } catch (error) {
      const headers = error?.retryAfter ? { "retry-after": String(error.retryAfter) } : {};
      if (error instanceof ApiError && error.status === 429) {
        return send(req, res, error.status, { error: error.message, code: error.code, request_id: requestId }, headers);
      }
      errorResponse(req, res, error, requestId);
    }
  };
}
