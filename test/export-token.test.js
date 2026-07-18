const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SIGNAL_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'signal-export-token-'));
process.env.ADMIN_PASSWORD = 'test-password-123';
process.env.SESSION_SECRET = 'test-secret';
// EXPORT_TOKEN is read once at server.js module load, so the token-gated
// path needs its own process — kept in a separate test file for that
// reason (node --test runs each matching file in its own process).
process.env.EXPORT_TOKEN = 'test-export-token-abc123';

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

test('no session, no token -> 401', async () => {
  const res = await fetch(`${base}/api/export`);
  assert.equal(res.status, 401);
});

test('no session, wrong token -> 401 (no bypass)', async () => {
  const res = await fetch(`${base}/api/export`, { headers: { 'X-Export-Token': 'not-the-right-token' } });
  assert.equal(res.status, 401);
});

test('no session, correct token -> 200', async () => {
  const res = await fetch(`${base}/api/export`, { headers: { 'X-Export-Token': 'test-export-token-abc123' } });
  assert.equal(res.status, 200);
  const doc = await res.json();
  assert.ok('snapshots' in doc);
});

test('an admin session works regardless of EXPORT_TOKEN being set', async () => {
  const login = await fetch(`${base}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password: 'test-password-123' }),
  });
  const cookie = sessionCookie(login);

  const noHeader = await fetch(`${base}/api/export`, { headers: { Cookie: cookie } });
  assert.equal(noHeader.status, 200);

  const wrongHeader = await fetch(`${base}/api/export`, { headers: { Cookie: cookie, 'X-Export-Token': 'garbage' } });
  assert.equal(wrongHeader.status, 200, 'session alone is sufficient even with a bad token header present');
});
