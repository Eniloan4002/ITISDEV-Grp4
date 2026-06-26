// Minimal vanilla JS for the Create User form (SI-6).
// No framework, no animation — it just talks to the REST API and shows results.

const form = document.getElementById('register-form');
const submitBtn = document.getElementById('submit-btn');
const formMessage = document.getElementById('form-message');

const FIELDS = ['fullName', 'email', 'password', 'role'];

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

// "Show password" toggle — flip the password input between hidden and visible.
const togglePassword = document.getElementById('toggle-password');
if (togglePassword) {
  togglePassword.addEventListener('change', () => {
    document.getElementById('password').type = togglePassword.checked ? 'text' : 'password';
  });
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();

  const payload = {
    fullName: form.fullName.value,
    email: form.email.value,
    password: form.password.value,
    role: form.role.value,
  };

  submitBtn.disabled = true;
  try {
    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (res.ok) {
      // Success (AC1): account saved + welcome email triggered.
      showMessage(data.message, 'success');
      form.reset();
    } else {
      // Validation / duplicate email (AC2) or other rejection.
      if (data.errors) showFieldErrors(data.errors);
      showMessage(data.message || 'Could not create the account.', 'error');
    }
  } catch (err) {
    showMessage('Network error. Please try again.', 'error');
  } finally {
    submitBtn.disabled = false;
  }
});
