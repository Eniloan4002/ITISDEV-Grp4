// Minimal vanilla JS for the Reset Password form (SI-8).
// The single-use token comes from the URL (?token=...). On submit we post the
// token + new password to /api/password-reset/confirm. The server validates the
// token (existence, unused, not expired) and the password strength server-side.

const form = document.getElementById('reset-form');
const submitBtn = document.getElementById('submit-btn');
const formMessage = document.getElementById('form-message');

const FIELDS = ['newPassword'];

// Token from the query string. Disable the form if it's missing.
const token = new URLSearchParams(location.search).get('token');

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

// Show field-level errors returned by the server (or client-side checks).
function showFieldErrors(errors) {
  for (const [field, message] of Object.entries(errors)) {
    const errorEl = document.getElementById(`error-${field}`);
    const wrapper = document.getElementById(field)?.closest('.field');
    if (errorEl) errorEl.textContent = message;
    if (wrapper) wrapper.classList.add('has-error');
  }
}

function showMessage(text, type) {
  formMessage.innerHTML = text;
  formMessage.className = `form-message is-${type}`;
  formMessage.hidden = false;
}

// Guard: no token in the URL means the link is unusable.
if (!token) {
  showMessage('Invalid reset link.', 'error');
  submitBtn.disabled = true;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();

  const payload = { token, newPassword: form.newPassword.value };

  submitBtn.disabled = true;
  try {
    const res = await fetch('/api/password-reset/confirm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (res.ok) {
      // Success: invite the user to log in with their new password.
      showMessage(data.message + ' <a href="/login">Go to login</a>', 'success');
      form.reset();
      submitBtn.disabled = true;
    } else {
      if (data.errors) showFieldErrors(data.errors);
      showMessage(data.message || 'Could not reset the password.', 'error');
      submitBtn.disabled = false;
    }
  } catch (err) {
    showMessage('Network error. Please try again.', 'error');
    submitBtn.disabled = false;
  }
});
