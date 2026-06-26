# DayQuest — Host the API Server (Render, free)

Goal: run the Node quest API in the cloud so the app works for anyone, anywhere,
without your Mac running. ~10 min. Free tier.

## 1. Create the service
1. Go to **render.com** → sign up / log in (use **GitHub** — fastest, and it connects your repos).
2. Dashboard → **New +** → **Web Service**.
3. **Connect a repository** → authorize Render for GitHub → pick **akoke18/Dayquest**.
   (If you don't see it, click "Configure account" and grant access to that repo.)

## 2. Configure it
| Field | Value |
|---|---|
| **Name** | `dayquest-api` |
| **Region** | Ohio (US East) |
| **Branch** | `main` |
| **Root Directory** | *(leave blank — server.js is at the repo root)* |
| **Runtime** | Node |
| **Build Command** | `npm install` |
| **Start Command** | `npm run serve` |
| **Instance Type** | **Free** |

## 3. Add your secret keys (as environment variables — NOT in code)
Scroll to **Environment Variables** → **Add** each:
- `ANTHROPIC_API_KEY` = your `sk-ant-...` key
- `GOOGLE_MAPS_API_KEY` = your `AIza...` key
- `DAYQUEST_MODEL` = `claude-sonnet-4-6`

(These live only in Render's dashboard — they're never in the repo.)

## 4. Deploy
- Click **Create Web Service**. Render runs `npm install` then `npm run serve` (~2–3 min).
- When it's live you get a URL like **`https://dayquest-api.onrender.com`**.

## 5. Test it
Open in a browser: `https://dayquest-api.onrender.com/health`
You should see JSON with `"key_configured": true`. 🎉

Then **send me that URL** — I'll point the app at it (one small config change + a redeploy of the app), so the built app calls the cloud server instead of your laptop.

## Good-to-know caveats (free tier)
- **Cold starts:** the free instance sleeps after ~15 min idle; the first request after that takes ~30–60s to wake. Fine for testing; we can upgrade to an always-on instance (~$7/mo) when we want it snappy.
- **Analytics files are ephemeral:** events/feedback/scores write to disk, which resets on each redeploy. Fine for the pilot — we'll move analytics into Supabase before it matters.
- **Node version:** if the build errors on Node version, add `"engines": { "node": ">=18" }` to the root `package.json` (tell me and I'll do it).
