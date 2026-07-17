// Outbound notifications via a single incoming-webhook URL. Env-only on
// purpose: webhook URLs are capability secrets — anyone holding one can post
// to your channel — so they follow the same rule as platform credentials and
// never enter the hosted database.
//
// Payload shape is auto-detected from the host: Discord wants {content},
// Slack wants {text}; anything else gets {text}, which most generic
// webhook receivers accept.

const MILESTONES = [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];

function isConfigured() {
  return Boolean(process.env.NOTIFY_WEBHOOK_URL);
}

function payloadFor(url, text) {
  if (url.includes('discord.com')) return { content: text };
  return { text };
}

// Never throws: a webhook hiccup must not take down a sync or a request.
async function sendNotification(text) {
  const url = process.env.NOTIFY_WEBHOOK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloadFor(url, text)),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Thresholds passed between two follower counts, ascending. Null prev means
// "first snapshot ever" — nothing crossed, we just learned the current size.
function crossedThresholds(prev, next) {
  if (prev == null || next == null) return [];
  return MILESTONES.filter((t) => prev < t && next >= t);
}

module.exports = { isConfigured, sendNotification, crossedThresholds, MILESTONES };
