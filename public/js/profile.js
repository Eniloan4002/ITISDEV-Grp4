// Minimal vanilla JS for the My Profile form (SI-9).
// Loads the current profile, lets the user edit display name + contact number.
// Email and role are read-only — never sent back to the server.

const form = document.getElementById('profile-form');
const submitBtn = document.getElementById('submit-btn');
const formMessage = document.getElementById('form-message');

// Only the editable fields have inline error slots.
const FIELDS = ['fullName', 'contactNumber'];

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

// Show field-level errors returned by the server.
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

// On load: fetch the current profile and populate the four fields.
(async () => {
  try {
    const res = await fetch('/api/profile');
    if (res.status === 401) {
      window.location = '/login';
      return;
    }
    const data = await res.json();
    form.fullName.value = data.fullName || '';
    form.contactNumber.value = data.contactNumber || '';
    form.email.value = data.email || '';
    form.role.value = data.role || '';
  } catch (err) {
    showMessage('Could not load your profile. Please refresh.', 'error');
  }
})();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();

  // Only the editable fields are sent — email/role are read-only (AC).
  const payload = {
    fullName: form.fullName.value,
    contactNumber: form.contactNumber.value,
  };

  submitBtn.disabled = true;
  try {
    const res = await fetch('/api/profile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (res.ok) {
      showMessage(data.message, 'success');
    } else {
      if (data.errors) showFieldErrors(data.errors);
      showMessage(data.message || 'Could not update your profile.', 'error');
    }
  } catch (err) {
    showMessage('Network error. Please try again.', 'error');
  } finally {
    submitBtn.disabled = false;
  }
});
