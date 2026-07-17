const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'credentials.json');

// Legacy on-disk shape was a flat { ENV_KEY: "value" } map. Newer files use
// { values: {...}, meta: {...} } so we can track when each key was saved
// (for expiry warnings) without disturbing the flat lookup semantics.
// Migrate transparently on read — no key is ever literally "values"/"meta".
function load() {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return { values: {}, meta: {} };
  }
  if (raw.values || raw.meta) return { values: raw.values || {}, meta: raw.meta || {} };
  return { values: raw, meta: {} };
}

function persist(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), { mode: 0o600 });
}

// A saved override takes precedence over .env, so changes made from the
// admin page work immediately without editing files or restarting.
function getCred(key) {
  const store = load();
  if (store.values && store.values[key]) return store.values[key];
  return process.env[key] || '';
}

function isConfigured(key) {
  return Boolean(getCred(key));
}

// When a credential was last saved through the admin page — used to warn
// before short-lived tokens (Instagram/Facebook, ~60 days) silently expire.
// Only tracked for values saved here; env-only credentials have no known
// mint date, so this returns null for those (no warning shown, by design).
function getCredSavedAt(key) {
  const store = load();
  return store.meta && store.meta[key] ? store.meta[key].savedAt : null;
}

// keys: array of env var names this call is allowed to touch (a whitelist
// from CREDENTIAL_FIELDS) — never persist arbitrary keys a caller sends.
function saveCredentials(keys, values) {
  const store = load();
  store.values = store.values || {};
  store.meta = store.meta || {};
  const now = new Date().toISOString();
  keys.forEach((key) => {
    if (typeof values[key] === 'string' && values[key].trim() !== '') {
      store.values[key] = values[key].trim();
      store.meta[key] = { savedAt: now };
    }
  });
  persist(store);
}

function clearCredentials(keys) {
  const store = load();
  keys.forEach((key) => {
    if (store.values) delete store.values[key];
    if (store.meta) delete store.meta[key];
  });
  persist(store);
}

module.exports = { getCred, isConfigured, getCredSavedAt, saveCredentials, clearCredentials };
