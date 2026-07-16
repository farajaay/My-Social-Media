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

function sparkline(trend) {
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
  const delta = trend[trend.length - 1] - trend[0];
  const pct = ((delta / trend[0]) * 100).toFixed(1);
  return `
    <div class="panel-trend">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
      <p class="panel-trend-label">7-day trend &middot; <b>${delta >= 0 ? '+' : ''}${pct}%</b></p>
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
      <p class="panel-meta"><span class="label">Followers</span><span class="rate">${platform.engagementRate}% engagement</span></p>
      ${area === 'spot' ? sparkline(platform.trend) : ''}
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

async function load() {
  const res = await fetch('/api/dashboard');
  const data = await res.json();
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
