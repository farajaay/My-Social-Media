// Single persistence layer with two interchangeable backends:
//
//   - DATABASE_URL set   -> Postgres (works with Neon's free tier), so data
//     survives Render's free-tier spin-downs.
//   - DATABASE_URL unset -> local JSON files under data/ (gitignored), the
//     zero-setup path for local dev and CI.
//
// Everything except platform credentials lives here. Credentials stay in
// credentials.js (env/local file) on purpose: plaintext API tokens in a
// third-party hosted database is a worse posture than env vars.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// SIGNAL_DATA_DIR is a test hook: the suite points it at a temp dir so tests
// never touch real data. Production always uses ./data.
const DATA_DIR = process.env.SIGNAL_DATA_DIR || path.join(__dirname, 'data');
const usePg = Boolean(process.env.DATABASE_URL);

let pool = null;

// ---------------------------------------------------------------------------
// Local JSON helpers
// ---------------------------------------------------------------------------

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(name, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, name), JSON.stringify(value, null, 2));
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  if (!usePg) return { backend: 'json' };
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 3,
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS snapshots (
      id SERIAL PRIMARY KEY,
      platform_id TEXT NOT NULL,
      followers BIGINT NOT NULL,
      engagement_rate REAL,
      live BOOLEAN NOT NULL DEFAULT FALSE,
      taken_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_platform_time ON snapshots (platform_id, taken_at);
    CREATE TABLE IF NOT EXISTS competitor_snapshots (
      id SERIAL PRIMARY KEY,
      competitor_id TEXT NOT NULL,
      followers BIGINT NOT NULL,
      taken_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_comp_snapshots ON competitor_snapshots (competitor_id, taken_at);
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL
    );
  `);
  return { backend: 'postgres' };
}

function backendName() {
  return usePg ? 'postgres' : 'json';
}

// ---------------------------------------------------------------------------
// kv (goal, queue, posts, competitors live here — small collections)
// ---------------------------------------------------------------------------

async function kvGet(key, fallback) {
  if (usePg) {
    const r = await pool.query('SELECT value FROM kv WHERE key = $1', [key]);
    return r.rows.length ? r.rows[0].value : fallback;
  }
  return readJson(`${key}.json`, fallback);
}

async function kvSet(key, value) {
  if (usePg) {
    await pool.query(
      'INSERT INTO kv (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = $2::jsonb',
      [key, JSON.stringify(value)]
    );
    return;
  }
  writeJson(`${key}.json`, value);
}

async function kvDelete(key) {
  if (usePg) {
    await pool.query('DELETE FROM kv WHERE key = $1', [key]);
    return;
  }
  try {
    fs.unlinkSync(path.join(DATA_DIR, `${key}.json`));
  } catch {
    // already gone
  }
}

// ---------------------------------------------------------------------------
// Goal
// ---------------------------------------------------------------------------

async function getGoal() {
  return kvGet('goal', null);
}

async function setGoal(target) {
  await kvSet('goal', { target, setAt: new Date().toISOString() });
}

async function clearGoal() {
  await kvDelete('goal');
}

// ---------------------------------------------------------------------------
// Queue (draft posts)
// ---------------------------------------------------------------------------

async function loadQueue() {
  return kvGet('queue', []);
}

async function addDraft({ platformId, caption, day, daypart }) {
  const items = await loadQueue();
  const draft = {
    id: crypto.randomUUID(),
    platformId,
    caption,
    day,
    daypart,
    createdAt: new Date().toISOString(),
  };
  items.push(draft);
  await kvSet('queue', items);
  return draft;
}

async function removeDraft(id) {
  const items = (await loadQueue()).filter((d) => d.id !== id);
  await kvSet('queue', items);
  return items;
}

async function getDraft(id) {
  return (await loadQueue()).find((d) => d.id === id) || null;
}

// ---------------------------------------------------------------------------
// Posts (logged, actually-published posts — used to learn timing)
// ---------------------------------------------------------------------------

async function loadPosts() {
  return kvGet('posts', []);
}

async function addPost(post) {
  const posts = await loadPosts();
  posts.push({ id: crypto.randomUUID(), ...post });
  await kvSet('posts', posts);
  return posts;
}

// ---------------------------------------------------------------------------
// Competitors
// ---------------------------------------------------------------------------

async function listCompetitors() {
  return kvGet('competitors', []);
}

async function addCompetitor({ platformId, handle, name }) {
  const comps = await listCompetitors();
  const comp = { id: crypto.randomUUID(), platformId, handle, name, addedAt: new Date().toISOString() };
  comps.push(comp);
  await kvSet('competitors', comps);
  return comp;
}

async function removeCompetitor(id) {
  const comps = (await listCompetitors()).filter((c) => c.id !== id);
  await kvSet('competitors', comps);
  return comps;
}

// ---------------------------------------------------------------------------
// Snapshots (owner platforms)
// ---------------------------------------------------------------------------

const SNAPSHOT_RETENTION_DAYS = 120;

async function saveSnapshot({ platformId, followers, engagementRate, live, takenAt }) {
  const ts = takenAt || new Date().toISOString();
  if (usePg) {
    await pool.query(
      'INSERT INTO snapshots (platform_id, followers, engagement_rate, live, taken_at) VALUES ($1, $2, $3, $4, $5)',
      [platformId, followers, engagementRate ?? null, Boolean(live), ts]
    );
    return;
  }
  const all = readJson('history.json', []);
  all.push({ platformId, followers, engagementRate: engagementRate ?? null, live: Boolean(live), takenAt: ts });
  const cutoff = Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 3600 * 1000;
  writeJson('history.json', all.filter((s) => new Date(s.takenAt).getTime() >= cutoff));
}

async function getSnapshots(platformId, sinceMs) {
  if (usePg) {
    const r = await pool.query(
      'SELECT platform_id, followers, engagement_rate, live, taken_at FROM snapshots WHERE platform_id = $1 AND taken_at >= $2 ORDER BY taken_at ASC',
      [platformId, new Date(sinceMs).toISOString()]
    );
    return r.rows.map((row) => ({
      platformId: row.platform_id,
      followers: Number(row.followers),
      engagementRate: row.engagement_rate,
      live: row.live,
      takenAt: new Date(row.taken_at).toISOString(),
    }));
  }
  return readJson('history.json', [])
    .filter((s) => s.platformId === platformId && new Date(s.takenAt).getTime() >= sinceMs)
    .sort((a, b) => new Date(a.takenAt) - new Date(b.takenAt));
}

async function getLatestSnapshot(platformId) {
  if (usePg) {
    const r = await pool.query(
      'SELECT platform_id, followers, engagement_rate, live, taken_at FROM snapshots WHERE platform_id = $1 ORDER BY taken_at DESC LIMIT 1',
      [platformId]
    );
    if (!r.rows.length) return null;
    const row = r.rows[0];
    return {
      platformId: row.platform_id,
      followers: Number(row.followers),
      engagementRate: row.engagement_rate,
      live: row.live,
      takenAt: new Date(row.taken_at).toISOString(),
    };
  }
  const mine = readJson('history.json', []).filter((s) => s.platformId === platformId);
  if (!mine.length) return null;
  return mine.sort((a, b) => new Date(b.takenAt) - new Date(a.takenAt))[0];
}

async function getFirstSnapshotAfter(platformId, afterMs) {
  if (usePg) {
    const r = await pool.query(
      'SELECT followers, taken_at FROM snapshots WHERE platform_id = $1 AND taken_at >= $2 ORDER BY taken_at ASC LIMIT 1',
      [platformId, new Date(afterMs).toISOString()]
    );
    if (!r.rows.length) return null;
    return { followers: Number(r.rows[0].followers), takenAt: new Date(r.rows[0].taken_at).toISOString() };
  }
  const candidates = readJson('history.json', [])
    .filter((s) => s.platformId === platformId && new Date(s.takenAt).getTime() >= afterMs)
    .sort((a, b) => new Date(a.takenAt) - new Date(b.takenAt));
  return candidates.length ? { followers: candidates[0].followers, takenAt: candidates[0].takenAt } : null;
}

// ---------------------------------------------------------------------------
// Competitor snapshots
// ---------------------------------------------------------------------------

async function saveCompetitorSnapshot({ competitorId, followers, takenAt }) {
  const ts = takenAt || new Date().toISOString();
  if (usePg) {
    await pool.query(
      'INSERT INTO competitor_snapshots (competitor_id, followers, taken_at) VALUES ($1, $2, $3)',
      [competitorId, followers, ts]
    );
    return;
  }
  const all = readJson('competitor_history.json', []);
  all.push({ competitorId, followers, takenAt: ts });
  const cutoff = Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 3600 * 1000;
  writeJson('competitor_history.json', all.filter((s) => new Date(s.takenAt).getTime() >= cutoff));
}

async function getCompetitorSnapshots(competitorId, sinceMs) {
  if (usePg) {
    const r = await pool.query(
      'SELECT followers, taken_at FROM competitor_snapshots WHERE competitor_id = $1 AND taken_at >= $2 ORDER BY taken_at ASC',
      [competitorId, new Date(sinceMs).toISOString()]
    );
    return r.rows.map((row) => ({ followers: Number(row.followers), takenAt: new Date(row.taken_at).toISOString() }));
  }
  return readJson('competitor_history.json', [])
    .filter((s) => s.competitorId === competitorId && new Date(s.takenAt).getTime() >= sinceMs)
    .sort((a, b) => new Date(a.takenAt) - new Date(b.takenAt));
}

async function getLatestCompetitorSnapshot(competitorId) {
  const since = Date.now() - SNAPSHOT_RETENTION_DAYS * 24 * 3600 * 1000;
  const snaps = await getCompetitorSnapshots(competitorId, since);
  return snaps.length ? snaps[snaps.length - 1] : null;
}

module.exports = {
  init,
  backendName,
  kvGet,
  kvSet,
  getGoal,
  setGoal,
  clearGoal,
  loadQueue,
  addDraft,
  removeDraft,
  getDraft,
  loadPosts,
  addPost,
  listCompetitors,
  addCompetitor,
  removeCompetitor,
  saveSnapshot,
  getSnapshots,
  getLatestSnapshot,
  getFirstSnapshotAfter,
  saveCompetitorSnapshot,
  getCompetitorSnapshots,
  getLatestCompetitorSnapshot,
};
