# DayQuest — Quest Generator (MVP brain)

Generates a short, walkable, **storied** scavenger hunt near any location —
in the spirit of Atlas Obscura, built entirely on open data.

This is step one of the app: prove that the generated hunt is *delightful*
before building any screens. It's a single Node script that prints a quest.

## Run it

```bash
npm install                  # one time
cp .env.example .env         # then paste your Anthropic key into .env

# As a one-off command:
npm run quest                # Greenwich Village, NYC (a rich demo location)
npm run quest -- 40.7128 -74.0060   # or pass your own lat lng

# Or as an API the app will call:
npm run serve                # starts http://localhost:8787
#   GET /quest?lat=40.7308&lng=-73.9973  -> the quest JSON
```

You need an Anthropic API key: https://console.anthropic.com/settings/keys

The app should call the **server**, not Claude directly — that keeps your API
key on the server and out of the shipped app.

## How it works

1. **Wikipedia GeoSearch** (no API key) finds real geotagged places nearby and
   pulls each one's intro — that's the history/lore.
2. Those real places are numbered and handed to **Claude**, which curates 3 into
   a varied walking loop and writes the descriptions + small quests.
3. Claude returns only the **ids** it chose; the script joins them back to the
   trusted records, so coordinates and names can never be hallucinated.

The result prints to your terminal and is saved to `quest.json`.

## The mobile app (`app/`)

A minimal Expo app: get location → call `/quest` → show the hunt. To run it on
your phone:

```bash
# Terminal 1 — the API (from the project root)
npm run serve

# Terminal 2 — the app
cd app
npm install            # one time
npx expo start         # scan the QR code with the Expo Go app on your phone
```

Your phone and laptop must be on the **same Wi-Fi**, and the API server must be
running. The app auto-detects your laptop's address from Expo — no editing
needed. Get the free **Expo Go** app from the iOS/Android app store.

The app now covers Phases 2–4: location → fetch → list of stops, live GPS
check-in per stop (with a manual override), photo capture, and a completion
badge + shareable recap card. Possible next: a map view, accounts/history,
and deploying the API so the app runs off your laptop.

## Data sources & licensing

- Place data + lore: **Wikipedia** (CC BY-SA) — `source_url` is kept on every
  stop for attribution.
- Coming next (see `lib/sources.js`): **OpenStreetMap** for parks/green space,
  and a **Places API** for new/quirky spots Wikipedia won't know about.

We do **not** scrape Atlas Obscura — we borrow the *taste*, not the content.

## Files

| File | What it is |
|---|---|
| `lib/quest.js` | The core pipeline: gather → curate → join (shared) |
| `lib/sources.js` | Pluggable data sources: Wikipedia + OSM (add Places here) |
| `generate-quest.js` | CLI wrapper — prints a quest to the terminal |
| `server.js` | HTTP API the app calls: `GET /quest?lat=&lng=` |
| `quest.json` | The last generated quest (git-ignored) |
