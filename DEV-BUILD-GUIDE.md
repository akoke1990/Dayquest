# DayQuest — iOS Dev Build Walkthrough (custom map + standalone app)

Run this once your **Apple Developer Program** enrollment is approved. It produces
an installable iPhone app with the real Pokémon-GO custom map. ~30–45 min the first
time (plus cloud build wait). Do steps in order; if anything errors, stop & ask.

## Prerequisites (do these first)
- [ ] **Apple Developer Program** approved ($99/yr, Individual). — the gate
- [ ] **Expo account** created at expo.dev (free)
- [ ] **Google key:** Maps SDK for iOS **and** Maps SDK for Android enabled on your key
      (console.cloud.google.com → APIs & Services → Library → Enable each)

## 1. Put your Google key in the app config
Open `app/app.json`, find `expo.extra.GOOGLE_MAPS_API_KEY` and paste your real key:
```json
"GOOGLE_MAPS_API_KEY": "AIza...your key..."
```
🔒 **Restrict this key in Google Cloud** (Credentials → your key): under *Application
restrictions* you'll later add the iOS bundle id; under *API restrictions* keep it to
Maps SDK iOS/Android + Geocoding + Places. (This key ships inside the app, so the
restriction is what protects it — standard for mobile.)

## 2. Install the build tool + log in
In Terminal, from `~/Downloads/Dayquest-main/app`:
```bash
npm i -g eas-cli
eas login            # use your expo.dev account
```

## 3. Link the project
```bash
eas build:configure
```
Pick **iOS** (or All). This creates/links an EAS project id. If it offers to edit
app.json, let it.

## 4. Build the dev app (cloud build — takes ~10–20 min)
```bash
eas build --profile development --platform ios
```
- EAS will ask to **log in to your Apple account** and handle certificates/
  provisioning automatically — say yes to the prompts (it registers your iPhone).
- When it asks to register a device, follow the link/QR on your phone to register it.
- It uploads and builds in the cloud; you'll get a link when done.

## 5. Install on your iPhone
- Open the build link on your phone (or scan the QR EAS shows) → **Install**.
- iOS: first launch may need you to **trust the developer** (Settings → General →
  VPN & Device Management → trust your dev profile).
- This installs a **dev client** — your own DayQuest app icon, not Expo Go.

## 6. Run it
- Start the server on your Mac: `npm run serve` (from the project root).
- Start the bundler: from `app/`, `npx expo start --dev-client`.
- Open the **DayQuest dev app** on your phone → it connects to the bundler.
- **The custom Pokémon-GO map now appears** (Google provider + style). 🎉

## Later: a build to SHARE with testers
`eas build --profile preview --platform ios` makes a standalone build you can send to
testers (internal distribution / TestFlight). Their devices must be registered, or use
**TestFlight** (App Store Connect) for wider, link-based testing. We'll tackle TestFlight
distribution as its own step when you're ready for the real tester round.

## Notes
- Expo Go still works exactly as before (Apple Maps) — this doesn't replace it; the
  dev client is the *additional* path that unlocks the custom map + native modules.
- A hosted server (so testers don't depend on your Mac) is a separate, still-needed
  step for the real round — see TESTER-PLAN.md Tier 2.
