import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const ROOT = new URL("../", import.meta.url);

async function loadAccountDeletionModule() {
  const source = await readFile(new URL("app/lib/accountDeletion.js", ROOT), "utf8");
  const runnable = source.replaceAll("export ", "");
  const context = { URLSearchParams, TextEncoder, TextDecoder };
  vm.runInNewContext(`${runnable}\nthis.__exports = { LOCAL_DATA_KEYS, deleteAccountRemotely, clearLocalDayQuestData };`, context);
  return context.__exports;
}

test("authenticated deletion sends the current bearer token to the Edge Function", async () => {
  const { deleteAccountRemotely } = await loadAccountDeletionModule();
  let invocation;
  const supabase = {
    auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) },
    functions: {
      invoke: async (name, options) => {
        invocation = { name, options };
        return { data: { deleted: true }, error: null };
      },
    },
  };

  const result = await deleteAccountRemotely(supabase);

  assert.equal(result.deleted, true);
  assert.equal(invocation.name, "delete-account");
  assert.equal(invocation.options.headers.Authorization, "Bearer jwt");
  assert.equal(JSON.stringify(invocation.options.body), JSON.stringify({ action: "delete" }));
});

test("remote deletion rejects unauthenticated and unsuccessful responses without local side effects", async () => {
  const { deleteAccountRemotely } = await loadAccountDeletionModule();
  await assert.rejects(
    () => deleteAccountRemotely({ auth: { getSession: async () => ({ data: { session: null } }) } }),
    /sign in/i
  );

  const supabase = {
    auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) },
    functions: { invoke: async () => ({ data: { deleted: false }, error: { message: "blocked" } }) },
  };
  await assert.rejects(() => deleteAccountRemotely(supabase), /blocked/i);
});

test("remote deletion surfaces a safe retry reason from a FunctionsHttpError response", async () => {
  const { deleteAccountRemotely } = await loadAccountDeletionModule();
  const supabase = {
    auth: { getSession: async () => ({ data: { session: { access_token: "jwt" } } }) },
    functions: {
      invoke: async () => ({
        data: null,
        error: {
          message: "Edge Function returned a non-2xx status code",
          context: { clone: () => ({ json: async () => ({ error: "Deletion is temporarily blocked. Please try again." }) }) },
        },
      }),
    },
  };
  await assert.rejects(() => deleteAccountRemotely(supabase), /temporarily blocked/i);
});

test("local cleanup removes every represented DayQuest key, scheduled reminder, and photo directory", async () => {
  const { LOCAL_DATA_KEYS, clearLocalDayQuestData } = await loadAccountDeletionModule();
  const calls = [];
  const storage = {
    getItem: async (key) =>
      key === "dayquest.plannedHunt.v1" ? JSON.stringify({ notif_id: "reminder-1" }) : null,
    multiRemove: async (keys) => calls.push(["keys", [...keys]]),
  };
  const photoDirectory = { delete: () => calls.push(["photos"]) };
  const cancelNotification = async (id) => calls.push(["notification", id]);

  await clearLocalDayQuestData({ storage, photoDirectory, cancelNotification });

  assert.ok(LOCAL_DATA_KEYS.includes("dayquest.installId.v1"));
  assert.ok(LOCAL_DATA_KEYS.includes("dayquest.activeQuest.v1"));
  assert.ok(LOCAL_DATA_KEYS.includes("dayquest.history.v1"));
  assert.ok(LOCAL_DATA_KEYS.includes("dayquest.guest.v1"));
  assert.deepEqual(calls[0], ["notification", "reminder-1"]);
  assert.deepEqual(calls[1], ["photos"]);
  assert.deepEqual(calls[2], ["keys", [...LOCAL_DATA_KEYS]]);
});

test("app exposes separate account deletion and guest reset actions with server-first ordering", async () => {
  const source = await readFile(new URL("app/App.js", ROOT), "utf8");
  assert.match(source, /async function confirmAccountDeletion\(\)/);
  assert.match(source, /await deleteAccountRemotely\(supabase\)[\s\S]*await clearLocalData\(\)/);
  assert.match(source, /async function confirmGuestDataReset\(\)/);
  assert.match(source, /Delete account/);
  assert.match(source, /Reset guest data/);
  assert.match(source, /AppleAuthentication\.signInAsync[\s\S]*registerAppleRevocationToken[\s\S]*deleteAccountRemotely/);
  assert.doesNotMatch(source, /associated cloud data/);
});

test("Supabase deletion contract enumerates known user-linked tables and blocks unknown dependencies", async () => {
  const sql = await readFile(
    new URL("supabase/migrations/202607220001_account_deletion.sql", ROOT),
    "utf8"
  );
  for (const table of ["profiles", "friendships", "hunt_results", "shared_hunts", "auth_provider_secrets"]) {
    assert.match(sql, new RegExp(`\\b${table}\\b`));
  }
  assert.match(sql, /unknown user-linked/i);
  assert.match(sql, /storage\.objects/);
  assert.match(sql, /grant execute[\s\S]*service_role/i);
  assert.match(sql, /revoke all[\s\S]*public/i);
});

test("Edge Function validates the caller, supports Apple token registration, and deletes auth last", async () => {
  const source = await readFile(
    new URL("supabase/functions/delete-account/index.ts", ROOT),
    "utf8"
  );
  assert.match(source, /auth\.getUser\(/);
  assert.match(source, /register_apple_token/);
  assert.match(source, /appleid\.apple\.com\/auth\/revoke/);
  const rpc = source.indexOf('rpc("delete_dayquest_user_data"');
  const authDelete = source.indexOf("auth.admin.deleteUser");
  assert.ok(rpc >= 0 && authDelete > rpc, "auth user must be deleted only after linked data cleanup");
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY\s*=\s*["'][^"']+["']/);
});

test("release artifacts keep unknown legal/publication facts as explicit variables", async () => {
  const inventory = JSON.parse(
    await readFile(new URL("docs/app-store/privacy-inventory.json", ROOT), "utf8")
  );
  assert.equal(inventory.schema_version, 1);
  assert.ok(inventory.release_blockers.includes("PRIVACY_POLICY_URL"));
  assert.ok(inventory.release_blockers.includes("SUPPORT_URL"));
  assert.ok(inventory.data_types.some((item) => item.type === "Precise Location"));
  assert.ok(inventory.data_types.some((item) => item.type === "Device ID"));

  const policy = await readFile(new URL("docs/legal/privacy-policy.draft.md", ROOT), "utf8");
  assert.match(policy, /\{\{LEGAL_ENTITY_NAME\}\}/);
  assert.match(policy, /\{\{SUPPORT_CONTACT\}\}/);
  assert.match(policy, /\{\{RETENTION_SCHEDULE\}\}/);
  assert.doesNotMatch(policy, /andrew@firstprinciplefunds\.com/);
});
