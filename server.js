require('dotenv').config();
const crypto = require('crypto');
const path = require('path');
const express = require('express');
const session = require('express-session');
const { getCred, isConfigured, saveCredentials, clearCredentials } = require('./credentials');
const { getGoal, setGoal, clearGoal } = require('./goals');
const { loadQueue, addDraft, removeDraft } = require('./queue');
const { CONTENT_IDEAS } = require('./ideas');

const app = express();
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
  return { id, live: false, updatedAt: new Date().toISOString(), ...DEMO[id] };
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
    return {
      id: 'x',
      live: true,
      followers: data.public_metrics.followers_count,
      engagementRate: DEMO.x.engagementRate,
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
      `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelId}&key=${key}`
    );
    if (!res.ok) throw new Error(`YouTube API ${res.status}`);
    const json = await res.json();
    const stats = json.items?.[0]?.statistics;
    if (!stats) throw new Error('no channel data');
    return {
      id: 'youtube',
      live: true,
      followers: Number(stats.subscriberCount),
      engagementRate: DEMO.youtube.engagementRate,
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
    return {
      id: 'instagram',
      live: true,
      followers: data.followers_count,
      engagementRate: DEMO.instagram.engagementRate,
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
    return {
      id: 'facebook',
      live: true,
      followers: data.fan_count,
      engagementRate: DEMO.facebook.engagementRate,
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

app.use(express.static('public'));

async function getPlatformResults() {
  const results = await Promise.all(PLATFORMS.map((p) => p.fetch()));
  return results.map((r, i) => ({ name: PLATFORMS[i].name, ...r }));
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

function buildTimingGrid() {
  let best = { day: DAYS[0], daypart: DAYPARTS[0], index: -1 };
  const cells = [];
  TIMING_MODEL.forEach((row, dayIdx) => {
    row.forEach((index, partIdx) => {
      cells.push({ day: DAYS[dayIdx], daypart: DAYPARTS[partIdx], index });
      if (index > best.index) best = { day: DAYS[dayIdx], daypart: DAYPARTS[partIdx], index };
    });
  });
  return { days: DAYS, dayparts: DAYPARTS, cells, best };
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
    timing: buildTimingGrid(),
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

function computeGoalProgress(totals) {
  const goal = getGoal();
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
  res.json({ goal: computeGoalProgress(totals) });
});

// ---------------------------------------------------------------------------
// Content ideas: a static, curated prompt bank — not personal data, so it's
// public and needs no auth. Edit ideas.js directly to customize it.
// ---------------------------------------------------------------------------

app.get('/api/ideas', (_req, res) => {
  res.json({ ideas: CONTENT_IDEAS });
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

app.get('/api/admin/bootstrap', requireAuthApi, (_req, res) => {
  res.json({
    csrfToken: _req.session.csrfToken,
    platforms: PLATFORMS.map((p) => ({ id: p.id, name: p.name, fields: platformFieldStatus(p) })),
    goal: getGoal(),
    days: DAYS,
    dayparts: DAYPARTS,
  });
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

app.post('/api/admin/goal', requireAuthApi, requireCsrf, (req, res) => {
  const target = Number(req.body && req.body.target);
  if (!Number.isFinite(target) || target <= 0 || target > 1_000_000_000) {
    return res.status(400).json({ error: 'Target must be a positive number.' });
  }
  setGoal(Math.round(target));
  res.json({ ok: true, goal: getGoal() });
});

app.post('/api/admin/goal/clear', requireAuthApi, requireCsrf, (_req, res) => {
  clearGoal();
  res.json({ ok: true });
});

// --- Content queue: a planning list, not a publisher. Nothing here posts to
// any platform — actually publishing would need write-scoped OAuth and app
// review per platform, well beyond a read-only dashboard's key. This just
// keeps drafts next to the best-time-to-post data so you can plan against it.

app.get('/api/admin/queue', requireAuthApi, (_req, res) => {
  res.json({ queue: loadQueue() });
});

app.post('/api/admin/queue', requireAuthApi, requireCsrf, (req, res) => {
  const { platformId, caption, day, daypart } = req.body || {};
  if (!PLATFORMS.some((p) => p.id === platformId)) return res.status(400).json({ error: 'Unknown platform.' });
  if (typeof caption !== 'string' || !caption.trim()) return res.status(400).json({ error: 'Caption is required.' });
  if (caption.length > 500) return res.status(400).json({ error: 'Caption is too long (500 char max).' });
  if (!DAYS.includes(day)) return res.status(400).json({ error: 'Unknown day.' });
  if (!DAYPARTS.includes(daypart)) return res.status(400).json({ error: 'Unknown time slot.' });

  const draft = addDraft({ platformId, caption: caption.trim(), day, daypart });
  res.json({ ok: true, draft, queue: loadQueue() });
});

app.post('/api/admin/queue/delete', requireAuthApi, requireCsrf, (req, res) => {
  const { id } = req.body || {};
  if (typeof id !== 'string' || !id) return res.status(400).json({ error: 'Missing id.' });
  const queue = removeDraft(id);
  res.json({ ok: true, queue });
});

app.listen(PORT, () => {
  console.log(`Signal running at http://localhost:${PORT}`);
});
