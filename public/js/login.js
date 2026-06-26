// Minimal vanilla JS for the Login form (SI-7).
// No framework, no animation — it just talks to the REST API and shows results.

const form = document.getElementById('login-form');
const submitBtn = document.getElementById('submit-btn');
const formMessage = document.getElementById('form-message');

const FIELDS = ['email', 'password'];

// Clear all previous error/message state before a new submit.
function clearErrors() {
  formMessage.hidden = true;
  formMessage.className = 'form-message';
  formMessage.textContent = '';
  for (const field of FIELDS) {
    document.getElementById(field).closest('.field').classList.remove('has-error');
    document.getElementById(`error-${field}`).textContent = '';
  }
}

// Show field-level errors (kept for parity with register.js; login uses a top-level message).
function showFieldErrors(errors) {
  for (const [field, message] of Object.entries(errors)) {
    const errorEl = document.getElementById(`error-${field}`);
    const wrapper = document.getElementById(field)?.closest('.field');
    if (errorEl) errorEl.textContent = message;
    if (wrapper) wrapper.classList.add('has-error');
  }
}

function showMessage(text, type) {
  formMessage.textContent = text;
  formMessage.className = `form-message is-${type}`;
  formMessage.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();

  const payload = {
    email: form.email.value,
    password: form.password.value,
  };

  submitBtn.disabled = true;
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (res.ok) {
      // Success (AC): authenticated, redirect to the role dashboard.
      window.location = data.redirect || '/dashboard.html';
    } else {
      // Generic rejection — login returns a top-level message, not per-field errors.
      showMessage(data.message || 'Could not log in.', 'error');
    }
  } catch (err) {
    showMessage('Network error. Please try again.', 'error');
  } finally {
    submitBtn.disabled = false;
  }
});
