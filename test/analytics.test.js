const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SIGNAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-analytics-'));

const { test } = require('node:test');
const assert = require('node:assert/strict');
const store = require('../store');
const {
  computeTotals,
  computeGoalProgress,
  computePromotionRanking,
  allocateBudget,
  buildTimingGrid,
  slotFor,
  dailyPoints,
  indexSeries,
} = require('../server');

test('slotFor maps local time to the right day/daypart', () => {
  // new Date(y, m, d, h) is local time — getDay/getHours are local too, so
  // this holds in any TZ. 2026-07-13 is a Monday.
  assert.deepEqual(slotFor(new Date(2026, 6, 13, 10)), { day: 'Mon', daypart: '8a' });
  assert.deepEqual(slotFor(new Date(2026, 6, 19, 23)), { day: 'Sun', daypart: '8p' });
  assert.deepEqual(slotFor(new Date(2026, 6, 14, 0)), { day: 'Tue', daypart: '12a' });
});

test('computeTotals: weighted engagement and weekly delta', () => {
  const totals = computeTotals([
    { followers: 100, engagementRate: 10, trend: [90, 100] },
    { followers: 300, engagementRate: 2, trend: [310, 300] },
  ]);
  assert.equal(totals.followers, 400);
  assert.equal(totals.weeklyDeltaFollowers, 0); // +10 and -10 cancel
  assert.equal(totals.blendedEngagement, 4); // (100*10 + 300*2) / 400
});

test('goal projection: ceil days, straight-line date', async () => {
  await store.setGoal(510000);
  const goal = await computeGoalProgress({ followers: 500000, weeklyDeltaFollowers: 7000 });
  assert.equal(goal.pct, 98);
  assert.equal(goal.dailyRate, 1000);
  assert.equal(goal.daysToGoal, 10);
  assert.equal(goal.reached, false);
  assert.ok(goal.projectedDate);
});

test('goal projection: reached and flat-growth cases', async () => {
  await store.setGoal(100);
  const reached = await computeGoalProgress({ followers: 500, weeklyDeltaFollowers: 10 });
  assert.equal(reached.reached, true);
  assert.equal(reached.pct, 100);

  await store.setGoal(1000);
  const flat = await computeGoalProgress({ followers: 500, weeklyDeltaFollowers: 0 });
  assert.equal(flat.projectedDate, null);
  assert.equal(flat.daysToGoal, null);

  await store.clearGoal();
  assert.equal(await computeGoalProgress({ followers: 1, weeklyDeltaFollowers: 1 }), null);
});

test('promotion: ranking is score-ordered, allocation sums to budget', () => {
  const platforms = [
    { id: 'x', engagementRate: 3.4, trend: [100, 105] },
    { id: 'tiktok', engagementRate: 7.8, trend: [100, 108] },
    { id: 'linkedin', engagementRate: 2.9, trend: [100, 105] },
    { id: 'youtube', engagementRate: 5.1, trend: [100, 103] },
    { id: 'instagram', engagementRate: 4.2, trend: [100, 103] },
    { id: 'facebook', engagementRate: 1.6, trend: [101, 100] },
  ];
  const ranked = computePromotionRanking(platforms);
  assert.equal(ranked[0].id, 'tiktok', 'best engagement + trend + cheap CPM ranks first');
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i - 1].score >= ranked[i].score);

  const budget = 1000;
  const alloc = allocateBudget(ranked, budget);
  const sum = alloc.reduce((s, p) => s + p.allocated, 0);
  assert.ok(Math.abs(sum - budget) <= 15, `allocations (${sum}) sum to budget within $5-rounding`);
  assert.ok(alloc[0].allocated >= alloc[alloc.length - 1].allocated, 'top pick gets the biggest slice');
  alloc.forEach((p) => assert.ok(p.estImpressions >= 0 && p.estEngagements >= 0));
});

test('timing grid: model mode below the personalization threshold', async () => {
  const timing = await buildTimingGrid();
  assert.equal(timing.source, 'model');
  assert.equal(timing.postsLogged, 0);
  assert.equal(timing.best.day, 'Wed');
  assert.equal(timing.best.daypart, '4p');
});

test('timing grid: personalizes from scored posts, keeps model elsewhere', async () => {
  // 12 scored posts across 3 slots; Tue 4p clearly best.
  const slots = [
    { day: 'Tue', daypart: '4p', delta: 900 },
    { day: 'Sat', daypart: '8a', delta: 300 },
    { day: 'Mon', daypart: '12a', delta: 50 },
  ];
  let base = 50000;
  for (let i = 0; i < 12; i++) {
    const slot = slots[i % 3];
    const postedAt = new Date(Date.now() - (30 - i * 2) * 24 * 3600 * 1000);
    await store.addPost({
      platformId: 'x', caption: `seed ${i}`, day: slot.day, daypart: slot.daypart,
      postedAt: postedAt.toISOString(), followersBefore: base,
    });
    await store.saveSnapshot({
      platformId: 'x', followers: base + slot.delta, live: true,
      takenAt: new Date(postedAt.getTime() + 25 * 3600 * 1000).toISOString(),
    });
    base += slot.delta;
  }

  const timing = await buildTimingGrid();
  assert.equal(timing.source, 'personalized');
  assert.equal(timing.postsLogged, 12);
  const cell = (d, p) => timing.cells.find((c) => c.day === d && c.daypart === p).index;
  assert.equal(cell('Tue', '4p'), 100, 'best real slot maxes out');
  assert.equal(cell('Mon', '12a'), 20, 'worst real slot sits at the floor');
  assert.equal(cell('Wed', '4p'), 92, 'never-posted cell keeps the model value');
  assert.deepEqual({ day: timing.best.day, daypart: timing.best.daypart }, { day: 'Tue', daypart: '4p' });
});

test('dailyPoints keeps the last snapshot per day', () => {
  const pts = dailyPoints([
    { followers: 10, takenAt: '2026-07-01T08:00:00.000Z' },
    { followers: 12, takenAt: '2026-07-01T20:00:00.000Z' },
    { followers: 15, takenAt: '2026-07-02T09:00:00.000Z' },
  ]);
  assert.deepEqual(pts, [
    { date: '2026-07-01', followers: 12 },
    { date: '2026-07-02', followers: 15 },
  ]);
});

test('indexSeries rebases to 100 at the first point', () => {
  const idx = indexSeries([
    { date: 'd1', followers: 500000 },
    { date: 'd2', followers: 533000 },
  ]);
  assert.equal(idx[0].indexed, 100);
  assert.equal(idx[1].indexed, 106.6);
});
