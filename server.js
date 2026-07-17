require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const session = require('express-session');
const { getCred, isConfigured, saveCredentials, clearCredentials } = require('./credentials');
const store = require('./store');
const history = require('./history');
const notify = require('./notify');
const report = require('./report');
const { CONTENT_IDEAS } = require('./ideas');
const { AD_COST_BENCHMARKS, avgCpm } = require('./adCosts');

const app = express();
// Render (like Heroku) terminates TLS at its own proxy and forwards plain HTTP
// to the app, so without this, Express sees every request as insecure and the
// session cookie's `secure: true` flag (below) silently never gets set.
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const ADMIN_DIR = path.join(__dirname, 'admin');

// ---------------------------------------------------------------------------
// Demo data. Shown whenever a platform's env keys are missing or its live
// call fails, so the dashboard always renders something honest and labeled.
// ---------------------------------------------------------------------------
const DEMO = {
  x: { followers: 48200, engagementRate: 3.4, latestPost: 'Shipping the new pulse dashboard today.', postedAgo: '2h', trend: [46100, 46600, 47000, 46800, 47500, 47900, 48200] },
  youtube: { followers: 132000, engagementRate: 5.1, latestPost: 'Behind the scenes: building in public, ep. 12', postedAgo: '1d', trend: [128400, 129100, 129800, 130200, 130900, 131400, 132000] },
  instagram: { followers: 76300, engagementRate: 4.2, latestPost: 'Studio shots from this week’s shoot.', postedAgo: '5h', trend: [74200, 74600, 75100, 74900, 75600, 76000, 76300] },
  tiktok: { followers: 214000, engagementRate: 7.8, latestPost: '3 things nobody tells you about growth loops', postedAgo: '9h', trend: [198500, 202000, 204800, 206200, 209600, 211900, 214000] },
  facebook: { followers: 29800, engagementRate: 1.6, latestPost: 'Event recap: thanks for coming out.', postedAgo: '3d', trend: [29950, 29900, 29820, 29870, 29780, 29810, 29800] },
  linkedin: { followers: 15400, engagementRate: 2.9, latestPost: 'Hiring: senior product designer, remote.', postedAgo: '6h', trend: [14600, 14750, 14900, 15020, 15150, 15280, 15400] },
};

function demoResult(id) {
  return { id, live: false, updatedAt: new Date().toISOString(), engagementSource: 'demo', ...DEMO[id] };
}

// ---------------------------------------------------------------------------
// Real engagement, where a basic key allows it. Each helper returns a rate
// (%) or null; callers fall back to the demo rate with engagementSource
// 'demo' so a metrics failure never breaks the follower fetch. TikTok and
// LinkedIn post metrics sit behind higher API tiers, so those two stay
// demo-labeled by design.
// ---------------------------------------------------------------------------

async function youTubeEngagement(key, uploadsPlaylistId) {
  if (!uploadsPlaylistId) return null;
  const plRes = await fetch(
    `https://www.googleapis.com/youtube/v3/playlistItems?part=contentDetails&playlistId=${uploadsPlaylistId}&maxResults=10&key=${key}`
  );
  if (!plRes.ok) return null;
  const ids = ((await plRes.json()).items || []).map((i) => i.contentDetails?.videoId).filter(Boolean);
  if (!ids.length) return null;
  const vRes = await fetch(
    `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.join(',')}&key=${key}`
  );
  if (!vRes.ok) return null;
  let views = 0;
  let interactions = 0;
  ((await vRes.json()).items || []).forEach((v) => {
    const s = v.statistics || {};
    views += Number(s.viewCount || 0);
    interactions += Number(s.likeCount || 0) + Number(s.commentCount || 0);
  });
  if (!views) return null;
  return Number(((interactions / views) * 100).toFixed(1));
}

async function xEngagement(token, userId, followers) {
  if (!userId || !followers) return null;
  const res = await fetch(
    `https://api.twitter.com/2/users/${userId}/tweets?max_results=10&tweet.fields=public_metrics`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) return null;
  const tweets = (await res.json()).data || [];
  if (!tweets.length) return null;
  const total = tweets.reduce((sum, t) => {
    const m = t.public_metrics || {};
    return sum + (m.like_count || 0) + (m.retweet_count || 0) + (m.reply_count || 0) + (m.quote_count || 0);
  }, 0);
  return Number((((total / tweets.length) / followers) * 100).toFixed(1));
}

async function instagramEngagement(token, userId, followers) {
  if (!followers) return null;
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${userId}/media?fields=like_count,comments_count&limit=10&access_token=${token}`
  );
  if (!res.ok) return null;
  const items = (await res.json()).data || [];
  if (!items.length) return null;
  const total = items.reduce((sum, m) => sum + (m.like_count || 0) + (m.comments_count || 0), 0);
  return Number((((total / items.length) / followers) * 100).toFixed(1));
}

async function facebookEngagement(token, pageId, fans) {
  if (!fans) return null;
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${pageId}/posts?fields=likes.summary(true).limit(0),comments.summary(true).limit(0)&limit=10&access_token=${token}`
  );
  if (!res.ok) return null;
  const items = (await res.json()).data || [];
  if (!items.length) return null;
  const total = items.reduce(
    (sum, p) => sum + (p.likes?.summary?.total_count || 0) + (p.comments?.summary?.total_count || 0),
    0
  );
  return Number((((total / items.length) / fans) * 100).toFixed(1));
}

// ---------------------------------------------------------------------------
// Live fetchers. Each reads credentials from environment variables the
// operator supplies after registering an app with that platform. No key
// ever ships in this repo — see .env.example for the exact variable names
// and README.md for where to obtain each one. Any failure (missing key,
// expired token, rate limit) falls back to demo data rather than crashing
// the dashboard.
// ---------------------------------------------------------------------------

async function fetchX() {
  const token = getCred('TWITTER_BEARER_TOKEN');
  const username = getCred('TWITTER_USERNAME');
  if (!token || !username) return demoResult('x');
  try {
    const res = await fetch(
      `https://api.twitter.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=public_metrics`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`X API ${res.status}`);
    const { data } = await res.json();
    const followers = data.public_metrics.followers_count;
    let engagementRate = null;
    try {
      engagementRate = await xEngagement(token, data.id, followers);
    } catch {
      engagementRate = null;
    }
    return {
      id: 'x',
      live: true,
      followers,
      engagementRate: engagementRate ?? DEMO.x.engagementRate,
      engagementSource: engagementRate !== null ? 'live' : 'demo',
      latestPost: DEMO.x.latestPost,
      postedAgo: DEMO.x.postedAgo,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return demoResult('x');
  }
}

async function fetchYouTube() {
  const key = getCred('YOUTUBE_API_KEY');
  const channelId = getCred('YOUTUBE_CHANNEL_ID');
  if (!key || !channelId) return demoResult('youtube');
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=statistics,contentDetails&id=${channelId}&key=${key}`
    );
    if (!res.ok) throw new Error(`YouTube API ${res.status}`);
    const json = await res.json();
    const item = json.items?.[0];
    const stats = item?.statistics;
    if (!stats) throw new Error('no channel data');
    let engagementRate = null;
    try {
      engagementRate = await youTubeEngagement(key, item.contentDetails?.relatedPlaylists?.uploads);
    } catch {
      engagementRate = null;
    }
    return {
      id: 'youtube',
      live: true,
      followers: Number(stats.subscriberCount),
      engagementRate: engagementRate ?? DEMO.youtube.engagementRate,
      engagementSource: engagementRate !== null ? 'live' : 'demo',
      latestPost: DEMO.youtube.latestPost,
      postedAgo: DEMO.youtube.postedAgo,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return demoResult('youtube');
  }
}

async function fetchInstagram() {
  const token = getCred('INSTAGRAM_ACCESS_TOKEN');
  const userId = getCred('INSTAGRAM_USER_ID');
  if (!token || !userId) return demoResult('instagram');
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${userId}?fields=followers_count&access_token=${token}`
    );
    if (!res.ok) throw new Error(`Instagram API ${res.status}`);
    const data = await res.json();
    let engagementRate = null;
    try {
      engagementRate = await instagramEngagement(token, userId, data.followers_count);
    } catch {
      engagementRate = null;
    }
    return {
      id: 'instagram',
      live: true,
      followers: data.followers_count,
      engagementRate: engagementRate ?? DEMO.instagram.engagementRate,
      engagementSource: engagementRate !== null ? 'live' : 'demo',
      latestPost: DEMO.instagram.latestPost,
      postedAgo: DEMO.instagram.postedAgo,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return demoResult('instagram');
  }
}

async function fetchTikTok() {
  const token = getCred('TIKTOK_ACCESS_TOKEN');
  if (!token) return demoResult('tiktok');
  try {
    const res = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=follower_count', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`TikTok API ${res.status}`);
    const json = await res.json();
    const followers = json.data?.user?.follower_count;
    if (followers == null) throw new Error('no user data');
    return {
      id: 'tiktok',
      live: true,
      followers,
      engagementRate: DEMO.tiktok.engagementRate,
      engagementSource: 'demo',
      latestPost: DEMO.tiktok.latestPost,
      postedAgo: DEMO.tiktok.postedAgo,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return demoResult('tiktok');
  }
}

async function fetchFacebook() {
  const token = getCred('FACEBOOK_ACCESS_TOKEN');
  const pageId = getCred('FACEBOOK_PAGE_ID');
  if (!token || !pageId) return demoResult('facebook');
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${pageId}?fields=fan_count&access_token=${token}`
    );
    if (!res.ok) throw new Error(`Facebook API ${res.status}`);
    const data = await res.json();
    let engagementRate = null;
    try {
      engagementRate = await facebookEngagement(token, pageId, data.fan_count);
    } catch {
      engagementRate = null;
    }
    return {
      id: 'facebook',
      live: true,
      followers: data.fan_count,
      engagementRate: engagementRate ?? DEMO.facebook.engagementRate,
      engagementSource: engagementRate !== null ? 'live' : 'demo',
      latestPost: DEMO.facebook.latestPost,
      postedAgo: DEMO.facebook.postedAgo,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return demoResult('facebook');
  }
}

async function fetchLinkedIn() {
  const token = getCred('LINKEDIN_ACCESS_TOKEN');
  const orgId = getCred('LINKEDIN_ORG_ID');
  if (!token || !orgId) return demoResult('linkedin');
  try {
    const res = await fetch(
      `https://api.linkedin.com/v2/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=urn:li:organization:${orgId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`LinkedIn API ${res.status}`);
    const json = await res.json();
    const followers = json.elements?.[0]?.followerCounts?.organicFollowerCount;
    if (followers == null) throw new Error('no follower data');
    return {
      id: 'linkedin',
      live: true,
      followers,
      engagementRate: DEMO.linkedin.engagementRate,
      engagementSource: 'demo',
      latestPost: DEMO.linkedin.latestPost,
      postedAgo: DEMO.linkedin.postedAgo,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return demoResult('linkedin');
  }
}

const PLATFORMS = [
  {
    id: 'x',
    name: 'X',
    fetch: fetchX,
    fields: [
      { key: 'TWITTER_BEARER_TOKEN', label: 'Bearer token', secret: true },
      { key: 'TWITTER_USERNAME', label: 'Username', secret: false },
    ],
  },
  {
    id: 'youtube',
    name: 'YouTube',
    fetch: fetchYouTube,
    fields: [
      { key: 'YOUTUBE_API_KEY', label: 'API key', secret: true },
      { key: 'YOUTUBE_CHANNEL_ID', label: 'Channel ID', secret: false },
    ],
  },
  {
    id: 'instagram',
    name: 'Instagram',
    fetch: fetchInstagram,
    fields: [
      { key: 'INSTAGRAM_ACCESS_TOKEN', label: 'Access token', secret: true },
      { key: 'INSTAGRAM_USER_ID', label: 'IG user ID', secret: false },
    ],
  },
  {
    id: 'tiktok',
    name: 'TikTok',
    fetch: fetchTikTok,
    fields: [{ key: 'TIKTOK_ACCESS_TOKEN', label: 'Access token', secret: true }],
  },
  {
    id: 'facebook',
    name: 'Facebook',
    fetch: fetchFacebook,
    fields: [
      { key: 'FACEBOOK_ACCESS_TOKEN', label: 'Access token', secret: true },
      { key: 'FACEBOOK_PAGE_ID', label: 'Page ID', secret: false },
    ],
  },
  {
    id: 'linkedin',
    name: 'LinkedIn',
    fetch: fetchLinkedIn,
    fields: [
      { key: 'LINKEDIN_ACCESS_TOKEN', label: 'Access token', secret: true },
      { key: 'LINKEDIN_ORG_ID', label: 'Organization ID', secret: false },
    ],
  },
];

// ---------------------------------------------------------------------------
// Competitors: public follower counts for accounts you choose to track,
// fetched with your own keys through the same official APIs as your own
// panels. Scoped to YouTube (any channel ID works with a plain API key) and
// X (any public username works with a bearer token) — the platforms where
// public lookup reliably works at basic API tiers. No scraping.
// ---------------------------------------------------------------------------

const COMPETITOR_PLATFORMS = [
  {
    id: 'youtube',
    name: 'YouTube',
    handleLabel: 'Channel ID',
    keyName: 'YOUTUBE_API_KEY',
    async lookup(handle) {
      const key = getCred('YOUTUBE_API_KEY');
      if (!key) return null;
      const res = await fetch(
        `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${encodeURIComponent(handle)}&key=${key}`
      );
      if (!res.ok) return null;
      const stats = (await res.json()).items?.[0]?.statistics;
      return stats ? Number(stats.subscriberCount) : null;
    },
  },
  {
    id: 'x',
    name: 'X',
    handleLabel: 'Username',
    keyName: 'TWITTER_BEARER_TOKEN',
    async lookup(handle) {
      const token = getCred('TWITTER_BEARER_TOKEN');
      if (!token) return null;
      const res = await fetch(
        `https://api.twitter.com/2/users/by/username/${encodeURIComponent(handle.replace(/^@/, ''))}?user.fields=public_metrics`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!res.ok) return null;
      const data = (await res.json()).data;
      return data ? data.public_metrics.followers_count : null;
    },
  },
];

const MAX_COMPETITORS = 5;
const competitorSnapshotAt = new Map();

async function recordCompetitorSnapshots() {
  const comps = await store.listCompetitors();
  const now = Date.now();
  for (const c of comps) {
    const cached = competitorSnapshotAt.get(c.id) || 0;
    if (now - cached < 60 * 60 * 1000) continue;
    const latest = await store.getLatestCompetitorSnapshot(c.id);
    if (latest && now - new Date(latest.takenAt).getTime() < 60 * 60 * 1000) {
      competitorSnapshotAt.set(c.id, new Date(latest.takenAt).getTime());
      continue;
    }
    try {
      const platform = COMPETITOR_PLATFORMS.find((p) => p.id === c.platformId);
      const followers = platform ? await platform.lookup(c.handle) : null;
      if (followers != null) {
        await store.saveCompetitorSnapshot({ competitorId: c.id, followers });
        competitorSnapshotAt.set(c.id, now);
      }
    } catch {
      // a failed competitor lookup never breaks the sync
    }
  }
}

// ---------------------------------------------------------------------------
// Admin auth. A single owner account protected by one password (ADMIN_PASSWORD)
// — this is a personal dashboard for your own accounts, not a multi-user app.
// The admin page is where you paste your own API keys instead of hand-editing
// .env; nothing here is reachable without a valid session.
// ---------------------------------------------------------------------------

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');

if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET not set in .env — using a random secret for this run. Admin sessions will not survive a restart until you set one.');
}
if (!ADMIN_PASSWORD) {
  console.warn('ADMIN_PASSWORD not set in .env — the admin page stays locked out until you set one.');
}

function safeCompare(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, Buffer.alloc(bufA.length));
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

// Simple in-memory throttle: a personal single-instance tool doesn't need a
// shared store for this, and it resets on restart along with everything else.
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 8;

function underRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return true;
  }
  entry.count += 1;
  return entry.count <= LOGIN_MAX_ATTEMPTS;
}

function requireAuthPage(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.redirect('/admin/login');
}

function requireAuthApi(req, res, next) {
  if (req.session && req.session.authed) return next();
  return res.status(401).json({ error: 'Not authenticated' });
}

function requireCsrf(req, res, next) {
  const token = req.get('x-csrf-token');
  if (!token || !req.session.csrfToken || token !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Invalid or missing CSRF token' });
  }
  next();
}

app.use(express.json());
app.use(
  session({
    name: 'signal.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 8 * 60 * 60 * 1000,
    },
  })
);

// index: false so GET / falls through to the templated route below, which
// fills in the absolute og:image URL (link scrapers won't resolve relative
// image paths).
app.use(express.static('public', { index: false }));

let indexTemplate = null;
app.get('/', (req, res) => {
  if (!indexTemplate) indexTemplate = require('fs').readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
  const origin = `${req.protocol}://${req.get('host')}`;
  res.type('html').send(indexTemplate.replace(/__ORIGIN__/g, origin));
});

async function getPlatformResults() {
  const results = await Promise.all(PLATFORMS.map((p) => p.fetch()));
  const named = results.map((r, i) => ({ name: PLATFORMS[i].name, ...r }));
  // Persist history (throttled internally) and swap real trends into live
  // platforms. Failures here must never take down a dashboard request.
  try {
    await history.recordSnapshots(named);
    await history.applyRealTrends(named);
    await recordCompetitorSnapshots();
    await maybeSendWeeklyDigest(named);
  } catch (err) {
    console.error('history engine error:', err.message);
  }
  return named;
}

// ---------------------------------------------------------------------------
// Weekly digest. Gathers the same numbers the dashboard shows and pushes a
// summary to NOTIFY_WEBHOOK_URL once every 7 days, riding the normal sync
// cadence (and the daily wake-up ping on free-tier hosting). The first sync
// after configuring only arms the timer — no digest spam on install day.
// ---------------------------------------------------------------------------

const DIGEST_INTERVAL_MS = 7 * 24 * 3600 * 1000;

async function buildDigestData(platforms) {
  const totals = computeTotals(platforms);
  return {
    generatedAt: new Date().toISOString(),
    totals,
    platforms: platforms.map((p) => ({
      name: p.name,
      followers: p.followers,
      engagementRate: p.engagementRate,
      trend: p.trend,
      trendPct: platformTrendPct(p),
      trendSource: p.trendSource,
      live: p.live,
    })),
    goal: await computeGoalProgress(totals),
    timing: await buildTimingGrid(),
    queueCount: (await store.loadQueue()).length,
    topPromotion: (() => {
      const top = computePromotionRanking(platforms)[0];
      return top ? { name: top.name || top.id, costPerEngagement: top.costPerEngagement } : null;
    })(),
  };
}

async function maybeSendWeeklyDigest(platforms) {
  if (!notify.isConfigured()) return;
  const last = await store.kvGet('last_digest_at', null);
  if (!last) {
    await store.kvSet('last_digest_at', new Date().toISOString());
    return;
  }
  if (Date.now() - new Date(last).getTime() < DIGEST_INTERVAL_MS) return;
  const text = report.formatDigest(await buildDigestData(platforms));
  const sent = await notify.sendNotification(text);
  if (sent) await store.kvSet('last_digest_at', new Date().toISOString());
}

app.get('/api/dashboard', async (_req, res) => {
  const platforms = await getPlatformResults();
  res.json({ generatedAt: new Date().toISOString(), platforms });
});

// ---------------------------------------------------------------------------
// Stats: aggregate KPIs, per-platform growth, and a best-time-to-post model.
// The timing grid is a demo model (7 days x six 4-hour dayparts) — wiring it
// to real per-post analytics needs each platform's own post-level insights
// API (X API v2 tweet metrics, YouTube Analytics, Instagram/Facebook Insights,
// TikTok Research API, LinkedIn Analytics), which needs elevated app review
// on most of these platforms. The shape here is what that data would fill.
// ---------------------------------------------------------------------------

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAYPARTS = ['12a', '4a', '8a', '12p', '4p', '8p'];

// Engagement index (0-100) per [day][daypart]. Modeled on a common real
// pattern: quiet overnight, a commute bump, a midweek evening peak.
const TIMING_MODEL = [
  [10, 22, 48, 55, 78, 60], // Mon
  [9, 20, 50, 58, 88, 65],  // Tue
  [11, 21, 52, 60, 92, 68], // Wed
  [10, 19, 49, 57, 85, 70], // Thu
  [12, 18, 45, 52, 74, 76], // Fri
  [15, 25, 62, 66, 70, 72], // Sat
  [14, 28, 58, 64, 80, 66], // Sun
];

// Which day/daypart slot a timestamp falls in (server clock, UTC on Render).
function slotFor(date) {
  return {
    day: DAYS[(date.getDay() + 6) % 7],
    daypart: DAYPARTS[Math.floor(date.getHours() / 4)],
  };
}

// Score logged posts by real outcome: the follower delta in the ~24h after
// posting, read straight from the snapshot history — no manual data entry.
// Posts younger than 24h (or with no usable snapshots around them) stay
// unscored until the data exists.
const PERSONALIZATION_MIN_POSTS = 10;

async function getScoredPosts() {
  const posts = await store.loadPosts();
  const scored = [];
  for (const p of posts) {
    if (p.followersBefore == null) continue;
    const after = await store.getFirstSnapshotAfter(p.platformId, new Date(p.postedAt).getTime() + 24 * 3600 * 1000);
    if (!after) continue;
    scored.push({ day: p.day, daypart: p.daypart, delta: after.followers - p.followersBefore });
  }
  return { total: posts.length, scored };
}

// Hybrid timing grid: the static industry model until enough logged posts
// exist, then cells with real outcomes take over (normalized 20-100 so a
// below-average personal slot still reads as present, not empty). Cells you
// have never posted in keep the model value.
async function buildTimingGrid() {
  const { scored } = await getScoredPosts();
  const grid = TIMING_MODEL.map((row) => row.slice());
  let source = 'model';

  if (scored.length >= PERSONALIZATION_MIN_POSTS) {
    source = 'personalized';
    const agg = new Map();
    scored.forEach((s) => {
      const key = `${s.day}|${s.daypart}`;
      const a = agg.get(key) || { sum: 0, count: 0 };
      a.sum += s.delta;
      a.count += 1;
      agg.set(key, a);
    });
    const avgs = [...agg.values()].map((a) => a.sum / a.count);
    const min = Math.min(...avgs);
    const span = Math.max(...avgs) - min || 1;
    DAYS.forEach((day, di) => {
      DAYPARTS.forEach((part, pi) => {
        const a = agg.get(`${day}|${part}`);
        if (a) grid[di][pi] = Math.round(20 + 80 * ((a.sum / a.count - min) / span));
      });
    });
  }

  let best = { day: DAYS[0], daypart: DAYPARTS[0], index: -1 };
  const cells = [];
  grid.forEach((row, dayIdx) => {
    row.forEach((index, partIdx) => {
      cells.push({ day: DAYS[dayIdx], daypart: DAYPARTS[partIdx], index });
      if (index > best.index) best = { day: DAYS[dayIdx], daypart: DAYPARTS[partIdx], index };
    });
  });
  return { days: DAYS, dayparts: DAYPARTS, cells, best, source, postsLogged: scored.length, postsNeeded: PERSONALIZATION_MIN_POSTS };
}

function platformTrendPct(platform) {
  if (!Array.isArray(platform.trend) || platform.trend.length < 2) return null;
  const [first] = platform.trend;
  const last = platform.trend[platform.trend.length - 1];
  if (!first) return null;
  return ((last - first) / first) * 100;
}

function computeTotals(platforms) {
  const followers = platforms.reduce((sum, p) => sum + p.followers, 0);
  const blendedEngagement =
    platforms.reduce((sum, p) => sum + p.engagementRate * p.followers, 0) / (followers || 1);
  const weeklyDeltaFollowers = platforms.reduce((sum, p) => {
    if (!Array.isArray(p.trend) || p.trend.length < 2) return sum;
    return sum + (p.trend[p.trend.length - 1] - p.trend[0]);
  }, 0);
  return { followers, weeklyDeltaFollowers, blendedEngagement: Number(blendedEngagement.toFixed(2)) };
}

app.get('/api/stats', async (_req, res) => {
  const platforms = await getPlatformResults();
  const totals = computeTotals(platforms);

  const growth = platforms
    .map((p) => ({ id: p.id, name: p.name, pct: platformTrendPct(p) }))
    .filter((p) => p.pct !== null);

  const topByEngagement = [...platforms].sort((a, b) => b.engagementRate - a.engagementRate)[0];
  const fastestGrowing = growth.length ? [...growth].sort((a, b) => b.pct - a.pct)[0] : null;

  res.json({
    generatedAt: new Date().toISOString(),
    totals,
    topByEngagement: { id: topByEngagement.id, name: topByEngagement.name, engagementRate: topByEngagement.engagementRate },
    fastestGrowing,
    timing: await buildTimingGrid(),
  });
});

// ---------------------------------------------------------------------------
// Growth goal: a single target for total reach across all channels, set from
// the admin page. Progress and the projected hit-date are computed fresh on
// every request from the same 7-day trend data the dashboard already shows —
// a plain linear projection off the current daily rate, not a forecast model,
// and it says so on the label rather than pretending to more certainty than
// a straight line from six data points deserves.
// ---------------------------------------------------------------------------

async function computeGoalProgress(totals) {
  const goal = await store.getGoal();
  if (!goal || !goal.target) return null;

  const dailyRate = totals.weeklyDeltaFollowers / 7;
  const remaining = goal.target - totals.followers;
  const reached = remaining <= 0;

  let projectedDate = null;
  let daysToGoal = null;
  if (!reached && dailyRate > 0) {
    daysToGoal = Math.ceil(remaining / dailyRate);
    const d = new Date();
    d.setDate(d.getDate() + daysToGoal);
    projectedDate = d.toISOString().slice(0, 10);
  }

  return {
    target: goal.target,
    current: totals.followers,
    pct: Math.min(100, Math.round((totals.followers / goal.target) * 100)),
    dailyRate: Math.round(dailyRate),
    reached,
    daysToGoal,
    projectedDate,
  };
}

app.get('/api/goal', async (_req, res) => {
  const platforms = await getPlatformResults();
  const totals = computeTotals(platforms);
  res.json({ goal: await computeGoalProgress(totals) });
});

// ---------------------------------------------------------------------------
// Content ideas: a static, curated prompt bank — not personal data, so it's
// public and needs no auth. Edit ideas.js directly to customize it.
// ---------------------------------------------------------------------------

app.get('/api/ideas', (_req, res) => {
  res.json({ ideas: CONTENT_IDEAS });
});

// ---------------------------------------------------------------------------
// Promotion advisor: which channel is the best value to put paid spend
// behind right now, and roughly how a budget might split across channels.
// The cost side is a static industry-average benchmark (adCosts.js), NOT a
// live quote from any ad platform's auction — those move constantly with
// targeting, audience size, season, and competition. This blends that
// benchmark with each platform's actual current engagement rate and 7-day
// trend (the same numbers already on the dashboard) into a ranking; it is a
// planning aid, not a media-buying recommendation to act on blindly.
// ---------------------------------------------------------------------------

function computePromotionRanking(platforms) {
  const engagementRates = platforms.map((p) => p.engagementRate);
  const trends = platforms.map((p) => platformTrendPct(p) ?? 0);
  const cpms = platforms.map((p) => avgCpm(p.id));

  const norm = (v, min, max) => (max === min ? 0.5 : (v - min) / (max - min));
  const minEng = Math.min(...engagementRates), maxEng = Math.max(...engagementRates);
  const minTrend = Math.min(...trends), maxTrend = Math.max(...trends);
  const minCpm = Math.min(...cpms), maxCpm = Math.max(...cpms);

  return platforms
    .map((p, i) => {
      const trendPct = Number((trends[i]).toFixed(1));
      const cpm = cpms[i];
      const engScore = norm(p.engagementRate, minEng, maxEng);
      const trendScore = norm(trends[i], minTrend, maxTrend);
      const costScore = 1 - norm(cpm, minCpm, maxCpm);
      const score = engScore * 0.4 + trendScore * 0.3 + costScore * 0.3;
      // $ per engagement: 1,000 impressions at this CPM buy (engagementRate%) engagements.
      const costPerEngagement = Number((cpm / (10 * p.engagementRate)).toFixed(2));
      return {
        id: p.id,
        name: p.name,
        engagementRate: p.engagementRate,
        trendPct,
        cpmLow: AD_COST_BENCHMARKS[p.id].cpmLow,
        cpmHigh: AD_COST_BENCHMARKS[p.id].cpmHigh,
        costPerEngagement,
        note: AD_COST_BENCHMARKS[p.id].note,
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
}

function allocateBudget(ranked, totalBudget) {
  const totalScore = ranked.reduce((sum, p) => sum + Math.max(p.score, 0.05), 0);
  return ranked.map((p) => {
    const weight = Math.max(p.score, 0.05) / totalScore;
    const allocated = Math.round((totalBudget * weight) / 5) * 5;
    const avgCpmVal = (p.cpmLow + p.cpmHigh) / 2;
    const estImpressions = allocated > 0 ? Math.round((allocated / avgCpmVal) * 1000) : 0;
    const estEngagements = Math.round(estImpressions * (p.engagementRate / 100));
    return { ...p, allocated, pct: Math.round(weight * 100), estImpressions, estEngagements };
  });
}

app.get('/api/promotion', async (req, res) => {
  const platforms = await getPlatformResults();
  const budgetRaw = Number(req.query.budget);
  const budget = Number.isFinite(budgetRaw) && budgetRaw > 0 ? Math.min(budgetRaw, 1_000_000) : 500;

  const ranked = computePromotionRanking(platforms);
  const allocation = allocateBudget(ranked, budget);
  const top = allocation[0];
  const timing = await buildTimingGrid();

  let trendPhrase = '';
  if (top.trendPct > 0) trendPhrase = `growing ${top.trendPct}%/week, `;
  else if (top.trendPct < 0) trendPhrase = `even while down ${Math.abs(top.trendPct)}%/week, `;

  res.json({
    budget,
    recommendation: {
      platformId: top.id,
      platformName: top.name,
      reason: `Highest engagement (${top.engagementRate}%), ${trendPhrase}at an estimated $${top.costPerEngagement}/engagement — the best mix of resonance and cost right now.`,
    },
    timingSuggestion: { day: timing.best.day, daypart: timing.best.daypart },
    platforms: allocation,
  });
});

// ---------------------------------------------------------------------------
// Versus: your growth against tracked competitors on the same platform, over
// the last 7 days of daily snapshots. Every series is indexed to 100 at the
// start of the shared window — never raw counts on one chart, since a 2M
// channel and a 20K channel on the same axis says nothing about growth.
// ---------------------------------------------------------------------------

function dailyPoints(snaps) {
  const byDay = new Map();
  snaps.forEach((s) => byDay.set(s.takenAt.slice(0, 10), s.followers));
  return [...byDay.entries()].map(([date, followers]) => ({ date, followers }));
}

function indexSeries(points) {
  const base = points[0].followers || 1;
  return points.map((p) => ({ date: p.date, indexed: Number(((p.followers / base) * 100).toFixed(2)) }));
}

app.get('/api/versus', async (_req, res) => {
  const comps = await store.listCompetitors();
  if (!comps.length) return res.json({ groups: [], windowDays: 7 });

  const since = Date.now() - 8 * 24 * 3600 * 1000;
  const byPlatform = new Map();
  comps.forEach((c) => {
    const arr = byPlatform.get(c.platformId) || [];
    arr.push(c);
    byPlatform.set(c.platformId, arr);
  });

  const groups = [];
  for (const [platformId, platformComps] of byPlatform) {
    const series = [];
    const pending = [];

    const ownPoints = dailyPoints(await store.getSnapshots(platformId, since));
    if (ownPoints.length >= 2) series.push({ name: 'You', you: true, points: indexSeries(ownPoints) });

    for (const c of platformComps) {
      const pts = dailyPoints(await store.getCompetitorSnapshots(c.id, since));
      if (pts.length >= 2) series.push({ name: c.name, you: false, points: indexSeries(pts) });
      else pending.push(c.name);
    }

    const platformName =
      PLATFORMS.find((p) => p.id === platformId)?.name ||
      COMPETITOR_PLATFORMS.find((p) => p.id === platformId)?.name ||
      platformId;
    groups.push({ platformId, platformName, series, pending });
  }

  res.json({ groups, windowDays: 7 });
});

// ---------------------------------------------------------------------------
// Shareable output: an SVG stat card and a weekly report (print-styled HTML
// + markdown download). Public — same numbers as the dashboard, nothing
// sensitive; all three build from the same data object as the digest.
// ---------------------------------------------------------------------------

app.get('/card.svg', async (req, res) => {
  const platforms = await getPlatformResults();
  const data = await buildDigestData(platforms);
  const theme = req.query.theme === 'blueprint' ? 'blueprint' : 'signal';
  res.type('image/svg+xml').send(report.buildCardSvg(data, theme));
});

app.get('/report', async (_req, res) => {
  const platforms = await getPlatformResults();
  const data = await buildDigestData(platforms);
  res.type('html').send(report.formatReportHtml(data));
});

app.get('/report.md', async (_req, res) => {
  const platforms = await getPlatformResults();
  const data = await buildDigestData(platforms);
  res
    .type('text/markdown')
    .set('Content-Disposition', 'attachment; filename="signal-weekly-report.md"')
    .send(report.formatReportMarkdown(data));
});

// ---------------------------------------------------------------------------
// Admin: login and the credentials editor. Static admin assets live outside
// public/ (which express.static serves unauthenticated) and are only ever
// sent through these gated routes, so there's no path that reaches them
// without a valid session.
// ---------------------------------------------------------------------------

app.get('/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(503).sendFile(path.join(ADMIN_DIR, 'setup-needed.html'));
  if (req.session.authed) return res.redirect('/admin');
  res.sendFile(path.join(ADMIN_DIR, 'login.html'));
});

app.get('/admin/login.js', (req, res) => {
  res.sendFile(path.join(ADMIN_DIR, 'login.js'));
});

app.post('/admin/login', (req, res) => {
  if (!underRateLimit(req.ip)) {
    return res.status(429).json({ error: 'Too many attempts. Try again in a few minutes.' });
  }
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({ error: 'ADMIN_PASSWORD is not set on the server.' });
  }
  const { password } = req.body || {};
  if (typeof password !== 'string' || !password || !safeCompare(password, ADMIN_PASSWORD)) {
    return res.status(401).json({ error: 'Incorrect password.' });
  }
  loginAttempts.delete(req.ip);
  req.session.authed = true;
  req.session.csrfToken = crypto.randomBytes(24).toString('hex');
  res.json({ ok: true });
});

app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('signal.sid');
    res.json({ ok: true });
  });
});

app.get('/admin', requireAuthPage, (req, res) => {
  res.sendFile(path.join(ADMIN_DIR, 'dashboard.html'));
});

app.get('/admin/dashboard.js', requireAuthPage, (req, res) => {
  res.sendFile(path.join(ADMIN_DIR, 'dashboard.js'));
});

function platformFieldStatus(platform) {
  return platform.fields.map((f) => ({ key: f.key, label: f.label, secret: f.secret, configured: isConfigured(f.key) }));
}

app.get('/api/admin/bootstrap', requireAuthApi, async (_req, res) => {
  res.json({
    csrfToken: _req.session.csrfToken,
    platforms: PLATFORMS.map((p) => ({ id: p.id, name: p.name, fields: platformFieldStatus(p) })),
    goal: await store.getGoal(),
    days: DAYS,
    dayparts: DAYPARTS,
    notifyConfigured: notify.isConfigured(),
  });
});

// Send (or preview) the weekly digest on demand — the admin's way to check
// the webhook wiring without waiting a week. Returns the digest text either
// way, so it's previewable even before NOTIFY_WEBHOOK_URL is set.
app.post('/api/admin/notify/test', requireAuthApi, requireCsrf, async (_req, res) => {
  const platforms = await getPlatformResults();
  const text = report.formatDigest(await buildDigestData(platforms));
  const sent = await notify.sendNotification(text);
  res.json({ ok: true, configured: notify.isConfigured(), sent, preview: text });
});

app.post('/api/admin/credentials', requireAuthApi, requireCsrf, (req, res) => {
  const { platformId, values } = req.body || {};
  const platform = PLATFORMS.find((p) => p.id === platformId);
  if (!platform) return res.status(400).json({ error: 'Unknown platform.' });
  if (!values || typeof values !== 'object') return res.status(400).json({ error: 'Missing values.' });
  saveCredentials(platform.fields.map((f) => f.key), values);
  res.json({ ok: true, fields: platformFieldStatus(platform) });
});

app.post('/api/admin/credentials/clear', requireAuthApi, requireCsrf, (req, res) => {
  const { platformId } = req.body || {};
  const platform = PLATFORMS.find((p) => p.id === platformId);
  if (!platform) return res.status(400).json({ error: 'Unknown platform.' });
  clearCredentials(platform.fields.map((f) => f.key));
  res.json({ ok: true, fields: platformFieldStatus(platform) });
});

// --- Growth goal (admin-managed; progress itself is public via /api/goal) ---

app.post('/api/admin/goal', requireAuthApi, requireCsrf, async (req, res) => {
  const target = Number(req.body && req.body.target);
  if (!Number.isFinite(target) || target <= 0 || target > 1_000_000_000) {
    return res.status(400).json({ error: 'Target must be a positive number.' });
  }
  await store.setGoal(Math.round(target));
  res.json({ ok: true, goal: await store.getGoal() });
});

app.post('/api/admin/goal/clear', requireAuthApi, requireCsrf, async (_req, res) => {
  await store.clearGoal();
  res.json({ ok: true });
});

// --- Content queue: a planning list, not a publisher. Nothing here posts to
// any platform — actually publishing would need write-scoped OAuth and app
// review per platform, well beyond a read-only dashboard's key. This just
// keeps drafts next to the best-time-to-post data so you can plan against it.

app.get('/api/admin/queue', requireAuthApi, async (_req, res) => {
  res.json({ queue: await store.loadQueue() });
});

app.post('/api/admin/queue', requireAuthApi, requireCsrf, async (req, res) => {
  const { platformId, caption, day, daypart } = req.body || {};
  if (!PLATFORMS.some((p) => p.id === platformId)) return res.status(400).json({ error: 'Unknown platform.' });
  if (typeof caption !== 'string' || !caption.trim()) return res.status(400).json({ error: 'Caption is required.' });
  if (caption.length > 500) return res.status(400).json({ error: 'Caption is too long (500 char max).' });
  if (!DAYS.includes(day)) return res.status(400).json({ error: 'Unknown day.' });
  if (!DAYPARTS.includes(daypart)) return res.status(400).json({ error: 'Unknown time slot.' });

  const draft = await store.addDraft({ platformId, caption: caption.trim(), day, daypart });
  res.json({ ok: true, draft, queue: await store.loadQueue() });
});

app.post('/api/admin/queue/delete', requireAuthApi, requireCsrf, async (req, res) => {
  const { id } = req.body || {};
  if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'Missing id.' });
  const queue = await store.removeDraft(id);
  res.json({ ok: true, queue });
});

// Mark a draft as actually posted. Logs the real posting moment's day/time
// slot and the follower count at that point (from the latest snapshot), so
// the timing heatmap can learn from what actually happened. The 24h outcome
// is scored automatically from later snapshots — nothing manual to fill in.
app.post('/api/admin/queue/posted', requireAuthApi, requireCsrf, async (req, res) => {
  const { id } = req.body || {};
  if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'Missing id.' });
  const draft = await store.getDraft(id);
  if (!draft) return res.status(404).json({ error: 'Draft not found.' });

  const latest = await store.getLatestSnapshot(draft.platformId);
  const now = new Date();
  const slot = slotFor(now);
  await store.addPost({
    platformId: draft.platformId,
    caption: draft.caption,
    plannedDay: draft.day,
    plannedDaypart: draft.daypart,
    day: slot.day,
    daypart: slot.daypart,
    postedAt: now.toISOString(),
    followersBefore: latest ? latest.followers : null,
  });
  const queue = await store.removeDraft(id);
  const posts = await store.loadPosts();
  res.json({ ok: true, queue, postsLogged: posts.length });
});

// --- Competitors (admin-managed; the comparison itself is public via /api/versus) ---

function competitorPlatformInfo() {
  return COMPETITOR_PLATFORMS.map((p) => ({
    id: p.id,
    name: p.name,
    handleLabel: p.handleLabel,
    keyConfigured: isConfigured(p.keyName),
    keyName: p.keyName,
  }));
}

app.get('/api/admin/competitors', requireAuthApi, async (_req, res) => {
  res.json({ competitors: await store.listCompetitors(), platforms: competitorPlatformInfo(), max: MAX_COMPETITORS });
});

app.post('/api/admin/competitors', requireAuthApi, requireCsrf, async (req, res) => {
  const { platformId, handle, name } = req.body || {};
  const platform = COMPETITOR_PLATFORMS.find((p) => p.id === platformId);
  if (!platform) return res.status(400).json({ error: 'Competitors are supported on YouTube and X only.' });
  if (typeof handle !== 'string' || !handle.trim() || handle.length > 100) {
    return res.status(400).json({ error: `${platform.handleLabel} is required.` });
  }
  if (typeof name !== 'string' || !name.trim() || name.length > 60) {
    return res.status(400).json({ error: 'Display name is required (60 chars max).' });
  }
  const existing = await store.listCompetitors();
  if (existing.length >= MAX_COMPETITORS) {
    return res.status(400).json({ error: `Cap of ${MAX_COMPETITORS} competitors — remove one first (API rate limits).` });
  }

  const comp = await store.addCompetitor({ platformId, handle: handle.trim(), name: name.trim() });
  // Take the first snapshot immediately when the key allows, so the Versus
  // comparison can start counting days from right now.
  try {
    const followers = await platform.lookup(comp.handle);
    if (followers != null) await store.saveCompetitorSnapshot({ competitorId: comp.id, followers });
  } catch {
    // first snapshot is best-effort; the sync cadence will retry
  }
  res.json({ ok: true, competitors: await store.listCompetitors(), platforms: competitorPlatformInfo(), max: MAX_COMPETITORS });
});

app.post('/api/admin/competitors/delete', requireAuthApi, requireCsrf, async (req, res) => {
  const { id } = req.body || {};
  if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'Missing id.' });
  const competitors = await store.removeCompetitor(id);
  res.json({ ok: true, competitors, platforms: competitorPlatformInfo(), max: MAX_COMPETITORS });
});

// ---------------------------------------------------------------------------
// Boot: initialize the store (Postgres when DATABASE_URL is set, local JSON
// otherwise), then start serving. A catch-up sync at boot plus a 6-hour
// interval keeps daily snapshots flowing — the boot sync is what makes this
// work on Render's free tier, where the process sleeps between visits and
// the interval never fires.
// ---------------------------------------------------------------------------

if (require.main === module) {
  store
    .init()
    .then(({ backend }) => {
      app.listen(PORT, () => {
        console.log(`Signal running at http://localhost:${PORT} (store: ${backend})`);
        getPlatformResults().catch((err) => console.error('boot sync failed:', err.message));
        setInterval(() => {
          getPlatformResults().catch((err) => console.error('scheduled sync failed:', err.message));
        }, 6 * 60 * 60 * 1000);
      });
    })
    .catch((err) => {
      console.error('store init failed:', err.message);
      process.exit(1);
    });
}

// Exported for the test suite (test/*.test.js) — requiring this module does
// not start the server; only running it directly does.
module.exports = {
  app,
  computeTotals,
  computeGoalProgress,
  computePromotionRanking,
  allocateBudget,
  buildTimingGrid,
  slotFor,
  dailyPoints,
  indexSeries,
  DAYS,
  DAYPARTS,
};
