const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const GOAL_PATH = path.join(DATA_DIR, 'goal.json');

function getGoal() {
  try {
    return JSON.parse(fs.readFileSync(GOAL_PATH, 'utf8'));
  } catch {
    return null;
  }
}

function setGoal(target) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(GOAL_PATH, JSON.stringify({ target, setAt: new Date().toISOString() }, null, 2));
}

function clearGoal() {
  try {
    fs.unlinkSync(GOAL_PATH);
  } catch {
    // already gone
  }
}

module.exports = { getGoal, setGoal, clearGoal };
