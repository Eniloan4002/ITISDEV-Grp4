const messageEl = document.getElementById('form-message');
const bodyEl = document.getElementById('inventory-body');

function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `form-message is-${type}`;
  messageEl.hidden = false;
}

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function statusClass(status) {
  if (status === 'Out of Stock') return 'is-danger';
  if (status === 'Low Stock') return 'is-warning';
  return 'is-ok';
}

function renderRows(items) {
  if (!items.length) {
    bodyEl.innerHTML = '<tr><td colspan="6" class="muted">No ingredients found.</td></tr>';
    return;
  }

  bodyEl.innerHTML = items.map((item) => {
    const current = asNumber(item.current_quantity);
    const reorder = asNumber(item.reorder_level);
    return (
      '<tr>' +
        `<td>${item.ingredient_name}</td>` +
        `<td>${item.ingredient_type_name}</td>` +
        `<td>${current.toFixed(2)}</td>` +
        `<td>${item.unit_of_measure}</td>` +
        `<td>${reorder.toFixed(2)}</td>` +
        `<td><span class="status-pill ${statusClass(item.stock_status)}">${item.stock_status}</span></td>` +
      '</tr>'
    );
  }).join('');
}

(async () => {
  try {
    const res = await fetch('/api/inventory');

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
      showMessage(data.message || 'Could not load inventory.', 'error');
      bodyEl.innerHTML = '<tr><td colspan="6" class="muted">Unable to load data.</td></tr>';
      return;
    }

    renderRows(data.items || []);
  } catch (err) {
    showMessage('Network error. Please try again.', 'error');
    bodyEl.innerHTML = '<tr><td colspan="6" class="muted">Unable to load data.</td></tr>';
  }
})();
