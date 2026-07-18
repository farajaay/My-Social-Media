// Read-only data export for external analysis (an AI/statistical agent, a
// spreadsheet, whatever). This is a translation boundary: everywhere else in
// the app stays camelCase; only the JSON/CSV this module emits uses the
// snake_case field names an external consumer was asked for. Takes a plain
// data object assembled by server.js (same separation report.js already
// uses for the digest) so this module never requires server.js or reaches
// into credentials.js — nothing that flows through here can ever carry a
// secret.

const store = require('./store');
const { AD_COST_BENCHMARKS } = require('./adCosts');

function provenanceOf(row) {
  return row.live ? 'real' : 'demo';
}

// "Engagement" here means the 24h follower-delta as a % of the follower
// count right before posting — the only real per-post outcome this app has.
// Not the same thing as a platform's rolling engagementRate scalar, which
// isn't tied to any single post.
function postEngagementPct(scoredPost) {
  if (!scoredPost.followersBefore) return null;
  return (scoredPost.delta / scoredPost.followersBefore) * 100;
}

const VIRAL_WINDOW = 30;
const VIRAL_MIN_BASELINE = 5;

// Per platform, per post (newest first): compare against the trailing
// scored posts on that same platform. Fewer than VIRAL_MIN_BASELINE
// trailing posts, or no resolved 24h delta yet, means "not enough data" —
// null, never false, since that's a different claim than "not viral."
function computeViralFlags(scoredPosts) {
  const byPlatform = new Map();
  scoredPosts.forEach((p) => {
    if (!byPlatform.has(p.platformId)) byPlatform.set(p.platformId, []);
    byPlatform.get(p.platformId).push({ ...p, pct: postEngagementPct(p) });
  });

  const flags = new Map();
  for (const posts of byPlatform.values()) {
    const sorted = [...posts].sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));
    sorted.forEach((post, i) => {
      if (post.pct === null) {
        flags.set(post.id, null);
        return;
      }
      const trailing = sorted.slice(i + 1, i + 1 + VIRAL_WINDOW).filter((t) => t.pct !== null);
      if (trailing.length < VIRAL_MIN_BASELINE) {
        flags.set(post.id, null);
        return;
      }
      const vals = trailing.map((t) => t.pct);
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
      flags.set(post.id, post.pct > mean + 2 * sd);
    });
  }
  return flags;
}

function dayKey(iso) {
  return iso.slice(0, 10);
}

function since(sinceParam) {
  const parsed = sinceParam ? new Date(sinceParam) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.getTime() : 0;
}

async function buildExport({ platforms, since: sinceParam, platformFilter, goal, timing, scoredPosts, backend }) {
  const sinceMs = since(sinceParam);
  const filter = platformFilter && platformFilter !== 'all' ? platformFilter : null;
  const targetPlatforms = filter ? platforms.filter((p) => p.id === filter) : platforms;

  const viralFlags = computeViralFlags(scoredPosts);

  const snapshots = [];
  const engagementHistory = [];
  const confidenceByPlatform = {};

  for (const p of targetPlatforms) {
    const rows = await store.getSnapshots(p.id, sinceMs);
    const realDays = new Set();
    rows.forEach((row) => {
      if (row.live) realDays.add(dayKey(row.takenAt));
      snapshots.push({
        platform_id: row.platformId,
        taken_at: row.takenAt,
        followers: row.followers,
        engagement_rate: row.engagementRate,
        live: Boolean(row.live),
        provenance: provenanceOf(row),
        reach_metric: { type: null, value: null },
      });
      engagementHistory.push({
        platform_id: row.platformId,
        taken_at: row.takenAt,
        engagement_rate: row.engagementRate,
        provenance: provenanceOf(row),
      });
    });

    const platformScoredCount = scoredPosts.filter((s) => s.platformId === p.id).length;
    confidenceByPlatform[p.id] = {
      real_snapshot_days: realDays.size,
      scored_posts: platformScoredCount,
      minimum_viable_met: realDays.size >= 14 && platformScoredCount >= 10,
    };
  }

  const allPosts = await store.loadPosts();
  const posts = allPosts
    .filter((post) => !filter || post.platformId === filter)
    .map((post) => ({
      id: post.id,
      platform_id: post.platformId,
      posted_at: post.postedAt || null,
      day: post.day ?? null,
      daypart: post.daypart ?? null,
      caption: post.caption ?? null,
      content_type: post.contentType ?? null,
      topic_tags: post.topicTags ?? null,
      caption_length: post.captionLength ?? null,
      has_hashtags: post.hashtagCount ?? null,
      has_cta: post.hasCta ?? null,
      followers_before: post.followersBefore ?? null,
      follower_delta_24h: null,
      engagement_pct_24h: null,
      impressions: null,
      likes: null,
      comments: null,
      shares: null,
      saves: null,
      viral_flag: viralFlags.has(post.id) ? viralFlags.get(post.id) : null,
    }));

  const scoredById = new Map(scoredPosts.map((s) => [s.id, s]));
  posts.forEach((post) => {
    const scored = scoredById.get(post.id);
    if (scored) {
      post.follower_delta_24h = scored.delta;
      post.engagement_pct_24h = postEngagementPct(scored);
    }
  });

  const allCompetitors = await store.listCompetitors();
  const competitors = [];
  for (const c of allCompetitors) {
    if (filter && c.platformId !== filter) continue;
    const snaps = await store.getCompetitorSnapshots(c.id, sinceMs);
    competitors.push({
      id: c.id,
      platform_id: c.platformId,
      handle: c.handle,
      name: c.name,
      added_at: c.addedAt,
      snapshots: snaps.map((s) => ({ followers: s.followers, taken_at: s.takenAt })),
    });
  }

  const anyViable = Object.values(confidenceByPlatform).some((c) => c.minimum_viable_met);

  return {
    meta: {
      schema_version: '1.0',
      generated_at: new Date().toISOString(),
      since: sinceParam || null,
      platform_filter: filter || 'all',
    },
    snapshots,
    engagement_history: engagementHistory,
    posts,
    competitors,
    context: {
      schema_version: '1.0',
      exported_at: new Date().toISOString(),
      since: sinceParam || null,
      platform_filter: filter || 'all',
      backend,
      goal: goal
        ? {
            target: goal.target,
            current: goal.current,
            pct: goal.pct,
            daily_rate: goal.dailyRate,
            reached: goal.reached,
            days_to_goal: goal.daysToGoal,
            projected_date: goal.projectedDate,
          }
        : null,
      ad_cost_benchmarks: AD_COST_BENCHMARKS,
      heatmap: {
        mode: timing.source,
        posts_logged: timing.postsLogged,
        posts_needed: timing.postsNeeded,
        best: timing.best,
      },
      platforms: platforms.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.live ? 'LIVE' : 'DEMO',
        engagement_source: p.engagementSource || null,
      })),
      confidence: {
        by_platform: confidenceByPlatform,
        any_platform_viable: anyViable,
        targets: { snapshot_days: 14, scored_posts: 10 },
      },
      capabilities: {
        engagement_history: true,
        views_impressions: false,
        per_post_outcome_metrics: false,
      },
    },
  };
}

function toCsv(snapshots) {
  const header = 'platform_id,taken_at,followers,engagement_rate,live,provenance';
  const rows = snapshots.map((row) =>
    [row.platform_id, row.taken_at, row.followers, row.engagement_rate ?? '', row.live, row.provenance].join(',')
  );
  return [header, ...rows].join('\n') + '\n';
}

module.exports = { buildExport, computeViralFlags, postEngagementPct, toCsv, provenanceOf };
