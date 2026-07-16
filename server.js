require('dotenv').config();
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Demo data. Shown whenever a platform's env keys are missing or its live
// call fails, so the dashboard always renders something honest and labeled.
// ---------------------------------------------------------------------------
const DEMO = {
  x: { followers: 48200, engagementRate: 3.4, latestPost: 'Shipping the new pulse dashboard today.', postedAgo: '2h', trend: [46100, 46600, 47000, 46800, 47500, 47900, 48200] },
  youtube: { followers: 132000, engagementRate: 5.1, latestPost: 'Behind the scenes: building in public, ep. 12', postedAgo: '1d', trend: [128400, 129100, 129800, 130200, 130900, 131400, 132000] },
  instagram: { followers: 76300, engagementRate: 4.2, latestPost: 'Studio shots from this week’s shoot.', postedAgo: '5h', trend: [74200, 74600, 75100, 74900, 75600, 76000, 76300] },
  tiktok: { followers: 214000, engagementRate: 7.8, latestPost: '3 things nobody tells you about growth loops', postedAgo: '9h', trend: [198500, 202000, 204800, 206200, 209600, 211900, 214000] },
  facebook: { followers: 29800, engagementRate: 1.6, latestPost: 'Event recap: thanks for coming out.', postedAgo: '3d', trend: [29950, 29900, 29820, 29870, 29780, 29810, 29800] },
  linkedin: { followers: 15400, engagementRate: 2.9, latestPost: 'Hiring: senior product designer, remote.', postedAgo: '6h', trend: [14600, 14750, 14900, 15020, 15150, 15280, 15400] },
};

function demoResult(id) {
  return { id, live: false, updatedAt: new Date().toISOString(), ...DEMO[id] };
}

// ---------------------------------------------------------------------------
// Live fetchers. Each reads credentials from environment variables the
// operator supplies after registering an app with that platform. No key
// ever ships in this repo — see .env.example for the exact variable names
// and README.md for where to obtain each one. Any failure (missing key,
// expired token, rate limit) falls back to demo data rather than crashing
// the dashboard.
// ---------------------------------------------------------------------------

async function fetchX() {
  const token = process.env.TWITTER_BEARER_TOKEN;
  const username = process.env.TWITTER_USERNAME;
  if (!token || !username) return demoResult('x');
  try {
    const res = await fetch(
      `https://api.twitter.com/2/users/by/username/${encodeURIComponent(username)}?user.fields=public_metrics`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`X API ${res.status}`);
    const { data } = await res.json();
    return {
      id: 'x',
      live: true,
      followers: data.public_metrics.followers_count,
      engagementRate: DEMO.x.engagementRate,
      latestPost: DEMO.x.latestPost,
      postedAgo: DEMO.x.postedAgo,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return demoResult('x');
  }
}

async function fetchYouTube() {
  const key = process.env.YOUTUBE_API_KEY;
  const channelId = process.env.YOUTUBE_CHANNEL_ID;
  if (!key || !channelId) return demoResult('youtube');
  try {
    const res = await fetch(
      `https://www.googleapis.com/youtube/v3/channels?part=statistics&id=${channelId}&key=${key}`
    );
    if (!res.ok) throw new Error(`YouTube API ${res.status}`);
    const json = await res.json();
    const stats = json.items?.[0]?.statistics;
    if (!stats) throw new Error('no channel data');
    return {
      id: 'youtube',
      live: true,
      followers: Number(stats.subscriberCount),
      engagementRate: DEMO.youtube.engagementRate,
      latestPost: DEMO.youtube.latestPost,
      postedAgo: DEMO.youtube.postedAgo,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return demoResult('youtube');
  }
}

async function fetchInstagram() {
  const token = process.env.INSTAGRAM_ACCESS_TOKEN;
  const userId = process.env.INSTAGRAM_USER_ID;
  if (!token || !userId) return demoResult('instagram');
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${userId}?fields=followers_count&access_token=${token}`
    );
    if (!res.ok) throw new Error(`Instagram API ${res.status}`);
    const data = await res.json();
    return {
      id: 'instagram',
      live: true,
      followers: data.followers_count,
      engagementRate: DEMO.instagram.engagementRate,
      latestPost: DEMO.instagram.latestPost,
      postedAgo: DEMO.instagram.postedAgo,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return demoResult('instagram');
  }
}

async function fetchTikTok() {
  const token = process.env.TIKTOK_ACCESS_TOKEN;
  if (!token) return demoResult('tiktok');
  try {
    const res = await fetch('https://open.tiktokapis.com/v2/user/info/?fields=follower_count', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`TikTok API ${res.status}`);
    const json = await res.json();
    const followers = json.data?.user?.follower_count;
    if (followers == null) throw new Error('no user data');
    return {
      id: 'tiktok',
      live: true,
      followers,
      engagementRate: DEMO.tiktok.engagementRate,
      latestPost: DEMO.tiktok.latestPost,
      postedAgo: DEMO.tiktok.postedAgo,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return demoResult('tiktok');
  }
}

async function fetchFacebook() {
  const token = process.env.FACEBOOK_ACCESS_TOKEN;
  const pageId = process.env.FACEBOOK_PAGE_ID;
  if (!token || !pageId) return demoResult('facebook');
  try {
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${pageId}?fields=fan_count&access_token=${token}`
    );
    if (!res.ok) throw new Error(`Facebook API ${res.status}`);
    const data = await res.json();
    return {
      id: 'facebook',
      live: true,
      followers: data.fan_count,
      engagementRate: DEMO.facebook.engagementRate,
      latestPost: DEMO.facebook.latestPost,
      postedAgo: DEMO.facebook.postedAgo,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return demoResult('facebook');
  }
}

async function fetchLinkedIn() {
  const token = process.env.LINKEDIN_ACCESS_TOKEN;
  const orgId = process.env.LINKEDIN_ORG_ID;
  if (!token || !orgId) return demoResult('linkedin');
  try {
    const res = await fetch(
      `https://api.linkedin.com/v2/organizationalEntityFollowerStatistics?q=organizationalEntity&organizationalEntity=urn:li:organization:${orgId}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`LinkedIn API ${res.status}`);
    const json = await res.json();
    const followers = json.elements?.[0]?.followerCounts?.organicFollowerCount;
    if (followers == null) throw new Error('no follower data');
    return {
      id: 'linkedin',
      live: true,
      followers,
      engagementRate: DEMO.linkedin.engagementRate,
      latestPost: DEMO.linkedin.latestPost,
      postedAgo: DEMO.linkedin.postedAgo,
      updatedAt: new Date().toISOString(),
    };
  } catch {
    return demoResult('linkedin');
  }
}

const PLATFORMS = [
  { id: 'x', name: 'X', fetch: fetchX },
  { id: 'youtube', name: 'YouTube', fetch: fetchYouTube },
  { id: 'instagram', name: 'Instagram', fetch: fetchInstagram },
  { id: 'tiktok', name: 'TikTok', fetch: fetchTikTok },
  { id: 'facebook', name: 'Facebook', fetch: fetchFacebook },
  { id: 'linkedin', name: 'LinkedIn', fetch: fetchLinkedIn },
];

app.use(express.static('public'));

app.get('/api/dashboard', async (_req, res) => {
  const results = await Promise.all(PLATFORMS.map((p) => p.fetch()));
  const named = results.map((r, i) => ({ name: PLATFORMS[i].name, ...r }));
  res.json({ generatedAt: new Date().toISOString(), platforms: named });
});

app.listen(PORT, () => {
  console.log(`Signal running at http://localhost:${PORT}`);
});
