// Social layer — friends, shared-hunt results, leaderboard.
//
// OPTIONAL, exactly like auth.js: every export is a safe no-op (returns a falsy
// value or empty array) when Supabase is unconfigured OR no user is signed in,
// so callers never need to special-case the unconfigured/guest state beyond
// gating the entry behind sign-in. Nothing here throws.
//
// The app talks DIRECTLY to Supabase for social data (RLS-protected), per
// db/MULTIPLAYER_DESIGN.md. Shared-hunt CONTENT still comes from the Node server
// (`/quest?shared=1`); this file only touches the `friendships`, `hunt_results`
// and `profiles` tables.
//
// IMPORTANT — PostgREST embedding:
//   friendships.requester_id / addressee_id and hunt_results.user_id reference
//   `auth.users`, NOT `public.profiles`. So a `.select('*, profiles(...)')`
//   embed does NOT resolve (there's no FK from these tables to profiles). Every
//   place that needs a display name/avatar therefore does a TWO-STEP fetch:
//   rows first, then `profiles.in('id', ids)`, joined in JS.

import { supabase, authConfigured } from "./supabase";

// True only when we can actually talk to Supabase as a signed-in user.
function ready(user) {
  return Boolean(authConfigured && supabase && user?.id);
}

// auth user ids are UUIDs. Guard untrusted deep-link input (the `uid` from a
// dayquest://friend link) so a malformed value yields a clean "bad link"
// message instead of a confusing PostgREST query error. RLS protects the data
// regardless; this is just UX hardening.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(v) {
  return typeof v === "string" && UUID_RE.test(v);
}

// Fetch display fields for a set of user ids → Map(id → {display_name, avatar_url}).
// Empty map on any failure (so the UI degrades to "Player" labels, never crashes).
// Requires the cross-user profiles SELECT policy (see SQL delta in the build
// notes / SUPABASE_SETUP.md). Without it this returns only the caller's own row.
export async function fetchProfiles(ids) {
  const map = new Map();
  if (!authConfigured || !supabase) return map;
  const unique = [...new Set((ids || []).filter(Boolean))];
  if (unique.length === 0) return map;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id,display_name,avatar_url")
      .in("id", unique);
    if (error || !data) return map;
    for (const p of data) map.set(p.id, p);
    return map;
  } catch {
    return map;
  }
}

// --- Friends -----------------------------------------------------------------

// Create a friend REQUEST from the signed-in user → addresseeId. Handles the
// edge cases that can't be live-tested:
//  - self-add (addressee === me): ignored.
//  - a reverse-pending request already exists (THEY requested ME): we ACCEPT it
//    instead of inserting a duplicate (which would also trip the
//    (requester_id, addressee_id) unique constraint on the other ordering only —
//    this ordering is distinct, but accepting is the right UX).
//  - an identical request/accepted row already exists: treated as success.
// Returns { ok } | { ignored, reason } | { error }.
export async function requestFriend(user, addresseeId) {
  if (!ready(user)) return { error: "Sign in to add friends." };
  if (!isUuid(addresseeId)) return { error: "That invite link looks invalid." };
  if (addresseeId === user.id) return { ignored: true, reason: "self" };
  try {
    // Is there already a friendship in EITHER direction between us?
    const { data: existing } = await supabase
      .from("friendships")
      .select("id,requester_id,addressee_id,status")
      .or(
        `and(requester_id.eq.${user.id},addressee_id.eq.${addresseeId}),` +
          `and(requester_id.eq.${addresseeId},addressee_id.eq.${user.id})`
      );
    if (existing && existing.length) {
      const row = existing[0];
      // They already requested me and it's still pending → accept it.
      if (row.requester_id === addresseeId && row.status === "pending") {
        await supabase.from("friendships").update({ status: "accepted" }).eq("id", row.id);
        return { ok: true, accepted: true };
      }
      // Otherwise the relationship already exists (pending the other way, or
      // accepted) — nothing to do.
      return { ok: true, existing: true };
    }
    const { error } = await supabase
      .from("friendships")
      .insert({ requester_id: user.id, addressee_id: addresseeId, status: "pending" });
    if (error) return { error: error.message };
    return { ok: true };
  } catch (e) {
    return { error: e?.message || "Could not send the friend request." };
  }
}

// Accept a pending request addressed to ME. RLS lets either side update; the
// addressee accepting is the intended path.
export async function acceptFriend(user, friendshipId) {
  if (!ready(user) || !friendshipId) return { error: "Sign in to accept." };
  try {
    const { error } = await supabase
      .from("friendships")
      .update({ status: "accepted" })
      .eq("id", friendshipId);
    if (error) return { error: error.message };
    return { ok: true };
  } catch (e) {
    return { error: e?.message || "Could not accept." };
  }
}

// Decline/remove a request or friendship. We DELETE the row (clean: a declined
// request can be re-sent later without tripping the unique constraint).
export async function declineFriend(user, friendshipId) {
  if (!ready(user) || !friendshipId) return { error: "Sign in to decline." };
  try {
    const { error } = await supabase.from("friendships").delete().eq("id", friendshipId);
    if (error) return { error: error.message };
    return { ok: true };
  } catch (e) {
    return { error: e?.message || "Could not decline." };
  }
}

// Load the signed-in user's friend graph, profile-joined.
// Returns { friends: [...], incoming: [...], outgoing: [...] } where each entry
// is { friendshipId, userId, display_name, avatar_url, status }. The OTHER
// person's id/profile is resolved per row. Empty lists on failure.
export async function listFriends(user) {
  const empty = { friends: [], incoming: [], outgoing: [] };
  if (!ready(user)) return empty;
  try {
    // RLS friendships_select returns every row where I'm either side.
    const { data, error } = await supabase
      .from("friendships")
      .select("id,requester_id,addressee_id,status,created_at")
      .order("created_at", { ascending: false });
    if (error || !data) return empty;

    // Resolve the OTHER user's profile for each row (two-step; see header).
    const otherIds = data.map((r) =>
      r.requester_id === user.id ? r.addressee_id : r.requester_id
    );
    const profiles = await fetchProfiles(otherIds);

    const friends = [];
    const incoming = [];
    const outgoing = [];
    for (const r of data) {
      const otherId = r.requester_id === user.id ? r.addressee_id : r.requester_id;
      const prof = profiles.get(otherId) || {};
      const entry = {
        friendshipId: r.id,
        userId: otherId,
        display_name: prof.display_name || "Player",
        avatar_url: prof.avatar_url || null,
        status: r.status,
      };
      if (r.status === "accepted") friends.push(entry);
      else if (r.addressee_id === user.id) incoming.push(entry); // they → me
      else outgoing.push(entry); // me → them, still pending
    }
    return { friends, incoming, outgoing };
  } catch {
    return empty;
  }
}

// --- Hunt results / leaderboard ---------------------------------------------

// Upsert THIS user's result for a shared hunt (one row per user per hunt). Best-
// effort; never throws, never blocks the quest flow. No-op without a hunt_id or
// a signed-in user (so solo/guest quests post nothing).
export async function postHuntResult(user, result) {
  if (!ready(user) || !result?.hunt_id) return { skipped: true };
  const row = {
    user_id: user.id,
    hunt_id: String(result.hunt_id),
    area: result.area || null,
    found_count: result.found_count || 0,
    total_stops: result.total_stops || 0,
    time_seconds: result.time_seconds ?? null,
    points: result.points || 0,
  };
  try {
    const { error } = await supabase
      .from("hunt_results")
      .upsert(row, { onConflict: "user_id,hunt_id" });
    if (error) return { error: error.message };
    return { ok: true };
  } catch (e) {
    return { error: e?.message || "Could not post result." };
  }
}

// Read the leaderboard for a shared hunt: every result row the RLS policy lets
// us see (our own + co-participants of a hunt we're in), profile-joined and
// ranked. Ranking: fastest time first (nulls last), then most found, then most
// points. Returns [{ userId, isMe, display_name, avatar_url, time_seconds,
// found_count, total_stops, points, rank }]. Empty on failure.
export async function leaderboard(user, huntId) {
  if (!ready(user) || !huntId) return [];
  try {
    const { data, error } = await supabase
      .from("hunt_results")
      .select("user_id,hunt_id,found_count,total_stops,time_seconds,points,completed_at")
      .eq("hunt_id", String(huntId));
    if (error || !data) return [];

    const profiles = await fetchProfiles(data.map((r) => r.user_id));
    const rows = data.map((r) => {
      const prof = profiles.get(r.user_id) || {};
      return {
        userId: r.user_id,
        isMe: r.user_id === user.id,
        display_name: prof.display_name || (r.user_id === user.id ? "You" : "Player"),
        avatar_url: prof.avatar_url || null,
        time_seconds: r.time_seconds,
        found_count: r.found_count || 0,
        total_stops: r.total_stops || 0,
        points: r.points || 0,
      };
    });

    rows.sort((a, b) => {
      // Fastest time wins; a null time (DNF / no timer) sorts last.
      const at = a.time_seconds == null ? Infinity : a.time_seconds;
      const bt = b.time_seconds == null ? Infinity : b.time_seconds;
      if (at !== bt) return at - bt;
      if (a.found_count !== b.found_count) return b.found_count - a.found_count;
      return b.points - a.points;
    });
    rows.forEach((r, i) => {
      r.rank = i + 1;
    });
    return rows;
  } catch {
    return [];
  }
}
