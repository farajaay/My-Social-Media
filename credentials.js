const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'credentials.json');

function load() {
  try {
    return JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
  } catch {
    return {};
  }
}

function persist(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), { mode: 0o600 });
}

// A saved override takes precedence over .env, so changes made from the
// admin page work immediately without editing files or restarting.
function getCred(key) {
  const store = load();
  if (store[key]) return store[key];
  return process.env[key] || '';
}

function isConfigured(key) {
  return Boolean(getCred(key));
}

// keys: array of env var names this call is allowed to touch (a whitelist
// from CREDENTIAL_FIELDS) — never persist arbitrary keys a caller sends.
function saveCredentials(keys, values) {
  const store = load();
  keys.forEach((key) => {
    if (typeof values[key] === 'string' && values[key].trim() !== '') {
      store[key] = values[key].trim();
    }
  });
  persist(store);
}

function clearCredentials(keys) {
  const store = load();
  keys.forEach((key) => {
    delete store[key];
  });
  persist(store);
}

module.exports = { getCred, isConfigured, saveCredentials, clearCredentials };
