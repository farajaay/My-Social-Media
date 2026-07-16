# Signal

A single live pulse across six social channels — X, YouTube, Instagram, TikTok, Facebook, LinkedIn — in one dashboard.

## Run it

```
npm install
npm start
```

Then open `http://localhost:3000`. With no keys configured it runs entirely on demo data, clearly marked `DEMO` on every panel and in the footer status strip.

## Themes

The switch in the top bar swaps between two full themes, each with its own palette, type, panel geometry, and signature artifact — not a recolor of the same look:

- **Signal** — warm graphite and amber, an italic serif display face, chamfered panels, an animated pulse waveform.
- **Blueprint** — cobalt and white-ink, a bold grotesque display face, squared panels with corner focus-brackets, a ruler/crosshair readout, and a faint technical grid backdrop.

The choice is saved to `localStorage` and restored on reload.

## Trends & timing

Below the channel grid, `/api/stats` computes:

- **Total reach** and its week-over-week delta, summed across all six channels.
- **Blended engagement**, weighted by each channel's follower count.
- **Fastest growing** channel, from the same 7-day trend data used in each panel's sparkline.
- **Best time to post** — a day-of-week × time-of-day heatmap with the peak window called out. The grid itself is a demo model (7 days × six 4-hour dayparts); wiring real numbers in needs each platform's own post-level insights API (X API v2 tweet metrics, YouTube Analytics, Instagram/Facebook Insights, TikTok Research API, LinkedIn Analytics), most of which require elevated app review beyond what a basic key grants. The response shape is what that data would fill in.

Every panel in the grid also carries a 7-day trend badge (▲/▼ %); the spotlight panel additionally shows a sparkline. Sync re-fetches both `/api/dashboard` and `/api/stats` together.

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
server.js        Express server, /api/dashboard + /api/stats endpoints, per-platform fetchers + demo fallback
public/
  index.html     Markup, inline SVG brand-mark sprite
  styles.css     Design system: palette, type, layout
  app.js         Fetches /api/dashboard + /api/stats, renders panels/tiles/heatmap, drives the animated counters
```
