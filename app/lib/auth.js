// Auth + profile helpers — OPTIONAL layer on top of the anonymous app.
//
// Every export here is a no-op (or returns a safe falsy value) when Supabase is
// unconfigured, so callers never need to special-case the unconfigured state
// beyond hiding the sign-in entry. Nothing here is imported for its side
// effects; importing this module when unconfigured pulls in only `supabase`
// (which is `null`) and `expo-*` modules that are safe to load.

import * as WebBrowser from "expo-web-browser";
import * as AuthSession from "expo-auth-session";
import { supabase, authConfigured } from "./supabase";
import { APP_SCHEME } from "../config";

// Required for the auth-session popup to dismiss cleanly when control returns.
WebBrowser.maybeCompleteAuthSession();

// The redirect URL the OAuth provider sends the browser back to. In Expo Go
// this is proxied by Expo; in a standalone build it's `dayquest://`. We let
// expo-auth-session decide the right shape for the current runtime.
export function getRedirectTo() {
  return AuthSession.makeRedirectUri({ scheme: APP_SCHEME });
}

// Pull access/refresh tokens out of the URL the browser returned. Implicit-flow
// tokens arrive in the FRAGMENT (#access_token=...). Some setups put them in the
// query string instead, so we check both.
function parseTokensFromUrl(url) {
  if (!url) return null;
  const out = {};
  const grab = (str) => {
    if (!str) return;
    const params = new URLSearchParams(str);
    for (const [k, v] of params.entries()) out[k] = v;
  };
  const hashIdx = url.indexOf("#");
  if (hashIdx >= 0) grab(url.slice(hashIdx + 1));
  const qIdx = url.indexOf("?");
  if (qIdx >= 0) grab(url.slice(qIdx + 1, hashIdx >= 0 ? hashIdx : undefined));
  if (out.access_token && out.refresh_token) {
    return { access_token: out.access_token, refresh_token: out.refresh_token };
  }
  return null;
}

// Run the full web-redirect OAuth dance for a provider ("google" | "apple").
// Returns { user } on success, { canceled: true } if the user backed out, or
// { error } on any failure. Never throws.
export async function signInWithProvider(provider) {
  if (!authConfigured || !supabase) return { error: "Sign-in isn't set up yet." };
  try {
    const redirectTo = getRedirectTo();
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo, skipBrowserRedirect: true },
    });
    if (error) return { error: error.message };
    if (!data?.url) return { error: "Could not start sign-in." };

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
    if (result.type === "cancel" || result.type === "dismiss") {
      return { canceled: true };
    }
    if (result.type !== "success" || !result.url) {
      return { error: "Sign-in didn't complete." };
    }

    const tokens = parseTokensFromUrl(result.url);
    if (!tokens) return { error: "Sign-in returned no session." };

    const { data: sessionData, error: sessionError } = await supabase.auth.setSession(tokens);
    if (sessionError) return { error: sessionError.message };

    return { user: sessionData?.user || null };
  } catch (e) {
    return { error: e?.message || "Sign-in failed." };
  }
}

export async function signOut() {
  if (!authConfigured || !supabase) return;
  try {
    await supabase.auth.signOut();
  } catch {
    /* best-effort */
  }
}

// Current session's user, or null. Safe when unconfigured.
export async function getCurrentUser() {
  if (!authConfigured || !supabase) return null;
  try {
    const { data } = await supabase.auth.getSession();
    return data?.session?.user || null;
  } catch {
    return null;
  }
}

// Subscribe to auth changes. Returns an unsubscribe fn (no-op when unconfigured).
export function onAuthChange(cb) {
  if (!authConfigured || !supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.user || null);
  });
  return () => data?.subscription?.unsubscribe?.();
}

// Pull the display fields a provider hands us, tolerating shape differences
// between Google and Apple.
export function profileFromUser(user) {
  if (!user) return null;
  const m = user.user_metadata || {};
  return {
    id: user.id,
    email: user.email || m.email || null,
    display_name: m.full_name || m.name || m.user_name || (user.email ? user.email.split("@")[0] : null),
    avatar_url: m.avatar_url || m.picture || null,
  };
}

// Upsert the profile row (id = auth uid) merging in the local score totals, then
// read it back. Returns the stored row, or null on any failure / unconfigured.
export async function upsertProfile(user, score) {
  if (!authConfigured || !supabase || !user) return null;
  const base = profileFromUser(user);
  const row = {
    id: base.id,
    email: base.email,
    display_name: base.display_name,
    avatar_url: base.avatar_url,
    total_points: score?.total || 0,
    quests_completed: score?.quests_completed || 0,
    streak_weeks: score?.streak_weeks || 0,
  };
  try {
    const { data, error } = await supabase
      .from("profiles")
      .upsert(row, { onConflict: "id" })
      .select()
      .single();
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

// Load the profile row for a user id. Returns the row or null.
export async function loadProfile(userId) {
  if (!authConfigured || !supabase || !userId) return null;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (error) return null;
    return data;
  } catch {
    return null;
  }
}

// Push the latest local score totals onto the signed-in user's profile. Used on
// quest completion. Best-effort; never throws, never blocks the quest flow.
export async function pushScore(user, score) {
  if (!authConfigured || !supabase || !user) return;
  try {
    await supabase
      .from("profiles")
      .update({
        total_points: score?.total || 0,
        quests_completed: score?.quests_completed || 0,
        streak_weeks: score?.streak_weeks || 0,
      })
      .eq("id", user.id);
  } catch {
    /* best-effort */
  }
}
