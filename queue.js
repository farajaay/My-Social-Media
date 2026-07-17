const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.join(__dirname, 'data');
const QUEUE_PATH = path.join(DATA_DIR, 'queue.json');

function loadQueue() {
  try {
    return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function persist(items) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(items, null, 2));
}

function addDraft({ platformId, caption, day, daypart }) {
  const items = loadQueue();
  const draft = {
    id: crypto.randomUUID(),
    platformId,
    caption,
    day,
    daypart,
    createdAt: new Date().toISOString(),
  };
  items.push(draft);
  persist(items);
  return draft;
}

function removeDraft(id) {
  const items = loadQueue().filter((d) => d.id !== id);
  persist(items);
  return items;
}

module.exports = { loadQueue, addDraft, removeDraft };
