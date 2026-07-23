// Account deletion and on-device reset primitives. Kept dependency-injected so
// the destructive ordering can be tested without a device or live Supabase.

export const LOCAL_DATA_KEYS = Object.freeze([
  "dayquest.activeQuest.v1",
  "dayquest.installId.v1",
  "dayquest.history.v1",
  "dayquest.score.v1",
  "dayquest.collections.v1",
  "dayquest.bests.v1",
  "dayquest.settings.v1",
  "dayquest.guest.v1",
  "dayquest.helpSeen.v1",
  "dayquest.plannedHunt.v1",
  "dayquest.visited.v1",
  "dayquest.privacy.v1",
]);

async function functionErrorMessage(error, fallback) {
  try {
    const response = error?.context?.clone ? error.context.clone() : error?.context;
    const payload = await response?.json?.();
    if (typeof payload?.error === "string" && payload.error) return payload.error;
  } catch {
    // A network error or non-JSON response falls back to the SDK message.
  }
  return error?.message || fallback;
}

export async function deleteAccountRemotely(supabaseClient) {
  if (!supabaseClient?.auth) {
    throw new Error("Account deletion is unavailable. Please try again later.");
  }
  const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (sessionError || !accessToken) {
    throw new Error("Please sign in again before deleting your account.");
  }
  if (!supabaseClient?.functions) {
    throw new Error("Account deletion is unavailable. Please try again later.");
  }

  const { data, error } = await supabaseClient.functions.invoke("delete-account", {
    body: { action: "delete" },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (error) throw new Error(await functionErrorMessage(error, "Account deletion did not complete."));
  if (!data?.deleted) {
    throw new Error(data?.error || "Account deletion did not complete. Your local data was kept.");
  }
  return data;
}

export async function registerAppleRevocationToken(supabaseClient, authorizationCode) {
  if (!authorizationCode) {
    return { registered: false, reason: "Apple did not return an authorization code." };
  }
  const { data: sessionData } = await supabaseClient.auth.getSession();
  const accessToken = sessionData?.session?.access_token;
  if (!accessToken) return { registered: false, reason: "No authenticated session." };
  const { data, error } = await supabaseClient.functions.invoke("delete-account", {
    body: { action: "register_apple_token", authorization_code: authorizationCode },
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (error || !data?.registered) {
    const reason = error
      ? await functionErrorMessage(error, "Registration failed.")
      : data?.error || "Registration failed.";
    return { registered: false, reason };
  }
  return { registered: true };
}

export async function clearLocalDayQuestData({ storage, photoDirectory, cancelNotification }) {
  // Read the reminder id before deleting its persisted record.
  let reminderId = null;
  try {
    const raw = await storage.getItem("dayquest.plannedHunt.v1");
    reminderId = raw ? JSON.parse(raw)?.notif_id : null;
  } catch {
    // Corrupt/missing plan is still safe to clear.
  }
  if (reminderId && cancelNotification) await cancelNotification(reminderId);

  // Delete photos before keys so a filesystem failure leaves the local references
  // intact and the caller can retry rather than silently orphaning user files.
  if (photoDirectory) {
    try {
      photoDirectory.delete();
    } catch (error) {
      // A missing directory is the normal no-photo case. Expo's idempotent delete
      // behavior differs by SDK, so only ignore explicit not-found errors.
      const message = String(error?.message || error || "");
      if (!/not found|does not exist|enoent/i.test(message)) throw error;
    }
  }
  await storage.multiRemove([...LOCAL_DATA_KEYS]);
}
