const messageEl = document.getElementById('form-message');
const floorPlanEl = document.getElementById('floor-plan');
const bodyEl = document.getElementById('tables-body');

let allTables = []; // Store all tables for filtering

function showMessage(text, type) {
  messageEl.textContent = text;
  messageEl.className = `form-message is-${type}`;
  messageEl.hidden = false;
}

function clearMessage() {
  messageEl.hidden = true;
}

function getTableStatusClass(status) {
  if (status === 'Available') return 'available';
  if (status === 'Occupied') return 'occupied';
  if (status === 'Reserved') return 'reserved';
  if (status === 'Maintenance') return 'pending-cleaning';
  return 'available';
}

function getCheckedStatuses() {
  const checkboxes = document.querySelectorAll('.legend-checkbox input[type="checkbox"]');
  const statuses = [];
  checkboxes.forEach((cb) => {
    if (cb.checked) {
      statuses.push(cb.value);
    }
  });
  return statuses;
}

function applyFilters() {
  const checkedStatuses = getCheckedStatuses();
  const filtered = allTables.filter((t) => checkedStatuses.includes(t.table_status));
  renderFloorPlan(filtered);
  renderTablesList(filtered);
}

function renderFloorPlan(tables) {
  if (!tables || !tables.length) {
    floorPlanEl.innerHTML = '<p class="muted">No tables available.</p>';
    return;
  }

  const planHtml = tables.map((t) => {
    const statusClass = getTableStatusClass(t.table_status);
    const reservationInfo = t.reservation_id 
      ? `<div class="table-reservation">${t.customer_name}</div>`
      : '';
    
    return (
      `<div class="table-item ${statusClass}" data-table-id="${t.table_id}">` +
        `<div class="table-number">${t.table_number}</div>` +
        `<div class="table-capacity">${t.seating_capacity}</div>` +
        reservationInfo +
      `</div>`
    );
  }).join('');

  floorPlanEl.innerHTML = planHtml;

  // Add click handlers for status updates
  document.querySelectorAll('.table-item').forEach((el) => {
    el.addEventListener('click', () => {
      const tableId = el.dataset.tableId;
      const table = tables.find((t) => t.table_id == tableId);
      if (table) {
        showTableStatusModal(tableId, table.table_number, table.table_status);
      }
    });
  });
}

function renderTablesList(tables) {
  if (!tables || !tables.length) {
    bodyEl.innerHTML = '<tr><td colspan="6" class="muted">No tables found.</td></tr>';
    return;
  }

  bodyEl.innerHTML = tables.map((t) => {
    const statusClass = getTableStatusClass(t.table_status);
    const reservation = t.reservation_id 
      ? `${t.customer_name} (${t.party_size} ppl, ${t.reservation_status})`
      : '-';
    
    return (
      '<tr>' +
        `<td>${t.table_number}</td>` +
        `<td>${t.seating_capacity}</td>` +
        `<td>${t.table_location || '-'}</td>` +
        `<td><span class="status-pill ${statusClass === 'available' ? 'is-ok' : statusClass === 'occupied' ? 'is-warning' : 'is-danger'}">${t.table_status}</span></td>` +
        `<td>${reservation}</td>` +
        `<td>` +
          `<select class="status-select" onchange="updateTableStatus(${t.table_id}, this)">` +
            `<option value="">Update status...</option>` +
            `<option value="Available">Available</option>` +
            `<option value="Occupied">Occupied</option>` +
            `<option value="Reserved">Reserved</option>` +
            `<option value="Maintenance">Maintenance</option>` +
          `</select>` +
        `</td>` +
      '</tr>'
    );
  }).join('');
}

async function loadTables() {
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
      throw new Error(data.message || 'Could not load tables.');
    }

    allTables = data.tables || [];
    applyFilters(); // Apply filters to render
  } catch (err) {
    showMessage(err.message || 'Could not load tables.', 'error');
    floorPlanEl.innerHTML = '<p class="muted">Unable to load floor plan.</p>';
    bodyEl.innerHTML = '<tr><td colspan="6" class="muted">Unable to load data.</td></tr>';
  }
}

function showTableStatusModal(tableId, tableNumber, currentStatus) {
  const statusEl = document.querySelector(`select[onchange="updateTableStatus(${tableId}, this)"]`);
  if (statusEl) {
    statusEl.focus();
    statusEl.click();
  }
}

async function updateTableStatus(tableId, selectEl) {
  const status = selectEl.value;

  if (!status) return;

  try {
    const res = await fetch(`/api/tables/${tableId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });

    const data = await res.json();
    if (!res.ok) {
      showMessage(data.message || 'Could not update table status.', 'error');
      selectEl.value = '';
      return;
    }

    showMessage(data.message || 'Table status updated.', 'success');
    selectEl.value = '';
    await loadTables();
  } catch (err) {
    showMessage('Network error. Please try again.', 'error');
    selectEl.value = '';
  }
}

// Auto-refresh every 10 seconds
(async () => {
  try {
    await loadTables();
    setInterval(loadTables, 10000);
  } catch (err) {
    showMessage(err.message || 'Could not load tables.', 'error');
  }
})();
