# Signal

A single live pulse across six social channels — X, YouTube, Instagram, TikTok, Facebook, LinkedIn — in one dashboard.

## Run it

```
npm install
npm start
```

Then open `http://localhost:3000`. With no keys configured it runs entirely on demo data, clearly marked `DEMO` on every panel and in the footer status strip.

## Connect real accounts

This repo ships **no API keys**, real or fake. To pull live numbers:

1. Copy `.env.example` to `.env`.
2. Register an app with each platform you want to connect and drop the resulting credentials into `.env`. Each block in `.env.example` names the developer portal and the specific API to use:
   - **X (Twitter):** developer.x.com → API v2 → Bearer token
   - **YouTube:** console.cloud.google.com → enable "YouTube Data API v3" → API key
   - **Instagram:** developers.facebook.com → Instagram Graph API (needs a Business/Creator account linked to a Facebook Page)
   - **Facebook:** developers.facebook.com → Graph API → Page access token
   - **TikTok:** developers.tiktok.com → Login Kit + Display API → OAuth2 user token
   - **LinkedIn:** developer.linkedin.com → Community Management API (requires Partner Program approval)
3. Restart the server. Any platform with valid credentials switches to `LIVE`; anything left blank, or whose call fails, falls back to demo data rather than breaking the page.

Credentials only ever live server-side in `server.js`, read from `process.env` — they're never sent to the browser.

## Structure

```
server.js        Express server, /api/dashboard endpoint, per-platform fetchers + demo fallback
public/
  index.html     Markup, inline SVG brand-mark sprite
  styles.css     Design system: palette, type, layout
  app.js         Fetches /api/dashboard, renders panels, drives the animated counters
```
