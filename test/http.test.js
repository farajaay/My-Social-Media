const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SIGNAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-http-'));
process.env.ADMIN_PASSWORD = 'test-password-123';
process.env.SESSION_SECRET = 'test-secret';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { app } = require('../server');

let server;
let base;

before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://localhost:${server.address().port}`;
});

after(() => server.close());

function sessionCookie(res) {
  const setCookie = res.headers.get('set-cookie') || '';
  return setCookie.split(';')[0];
}

test('public endpoints respond 200 with the expected shape', async () => {
  const dash = await (await fetch(`${base}/api/dashboard`)).json();
  assert.equal(dash.platforms.length, 6);
  assert.ok(dash.platforms.every((p) => ['live', 'demo', 'pending'].includes(p.trendSource)));

  const stats = await (await fetch(`${base}/api/stats`)).json();
  assert.ok(stats.totals.followers > 0);
  assert.equal(stats.timing.cells.length, 42);
  assert.ok(['model', 'personalized'].includes(stats.timing.source));

  assert.equal((await (await fetch(`${base}/api/goal`)).json()).goal, null);
  assert.ok((await (await fetch(`${base}/api/ideas`)).json()).ideas.length > 0);

  const promo = await (await fetch(`${base}/api/promotion?budget=1000`)).json();
  assert.equal(promo.budget, 1000);
  assert.equal(promo.platforms.length, 6);

  const versus = await (await fetch(`${base}/api/versus`)).json();
  assert.deepEqual(versus.groups, []);
});

test('admin API requires a session', async () => {
  for (const ep of ['/api/admin/bootstrap', '/api/admin/queue', '/api/admin/competitors']) {
    assert.equal((await fetch(`${base}${ep}`)).status, 401, ep);
  }
  const write = await fetch(`${base}/api/admin/goal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ target: 1 }),
  });
  assert.equal(write.status, 401);
});

test('login: wrong password 401, right password grants a session', async () => {
  const bad = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'wrong' }),
  });
  assert.equal(bad.status, 401);

  const good = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-password-123' }),
  });
  assert.equal(good.status, 200);
  const cookie = sessionCookie(good);
  assert.ok(cookie.startsWith('signal.sid='));

  const boot = await fetch(`${base}/api/admin/bootstrap`, { headers: { Cookie: cookie } });
  assert.equal(boot.status, 200);
  assert.ok((await boot.json()).csrfToken);
});

test('state-changing admin calls require the CSRF token on top of the session', async () => {
  const login = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-password-123' }),
  });
  const cookie = sessionCookie(login);

  const noToken = await fetch(`${base}/api/admin/goal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ target: 5000 }),
  });
  assert.equal(noToken.status, 403);

  const { csrfToken } = await (await fetch(`${base}/api/admin/bootstrap`, { headers: { Cookie: cookie } })).json();
  const withToken = await fetch(`${base}/api/admin/goal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie, 'X-CSRF-Token': csrfToken },
    body: JSON.stringify({ target: 5000 }),
  });
  assert.equal(withToken.status, 200);
  assert.equal((await (await fetch(`${base}/api/goal`)).json()).goal.target, 5000);
});

test('admin pages redirect to login without a session', async () => {
  const res = await fetch(`${base}/admin`, { redirect: 'manual' });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/admin/login');
});

test('shareable output: card, report, markdown, og templating', async () => {
  const card = await fetch(`${base}/card.svg?theme=blueprint`);
  assert.equal(card.status, 200);
  assert.match(card.headers.get('content-type'), /image\/svg\+xml/);
  const svg = await card.text();
  assert.ok(svg.startsWith('<svg'));
  assert.match(svg, /#0e2444/, 'blueprint theme background');

  const almanacCard = await fetch(`${base}/card.svg?theme=almanac`);
  assert.equal(almanacCard.status, 200);
  assert.match(await almanacCard.text(), /#0f1a12/, 'almanac theme background');

  const rep = await fetch(`${base}/report`);
  assert.equal(rep.status, 200);
  assert.match(await rep.text(), /Weekly report/);

  const md = await fetch(`${base}/report.md`);
  assert.match(md.headers.get('content-disposition'), /attachment/);
  const mdText = await md.text();
  assert.match(mdText, /^# Signal — weekly report/);
  assert.match(mdText, /\| Channel \|/);

  const index = await (await fetch(`${base}/`)).text();
  assert.ok(!index.includes('__ORIGIN__'), 'origin placeholder is substituted');
  assert.match(index, /property="og:image" content="http:\/\/localhost:\d+\/og\.png"/);
});
