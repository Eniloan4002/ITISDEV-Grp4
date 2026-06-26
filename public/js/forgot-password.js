// Minimal vanilla JS for the Forgot Password form (SI-8).
// Posts an email to /api/password-reset/request. The server always replies with
// a generic message; for a registered email it also returns a `resetLink` that we
// surface on-screen (MVP delivery — normally this would arrive by email).

const form = document.getElementById('forgot-form');
const submitBtn = document.getElementById('submit-btn');
const formMessage = document.getElementById('form-message');
const resetLinkBox = document.getElementById('reset-link-box');

const FIELDS = ['email'];

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
  formMessage.textContent = text;
  formMessage.className = `form-message is-${type}`;
  formMessage.hidden = false;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();
  resetLinkBox.hidden = true;
  resetLinkBox.innerHTML = '';

  const payload = { email: form.email.value };

  submitBtn.disabled = true;
  try {
    const res = await fetch('/api/password-reset/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (res.ok) {
      // Generic success — same whether or not the email was registered.
      showMessage(data.message, 'success');
      // Only a registered email returns a link; reveal it when present.
      if (data.resetLink) {
        resetLinkBox.innerHTML =
          '<a href="' + data.resetLink + '">Click here to reset your password</a>' +
          '<p class="field-hint">This link normally arrives by email. For this demo it is shown here.</p>';
        resetLinkBox.hidden = false;
      }
    } else {
      if (data.errors) showFieldErrors(data.errors);
      showMessage(data.message || 'Could not process the request.', 'error');
    }
  } catch (err) {
    showMessage('Network error. Please try again.', 'error');
  } finally {
    submitBtn.disabled = false;
  }
});
