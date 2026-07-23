import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createInterface } from "node:readline";
import test from "node:test";

test("quest module can load without eagerly importing the AI SDK", async () => {
  const module = await import("../lib/quest.js");
  assert.equal(typeof module.buildQuest, "function");
});

const ROOT = new URL("..", import.meta.url).pathname;

test("real server starts without provider modules and serves bounded health/root probes", async (t) => {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: "0", NODE_ENV: "test", ANTHROPIC_API_KEY: "", SUPABASE_URL: "", SUPABASE_SERVICE_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill("SIGTERM"));
  const stderr = [];
  child.stderr.on("data", (chunk) => stderr.push(chunk));
  const lines = createInterface({ input: child.stdout });
  const startup = await Promise.race([
    (async () => {
      for await (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.event === "server_listening") return parsed;
        } catch { /* ignore non-JSON legacy output */ }
      }
      return null;
    })(),
    new Promise((_, reject) => setTimeout(() => reject(new Error(`server startup timed out: ${Buffer.concat(stderr).toString()}`)), 1000)),
  ]);
  assert.ok(startup?.port > 0);
  const base = `http://127.0.0.1:${startup.port}`;
  for (const path of ["/health", "/ready", "/"]) {
    const start = performance.now();
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.ok(performance.now() - start < 200);
  }
  child.kill("SIGTERM");
  await once(child, "exit");
});
