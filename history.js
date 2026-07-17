// History engine: turns the dashboard's demo trend arrays into real ones by
// accumulating follower snapshots over time.
//
// Only LIVE platforms are snapshotted — demo numbers are constants, and
// recording them would manufacture flat "real-looking" series out of fake
// data. Demo platforms keep their demo trend arrays, labeled as such.

const store = require('./store');
const notify = require('./notify');
const { formatMilestone } = require('./report');

const SNAPSHOT_MIN_INTERVAL_MS = 60 * 60 * 1000; // at most one snapshot/hour/platform
const TREND_WINDOW_MS = 8 * 24 * 3600 * 1000; // 7 days + buffer

// In-memory throttle so page views don't hit the store on every request;
// backed up by a store-side check that survives restarts.
const lastSnapshotAt = new Map();

async function recordSnapshots(platforms) {
  const now = Date.now();
  for (const p of platforms) {
    if (!p.live) continue;
    const cached = lastSnapshotAt.get(p.id) || 0;
    if (now - cached < SNAPSHOT_MIN_INTERVAL_MS) continue;

    const latest = await store.getLatestSnapshot(p.id);
    if (latest) {
      const latestMs = new Date(latest.takenAt).getTime();
      if (now - latestMs < SNAPSHOT_MIN_INTERVAL_MS) {
        lastSnapshotAt.set(p.id, latestMs);
        continue;
      }
    }

    await store.saveSnapshot({
      platformId: p.id,
      followers: p.followers,
      engagementRate: p.engagementRate,
      live: true,
    });
    lastSnapshotAt.set(p.id, now);

    // Milestone alerts ride the snapshot write: compare against the previous
    // count and announce each threshold exactly once (dedupe survives
    // restarts via the store). A notify failure never breaks a sync.
    try {
      await announceMilestones(p, latest ? latest.followers : null);
    } catch {
      // best-effort only
    }
  }
}

async function announceMilestones(platform, prevFollowers) {
  if (!notify.isConfigured()) return;
  const crossed = notify.crossedThresholds(prevFollowers, platform.followers);
  if (!crossed.length) return;

  const fired = await store.kvGet('milestones_fired', {});
  const already = fired[platform.id] || [];
  const fresh = crossed.filter((t) => !already.includes(t));
  if (!fresh.length) return;

  const top = Math.max(...fresh);
  await notify.sendNotification(formatMilestone(platform.name || platform.id, top, platform.followers));
  fired[platform.id] = [...already, ...fresh];
  await store.kvSet('milestones_fired', fired);
}

function dayKey(iso) {
  return iso.slice(0, 10);
}

// Last value per calendar day over the trend window — up to ~8 points.
async function realTrend(platformId) {
  const snaps = await store.getSnapshots(platformId, Date.now() - TREND_WINDOW_MS);
  const byDay = new Map();
  snaps.forEach((s) => byDay.set(dayKey(s.takenAt), s.followers));
  const points = [...byDay.values()];
  return points.length >= 2 ? points : null;
}

// Swap real trends into live platforms and mark provenance on every platform:
//   'live'    — trend computed from stored snapshots
//   'pending' — live platform, but not enough history yet (needs 2+ days)
//   'demo'    — demo platform, demo trend array
async function applyRealTrends(platforms) {
  for (const p of platforms) {
    if (!p.live) {
      p.trendSource = 'demo';
      continue;
    }
    const trend = await realTrend(p.id);
    if (trend) {
      p.trend = trend;
      p.trendSource = 'live';
    } else {
      p.trendSource = 'pending';
    }
  }
}

// Test hook: clears the in-memory throttle so a test can simulate a later
// sync without waiting an hour. The store-side check still applies.
function __resetThrottleForTests() {
  lastSnapshotAt.clear();
}

module.exports = { recordSnapshots, applyRealTrends, __resetThrottleForTests };
