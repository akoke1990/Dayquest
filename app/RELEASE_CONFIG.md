# DayQuest iOS release configuration

`app.config.js` is the only Expo app-config source. Do not add `app.json`: Expo
Doctor treats simultaneous static and dynamic config as ambiguous. The dynamic
config defaults `GOOGLE_MAPS_API_KEY` to an empty string, so no Google credential
is committed, while an EAS-selected environment can inject the key into Expo
runtime config and both native map configurations.

## EAS environments

`eas.json` maps each build profile to its same-named EAS environment:

| Profile | Distribution | EAS environment |
| --- | --- | --- |
| `development` | Internal development client | `development` |
| `preview` | Internal standalone build | `preview` |
| `production` | App Store build | `production` |

Create `GOOGLE_MAPS_API_KEY` separately in every environment that builds a
working map. The key must enable Maps SDK for iOS and Maps SDK for Android. Use
Google Cloud application/API restrictions: iOS bundle ID
`com.akoke18.dayquest`, the Android app identity when finalized, and only the
required Maps APIs. A mobile Maps key is embedded in the binary by design, so
restrictions—not obscurity—protect it.

Example commands (require Expo login and intentionally are **not** run as part
of repository verification):

```bash
eas env:set development --name GOOGLE_MAPS_API_KEY --visibility sensitive
eas env:set preview --name GOOGLE_MAPS_API_KEY --visibility sensitive
eas env:set production --name GOOGLE_MAPS_API_KEY --visibility sensitive
```

For a local effective-config or prebuild check, pass a temporary shell value;
an omitted value deliberately exercises the safe blank-key configuration:

```bash
GOOGLE_MAPS_API_KEY='local-restricted-key' npx expo config --type public
npx expo prebuild --platform ios --clean --no-install
```

The committed Supabase URL and publishable/anon key are client identifiers, not
server secrets, and are protected by Supabase RLS. Never place a service-role
key, Apple credential, signing certificate, or private key in Expo config.

## Version and build-number policy

- `app.config.js` owns the user-visible semantic version (`version`, currently
  `1.0.0`). Bump it deliberately for App Store releases.
- `ios.buildNumber` is a local/native-generation fallback (`1`).
- EAS is authoritative for uploaded iOS build numbers:
  `cli.appVersionSource` is `remote`, and the production profile has
  `autoIncrement: true`. Never hand-edit build numbers merely to retry a
  production EAS build.

## iOS scope and permissions

- Portrait is preserved. `supportsTablet` is false for v1 because this UI has
  no proved iPad test coverage.
- Foreground/when-in-use location supports quest discovery and check-in. No
  background location mode is enabled.
- Camera access supports stop photos and collectible capture. Photo-library
  access supports the fallback picker. Microphone permission is explicitly
  disabled because DayQuest records no audio.
- Local notification permission supports the optional scheduled hunt reminder.
  `with-local-notifications-only` strips `aps-environment`; remote push/APNs is
  not enabled.
- Sign in with Apple remains enabled because the iOS sign-in UI calls
  `expo-apple-authentication`.

## Deterministic release checks

From `app/`:

```bash
npm ci
npm run test:release-config
npx expo-doctor
npx expo config --type public --json
npx expo config --type introspect --json
npx expo prebuild --platform ios --clean --no-install
npx expo export --platform ios --output-dir /tmp/dayquest-ios-export
```

Prebuild and export do not sign, upload, deploy, or request Apple credentials.
Delete generated `ios/` after inspection; it is gitignored.