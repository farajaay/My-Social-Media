const platformList = document.getElementById('platformList');
const logoutBtn = document.getElementById('logoutBtn');
let csrfToken = '';

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

async function loadBootstrap() {
  const res = await fetch('/api/admin/bootstrap');
  if (res.status === 401) return (window.location.href = '/admin/login');
  const data = await res.json();
  csrfToken = data.csrfToken;
  platformList.innerHTML = '';
  data.platforms.forEach((platform) => platformList.appendChild(platformCard(platform)));
}

logoutBtn.addEventListener('click', async () => {
  await fetch('/admin/logout', { method: 'POST' });
  window.location.href = '/admin/login';
});

loadBootstrap();
