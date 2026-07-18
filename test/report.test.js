const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const report = require('../report');
const notify = require('../notify');

function baseData(overrides = {}) {
  return {
    generatedAt: '2026-07-17T12:00:00.000Z',
    totals: { followers: 100_000, weeklyDeltaFollowers: 1200, blendedEngagement: 4.2 },
    platforms: [
      { name: 'X', followers: 50_000, engagementRate: 3.1, trendPct: 2.5, trendSource: 'live', live: true, trend: [48000, 48500, 49000, 49400, 49800, 49900, 50000] },
      { name: 'YouTube', followers: 50_000, engagementRate: 5.0, trendPct: -1.2, trendSource: 'demo', live: false, trend: [50600, 50500, 50400, 50300, 50200, 50100, 50000] },
    ],
    goal: null,
    timing: { best: { day: 'Tue', daypart: '8p' }, source: 'model', postsLogged: 0 },
    queueCount: 0,
    ...overrides,
  };
}

// --- formatDigest ---

test('formatDigest: no goal, no decline, empty queue', () => {
  const text = report.formatDigest(baseData({ platforms: [{ name: 'X', followers: 50_000, trendPct: null }] }));
  assert.match(text, /Signal — weekly digest/);
  assert.match(text, /Total reach: 100K \(\+1\.2K this week\)/);
  assert.doesNotMatch(text, /Goal:/);
  assert.match(text, /Queue: empty/);
});

test('formatDigest: flags a decline under "Needs attention"', () => {
  const text = report.formatDigest(baseData());
  assert.match(text, /Fastest growing: X/);
  assert.match(text, /Needs attention: YouTube/);
});

test('formatDigest: goal reached', () => {
  const text = report.formatDigest(baseData({ goal: { target: 100_000, current: 100_000, pct: 100, reached: true, projectedDate: null } }));
  assert.match(text, /Goal: 100K reached/);
});

test('formatDigest: goal on pace with a projected date', () => {
  const text = report.formatDigest(baseData({ goal: { target: 200_000, current: 100_000, pct: 50, reached: false, projectedDate: '2026-09-01' } }));
  assert.match(text, /Goal: 50% of 200K — on pace for 2026-09-01/);
});

test('formatDigest: goal flat growth has no projected date', () => {
  const text = report.formatDigest(baseData({ goal: { target: 200_000, current: 100_000, pct: 50, reached: false, projectedDate: null } }));
  assert.match(text, /growth is flat, no projected date/);
});

test('formatDigest: non-empty queue is pluralized correctly', () => {
  const one = report.formatDigest(baseData({ queueCount: 1 }));
  assert.match(one, /Queue: 1 draft waiting\./);
  const many = report.formatDigest(baseData({ queueCount: 3 }));
  assert.match(many, /Queue: 3 drafts waiting\./);
});

test('formatDigest: zero followers and zero delta render without throwing', () => {
  const text = report.formatDigest(baseData({ totals: { followers: 0, weeklyDeltaFollowers: 0, blendedEngagement: 0 }, platforms: [] }));
  assert.match(text, /Total reach: 0 \(\+0 this week\)/);
});

// --- formatMilestone / bestWindowLabel ---

test('formatMilestone renders platform, threshold, and current count', () => {
  assert.equal(report.formatMilestone('YouTube', 100_000, 104_200), '🎉 YouTube crossed 100K followers — now at 104.2K.');
});

test('bestWindowLabel: model vs personalized source', () => {
  assert.match(report.bestWindowLabel({ best: { day: 'Mon', daypart: '12p' }, source: 'model', postsLogged: 0 }), /industry model/);
  assert.match(
    report.bestWindowLabel({ best: { day: 'Mon', daypart: '12p' }, source: 'personalized', postsLogged: 14 }),
    /personalized from 14 posts/
  );
});

// --- formatReportMarkdown / formatReportHtml ---

test('formatReportMarkdown: table has one row per platform and a goal line', () => {
  const md = report.formatReportMarkdown(baseData({ goal: { target: 200_000, current: 100_000, pct: 50, reached: false, projectedDate: '2026-09-01' } }));
  assert.match(md, /^# Signal — weekly report/);
  assert.match(md, /\| X \| 50K \| ▲ 2\.5% \| 3\.1% \| real \|/);
  assert.match(md, /\| YouTube \| 50K \| ▼ 1\.2% \| 5% \| demo \|/);
  assert.match(md, /\*\*Goal:\*\* 50% of 200K — on pace for 2026-09-01\./);
});

test('formatReportMarkdown: includes topPromotion callout when present', () => {
  const md = report.formatReportMarkdown(baseData({ topPromotion: { name: 'YouTube', costPerEngagement: 0.12 } }));
  assert.match(md, /Best paid value right now:\*\* YouTube at ~\$0\.12\/engagement/);
});

test('formatReportHtml: escapes platform names and includes the data table', () => {
  const html = report.formatReportHtml(baseData({ platforms: [{ name: '<script>', followers: 10, engagementRate: 1, trendPct: null, trendSource: 'demo' }] }));
  assert.match(html, /<!doctype html>/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('formatReportHtml: renders with no goal at all', () => {
  const html = report.formatReportHtml(baseData({ goal: null }));
  assert.doesNotMatch(html, /<b>Goal:<\/b>/);
});

// --- buildCardSvg ---

test('buildCardSvg: signal vs blueprint vs almanac theme backgrounds', () => {
  const signal = report.buildCardSvg(baseData(), 'signal');
  const blueprint = report.buildCardSvg(baseData(), 'blueprint');
  const almanac = report.buildCardSvg(baseData(), 'almanac');
  assert.ok(signal.startsWith('<svg'));
  assert.match(signal, /#17130f/);
  assert.match(blueprint, /#0e2444/);
  assert.match(almanac, /#0f1a12/);
});

test('buildCardSvg: unknown theme name falls back to signal', () => {
  const svg = report.buildCardSvg(baseData(), 'not-a-real-theme');
  assert.match(svg, /#17130f/);
});

test('buildCardSvg: no trend data on the top platform omits the sparkline', () => {
  const svg = report.buildCardSvg(baseData({ platforms: [{ name: 'X', followers: 50_000, trendPct: null }] }), 'signal');
  assert.doesNotMatch(svg, /<polyline/);
});

test('buildCardSvg: zero followers renders without throwing', () => {
  const svg = report.buildCardSvg(baseData({ totals: { followers: 0, weeklyDeltaFollowers: 0, blendedEngagement: 0 }, platforms: [] }), 'signal');
  assert.ok(svg.includes('</svg>'));
});

// --- notify.crossedThresholds ---

test('crossedThresholds: null prev (first snapshot ever) crosses nothing', () => {
  assert.deepEqual(notify.crossedThresholds(null, 50_000), []);
});

test('crossedThresholds: crossing exactly one threshold', () => {
  assert.deepEqual(notify.crossedThresholds(9_000, 10_500), [10_000]);
});

test('crossedThresholds: jumping past multiple thresholds at once', () => {
  assert.deepEqual(notify.crossedThresholds(8_000, 30_000), [10_000, 25_000]);
});

test('crossedThresholds: no movement across a threshold crosses nothing', () => {
  assert.deepEqual(notify.crossedThresholds(12_000, 12_500), []);
});

test('crossedThresholds: a decline crosses nothing (never fires backwards)', () => {
  assert.deepEqual(notify.crossedThresholds(30_000, 8_000), []);
});

// --- notify.sendNotification / isConfigured ---

test('isConfigured reflects NOTIFY_WEBHOOK_URL', () => {
  const prev = process.env.NOTIFY_WEBHOOK_URL;
  delete process.env.NOTIFY_WEBHOOK_URL;
  assert.equal(notify.isConfigured(), false);
  process.env.NOTIFY_WEBHOOK_URL = 'https://example.com/hook';
  assert.equal(notify.isConfigured(), true);
  if (prev === undefined) delete process.env.NOTIFY_WEBHOOK_URL;
  else process.env.NOTIFY_WEBHOOK_URL = prev;
});

test('sendNotification: no-op (returns false, no throw) when unset', async () => {
  const prev = process.env.NOTIFY_WEBHOOK_URL;
  delete process.env.NOTIFY_WEBHOOK_URL;
  assert.equal(await notify.sendNotification('hello'), false);
  if (prev !== undefined) process.env.NOTIFY_WEBHOOK_URL = prev;
});

test('sendNotification: posts a generic {text} payload to a non-Discord/Slack host', async (t) => {
  let received = null;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received = { headers: req.headers, body: JSON.parse(body) };
      res.writeHead(200);
      res.end('ok');
    });
  });
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => server.close());

  const prev = process.env.NOTIFY_WEBHOOK_URL;
  process.env.NOTIFY_WEBHOOK_URL = `http://localhost:${server.address().port}/hook`;
  const ok = await notify.sendNotification('hello from the test');
  if (prev !== undefined) process.env.NOTIFY_WEBHOOK_URL = prev;
  else delete process.env.NOTIFY_WEBHOOK_URL;

  assert.equal(ok, true);
  assert.deepEqual(received.body, { text: 'hello from the test' });
  assert.equal(received.headers['content-type'], 'application/json');
});

test('sendNotification: a failed delivery (connection refused) resolves false rather than throwing', async () => {
  const prev = process.env.NOTIFY_WEBHOOK_URL;
  process.env.NOTIFY_WEBHOOK_URL = 'http://localhost:1/unreachable';
  const ok = await notify.sendNotification('hello');
  if (prev !== undefined) process.env.NOTIFY_WEBHOOK_URL = prev;
  else delete process.env.NOTIFY_WEBHOOK_URL;
  assert.equal(ok, false);
});
