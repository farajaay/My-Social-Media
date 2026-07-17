const platformList = document.getElementById('platformList');
const logoutBtn = document.getElementById('logoutBtn');
const goalFormCard = document.getElementById('goalFormCard');
const queueForm = document.getElementById('queueForm');
const queuePlatform = document.getElementById('queuePlatform');
const queueDay = document.getElementById('queueDay');
const queueDaypart = document.getElementById('queueDaypart');
const queueCaption = document.getElementById('queueCaption');
const queueMsg = document.getElementById('queueMsg');
const queueList = document.getElementById('queueList');
const compForm = document.getElementById('compForm');
const compPlatform = document.getElementById('compPlatform');
const compHandle = document.getElementById('compHandle');
const compName = document.getElementById('compName');
const compMsg = document.getElementById('compMsg');
const compList = document.getElementById('compList');

let csrfToken = '';
let platformsCache = [];

function formatCount(n) {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(n % 1_000_000 === 0 ? 0 : 1) + 'M';
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(n % 1_000 === 0 ? 0 : 1) + 'K';
  return String(n);
}

function fieldRow(platformId, field) {
  const row = document.createElement('div');
  row.className = 'field-row';
  row.innerHTML = `
    <label for="${platformId}-${field.key}">
      <span>${field.label}</span>
      <span class="state${field.configured ? ' is-set' : ''}">${field.configured ? 'Saved' : 'Not set'}</span>
    </label>
    <input type="${field.secret ? 'password' : 'text'}" id="${platformId}-${field.key}" data-key="${field.key}"
      placeholder="${field.configured ? '•••••••• leave blank to keep' : 'Not set'}" autocomplete="off" />
  `;
  return row;
}

function platformCard(platform) {
  const card = document.createElement('article');
  card.className = 'platform-card';
  const ready = platform.fields.every((f) => f.configured);

  const head = document.createElement('div');
  head.className = 'platform-head';
  head.innerHTML = `
    <span class="platform-name">${platform.name}</span>
    <span class="platform-chip${ready ? ' is-ready' : ''}">${ready ? 'Ready' : 'Incomplete'}</span>
  `;
  card.appendChild(head);

  const form = document.createElement('form');
  form.dataset.platform = platform.id;
  platform.fields.forEach((field) => form.appendChild(fieldRow(platform.id, field)));

  const actions = document.createElement('div');
  actions.className = 'platform-actions';
  actions.innerHTML = `
    <button type="submit" class="btn-save">Save</button>
    <button type="button" class="btn-clear" data-clear="${platform.id}">Clear saved keys</button>
  `;
  form.appendChild(actions);

  const msg = document.createElement('p');
  msg.className = 'platform-msg';
  form.appendChild(msg);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const values = {};
    form.querySelectorAll('input[data-key]').forEach((input) => {
      if (input.value.trim()) values[input.dataset.key] = input.value.trim();
    });
    if (Object.keys(values).length === 0) {
      msg.textContent = 'Nothing to save — fields are blank.';
      msg.className = 'platform-msg';
      return;
    }
    await submitCredentials(platform.id, values, card, msg);
  });

  actions.querySelector('[data-clear]').addEventListener('click', async () => {
    await clearCredentials(platform.id, card, msg);
  });

  card.appendChild(form);
  return card;
}

async function submitCredentials(platformId, values, card, msg) {
  try {
    const res = await fetch('/api/admin/credentials', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ platformId, values }),
    });
    if (res.status === 401) return (window.location.href = '/admin/login');
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.error || 'Save failed.';
      msg.className = 'platform-msg is-err';
      return;
    }
    msg.textContent = 'Saved.';
    msg.className = 'platform-msg is-ok';
    refreshCard(card, { id: platformId, name: card.querySelector('.platform-name').textContent, fields: data.fields });
  } catch {
    msg.textContent = 'Could not reach the server.';
    msg.className = 'platform-msg is-err';
  }
}

async function clearCredentials(platformId, card, msg) {
  try {
    const res = await fetch('/api/admin/credentials/clear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ platformId }),
    });
    if (res.status === 401) return (window.location.href = '/admin/login');
    const data = await res.json();
    if (!res.ok) {
      msg.textContent = data.error || 'Clear failed.';
      msg.className = 'platform-msg is-err';
      return;
    }
    msg.textContent = 'Cleared.';
    msg.className = 'platform-msg is-ok';
    refreshCard(card, { id: platformId, name: card.querySelector('.platform-name').textContent, fields: data.fields });
  } catch {
    msg.textContent = 'Could not reach the server.';
    msg.className = 'platform-msg is-err';
  }
}

function refreshCard(oldCard, platform) {
  const fresh = platformCard(platform);
  oldCard.replaceWith(fresh);
}

// --- Growth goal ---

function renderGoalForm(goal) {
  const current = goal
    ? `<p class="goal-current">Current target: <b>${formatCount(goal.target)}</b> followers, set ${new Date(goal.setAt).toLocaleDateString()}.</p>`
    : `<p class="goal-current">No goal set yet.</p>`;

  goalFormCard.innerHTML = `
    ${current}
    <form id="goalForm">
      <div class="goal-form-row">
        <input type="number" id="goalTarget" min="1" step="1" placeholder="e.g. 1000000" />
        <button type="submit" class="btn-save">Save goal</button>
        ${goal ? '<button type="button" class="btn-clear" id="goalClear">Clear</button>' : ''}
      </div>
      <p class="platform-msg" id="goalMsg"></p>
    </form>
  `;

  const form = document.getElementById('goalForm');
  const msg = document.getElementById('goalMsg');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const target = Number(document.getElementById('goalTarget').value);
    if (!Number.isFinite(target) || target <= 0) {
      msg.textContent = 'Enter a positive number.';
      msg.className = 'platform-msg is-err';
      return;
    }
    try {
      const res = await fetch('/api/admin/goal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ target }),
      });
      if (res.status === 401) return (window.location.href = '/admin/login');
      const data = await res.json();
      if (!res.ok) {
        msg.textContent = data.error || 'Save failed.';
        msg.className = 'platform-msg is-err';
        return;
      }
      renderGoalForm(data.goal);
    } catch {
      msg.textContent = 'Could not reach the server.';
      msg.className = 'platform-msg is-err';
    }
  });

  const clearBtn = document.getElementById('goalClear');
  if (clearBtn) {
    clearBtn.addEventListener('click', async () => {
      await fetch('/api/admin/goal/clear', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      });
      renderGoalForm(null);
    });
  }
}

// --- Content queue ---

function populateSelects(platforms, days, dayparts) {
  queuePlatform.innerHTML = platforms.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  queueDay.innerHTML = days.map((d) => `<option value="${d}">${d}</option>`).join('');
  queueDaypart.innerHTML = dayparts.map((d) => `<option value="${d}">${d}</option>`).join('');
}

function platformName(id) {
  const p = platformsCache.find((pl) => pl.id === id);
  return p ? p.name : id;
}

function queueItem(draft) {
  const item = document.createElement('article');
  item.className = 'queue-item';
  item.innerHTML = `
    <div class="queue-item-head">
      <span class="queue-item-slot">${draft.day} &middot; ${draft.daypart}</span>
      <span class="queue-item-platform">${platformName(draft.platformId)}</span>
    </div>
    <p class="queue-item-caption">${draft.caption}</p>
    <div class="queue-item-actions">
      <button type="button" class="btn-save queue-item-posted" data-id="${draft.id}" title="Logs the posting moment so the timing heatmap can learn from the real outcome">Mark as posted</button>
      <button type="button" class="queue-item-delete" data-id="${draft.id}">Remove</button>
    </div>
  `;
  item.querySelector('.queue-item-delete').addEventListener('click', async () => {
    const res = await fetch('/api/admin/queue/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ id: draft.id }),
    });
    if (res.status === 401) return (window.location.href = '/admin/login');
    const data = await res.json();
    renderQueue(data.queue || []);
  });
  item.querySelector('.queue-item-posted').addEventListener('click', async () => {
    const res = await fetch('/api/admin/queue/posted', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ id: draft.id }),
    });
    if (res.status === 401) return (window.location.href = '/admin/login');
    const data = await res.json();
    if (data.ok) {
      queueMsg.textContent = `Logged. ${data.postsLogged} post${data.postsLogged === 1 ? '' : 's'} recorded — outcomes score automatically after 24h.`;
      queueMsg.className = 'platform-msg is-ok';
    }
    renderQueue(data.queue || []);
  });
  return item;
}

function renderQueue(items) {
  queueList.innerHTML = '';
  if (!items.length) {
    queueList.innerHTML = '<p class="queue-empty">Nothing queued yet.</p>';
    return;
  }
  items.forEach((draft) => queueList.appendChild(queueItem(draft)));
}

async function loadQueue() {
  const res = await fetch('/api/admin/queue');
  if (res.status === 401) return (window.location.href = '/admin/login');
  const data = await res.json();
  renderQueue(data.queue || []);
}

queueForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const caption = queueCaption.value.trim();
  if (!caption) {
    queueMsg.textContent = 'Caption is required.';
    queueMsg.className = 'platform-msg is-err';
    return;
  }
  try {
    const res = await fetch('/api/admin/queue', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({
        platformId: queuePlatform.value,
        day: queueDay.value,
        daypart: queueDaypart.value,
        caption,
      }),
    });
    if (res.status === 401) return (window.location.href = '/admin/login');
    const data = await res.json();
    if (!res.ok) {
      queueMsg.textContent = data.error || 'Could not add draft.';
      queueMsg.className = 'platform-msg is-err';
      return;
    }
    queueCaption.value = '';
    queueMsg.textContent = 'Added.';
    queueMsg.className = 'platform-msg is-ok';
    renderQueue(data.queue);
  } catch {
    queueMsg.textContent = 'Could not reach the server.';
    queueMsg.className = 'platform-msg is-err';
  }
});

// --- Competitors ---

let compPlatforms = [];

function compPlatformName(id) {
  const p = compPlatforms.find((pl) => pl.id === id);
  return p ? p.name : id;
}

function renderCompetitors(data) {
  compPlatforms = data.platforms || compPlatforms;

  compPlatform.innerHTML = compPlatforms
    .map((p) => `<option value="${p.id}">${p.name} (${p.handleLabel})</option>`)
    .join('');

  const missingKeys = compPlatforms.filter((p) => !p.keyConfigured);
  const existingWarn = compForm.querySelector('.comp-key-warn');
  if (existingWarn) existingWarn.remove();
  if (missingKeys.length) {
    const warn = document.createElement('p');
    warn.className = 'comp-key-warn';
    warn.textContent = `Snapshots need your own key connected above: ${missingKeys.map((p) => `${p.name} (${p.keyName})`).join(', ')}.`;
    compForm.prepend(warn);
  }

  compList.innerHTML = '';
  const comps = data.competitors || [];
  if (!comps.length) {
    compList.innerHTML = '<p class="queue-empty">No tracked accounts yet.</p>';
    return;
  }
  comps.forEach((c) => {
    const item = document.createElement('article');
    item.className = 'queue-item';
    item.innerHTML = `
      <div class="queue-item-head">
        <span class="queue-item-slot comp-display-name"></span>
        <span class="queue-item-platform">${compPlatformName(c.platformId)}</span>
      </div>
      <p class="queue-item-caption comp-handle"></p>
      <button type="button" class="queue-item-delete">Stop tracking</button>
    `;
    item.querySelector('.comp-display-name').textContent = c.name;
    item.querySelector('.comp-handle').textContent = c.handle;
    item.querySelector('.queue-item-delete').addEventListener('click', async () => {
      const res = await fetch('/api/admin/competitors/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ id: c.id }),
      });
      if (res.status === 401) return (window.location.href = '/admin/login');
      renderCompetitors(await res.json());
    });
    compList.appendChild(item);
  });
}

async function loadCompetitors() {
  const res = await fetch('/api/admin/competitors');
  if (res.status === 401) return (window.location.href = '/admin/login');
  renderCompetitors(await res.json());
}

compForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await fetch('/api/admin/competitors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({
        platformId: compPlatform.value,
        handle: compHandle.value.trim(),
        name: compName.value.trim(),
      }),
    });
    if (res.status === 401) return (window.location.href = '/admin/login');
    const data = await res.json();
    if (!res.ok) {
      compMsg.textContent = data.error || 'Could not add.';
      compMsg.className = 'platform-msg is-err';
      return;
    }
    compHandle.value = '';
    compName.value = '';
    compMsg.textContent = 'Tracking. First snapshot taken now if the key allows; the Versus chart appears after two days of data.';
    compMsg.className = 'platform-msg is-ok';
    renderCompetitors(data);
  } catch {
    compMsg.textContent = 'Could not reach the server.';
    compMsg.className = 'platform-msg is-err';
  }
});

// --- Bootstrap ---

async function loadBootstrap() {
  const res = await fetch('/api/admin/bootstrap');
  if (res.status === 401) return (window.location.href = '/admin/login');
  const data = await res.json();
  csrfToken = data.csrfToken;
  platformsCache = data.platforms;

  platformList.innerHTML = '';
  data.platforms.forEach((platform) => platformList.appendChild(platformCard(platform)));

  renderGoalForm(data.goal);
  populateSelects(data.platforms, data.days, data.dayparts);
  loadQueue();
  loadCompetitors();
}

logoutBtn.addEventListener('click', async () => {
  await fetch('/admin/logout', { method: 'POST' });
  window.location.href = '/admin/login';
});

loadBootstrap();
