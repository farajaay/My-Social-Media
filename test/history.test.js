const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SIGNAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-history-'));

const { test } = require('node:test');
const assert = require('node:assert/strict');
const store = require('../store');
const history = require('../history');

test('applyRealTrends: live with history gets real daily trend', async () => {
  for (let i = 13; i >= 0; i--) {
    await store.saveSnapshot({
      platformId: 'x',
      followers: 10000 + (13 - i) * 260,
      live: true,
      takenAt: new Date(Date.now() - i * 24 * 3600 * 1000).toISOString(),
    });
  }
  const platforms = [{ id: 'x', live: true, followers: 13380 }];
  await history.applyRealTrends(platforms);
  assert.equal(platforms[0].trendSource, 'live');
  assert.ok(platforms[0].trend.length >= 7, 'about a week of daily points');
  assert.ok(platforms[0].trend.at(-1) > platforms[0].trend[0], 'rising series preserved');
});

test('applyRealTrends: live without history is pending, no fabricated trend', async () => {
  const platforms = [{ id: 'fresh', live: true, followers: 5000 }];
  await history.applyRealTrends(platforms);
  assert.equal(platforms[0].trendSource, 'pending');
  assert.equal(platforms[0].trend, undefined);
});

test('applyRealTrends: demo platform keeps its demo trend untouched', async () => {
  const platforms = [{ id: 'tiktok', live: false, followers: 214000, trend: [1, 2, 3] }];
  await history.applyRealTrends(platforms);
  assert.equal(platforms[0].trendSource, 'demo');
  assert.deepEqual(platforms[0].trend, [1, 2, 3]);
});

test('recordSnapshots: skips demo platforms entirely', async () => {
  await history.recordSnapshots([{ id: 'demoplat', live: false, followers: 123 }]);
  assert.equal((await store.getSnapshots('demoplat', 0)).length, 0);
});

test('recordSnapshots: hourly throttle writes exactly once', async () => {
  await history.recordSnapshots([{ id: 'throttled', live: true, followers: 1000, engagementRate: 2 }]);
  await history.recordSnapshots([{ id: 'throttled', live: true, followers: 1001, engagementRate: 2 }]);
  const snaps = await store.getSnapshots('throttled', 0);
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].followers, 1000);
});
