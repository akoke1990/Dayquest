// Supabase Edge Function: authenticated DayQuest account deletion and Apple
// refresh-token registration. Do not deploy until the migration and required
// secrets in README.md have been reviewed and configured.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const JSON_HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
};
const encoder = new TextEncoder();

function respond(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Server configuration missing: ${name}`);
  return value;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlJson(value: unknown): string {
  return bytesToBase64Url(encoder.encode(JSON.stringify(value)));
}

function pemToBytes(pem: string): Uint8Array {
  const body = pem.replaceAll("\\n", "\n").replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}

async function appleClientSecret(): Promise<string> {
  const teamId = required("APPLE_TEAM_ID");
  const clientId = required("APPLE_CLIENT_ID");
  const keyId = required("APPLE_KEY_ID");
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    pemToBytes(required("APPLE_PRIVATE_KEY_P8")),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlJson({ alg: "ES256", kid: keyId, typ: "JWT" });
  const payload = base64UrlJson({ iss: teamId, iat: now, exp: now + 300, aud: "https://appleid.apple.com", sub: clientId });
  const signingInput = `${header}.${payload}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, encoder.encode(signingInput))
  );
  return `${signingInput}.${bytesToBase64Url(signature)}`;
}

async function appleTokenRequest(fields: Record<string, string>): Promise<Record<string, unknown>> {
  const response = await fetch("https://appleid.apple.com/auth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: required("APPLE_CLIENT_ID"),
      client_secret: await appleClientSecret(),
      ...fields,
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Apple token exchange failed (${response.status}).`);
  return payload;
}

async function encryptionKey(): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(required("ACCOUNT_DELETION_TOKEN_ENCRYPTION_KEY")), (c) => c.charCodeAt(0));
  if (raw.length !== 32) throw new Error("ACCOUNT_DELETION_TOKEN_ENCRYPTION_KEY must decode to 32 bytes.");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function encryptToken(token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), encoder.encode(token))
  );
  return `${bytesToBase64Url(iv)}.${bytesToBase64Url(ciphertext)}`;
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function decryptToken(value: string): Promise<string> {
  const [ivPart, cipherPart] = value.split(".");
  if (!ivPart || !cipherPart) throw new Error("Stored provider token is invalid.");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeBase64Url(ivPart) },
    await encryptionKey(),
    decodeBase64Url(cipherPart)
  );
  return new TextDecoder().decode(plaintext);
}

async function revokeAppleToken(refreshToken: string): Promise<void> {
  const response = await fetch("https://appleid.apple.com/auth/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: required("APPLE_CLIENT_ID"),
      client_secret: await appleClientSecret(),
      token: refreshToken,
      token_type_hint: "refresh_token",
    }),
  });
  if (!response.ok) throw new Error(`Apple token revocation failed (${response.status}).`);
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: JSON_HEADERS });
  if (request.method !== "POST") return respond(405, { error: "Method not allowed." });

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) return respond(401, { error: "Authentication required." });

  try {
    const url = required("SUPABASE_URL");
    const anon = required("SUPABASE_ANON_KEY");
    const serviceRole = required("SUPABASE_SERVICE_ROLE_KEY");
    const callerClient = createClient(url, anon, { global: { headers: { Authorization: authorization } } });
    const { data: callerData, error: callerError } = await callerClient.auth.getUser(authorization.slice(7));
    const caller = callerData?.user;
    if (callerError || !caller) return respond(401, { error: "Authentication required." });

    const body = await request.json().catch(() => ({}));
    const action = body?.action;
    const admin = createClient(url, serviceRole, { auth: { autoRefreshToken: false, persistSession: false } });

    if (action === "register_apple_token") {
      const providers = caller.app_metadata?.providers || [];
      if (!providers.includes("apple")) return respond(403, { error: "Apple identity required." });
      if (typeof body.authorization_code !== "string" || !body.authorization_code) {
        return respond(400, { error: "Apple authorization code required." });
      }
      const tokens = await appleTokenRequest({ grant_type: "authorization_code", code: body.authorization_code });
      if (typeof tokens.refresh_token !== "string" || !tokens.refresh_token) {
        return respond(409, { error: "Apple did not issue a refresh token. Re-authorize Apple sign-in." });
      }
      const { error } = await admin.from("auth_provider_secrets").upsert({
        user_id: caller.id,
        provider: "apple",
        encrypted_refresh_token: await encryptToken(tokens.refresh_token),
        revoked_at: null,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error("Could not store Apple revocation token.");
      return respond(200, { registered: true });
    }

    if (action !== "delete") return respond(400, { error: "Unsupported action." });

    const usesApple = (caller.app_metadata?.providers || []).includes("apple");
    if (usesApple) {
      const { data: secret, error: secretError } = await admin
        .from("auth_provider_secrets")
        .select("encrypted_refresh_token,revoked_at")
        .eq("user_id", caller.id)
        .maybeSingle();
      if (secretError) throw new Error("Could not verify Apple revocation state.");
      if (!secret) {
        return respond(409, { error: "Apple revocation token is missing. Account deletion is blocked; contact support." });
      }
      if (!secret.revoked_at) {
        await revokeAppleToken(await decryptToken(secret.encrypted_refresh_token));
        const { error: markError } = await admin
          .from("auth_provider_secrets")
          .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq("user_id", caller.id);
        if (markError) throw new Error("Could not save Apple revocation state.");
      }
    }

    // Transactional and idempotent. It fails closed if the live schema has any
    // user-linked dependency not represented by the reviewed migration.
    const { data: deletionSummary, error: deletionError } = await admin.rpc("delete_dayquest_user_data", {
      p_user_id: caller.id,
    });
    if (deletionError) return respond(409, { error: deletionError.message });

    // Auth is last: only after Apple revocation and every represented data class
    // succeeded. Its cascade removes auth_provider_secrets.
    const { error: authDeleteError } = await admin.auth.admin.deleteUser(caller.id);
    if (authDeleteError) throw new Error("Account data was cleared, but authentication deletion must be retried.");

    return respond(200, { deleted: true, summary: deletionSummary });
  } catch (error) {
    console.error("delete-account failed", error instanceof Error ? error.message : "unknown error");
    return respond(500, { error: error instanceof Error ? error.message : "Account deletion failed." });
  }
});
