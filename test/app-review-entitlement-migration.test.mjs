import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL("../supabase/migrations/202607230002_app_review_entitlement.sql", import.meta.url);

test("App Review authorization uses authenticated identity and database time", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /create or replace function public\.dayquest_verify_app_review_entitlement\(\)/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /auth\.uid\(\)/i);
  assert.match(sql, /raw_app_meta_data/i);
  assert.match(sql, /com\.akoke18\.dayquest/);
  assert.match(sql, /1\.0\.0/);
  assert.match(sql, />\s*now\(\)/i);
  assert.match(sql, /revoke all on function public\.dayquest_verify_app_review_entitlement\(\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.dayquest_verify_app_review_entitlement\(\) to authenticated/i);
});
