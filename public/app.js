const ICONS = {
  x: 'icon-x',
  youtube: 'icon-youtube',
  instagram: 'icon-instagram',
  tiktok: 'icon-tiktok',
  facebook: 'icon-facebook',
  linkedin: 'icon-linkedin',
};

const AREAS = ['spot', 'a', 'b', 'c', 'd', 'e'];

const grid = document.getElementById('grid');
const heroSub = document.getElementById('heroSub');
const tickTime = document.getElementById('tickTime');
const tickTotal = document.getElementById('tickTotal');
const tickStatus = document.getElementById('tickStatus');
const controlStatus = document.getElementById('controlStatus');
const clock = document.getElementById('clock');
const syncButton = document.getElementById('sync');
const favicon = document.getElementById('favicon');
const themeOpts = document.querySelectorAll('.theme-opt');
const kpiRow = document.getElementById('kpiRow');
const heatmapEl = document.getElementById('heatmap');
const heatmapBest = document.getElementById('heatmapBest');
const heatmapProvenance = document.getElementById('heatmapProvenance');
const heatTip = document.getElementById('heatTip');
const goalBand = document.getElementById('goalBand');
const ideaPillar = document.getElementById('ideaPillar');
const ideaPrompt = document.getElementById('ideaPrompt');
const ideaShuffle = document.getElementById('ideaShuffle');
const promoBudget = document.getElementById('promoBudget');
const promoRecalc = document.getElementById('promoRecalc');
const promoCallout = document.getElementById('promoCallout');
const promoList = document.getElementById('promoList');

const DAYPART_RANGE = {
  '12a': '12–4am',
  '4a': '4–8am',
  '8a': '8am–12pm',
  '12p': '12–4pm',
  '4p': '4–8pm',
  '8p': '8pm–12am',
};

const FAVICONS = {
  signal: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%23171310'/%3E%3Cpath d='M4 18h5l3-9 5 15 3-10h8' fill='none' stroke='%23ff8a3d' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E",
  blueprint: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='6' fill='%230e2444'/%3E%3Cpath d='M4 18h5l3-9 5 15 3-10h8' fill='none' stroke='%23bfe3ff' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E",
};

function setTheme(theme) {
  document.documentElement.dataset.theme = theme === 'blueprint' ? 'blueprint' : '';
  localStorage.setItem('signal-theme', theme);
  favicon.href = FAVICONS[theme] || FAVICONS.signal;
  themeOpts.forEach((btn) => {
    const active = btn.dataset.themeChoice === theme;
    btn.setAttribute('aria-pressed', String(active));
  });
}

themeOpts.forEach((btn) => {
  btn.addEventListener('click', () => setTheme(btn.dataset.themeChoice));
});

setTheme(document.documentElement.dataset.theme === 'blueprint' ? 'blueprint' : 'signal');

function formatCount(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1) + 'K';
  return String(n);
}

function animateCount(el, target) {
  const start = 0;
  const duration = 900;
  const startTime = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - startTime) / duration);
    const eased = 1 - Math.pow(1 - p, 3);
    el.textContent = formatCount(Math.round(start + (target - start) * eased));
    if (p < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function trendPct(trend) {
  if (!Array.isArray(trend) || trend.length < 2 || !trend[0]) return null;
  const delta = trend[trend.length - 1] - trend[0];
  return (delta / trend[0]) * 100;
}

// trendSource provenance: 'live' = built from stored daily snapshots of your
// real accounts; 'demo' = the demo array; 'pending' = live account still
// collecting its first days of history.
function trendSourceTag(source) {
  if (source === 'live') return 'real';
  if (source === 'pending') return 'collecting';
  return 'demo';
}

function trendBadge(trend, source) {
  const pct = trendPct(trend);
  if (pct === null) {
    if (source === 'pending') {
      return '<span class="trend-badge is-pending" title="Live account — trend appears after two days of history">collecting history&#8230;</span>';
    }
    return '';
  }
  const up = pct >= 0;
  return `<span class="trend-badge ${up ? 'is-up' : 'is-down'}" title="Trend source: ${trendSourceTag(source)}">${up ? '▲' : '▼'} ${Math.abs(pct).toFixed(1)}% &middot; 7d</span>`;
}

function sparkline(trend, source) {
  if (!Array.isArray(trend) || trend.length < 2) return '';
  const min = Math.min(...trend);
  const max = Math.max(...trend);
  const span = max - min || 1;
  const points = trend
    .map((v, i) => {
      const x = (i / (trend.length - 1)) * 100;
      const y = 36 - ((v - min) / span) * 32 - 2;
      return `${x},${y}`;
    })
    .join(' ');
  const pct = trendPct(trend);
  return `
    <div class="panel-trend">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <p class="panel-trend-label">7-day trend &middot; <b>${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%</b> &middot; ${trendSourceTag(source)}</p>
    </div>
  `;
}

function panelTemplate(area, platform) {
  const iconId = ICONS[platform.id] || 'icon-pulse';
  const wrap = document.createElement('article');
  wrap.className = 'panel';
  wrap.dataset.area = area;
  wrap.innerHTML = `
    <div>
      <div class="panel-head">
        <svg class="panel-icon"><use href="#${iconId}"/></svg>
        <span class="panel-status${platform.live ? ' is-live' : ''}">${platform.live ? 'LIVE' : 'DEMO'}</span>
      </div>
      <p class="panel-name">${platform.name}</p>
      <p class="panel-number" data-count="${platform.followers}">0</p>
      <p class="panel-meta"><span class="label">Followers</span><span class="rate" title="Engagement source: ${platform.engagementSource === 'live' ? 'your recent posts' : 'demo estimate'}">${platform.engagementRate}% engagement${platform.live && platform.engagementSource !== 'live' ? ' (est.)' : ''}</span>${trendBadge(platform.trend, platform.trendSource)}</p>
      ${area === 'spot' ? sparkline(platform.trend, platform.trendSource) : ''}
    </div>
    <div class="panel-post">
      ${platform.latestPost}
      <span>${platform.postedAgo} ago</span>
    </div>
  `;
  return wrap;
}

function render(data) {
  const sorted = [...data.platforms].sort((a, b) => b.followers - a.followers);
  grid.innerHTML = '';
  sorted.forEach((platform, i) => {
    const panel = panelTemplate(AREAS[i], platform);
    grid.appendChild(panel);
    const numberEl = panel.querySelector('.panel-number');
    animateCount(numberEl, platform.followers);
  });

  const total = data.platforms.reduce((sum, p) => sum + p.followers, 0);
  const anyLive = data.platforms.some((p) => p.live);
  const allLive = data.platforms.every((p) => p.live);

  heroSub.innerHTML = `Reading six channels &middot; <b>${formatCount(total)}</b> people tracked, refreshed on demand.`;
  tickTotal.textContent = `${formatCount(total)} followers tracked`;
  tickStatus.textContent = allLive ? 'LIVE MODE' : anyLive ? 'MIXED MODE' : 'DEMO MODE';

  const now = new Date(data.generatedAt);
  tickTime.textContent = now.toTimeString().slice(0, 5);

  controlStatus.innerHTML = data.platforms
    .map((p) => `<span class="cs-item${p.live ? ' is-live' : ''}"><span class="cs-dot"></span>${p.name} ${p.live ? 'live' : 'demo'}</span>`)
    .join('');

  attachTilt();
}

function attachTilt() {
  const spot = grid.querySelector('[data-area="spot"]');
  if (!spot) return;
  spot.addEventListener('mousemove', (e) => {
    const r = spot.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    spot.style.transform = `perspective(900px) rotateX(${y * -3.5}deg) rotateY(${x * 3.5}deg)`;
  });
  spot.addEventListener('mouseleave', () => {
    spot.style.transform = 'perspective(900px) rotateX(0) rotateY(0)';
  });
}

function kpiTile({ label, value, deltaPct, deltaLabel, note }) {
  const wrap = document.createElement('div');
  wrap.className = 'kpi-tile';
  let deltaHtml = '';
  if (deltaPct !== null && deltaPct !== undefined) {
    const up = deltaPct >= 0;
    deltaHtml = `<span class="kpi-delta ${up ? 'is-up' : 'is-down'}">${up ? '▲' : '▼'} ${Math.abs(deltaPct).toFixed(1)}% ${deltaLabel || ''}</span>`;
  }
  wrap.innerHTML = `
    <p class="kpi-label">${label}</p>
    <p class="kpi-value">${value}</p>
    ${deltaHtml}
    ${note ? `<p class="kpi-note">${note}</p>` : ''}
  `;
  return wrap;
}

function renderKpis(stats) {
  kpiRow.innerHTML = '';

  const startFollowers = stats.totals.followers - stats.totals.weeklyDeltaFollowers;
  const totalDeltaPct = startFollowers ? (stats.totals.weeklyDeltaFollowers / startFollowers) * 100 : null;
  kpiRow.appendChild(
    kpiTile({
      label: 'Total reach',
      value: formatCount(stats.totals.followers),
      deltaPct: totalDeltaPct,
      deltaLabel: 'this week',
      note: 'Summed across all six channels.',
    })
  );

  kpiRow.appendChild(
    kpiTile({
      label: 'Blended engagement',
      value: `${stats.totals.blendedEngagement}%`,
      deltaPct: null,
      note: 'Weighted by follower count per channel.',
    })
  );

  kpiRow.appendChild(
    kpiTile({
      label: 'Fastest growing',
      value: stats.fastestGrowing ? stats.fastestGrowing.name : '—',
      deltaPct: stats.fastestGrowing ? stats.fastestGrowing.pct : null,
      deltaLabel: 'over 7 days',
      note: stats.fastestGrowing ? null : 'Needs trend history to compare.',
    })
  );
}

function heatCellColor(index) {
  const pct = Math.round(12 + (index / 100) * 82);
  return `color-mix(in srgb, var(--accent) ${pct}%, var(--bg-2) ${100 - pct}%)`;
}

function showHeatTip(x, y, text) {
  heatTip.textContent = text;
  heatTip.style.left = `${x}px`;
  heatTip.style.top = `${y}px`;
  heatTip.classList.add('is-visible');
}

function hideHeatTip() {
  heatTip.classList.remove('is-visible');
}

function renderHeatmap(timing) {
  heatmapEl.innerHTML = '';

  const corner = document.createElement('span');
  corner.className = 'heat-corner';
  heatmapEl.appendChild(corner);

  timing.dayparts.forEach((part) => {
    const label = document.createElement('span');
    label.className = 'heat-col-label';
    label.textContent = part;
    heatmapEl.appendChild(label);
  });

  timing.days.forEach((day) => {
    const rowLabel = document.createElement('span');
    rowLabel.className = 'heat-row-label';
    rowLabel.textContent = day;
    heatmapEl.appendChild(rowLabel);

    timing.dayparts.forEach((part) => {
      const cell = timing.cells.find((c) => c.day === day && c.daypart === part);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'heat-cell';
      if (cell.day === timing.best.day && cell.daypart === timing.best.daypart) {
        btn.classList.add('is-best');
      }
      btn.style.background = heatCellColor(cell.index);
      const tipText = `${cell.day} ${DAYPART_RANGE[cell.daypart]} — ${cell.index}/100`;

      btn.addEventListener('pointerenter', (e) => showHeatTip(e.clientX + 14, e.clientY + 14, tipText));
      btn.addEventListener('pointermove', (e) => showHeatTip(e.clientX + 14, e.clientY + 14, tipText));
      btn.addEventListener('pointerleave', hideHeatTip);
      btn.addEventListener('focus', () => {
        const r = btn.getBoundingClientRect();
        showHeatTip(r.left, r.bottom + 8, tipText);
      });
      btn.addEventListener('blur', hideHeatTip);

      heatmapEl.appendChild(btn);
    });
  });

  heatmapBest.innerHTML = `<b>${timing.best.day} ${DAYPART_RANGE[timing.best.daypart]}</b>`;

  if (timing.source === 'personalized') {
    heatmapProvenance.innerHTML = `<b>Personalized</b> from ${timing.postsLogged} of your logged posts &middot; slots you haven't posted in keep the industry model.`;
  } else {
    const remaining = Math.max(0, (timing.postsNeeded || 10) - (timing.postsLogged || 0));
    heatmapProvenance.innerHTML = `Industry model &middot; personalizes after <b>${remaining} more</b> logged post${remaining === 1 ? '' : 's'} (mark drafts as posted from the admin queue).`;
  }
}

function renderGoal(goal) {
  if (!goal) {
    goalBand.innerHTML = `
      <div class="goal-empty">
        No growth goal set yet. Add one from <a href="/admin/login">the admin page</a> to see progress and a projected date here.
      </div>
    `;
    return;
  }

  const metaLine = goal.reached
    ? `<b>Goal reached.</b> Set a new target from the admin page.`
    : goal.projectedDate
      ? `At the current pace (<b>${goal.dailyRate >= 0 ? '+' : ''}${formatCount(goal.dailyRate)}</b>/day), you'll hit it around <b>${goal.projectedDate}</b>.`
      : `Growth is flat or negative this week, so there's no projected date yet.`;

  goalBand.innerHTML = `
    <div class="goal-card">
      <div class="goal-head">
        <p class="goal-label">Growth goal</p>
        <p class="goal-value"><b>${formatCount(goal.current)}</b> / ${formatCount(goal.target)} &middot; ${goal.pct}%</p>
      </div>
      <div class="goal-track"><div class="goal-fill" style="width:${goal.pct}%"></div></div>
      <p class="goal-meta">${metaLine}</p>
    </div>
  `;
}

async function loadGoal() {
  const res = await fetch('/api/goal');
  const data = await res.json();
  renderGoal(data.goal);
}

let ideasBank = [];
let lastIdeaIndex = -1;

function showIdea() {
  if (!ideasBank.length) return;
  let i = Math.floor(Math.random() * ideasBank.length);
  if (ideasBank.length > 1 && i === lastIdeaIndex) i = (i + 1) % ideasBank.length;
  lastIdeaIndex = i;
  ideaPillar.textContent = ideasBank[i].pillar;
  ideaPrompt.textContent = ideasBank[i].prompt;
}

async function loadIdeas() {
  const res = await fetch('/api/ideas');
  const data = await res.json();
  ideasBank = data.ideas || [];
  showIdea();
}

ideaShuffle.addEventListener('click', showIdea);

function promoRow(platform, rank) {
  const iconId = ICONS[platform.id] || 'icon-pulse';
  const row = document.createElement('div');
  row.className = `promo-row${rank === 1 ? ' is-top' : ''}`;
  const trendClass = platform.trendPct >= 0 ? 'up' : 'down';
  const trendGlyph = platform.trendPct >= 0 ? '▲' : '▼';
  row.innerHTML = `
    <span class="promo-rank">${String(rank).padStart(2, '0')}</span>
    <svg class="promo-icon"><use href="#${iconId}"/></svg>
    <div class="promo-info">
      <p class="promo-name">${platform.name}</p>
      <p class="promo-meta">${platform.engagementRate}% engagement &middot; <span class="${trendClass}">${trendGlyph} ${Math.abs(platform.trendPct)}%</span></p>
    </div>
    <div class="promo-econ">
      CPM $${platform.cpmLow}&ndash;${platform.cpmHigh}<br>
      <b>$${platform.costPerEngagement}</b>/engagement
    </div>
    <div class="promo-bar-wrap">
      <div class="promo-bar-track"><div class="promo-bar-fill" style="width:${platform.pct}%"></div></div>
      <p class="promo-bar-pct">${platform.pct}% &middot; ~${formatCount(platform.estEngagements)} est. engagements</p>
    </div>
    <p class="promo-amount">$${platform.allocated}</p>
  `;
  return row;
}

async function loadPromotion() {
  const budget = Math.max(10, Number(promoBudget.value) || 500);
  const res = await fetch(`/api/promotion?budget=${budget}`);
  const data = await res.json();

  const slot = DAYPART_RANGE[data.timingSuggestion.daypart] || data.timingSuggestion.daypart;
  promoCallout.innerHTML = `Best value right now: <b>${data.recommendation.platformName}</b>. ${data.recommendation.reason} Paid tends to go further riding an already-strong organic window — yours is <b>${data.timingSuggestion.day} ${slot}</b>.`;

  promoList.innerHTML = '';
  data.platforms.forEach((p, i) => promoList.appendChild(promoRow(p, i + 1)));
}

promoRecalc.addEventListener('click', loadPromotion);
promoBudget.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadPromotion();
});

async function loadStats() {
  const res = await fetch('/api/stats');
  const stats = await res.json();
  renderKpis(stats);
  renderHeatmap(stats.timing);
}

async function load() {
  const [dashboardRes] = await Promise.all([fetch('/api/dashboard'), loadStats(), loadGoal(), loadPromotion()]);
  const data = await dashboardRes.json();
  render(data);
}

syncButton.addEventListener('click', async () => {
  syncButton.classList.add('is-syncing');
  syncButton.disabled = true;
  await load();
  setTimeout(() => {
    syncButton.classList.remove('is-syncing');
    syncButton.disabled = false;
  }, 400);
});

function tickClock() {
  clock.textContent = new Date().toTimeString().slice(0, 8);
}
tickClock();
setInterval(tickClock, 1000);

load();
loadIdeas();
