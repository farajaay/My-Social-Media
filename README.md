# Signal

A single live pulse across six social channels — X, YouTube, Instagram, TikTok, Facebook, LinkedIn — in one dashboard.

## Run it

```
npm install
npm start
```

Then open `http://localhost:3000`. With no keys configured it runs entirely on demo data, clearly marked `DEMO` on every panel and in the footer status strip.

## Themes

The switch in the top bar cycles between three full themes, each with its own palette, type, panel geometry, and signature artifact — not a recolor of the same look:

- **Signal** — warm graphite and amber, an italic serif display face, chamfered panels, an animated pulse waveform.
- **Blueprint** — cobalt and white-ink, a bold grotesque display face, squared panels with corner focus-brackets, a ruler/crosshair readout, and a faint technical grid backdrop.
- **Almanac** — deep forest green and parchment ink, a warm slab serif display face, torn-edge panels with a small ink-dot corner mark, an animated tree-ring growth diagram, and a faint concentric-ring watermark.

The choice is saved to `localStorage` and restored on reload.

## Data & persistence

Signal accumulates **real follower history**: every sync snapshots each LIVE platform's numbers (throttled to once per hour per platform), and once a platform has two or more days of snapshots, its 7-day trend, sparkline, goal projection, and promotion score are computed from *your actual data* instead of the demo arrays. Every trend is labeled with its provenance — `real`, `demo`, or `collecting` (a live account still gathering its first days). Demo platforms are never snapshotted, so fake numbers can't masquerade as history.

Two storage backends, chosen automatically at boot:

- **`DATABASE_URL` set** → Postgres. [Neon](https://neon.tech)'s free tier works well: create a project, copy the connection string, set it as an env var. Tables are created automatically on first boot. This is the right choice for Render's free tier, where the local filesystem is wiped on every spin-down.
- **`DATABASE_URL` unset** → local JSON files under `data/` (gitignored). Zero setup; perfect for local dev.

Goal, queue, logged posts, and competitors live in the same store. **Platform credentials deliberately do not** — plaintext API tokens in a hosted third-party database is a worse security posture than env vars, so they stay in `.env`/`data/credentials.json` as before.

Snapshots need the server to actually run once a day. Locally and on paid hosting a 6-hour interval handles it; on Render's free tier (which sleeps between visits) the CI workflow includes a **daily wake-up ping** — set a `RENDER_APP_URL` repository *variable* (Settings → Secrets and variables → Actions → Variables) to your deployed URL and GitHub Actions will hit `/api/dashboard` every morning, triggering the boot-time catch-up snapshot. Without the variable, the job skips silently.

## Trends & timing

Below the channel grid, `/api/stats` computes:

- **Total reach** and its week-over-week delta, summed across all six channels.
- **Blended engagement**, weighted by each channel's follower count.
- **Fastest growing** channel, from the same 7-day trend data used in each panel's sparkline.
- **Best time to post** — a day-of-week × time-of-day heatmap with the peak window called out. It starts as an industry model and **learns from your actual posts**: mark a queue draft as posted (admin → Content queue → "Mark as posted"), and the server logs the real posting slot plus your follower count at that moment. Each post's outcome — the follower delta over the next 24h — is scored automatically from the snapshot history, nothing manual. After 10 scored posts, cells you've posted in switch to your real per-slot performance (normalized 20–100); slots you've never tried keep the model value. The heatmap footer always says which mode it's in.

Engagement rates are also real where a basic key allows: YouTube ((likes+comments)/views over the last 10 uploads) and X ((likes+reposts+replies)/followers over recent tweets) work with the same credentials you already entered; Instagram/Facebook are attempted via the Graph token and fall back gracefully; TikTok and LinkedIn post metrics sit behind higher API tiers, so those stay demo-labeled — a live panel showing an estimated rate marks it "(est.)".

Every panel in the grid also carries a 7-day trend badge (▲/▼ %); the spotlight panel additionally shows a sparkline. Sync re-fetches both `/api/dashboard` and `/api/stats` together.

## Growth goal

Set a total-follower target from `/admin` → **Growth goal**. The public dashboard shows a progress meter (`GET /api/goal`) with a projected hit-date: a plain straight-line projection from the current 7-day daily rate, not a forecasting model — it says so in its own label rather than pretending to more certainty than six data points support. No goal set means no meter; the dashboard says so instead of making one up.

## Content queue

`/admin` → **Content queue** lets you draft posts (platform, caption, and a day/time slot picked from the same grid the best-time-to-post heatmap uses) and keeps them in a simple list. **This is a planning tool, not a publisher** — nothing here posts to any platform automatically. Actually publishing on your behalf would need write-scoped OAuth and an app-review pass from each platform individually, well beyond what a read-only dashboard key grants; this just keeps your ideas organized next to the timing data so you can act on them yourself. Drafts live in the store (see **Data & persistence**), same pattern as everything else the admin page manages.

## Content ideas

The public dashboard's **Need an idea?** card pulls from a curated bank of ~24 specific, non-generic prompts in `ideas.js` — edit that file directly to make it your own; there's no admin UI for it since it's reference material, not personal data. `GET /api/ideas` is public and needs no auth.

## Shareable output

Three ways to take your numbers with you, all built from the same data as the dashboard:

- **`/card.svg`** (footer → "Stat card") — a 1200×630 share-card SVG with total reach, week delta, engagement, and the spotlight channel's sparkline, in whichever theme you're using (`?theme=signal|blueprint`). Server-generated string templating, no image libraries.
- **`/report`** (footer → "Weekly report") — a print-styled weekly report page: per-channel table with 7-day deltas and data provenance, goal pace, best posting window, and the current best paid value (labeled a benchmark estimate). **`/report.md`** downloads the same as markdown for pasting into email or a sponsor deck.
- **OG tags** — sharing the dashboard link unfurls with a branded 1200×630 image (`public/og.png`, pre-rendered and committed; no runtime raster dependency). `GET /` templates the absolute image URL from the request host, so it works wherever you deploy without configuration.

## Data export

For handing your growth data to an external tool — a statistical model, an AI agent, a spreadsheet — rather than reading it off the dashboard:

- **`GET /api/export`** — a raw JSON dump: `snapshots` (full follower history, all platforms, with `provenance: "real"|"demo"` so you can exclude demo data), `engagement_history` (the same rows' engagement rate over time), `posts` (every logged "Mark as posted" entry, with content type, topic tags, caption length, hashtag count, has-CTA, and a `viral_flag` computed against each platform's trailing 30 scored posts), `competitors` (raw follower counts + timestamps per tracked account), and `context` (goal, ad-cost benchmarks, heatmap mode, per-platform LIVE/DEMO status, and a `confidence` block reporting how many real snapshot-days and scored posts each platform has, so the consumer can judge its own confidence rather than be told). Supports `?since=<ISO date>` and `?platform=all|<id>`.
- **`GET /api/export.csv`** — the `snapshots` table only, as CSV, for a quick spreadsheet import.
- **Auth** — an admin session works, or set `EXPORT_TOKEN` and send it back as the `X-Export-Token` header so an external tool never needs your admin password. Leave `EXPORT_TOKEN` unset to require an admin session for export access too.
- **Honesty note** — per-post impressions/likes/comments/shares/saves and per-snapshot views/impressions are always `null`: this app has no write-scoped OAuth to any platform, so there's nothing to look those up against. `context.capabilities` says so explicitly rather than the export pretending otherwise.

## Notifications

Set `NOTIFY_WEBHOOK_URL` (a Discord or Slack incoming-webhook URL — env-only, since webhook URLs are capability secrets) and the dashboard comes to you:

- **Weekly digest** — total reach and week delta, fastest-growing channel, any declining channels, goal progress with the projected date, your best posting window, and how many drafts are queued. Sent once every 7 days, riding the normal sync cadence (the daily wake-up ping keeps it flowing on free-tier hosting). The first sync after configuring only arms the timer, so no digest spam on install day.
- **Milestone alerts** — one message the first time a platform crosses 10K/25K/50K/100K/250K/500K/1M followers, deduped permanently in the store so a count wobbling around a threshold can't re-fire it. The very first snapshot of a platform never announces (that's learning its size, not crossing a line).

Admin → **Notifications** has a "Send test digest" button that also works as a preview when no webhook is configured. Payload shape is auto-detected: Discord gets `{content}`, Slack and everything else `{text}`. A webhook failure never breaks a sync or a request.

## Versus (competitor tracking)

Track up to 5 public accounts (admin → **Competitors**) and the dashboard grows a **Versus** section comparing your growth against theirs, from the same daily snapshots. Every line is indexed to 100 at the start of the 7-day window, so a huge channel and a small one compare fairly — the slope is the story, not the size. You render in the accent color; tracked accounts recede into grays, with the window delta next to each name in the legend.

Scope is deliberately honest: **YouTube** (any channel ID, via your existing API key) and **X** (any public username, via your existing bearer token) — the two platforms where public lookup reliably works at basic API tiers. Public follower counts only, read through the official APIs; no scraping. A comparison line appears once both sides have two days of snapshots; until then the section says it's collecting.

## Promotion advisor

**"Where to put paid spend"**, below the timing heatmap, answers two questions people usually guess at: which channel is the best value to boost right now, and roughly how a budget should split across channels.

**This is a planning estimate, not a live ad quote.** `adCosts.js` holds a static table of typical industry-average CPM ranges per platform (X, YouTube, Instagram, TikTok, Facebook, LinkedIn) — real ad prices are set by each platform's own auction and move constantly with targeting, audience size, season, and competition. `GET /api/promotion?budget=N` blends that static benchmark with your *actual* current engagement rate and 7-day trend (the same numbers already on the dashboard) into a 0–1 score per platform: 40% engagement, 30% momentum, 30% cost-efficiency. The result:

- A ranked list of all six channels with the benchmark CPM range, an estimated cost-per-engagement (derived from the CPM and that channel's real engagement rate), a suggested slice of your test budget, and a rough estimated-reach figure.
- A plain-language callout naming the top pick and why, plus a timing nudge that reuses the heatmap's own peak window — paid tends to go further riding a window your audience is already active in rather than posting cold.

Before spending anything for real, check the actual platform: Meta Ads Manager (Instagram/Facebook), X Ads, TikTok Ads Manager, YouTube/Google Ads, LinkedIn Campaign Manager. Nothing here submits a real campaign or touches any ad account — it's arithmetic over public benchmark numbers and your own dashboard data, entirely client-triggered, no auth needed since no personal data is involved.

## Connect your own accounts

This is built for one owner running their own accounts — not a multi-tenant app. This repo ships **no API keys**, real or fake. To pull live numbers:

1. Set `ADMIN_PASSWORD` in `.env` (see **Admin & security** below) and start the server.
2. Register an app with each platform you want to connect. Quick reference (see **[docs/API_KEYS.md](docs/API_KEYS.md) for the full click-by-click walkthrough** of each one, including where every screen and button lives):
   - **X (Twitter):** developer.x.com → API v2 → Bearer token
   - **YouTube:** console.cloud.google.com → enable "YouTube Data API v3" → API key
   - **Instagram:** developers.facebook.com → Instagram Graph API (needs a Business/Creator account linked to a Facebook Page)
   - **Facebook:** developers.facebook.com → Graph API → Page access token
   - **TikTok:** developers.tiktok.com → Login Kit + Display API → OAuth2 user token (requires app review)
   - **LinkedIn:** developer.linkedin.com → Community Management API (requires Partner Program approval)
3. Log in at `/admin` and paste each credential into its field, then **Save**. It takes effect on the next sync — no restart, no editing `.env` by hand. (You can still set the same variable names in `.env` instead if you prefer; the admin page's saved values win if both are set.)

Any platform with valid credentials switches to `LIVE` on the dashboard; anything left blank, or whose call fails, falls back to demo data rather than breaking the page. Credentials are read server-side only (`server.js` / `credentials.js`) — the browser never receives them, whether the request is from the public dashboard or a logged-in admin session.

## Admin & security

- **The dashboard (`/`) stays public** — anyone with the link can see follower counts, trends, and timing. It contains no credentials and no admin controls.
- **`/admin` is where you connect accounts**, and it's locked out entirely until you set `ADMIN_PASSWORD` in `.env`. There is no default password shipped with this app.
- Logging in starts a signed, `httpOnly`, `SameSite=Strict` session cookie (`express-session`); set `SESSION_SECRET` in `.env` too, or a random one is generated at boot (fine for local use, but it means a restart invalidates existing sessions).
- Login attempts are throttled per IP (8 tries / 15 minutes) and the password check runs in constant time.
- Every state-changing admin request (`POST /api/admin/credentials`, `/clear`) requires a CSRF token issued at login, on top of the session cookie.
- The admin API never echoes a saved secret back to the browser — only whether each field is currently set. Saved values live in `data/credentials.json` (gitignored, `0600` permissions) on the server's own disk, merged with `.env` at request time.
- If you deploy this somewhere reachable over the internet, put it behind HTTPS — the session cookie is marked `secure` automatically when `NODE_ENV=production`.

## Deploy (Render)

This needs an always-on process, not a serverless/static host — sessions and the admin-saved `data/credentials.json` both depend on a persistent, long-running server. Render's free web service fits.

**One-click:**

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/farajaay/My-Social-Media)

Render reads `render.yaml` in this repo and provisions the service automatically. It'll prompt you for `ADMIN_PASSWORD` and `SESSION_SECRET` during setup — pick a strong password; generate the secret with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**Manual setup**, if you'd rather not use the blueprint:

1. On Render: **New → Web Service** → connect this GitHub repo.
2. Build command: `npm install`. Start command: `npm start`.
3. Add environment variables: `NODE_ENV=production`, `ADMIN_PASSWORD`, `SESSION_SECRET` (same command as above). Leave platform keys (`TWITTER_BEARER_TOKEN`, etc.) unset for now — you'll add those from `/admin` after it's live, or set them here too if you'd rather.
4. Deploy. Once it's up, visit `https://<your-service>.onrender.com/admin` to log in and connect your accounts.

**Free-tier caveat:** Render's free plan spins the service down after inactivity and gives it a fresh filesystem on wake, so local files don't survive a spin-down — only real environment variables do. Setting `DATABASE_URL` (see **Data & persistence**) makes follower history, goal, queue, posts, and competitors fully durable. Credentials are the one thing that stays file/env-based by design: set them as Render env vars for durability (requires a redeploy to change), or re-enter them via `/admin` after a spin-down, or upgrade to a paid instance with a persistent disk at `/opt/render/project/src/data`.

## CI/CD

`.github/workflows/ci-cd.yml` ties GitHub and Render together end to end:

1. **On every push and pull request**: installs dependencies, syntax-checks `server.js`, `credentials.js`, the admin scripts, and `public/app.js`, then actually boots the server and hits `/`, `/api/dashboard`, `/api/stats`, and `/admin/login` to catch startup crashes the syntax check alone would miss.
2. **On push to the default branch only, once those checks pass**: POSTs to a Render **Deploy Hook** URL to trigger a deploy — but only if you've added one, so this step no-ops harmlessly until you opt in.

To wire up the deploy step:

1. In Render, open this service → **Settings → Deploy Hook** → copy the URL.
2. In GitHub: repo **Settings → Secrets and variables → Actions → New repository secret**, name it `RENDER_DEPLOY_HOOK_URL`, paste the URL.

That's the only setup needed — the workflow already looks for that secret.

**Avoiding double deploys:** Render can also auto-deploy on every push by itself (its default behavior once a repo is connected), independent of this workflow. If you want CI to be the gate — i.e., a broken boot never gets pushed live — turn off Render's own **Auto-Deploy** in the service's Settings and let this workflow's Deploy Hook call be the only trigger. If you'd rather keep Render's instant auto-deploy, that's fine too; just leave `RENDER_DEPLOY_HOOK_URL` unset and this workflow will only run checks.

## Structure

```
server.js         Express server: public /api/dashboard + /api/stats + /api/goal + /api/ideas + /api/promotion + /api/versus, gated /admin + /api/admin/*, per-platform fetchers + demo fallback
credentials.js     Local credential store the admin page reads/writes (data/credentials.json, gitignored)
store.js           Persistence layer: Postgres when DATABASE_URL is set, local JSON otherwise (goal, queue, posts, competitors, follower history)
history.js         History engine: hourly-throttled snapshots of live platforms, real 7-day trends with provenance, milestone alerts
notify.js          Webhook sender (NOTIFY_WEBHOOK_URL, Discord/Slack auto-detect) + milestone threshold math
report.js          Pure formatters for the digest (and shareable reports) — takes data, returns text
test/              node:test suite (npm test): store, history, analytics, HTTP auth gates, notifications
ideas.js           Static content-idea prompt bank — edit directly, no admin UI
adCosts.js         Static ad-cost CPM benchmarks per platform — edit directly, no admin UI
render.yaml        Render Blueprint — one-click deploy config
.github/workflows/
  ci-cd.yml        Syntax + boot smoke test on every push/PR, then triggers a Render deploy hook on the default branch
admin/
  login.html/js    Password login, rate-limited
  dashboard.html/js  Credentials editor (protected)
  setup-needed.html  Shown if ADMIN_PASSWORD isn't set yet
public/
  index.html       Markup, inline SVG brand-mark sprite
  styles.css       Design system: palette, type, layout (shared by admin/ pages too)
  app.js           Fetches /api/dashboard + /api/stats, renders panels/tiles/heatmap, drives the animated counters
```
