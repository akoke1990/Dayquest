import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/202607230001_content_failures.sql", import.meta.url);

test("content-failures migration creates the constrained server-generated queue contract", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create table public\.content_failures/i);
  assert.match(sql, /id\s+uuid\s+primary key\s+default\s+gen_random_uuid\(\)/i);
  assert.match(sql, /created_at\s+timestamptz\s+not null\s+default\s+now\(\)/i);
  assert.match(sql, /request_id\s+uuid\s+not null\s+unique/i);
  assert.match(sql, /reason[\s\S]*unsafe[\s\S]*blocked_closed[\s\S]*inaccessible[\s\S]*missing[\s\S]*incorrect/i);
  assert.match(sql, /priority[\s\S]*safety[\s\S]*content/i);
  assert.match(sql, /curator_action[\s\S]*immediate_review[\s\S]*availability_review[\s\S]*accessibility_review[\s\S]*content_review/i);
  assert.match(sql, /accessibility_status[\s\S]*unknown/i);
  assert.match(sql, /status[\s\S]*open[\s\S]*in_review[\s\S]*resolved[\s\S]*dismissed/i);
  assert.match(sql, /where\s+status\s*=\s*'open'/i);
  assert.match(sql, /priority\s*,\s*created_at/i);

  const tableBody = sql.match(/create table public\.content_failures\s*\(([\s\S]*?)\);/i)?.[1] || "";
  assert.doesNotMatch(tableBody, /\b(?:lat|lng|latitude|longitude|route|photo|clue|answer|email|ip|user_id|install_id|free_form)\b/i);
});

test("release, privacy, and reviewer docs make the durable safety queue a hard gate", async () => {
  const [runbook, privacy, checklist] = await Promise.all([
    readFile(new URL("../docs/app-store/RELEASE_RUNBOOK.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/app-store/APP_PRIVACY.md", import.meta.url), "utf8"),
    readFile(new URL("../docs/app-store/reviewer-checklist.md", import.meta.url), "utf8"),
  ]);
  for (const document of [runbook, checklist]) {
    assert.match(document, /202607230001_content_failures\.sql/);
    assert.match(document, /SUPABASE_SERVICE_KEY/);
    assert.match(document, /queue alert/i);
    assert.match(document, /live read-back/i);
  }
  assert.match(runbook, /immediate unsafe pause owner/i);
  assert.match(privacy, /content failure/i);
  assert.match(privacy, /no raw GPS|does not include.*coordinates/i);
  assert.match(privacy, /request ID/i);
});

test("content-failures migration permits only service-role table access", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /alter table public\.content_failures enable row level security/i);
  assert.match(sql, /alter table public\.content_failures force row level security/i);
  assert.match(sql, /revoke all on table public\.content_failures from public, anon, authenticated/i);
  assert.match(sql, /grant select, insert, update, delete on table public\.content_failures to service_role/i);
  assert.doesNotMatch(sql, /create\s+policy/i);
  assert.doesNotMatch(sql, /grant\s+(?:select|insert|update|delete)[\s\S]*\b(?:anon|authenticated)\b/i);
});
