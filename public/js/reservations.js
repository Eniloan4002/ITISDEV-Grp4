const messageEl = document.getElementById('form-message');
const reservationForm = document.getElementById('reservation-form');
const bodyEl = document.getElementById('reservations-body');

const customerNameEl = document.getElementById('customer-name');
const contactNumberEl = document.getElementById('contact-number');
const partySizeEl = document.getElementById('party-size');
const reservationStartEl = document.getElementById('reservation-start');
const reservationEndEl = document.getElementById('reservation-end');

function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `form-message is-${type}`;
  messageEl.hidden = false;
}

function clearMessage() {
  messageEl.hidden = true;
  messageEl.textContent = '';
  messageEl.className = 'form-message';
}

function showFieldError(fieldId, message) {
  const errorEl = document.getElementById(`error-${fieldId}`);
  if (errorEl) {
    errorEl.textContent = message;
    const field = document.querySelector(`[name="${fieldId}"]`) || document.getElementById(fieldId.replace(/([A-Z])/g, '-$1').toLowerCase());
    if (field) {
      field.parentElement.classList.add('has-error');
    }
  }
}

function clearFieldErrors() {
  document.querySelectorAll('.field-error').forEach((el) => {
    el.textContent = '';
  });
  document.querySelectorAll('.field').forEach((el) => {
    el.classList.remove('has-error');
  });
}

function dateText(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleString();
}

function statusColor(status) {
  if (status === 'Confirmed') return 'is-ok';
  if (status === 'Seated') return 'is-ok';
  if (status === 'Pending') return 'is-warning';
  if (status === 'Completed') return 'is-ok';
  if (status === 'Cancelled') return 'is-danger';
  if (status === 'No Show') return 'is-danger';
  return 'is-ok';
}

function renderReservations(reservations) {
  if (!reservations || !reservations.length) {
    bodyEl.innerHTML = '<tr><td colspan="8" class="muted">No active reservations.</td></tr>';
    return;
  }

  bodyEl.innerHTML = reservations.map((r) => {
    return (
      '<tr>' +
        `<td>${r.customer_name}</td>` +
        `<td>${r.contact_number}</td>` +
        `<td>${r.party_size}</td>` +
        `<td>${r.table_number || '-'}</td>` +
        `<td>${dateText(r.reservation_start)}</td>` +
        `<td>${dateText(r.reservation_end)}</td>` +
        `<td><span class="status-pill ${statusColor(r.reservation_status)}">${r.reservation_status}</span></td>` +
        `<td>` +
          `<select class="status-select" data-reservation-id="${r.reservation_id}" onchange="updateStatus(this)">` +
            `<option value="">Update...</option>` +
            `<option value="Confirmed">Confirm</option>` +
            `<option value="Seated">Seated</option>` +
            `<option value="Completed">Completed</option>` +
            `<option value="No Show">No Show</option>` +
            `<option value="Cancelled">Cancel</option>` +
          `</select>` +
        `</td>` +
      '</tr>'
    );
  }).join('');
}

async function loadReservations() {
  try {
    const res = await fetch('/api/tables');
    if (res.status === 401) {
      window.location = '/login';
      return;
    }
    if (res.status === 403) {
      window.location = '/403';
      return;
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || 'Could not load reservations.');
    }

    // Filter to only show rows with active reservations
    const reservations = (data.tables || [])
      .filter((t) => t.reservation_id)
      .map((t) => ({
        reservation_id: t.reservation_id,
        customer_name: t.customer_name,
        contact_number: t.contact_number || '-',
        party_size: t.party_size,
        table_number: t.table_number,
        reservation_start: t.reservation_start,
        reservation_end: t.reservation_end,
        reservation_status: t.reservation_status,
      }));

    renderReservations(reservations);
  } catch (err) {
    showMessage(err.message || 'Could not load reservations.', 'error');
    bodyEl.innerHTML = '<tr><td colspan="8" class="muted">Unable to load data.</td></tr>';
  }
}

async function updateStatus(selectEl) {
  const reservationId = selectEl.dataset.reservationId;
  const status = selectEl.value;

  if (!status) return;

  try {
    const res = await fetch(`/api/reservations/${reservationId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });

    const data = await res.json();
    if (!res.ok) {
      showMessage(data.message || 'Could not update reservation.', 'error');
      selectEl.value = '';
      return;
    }

    showMessage(data.message || 'Reservation updated.', 'success');
    selectEl.value = '';
    await loadReservations();
  } catch (err) {
    showMessage('Network error. Please try again.', 'error');
    selectEl.value = '';
  }
}

reservationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage();
  clearFieldErrors();

  const payload = {
    customerName: customerNameEl.value.trim(),
    contactNumber: contactNumberEl.value.trim(),
    partySize: Number(partySizeEl.value),
    reservationStart: reservationStartEl.value,
    reservationEnd: reservationEndEl.value,
  };

  try {
    const res = await fetch('/api/reservations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();

    if (!res.ok) {
      if (data.errors) {
        Object.entries(data.errors).forEach(([field, msg]) => {
          showFieldError(field, msg);
        });
      }
      showMessage(data.message || 'Could not create reservation.', 'error');
      return;
    }

    showMessage(data.message || 'Reservation confirmed!', 'success');
    reservationForm.reset();
    await loadReservations();
  } catch (err) {
    showMessage('Network error. Please try again.', 'error');
  }
});

(async () => {
  try {
    await loadReservations();
  } catch (err) {
    showMessage(err.message || 'Could not load reservations.', 'error');
  }
})();
