const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SIGNAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-export-'));
process.env.ADMIN_PASSWORD = 'test-password-123';
process.env.SESSION_SECRET = 'test-secret';
// Canary values — none of these should ever appear in an export response.
// EXPORT_TOKEN itself is deliberately left unset in this file so the
// session-only fallback path is what's under test (see export-token.test.js
// for the token-gated path, in its own process since env vars are
// module-load-time reads).
process.env.TWITTER_BEARER_TOKEN = 'leak-canary-bearer-token';
process.env.NOTIFY_WEBHOOK_URL = 'https://hooks.slack.com/leak-canary-webhook';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../server');
const store = require('../store');
const exporter = require('../export');

let server;
let base;
let cookie;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://localhost:${server.address().port}`;

  const now = Date.now();
  const at = (daysAgo) => new Date(now - daysAgo * 24 * 3600 * 1000).toISOString();
  await store.saveSnapshot({ platformId: 'x', followers: 1000, engagementRate: 2.1, live: true, takenAt: at(5) });
  await store.saveSnapshot({ platformId: 'x', followers: 1050, engagementRate: 2.3, live: true, takenAt: at(1) });
  await store.saveSnapshot({ platformId: 'youtube', followers: 500, engagementRate: 1.1, live: false, takenAt: at(1) });

  const comp = await store.addCompetitor({ platformId: 'x', handle: '@rival', name: 'Rival' });
  await store.saveCompetitorSnapshot({ competitorId: comp.id, followers: 800, takenAt: at(1) });

  const loginRes = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-password-123' }),
  });
  cookie = sessionCookie(loginRes);
});

after(() => server.close());

function sessionCookie(res) {
  const setCookie = res.headers.get('set-cookie') || '';
  return setCookie.split(';')[0];
}

test('/api/export requires auth: no session -> 401', async () => {
  const res = await fetch(`${base}/api/export`);
  assert.equal(res.status, 401);
});

test('/api/export with an admin session returns the full shape', async () => {
  const res = await fetch(`${base}/api/export`, { headers: { Cookie: cookie } });
  assert.equal(res.status, 200);
  const doc = await res.json();

  for (const key of ['meta', 'snapshots', 'engagement_history', 'posts', 'competitors', 'context']) {
    assert.ok(key in doc, `missing top-level key: ${key}`);
  }

  assert.ok(doc.snapshots.length > 0);
  doc.snapshots.forEach((row) => {
    assert.ok(['real', 'demo'].includes(row.provenance));
    assert.deepEqual(row.reach_metric, { type: null, value: null });
  });

  assert.ok(doc.context.capabilities);
  assert.equal(doc.context.capabilities.views_impressions, false);
  assert.equal(doc.context.capabilities.per_post_outcome_metrics, false);
  assert.equal(doc.context.schema_version, '1.0');
});

test('/api/export never leaks credentials or webhook URLs', async () => {
  const doc = await (await fetch(`${base}/api/export`, { headers: { Cookie: cookie } })).json();
  const blob = JSON.stringify(doc);
  assert.ok(!blob.includes('leak-canary-bearer-token'));
  assert.ok(!blob.includes('leak-canary-webhook'));
  assert.ok(!blob.includes('test-password-123'));
  assert.ok(!blob.includes('test-secret'));

  const csv = await (await fetch(`${base}/api/export.csv`, { headers: { Cookie: cookie } })).text();
  assert.ok(!csv.includes('leak-canary-bearer-token'));
  assert.ok(!csv.includes('leak-canary-webhook'));
});

test('/api/export filters by since and platform', async () => {
  const all = await (await fetch(`${base}/api/export?platform=x`, { headers: { Cookie: cookie } })).json();
  assert.ok(all.snapshots.every((s) => s.platform_id === 'x'));
  assert.equal(all.snapshots.length, 2);

  const now = Date.now();
  const since = new Date(now - 2 * 24 * 3600 * 1000).toISOString();
  const recent = await (await fetch(`${base}/api/export?platform=x&since=${since}`, { headers: { Cookie: cookie } })).json();
  assert.equal(recent.snapshots.length, 1);
});

test('/api/export.csv row count matches the JSON snapshot count for the same params', async () => {
  const json = await (await fetch(`${base}/api/export?platform=x`, { headers: { Cookie: cookie } })).json();

  const csvRes = await fetch(`${base}/api/export.csv?platform=x`, { headers: { Cookie: cookie } });
  assert.equal(csvRes.status, 200);
  assert.match(csvRes.headers.get('content-type'), /text\/csv/);
  assert.match(csvRes.headers.get('content-disposition'), /attachment/);
  const csvText = await csvRes.text();
  const rows = csvText.trim().split('\n');
  assert.equal(rows.length - 1, json.snapshots.length);
});

test('competitors export raw counts and timestamps, not an indexed series', async () => {
  const doc = await (await fetch(`${base}/api/export`, { headers: { Cookie: cookie } })).json();
  assert.equal(doc.competitors.length, 1);
  assert.equal(doc.competitors[0].snapshots[0].followers, 800);
  assert.ok(doc.competitors[0].snapshots[0].taken_at);
});

test('computeViralFlags: a clear outlier gets flagged true against a >=5-post baseline', () => {
  const base_ts = Date.now();
  const posts = [];
  // 10 baseline posts, all a modest ~1% delta.
  for (let i = 1; i <= 10; i++) {
    posts.push({
      id: `baseline-${i}`,
      platformId: 'x',
      postedAt: new Date(base_ts - i * 24 * 3600 * 1000).toISOString(),
      followersBefore: 10000,
      delta: 100,
    });
  }
  // Newest post: a massive outlier.
  posts.push({
    id: 'outlier',
    platformId: 'x',
    postedAt: new Date(base_ts).toISOString(),
    followersBefore: 10000,
    delta: 5000,
  });

  const flags = exporter.computeViralFlags(posts);
  assert.equal(flags.get('outlier'), true);
  assert.equal(flags.get('baseline-1'), false, 'a typical post is not flagged as viral');
  assert.equal(flags.get('baseline-10'), null, 'the oldest post has no trailing posts left to be judged against');
});

test('computeViralFlags: fewer than 5 trailing posts yields null, not false', () => {
  const base_ts = Date.now();
  const posts = [
    { id: 'p1', platformId: 'x', postedAt: new Date(base_ts - 2 * 24 * 3600 * 1000).toISOString(), followersBefore: 1000, delta: 10 },
    { id: 'p2', platformId: 'x', postedAt: new Date(base_ts - 1 * 24 * 3600 * 1000).toISOString(), followersBefore: 1000, delta: 10 },
    { id: 'p3', platformId: 'x', postedAt: new Date(base_ts).toISOString(), followersBefore: 1000, delta: 10 },
  ];
  const flags = exporter.computeViralFlags(posts);
  assert.equal(flags.get('p3'), null);
});
