// Supabase client — OPTIONAL, anonymous-first.
//
// CRITICAL: createClient() throws ("supabaseUrl is required") when the URL/key
// are empty strings. Empty is the DEFAULT, unconfigured state — so we must NOT
// call createClient at all unless both values are present. When unconfigured we
// export `supabase = null` and `authConfigured = false`, and every call site is
// expected to null-check before touching `supabase`. This keeps the app running
// exactly as it does today (anonymous, full flow) with zero risk of an
// import-time crash.

// URL/Blob/etc. polyfills supabase-js relies on in React Native. Importing the
// "/auto" entry installs them as a side effect. Safe to import unconditionally.
import "react-native-url-polyfill/auto";

import AsyncStorage from "@react-native-async-storage/async-storage";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "../config";

// True only when BOTH credentials are non-empty. This is the single switch the
// rest of the app reads to decide whether sign-in exists at all.
export const authConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

let _supabase = null;

if (authConfigured) {
  // Lazy require so the (heavy) module graph is only pulled in when actually
  // configured — and, more importantly, so createClient is NEVER reached on the
  // empty-key path.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createClient } = require("@supabase/supabase-js");
  _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      // We handle the OAuth redirect URL ourselves (web-redirect / Expo Go
      // pattern), so the client must NOT try to read the session out of a
      // browser URL.
      detectSessionInUrl: false,
      // Match the token-in-URL pattern we parse by hand: implicit returns
      // #access_token=...&refresh_token=... in the fragment (vs. pkce's ?code=).
      flowType: "implicit",
    },
  });
}

// `null` when unconfigured. All call sites MUST null-check.
export const supabase = _supabase;
