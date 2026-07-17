const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

process.env.SIGNAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-notify-'));

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const notify = require('../notify');
const report = require('../report');
const store = require('../store');
const history = require('../history');

// Mock webhook receiver capturing every POST body.
const received = [];
let mock;

before(async () => {
  mock = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.writeHead(200).end('ok');
    });
  });
  await new Promise((resolve) => mock.listen(0, resolve));
  process.env.NOTIFY_WEBHOOK_URL = `http://localhost:${mock.address().port}/hook`;
});

after(() => mock.close());

test('crossedThresholds: ascending thresholds between prev and next', () => {
  assert.deepEqual(notify.crossedThresholds(9000, 26000), [10_000, 25_000]);
  assert.deepEqual(notify.crossedThresholds(50_000, 50_000), []);
  assert.deepEqual(notify.crossedThresholds(49_999, 50_000), [50_000]);
  assert.deepEqual(notify.crossedThresholds(null, 500_000), [], 'first snapshot never announces');
});

test('sendNotification posts generic {text} payload and reports success', async () => {
  const ok = await notify.sendNotification('hello world');
  assert.equal(ok, true);
  assert.deepEqual(received.at(-1), { text: 'hello world' });
});

test('sendNotification is a silent no-op without a webhook URL', async () => {
  const saved = process.env.NOTIFY_WEBHOOK_URL;
  delete process.env.NOTIFY_WEBHOOK_URL;
  assert.equal(notify.isConfigured(), false);
  assert.equal(await notify.sendNotification('dropped'), false);
  process.env.NOTIFY_WEBHOOK_URL = saved;
});

test('milestone alert fires exactly once per threshold across syncs', async () => {
  const countBefore = received.length;

  // First snapshot ever: establishes 49K, no announcement.
  await history.recordSnapshots([{ id: 'yt', name: 'YouTube', live: true, followers: 49_000, engagementRate: 5 }]);
  assert.equal(received.length, countBefore);

  // Backdate the stored snapshot so the hourly throttle lets the next one through.
  const histPath = path.join(process.env.SIGNAL_DATA_DIR, 'history.json');
  const snaps = JSON.parse(fs.readFileSync(histPath, 'utf8'));
  snaps.forEach((s) => (s.takenAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString()));
  fs.writeFileSync(histPath, JSON.stringify(snaps));
  history.__resetThrottleForTests?.();

  // Crossing 50K announces once.
  await history.recordSnapshots([{ id: 'yt', name: 'YouTube', live: true, followers: 51_000, engagementRate: 5 }]);
  assert.equal(received.length, countBefore + 1);
  assert.match(received.at(-1).text, /YouTube crossed 50K followers/);

  // Same threshold never fires again even if counts wobble around it.
  const snaps2 = JSON.parse(fs.readFileSync(histPath, 'utf8'));
  snaps2.forEach((s) => (s.takenAt = new Date(Date.now() - 2 * 3600 * 1000).toISOString()));
  snaps2[snaps2.length - 1].followers = 49_500;
  fs.writeFileSync(histPath, JSON.stringify(snaps2));
  history.__resetThrottleForTests?.();
  await history.recordSnapshots([{ id: 'yt', name: 'YouTube', live: true, followers: 52_000, engagementRate: 5 }]);
  assert.equal(received.length, countBefore + 1, 'deduped via milestones_fired');
});

test('digest formatter covers totals, decline, goal, window, and queue', () => {
  const text = report.formatDigest({
    generatedAt: new Date().toISOString(),
    totals: { followers: 515_700, weeklyDeltaFollowers: 23_950, blendedEngagement: 5.66 },
    platforms: [
      { name: 'TikTok', followers: 214_000, engagementRate: 7.8, trendPct: 7.8, trendSource: 'demo', live: false },
      { name: 'Facebook', followers: 29_800, engagementRate: 1.6, trendPct: -0.5, trendSource: 'demo', live: false },
    ],
    goal: { target: 600_000, current: 515_700, pct: 86, reached: false, projectedDate: '2026-08-11' },
    timing: { best: { day: 'Wed', daypart: '4p' }, source: 'model', postsLogged: 0 },
    queueCount: 2,
  });
  assert.match(text, /Total reach: 515\.7K \(\+23\.9K this week\)/);
  assert.match(text, /Fastest growing: TikTok/);
  assert.match(text, /Needs attention: Facebook: 29\.8K ▼ 0\.5%\/7d/);
  assert.match(text, /86% of 600K — on pace for 2026-08-11/);
  assert.match(text, /Wed 4–8pm \(industry model\)/);
  assert.match(text, /2 drafts waiting/);
});
