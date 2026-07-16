const form = document.getElementById('loginForm');
const errorEl = document.getElementById('loginError');
const submitBtn = document.getElementById('submitBtn');

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorEl.textContent = '';
  submitBtn.disabled = true;
  submitBtn.classList.add('is-syncing');

  try {
    const password = document.getElementById('password').value;
    const res = await fetch('/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    });
    const data = await res.json();
    if (!res.ok) {
      errorEl.textContent = data.error || 'Login failed.';
      return;
    }
    window.location.href = '/admin';
  } catch {
    errorEl.textContent = 'Could not reach the server. Try again.';
  } finally {
    submitBtn.disabled = false;
    submitBtn.classList.remove('is-syncing');
  }
});
