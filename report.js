// Pure formatters for the weekly digest (and, later, shareable reports).
// This module takes a plain data object and returns text — it never fetches
// or requires app modules, so server.js can gather once and format many ways
// without require cycles.
//
// Expected data shape (assembled in server.js):
// {
//   generatedAt, totals: { followers, weeklyDeltaFollowers, blendedEngagement },
//   platforms: [{ name, followers, engagementRate, trendPct|null, trendSource, live }],
//   goal: null | { target, current, pct, reached, projectedDate },
//   timing: { best: { day, daypart }, source, postsLogged },
//   queueCount,
// }

function formatCount(n) {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return (n / 1_000_000).toFixed(abs % 1_000_000 === 0 ? 0 : 1) + 'M';
  if (abs >= 1_000) return (n / 1_000).toFixed(abs % 1_000 === 0 ? 0 : 1) + 'K';
  return String(n);
}

const DAYPART_RANGE = {
  '12a': '12–4am',
  '4a': '4–8am',
  '8a': '8am–12pm',
  '12p': '12–4pm',
  '4p': '4–8pm',
  '8p': '8pm–12am',
};

function bestWindowLabel(timing) {
  const range = DAYPART_RANGE[timing.best.daypart] || timing.best.daypart;
  const source = timing.source === 'personalized' ? `personalized from ${timing.postsLogged} posts` : 'industry model';
  return `${timing.best.day} ${range} (${source})`;
}

function trendLine(p) {
  if (p.trendPct == null) return `${p.name}: ${formatCount(p.followers)} followers`;
  const arrow = p.trendPct >= 0 ? '▲' : '▼';
  return `${p.name}: ${formatCount(p.followers)} ${arrow} ${Math.abs(p.trendPct).toFixed(1)}%/7d`;
}

function formatDigest(data) {
  const lines = [];
  const delta = data.totals.weeklyDeltaFollowers;
  lines.push('📡 Signal — weekly digest');
  lines.push(`Total reach: ${formatCount(data.totals.followers)} (${delta >= 0 ? '+' : ''}${formatCount(delta)} this week) · blended engagement ${data.totals.blendedEngagement}%`);

  const withTrend = data.platforms.filter((p) => p.trendPct != null);
  if (withTrend.length) {
    const best = [...withTrend].sort((a, b) => b.trendPct - a.trendPct)[0];
    lines.push(`Fastest growing: ${trendLine(best)}`);
    const declining = withTrend.filter((p) => p.trendPct < 0);
    if (declining.length) {
      lines.push(`Needs attention: ${declining.map(trendLine).join(' · ')}`);
    }
  }

  if (data.goal) {
    if (data.goal.reached) lines.push(`Goal: ${formatCount(data.goal.target)} reached 🎉 — set a new target.`);
    else if (data.goal.projectedDate) lines.push(`Goal: ${data.goal.pct}% of ${formatCount(data.goal.target)} — on pace for ${data.goal.projectedDate}`);
    else lines.push(`Goal: ${data.goal.pct}% of ${formatCount(data.goal.target)} — growth is flat, no projected date`);
  }

  lines.push(`Best posting window: ${bestWindowLabel(data.timing)}`);
  lines.push(
    data.queueCount > 0
      ? `Queue: ${data.queueCount} draft${data.queueCount === 1 ? '' : 's'} waiting.`
      : 'Queue: empty — worth drafting something for that window.'
  );
  return lines.join('\n');
}

function formatMilestone(platformName, threshold, current) {
  return `🎉 ${platformName} crossed ${formatCount(threshold)} followers — now at ${formatCount(current)}.`;
}

module.exports = { formatDigest, formatMilestone, formatCount, bestWindowLabel, DAYPART_RANGE };
