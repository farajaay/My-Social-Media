const fs = require('fs');
const os = require('os');
const path = require('path');

// Must be set before store.js is loaded — DATA_DIR is read at module load.
process.env.SIGNAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-store-'));

const { test } = require('node:test');
const assert = require('node:assert/strict');
const store = require('../store');

test('goal roundtrip: set, get, clear', async () => {
  assert.equal(await store.getGoal(), null);
  await store.setGoal(750000);
  const goal = await store.getGoal();
  assert.equal(goal.target, 750000);
  assert.ok(goal.setAt);
  await store.clearGoal();
  assert.equal(await store.getGoal(), null);
});

test('queue: add, get, remove', async () => {
  const draft = await store.addDraft({ platformId: 'x', caption: 'hello', day: 'Tue', daypart: '4p' });
  assert.ok(draft.id);
  assert.equal((await store.loadQueue()).length, 1);
  assert.equal((await store.getDraft(draft.id)).caption, 'hello');
  assert.equal(await store.getDraft('nope'), null);
  const remaining = await store.removeDraft(draft.id);
  assert.equal(remaining.length, 0);
});

test('posts: add and load', async () => {
  const posts = await store.addPost({ platformId: 'x', caption: 'p1', day: 'Mon', daypart: '8a', postedAt: new Date().toISOString(), followersBefore: 100 });
  assert.equal(posts.length, 1);
  assert.ok(posts[0].id);
  assert.equal((await store.loadPosts())[0].caption, 'p1');
});

test('competitors: add, list, remove', async () => {
  const comp = await store.addCompetitor({ platformId: 'youtube', handle: 'UC123', name: 'Rival' });
  assert.ok(comp.id);
  assert.equal((await store.listCompetitors()).length, 1);
  const remaining = await store.removeCompetitor(comp.id);
  assert.equal(remaining.length, 0);
});

test('snapshots: save, since-filter, latest, first-after', async () => {
  const now = Date.now();
  const at = (daysAgo) => new Date(now - daysAgo * 24 * 3600 * 1000).toISOString();
  await store.saveSnapshot({ platformId: 'yt', followers: 100, live: true, takenAt: at(3) });
  await store.saveSnapshot({ platformId: 'yt', followers: 110, live: true, takenAt: at(2) });
  await store.saveSnapshot({ platformId: 'yt', followers: 120, live: true, takenAt: at(1) });
  await store.saveSnapshot({ platformId: 'other', followers: 999, live: true, takenAt: at(1) });

  const all = await store.getSnapshots('yt', 0);
  assert.equal(all.length, 3);
  assert.deepEqual(all.map((s) => s.followers), [100, 110, 120]);

  const recent = await store.getSnapshots('yt', now - 2.5 * 24 * 3600 * 1000);
  assert.equal(recent.length, 2);

  assert.equal((await store.getLatestSnapshot('yt')).followers, 120);
  assert.equal(await store.getLatestSnapshot('missing'), null);

  const after = await store.getFirstSnapshotAfter('yt', now - 2.5 * 24 * 3600 * 1000);
  assert.equal(after.followers, 110);
  assert.equal(await store.getFirstSnapshotAfter('yt', now + 1000), null);
});

test('competitor snapshots: save, get, latest', async () => {
  await store.saveCompetitorSnapshot({ competitorId: 'c1', followers: 500 });
  await store.saveCompetitorSnapshot({ competitorId: 'c1', followers: 510 });
  const snaps = await store.getCompetitorSnapshots('c1', 0);
  assert.equal(snaps.length, 2);
  assert.equal((await store.getLatestCompetitorSnapshot('c1')).followers, 510);
});

test('backend is json when DATABASE_URL is unset', async () => {
  assert.equal(store.backendName(), 'json');
  const files = fs.readdirSync(process.env.SIGNAL_DATA_DIR);
  assert.ok(files.includes('history.json'), 'writes land in the temp dir, not ./data');
});
