// Benchmark paid-ad costs per platform — typical industry-average ranges
// reported across ad-buying guides, NOT live quotes. Real cost is set by
// auction and swings with targeting, audience size, season, and competition.
// Always check each platform's own ads manager before committing spend:
// Meta Ads Manager (Instagram/Facebook), X Ads, TikTok Ads Manager,
// YouTube/Google Ads, LinkedIn Campaign Manager.
//
// cpm = cost per 1,000 impressions, in USD. Used as the one comparable unit
// across platforms even though some (YouTube) natively price by view.

const AD_COST_BENCHMARKS = {
  x: { cpmLow: 5, cpmHigh: 8, note: 'Priced by objective; link clicks and engagements are the common buys.' },
  youtube: { cpmLow: 9, cpmHigh: 15, note: 'Skippable in-stream is usually priced per view (~$0.01–0.03/view); CPM shown here is the rough equivalent.' },
  instagram: { cpmLow: 6, cpmHigh: 10, note: 'Reels and Stories placements often run cheaper than feed.' },
  tiktok: { cpmLow: 8, cpmHigh: 12, note: 'Campaigns typically carry a $50/day minimum, ad groups $20/day.' },
  facebook: { cpmLow: 6, cpmHigh: 11, note: 'Shares inventory and auction with Instagram under Meta Ads Manager.' },
  linkedin: { cpmLow: 30, cpmHigh: 40, note: 'Notably pricier — B2B/professional targeting carries a premium.' },
};

function avgCpm(platformId) {
  const b = AD_COST_BENCHMARKS[platformId];
  if (!b) return null;
  return (b.cpmLow + b.cpmHigh) / 2;
}

module.exports = { AD_COST_BENCHMARKS, avgCpm };
