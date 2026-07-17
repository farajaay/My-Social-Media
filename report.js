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

// ---------------------------------------------------------------------------
// Shareable output: weekly report (markdown + print-styled HTML) and an SVG
// stat card. Same input data object as the digest — one source of truth.
// ---------------------------------------------------------------------------

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function deltaGlyph(pct) {
  if (pct == null) return '—';
  return `${pct >= 0 ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}%`;
}

function sourceLabel(s) {
  if (s === 'live') return 'real';
  if (s === 'pending') return 'collecting';
  return 'demo';
}

function formatReportMarkdown(data) {
  const d = data.totals.weeklyDeltaFollowers;
  const lines = [];
  lines.push('# Signal — weekly report');
  lines.push('');
  lines.push(`_Generated ${data.generatedAt.slice(0, 10)}_`);
  lines.push('');
  lines.push(`**Total reach:** ${formatCount(data.totals.followers)} (${d >= 0 ? '+' : ''}${formatCount(d)} this week) · blended engagement ${data.totals.blendedEngagement}%`);
  lines.push('');
  lines.push('| Channel | Followers | 7-day | Engagement | Data |');
  lines.push('|---|---:|---:|---:|---|');
  data.platforms.forEach((p) => {
    lines.push(`| ${p.name} | ${formatCount(p.followers)} | ${deltaGlyph(p.trendPct)} | ${p.engagementRate}% | ${sourceLabel(p.trendSource)} |`);
  });
  lines.push('');
  if (data.goal) {
    if (data.goal.reached) lines.push(`**Goal:** ${formatCount(data.goal.target)} reached.`);
    else if (data.goal.projectedDate) lines.push(`**Goal:** ${data.goal.pct}% of ${formatCount(data.goal.target)} — on pace for ${data.goal.projectedDate}.`);
    else lines.push(`**Goal:** ${data.goal.pct}% of ${formatCount(data.goal.target)} — growth is flat, no projected date.`);
  }
  lines.push(`**Best posting window:** ${bestWindowLabel(data.timing)}.`);
  if (data.topPromotion) {
    lines.push(`**Best paid value right now:** ${data.topPromotion.name} at ~$${data.topPromotion.costPerEngagement}/engagement (benchmark estimate, not a live ad quote).`);
  }
  lines.push('');
  lines.push('---');
  lines.push('_Demo-labeled rows are placeholder numbers; real rows come from connected accounts and daily snapshots._');
  return lines.join('\n');
}

function formatReportHtml(data) {
  const d = data.totals.weeklyDeltaFollowers;
  const rows = data.platforms
    .map(
      (p) => `<tr><td>${esc(p.name)}</td><td class="num">${formatCount(p.followers)}</td><td class="num ${p.trendPct != null && p.trendPct < 0 ? 'down' : 'up'}">${deltaGlyph(p.trendPct)}</td><td class="num">${p.engagementRate}%</td><td class="src">${sourceLabel(p.trendSource)}</td></tr>`
    )
    .join('');

  const goalLine = !data.goal
    ? ''
    : data.goal.reached
      ? `<p><b>Goal:</b> ${formatCount(data.goal.target)} reached.</p>`
      : data.goal.projectedDate
        ? `<p><b>Goal:</b> ${data.goal.pct}% of ${formatCount(data.goal.target)} — on pace for ${data.goal.projectedDate}.</p>`
        : `<p><b>Goal:</b> ${data.goal.pct}% of ${formatCount(data.goal.target)} — growth is flat, no projected date.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Signal — weekly report</title>
<meta name="robots" content="noindex">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 48px 24px; font-family: system-ui, -apple-system, sans-serif; background: #faf6ee; color: #2a2117; }
  .sheet { max-width: 680px; margin: 0 auto; }
  .mark { display: flex; align-items: center; gap: 10px; margin-bottom: 28px; }
  .mark svg { width: 26px; height: 26px; color: #d96a1e; }
  .mark span { font-size: 19px; font-weight: 600; letter-spacing: 0.01em; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  .date { font-family: ui-monospace, monospace; font-size: 12px; color: #8a7a63; margin: 0 0 24px; }
  .hero { font-size: 17px; margin: 0 0 22px; }
  table { width: 100%; border-collapse: collapse; margin: 0 0 24px; font-size: 14px; }
  th { text-align: left; font-family: ui-monospace, monospace; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: #8a7a63; padding: 8px 10px; border-bottom: 2px solid #2a2117; }
  td { padding: 9px 10px; border-bottom: 1px solid #e5dccb; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.up { color: #9a5310; } td.down { color: #8a7a63; }
  td.src { font-family: ui-monospace, monospace; font-size: 11px; text-transform: uppercase; color: #8a7a63; }
  p { line-height: 1.55; margin: 0 0 10px; }
  .fine { font-size: 12px; color: #8a7a63; border-top: 1px solid #e5dccb; padding-top: 14px; margin-top: 26px; }
  @media print { body { padding: 0; background: #fff; } }
</style>
</head>
<body>
<div class="sheet">
  <div class="mark">
    <svg viewBox="0 0 32 32"><path d="M2 18h6l3-11 6 18 3-13 3 6h7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    <span>Signal</span>
  </div>
  <h1>Weekly report</h1>
  <p class="date">Generated ${esc(data.generatedAt.slice(0, 10))}</p>
  <p class="hero"><b>Total reach: ${formatCount(data.totals.followers)}</b> (${d >= 0 ? '+' : ''}${formatCount(d)} this week) · blended engagement ${data.totals.blendedEngagement}%</p>
  <table>
    <thead><tr><th>Channel</th><th class="num">Followers</th><th class="num">7-day</th><th class="num">Engagement</th><th>Data</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${goalLine}
  <p><b>Best posting window:</b> ${esc(bestWindowLabel(data.timing))}.</p>
  ${data.topPromotion ? `<p><b>Best paid value right now:</b> ${esc(data.topPromotion.name)} at ~$${data.topPromotion.costPerEngagement}/engagement (benchmark estimate, not a live ad quote).</p>` : ''}
  <p class="fine">Demo-labeled rows are placeholder numbers; real rows come from connected accounts and daily snapshots. <a href="/report.md">Download as markdown</a> · <a href="/">Back to dashboard</a></p>
</div>
</body>
</html>`;
}

const CARD_THEMES = {
  signal: { bg: '#17130f', panel: '#241d15', ink: '#f4ecdd', dim: '#b7a891', faint: '#7c6f5c', accent: '#ff8a3d', serif: 'italic 600 92px Georgia, serif' },
  blueprint: { bg: '#0e2444', panel: '#163765', ink: '#eef4fb', dim: '#a7c1de', faint: '#6e8ab0', accent: '#bfe3ff', serif: '700 92px system-ui, sans-serif' },
};

// 1200x630 (standard OG size), self-contained, system fonts only — SVG
// viewers don't load webfonts.
function buildCardSvg(data, themeName) {
  const t = CARD_THEMES[themeName] || CARD_THEMES.signal;
  const dlt = data.totals.weeklyDeltaFollowers;
  const spot = [...data.platforms].sort((a, b) => b.followers - a.followers)[0];
  const trend = spot && Array.isArray(spot.trend) && spot.trend.length >= 2 ? spot.trend : null;

  let sparkline = '';
  if (trend) {
    const min = Math.min(...trend);
    const span = Math.max(...trend) - min || 1;
    const pts = trend
      .map((v, i) => `${(80 + (i / (trend.length - 1)) * 1040).toFixed(1)},${(560 - ((v - min) / span) * 90).toFixed(1)}`)
      .join(' ');
    sparkline = `<polyline points="${pts}" fill="none" stroke="${t.accent}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>
    <text x="80" y="600" font-family="ui-monospace, monospace" font-size="20" letter-spacing="2" fill="${t.faint}">${esc(spot.name.toUpperCase())} · 7-DAY TREND · ${esc(sourceLabel(spot.trendSource).toUpperCase())}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="${t.bg}"/>
  <path d="M80 84 h36 l18 -33 l36 54 l18 -39 l18 18 h42" fill="none" stroke="${t.accent}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="272" y="96" font-family="Georgia, serif" font-size="44" fill="${t.ink}">Signal</text>
  <text x="80" y="218" font-family="ui-monospace, monospace" font-size="24" letter-spacing="4" fill="${t.faint}">TOTAL REACH · 6 CHANNELS</text>
  <text x="74" y="352" style="font: ${t.serif}" font-size="132" fill="${t.ink}">${esc(formatCount(data.totals.followers))}</text>
  <text x="80" y="428" font-family="ui-monospace, monospace" font-size="30" fill="${t.accent}">${dlt >= 0 ? '▲ +' : '▼ '}${esc(formatCount(Math.abs(dlt)))} this week · ${esc(String(data.totals.blendedEngagement))}% engagement</text>
  ${sparkline}
</svg>`;
}

module.exports = {
  formatDigest,
  formatMilestone,
  formatCount,
  bestWindowLabel,
  DAYPART_RANGE,
  formatReportMarkdown,
  formatReportHtml,
  buildCardSvg,
};
