const messageEl = document.getElementById('form-message');
const bodyEl = document.getElementById('inventory-body');
const filterForm = document.getElementById('filter-form');
const ingredientForm = document.getElementById('ingredient-form');
const transactionForm = document.getElementById('transaction-form');

const filterSearchEl = document.getElementById('filter-search');
const filterCategoryEl = document.getElementById('filter-category');
const filterSupplierEl = document.getElementById('filter-supplier');
const expiryDaysEl = document.getElementById('filter-expiry-days');

const ingredientNameEl = document.getElementById('ingredient-name');
const ingredientUnitEl = document.getElementById('ingredient-unit');
const ingredientCategoryEl = document.getElementById('ingredient-category');
const ingredientSupplierEl = document.getElementById('ingredient-supplier');
const ingredientReorderEl = document.getElementById('ingredient-reorder');
const ingredientMaxEl = document.getElementById('ingredient-max');
const ingredientExpirationEl = document.getElementById('ingredient-expiration');

const txIngredientEl = document.getElementById('tx-ingredient');
const txTypeEl = document.getElementById('tx-type');
const txQuantityEl = document.getElementById('tx-quantity');
const txReferenceEl = document.getElementById('tx-reference');
const txReasonEl = document.getElementById('tx-reason');
const txExpirationEl = document.getElementById('tx-expiration');

let latestItems = [];

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

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function statusClass(status) {
  if (status === 'Out of Stock') return 'is-danger';
  if (status === 'Low Stock') return 'is-warning';
  return 'is-ok';
}

function dateText(dateValue) {
  if (!dateValue) return '-';
  const d = new Date(dateValue);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toISOString().slice(0, 10);
}

function rowClass(item, thresholdDays) {
  const days = Number(item.days_to_expiry);
  if (!Number.isFinite(days)) return '';
  if (days < 0) return 'expired';
  if (days <= thresholdDays) return 'expiring-soon';
  return '';
}

function renderIngredientOptions(items) {
  const current = txIngredientEl.value;
  txIngredientEl.innerHTML = '<option value="">-- Select ingredient --</option>';
  for (const item of items) {
    const opt = document.createElement('option');
    opt.value = item.ingredient_id;
    opt.textContent = `${item.ingredient_name} (${item.current_quantity} ${item.unit_of_measure})`;
    txIngredientEl.appendChild(opt);
  }
  if ([...txIngredientEl.options].some((o) => o.value === current)) {
    txIngredientEl.value = current;
  }
}

function renderRows(items) {
  if (!items.length) {
    bodyEl.innerHTML = '<tr><td colspan="8" class="muted">No ingredients found.</td></tr>';
    return;
  }

  const thresholdDays = Math.max(1, Math.floor(asNumber(expiryDaysEl.value) || 5));

  bodyEl.innerHTML = items.map((item) => {
    const current = asNumber(item.current_quantity);
    const reorder = asNumber(item.reorder_level);
    const cls = rowClass(item, thresholdDays);
    const supplier = item.supplier_name || '-';
    return (
      `<tr class="${cls}">` +
        `<td>${item.ingredient_name}</td>` +
        `<td>${item.ingredient_type_name}</td>` +
        `<td>${supplier}</td>` +
        `<td>${current.toFixed(2)}</td>` +
        `<td>${item.unit_of_measure}</td>` +
        `<td>${reorder.toFixed(2)}</td>` +
        `<td>${dateText(item.expiration_date)}</td>` +
        `<td><span class="status-pill ${statusClass(item.stock_status)}">${item.stock_status}</span></td>` +
      '</tr>'
    );
  }).join('');
}

function setSelectOptions(selectEl, options, emptyLabel) {
  const previous = selectEl.value;
  selectEl.innerHTML = '';

  const emptyOption = document.createElement('option');
  emptyOption.value = '';
  emptyOption.textContent = emptyLabel;
  selectEl.appendChild(emptyOption);

  for (const item of options) {
    const opt = document.createElement('option');
    opt.value = item;
    opt.textContent = item;
    selectEl.appendChild(opt);
  }

  if ([...selectEl.options].some((opt) => opt.value === previous)) {
    selectEl.value = previous;
  }
}

async function loadMeta() {
  const res = await fetch('/api/inventory/meta');
  if (res.status === 401) {
    window.location = '/login';
    return false;
  }
  if (res.status === 403) {
    window.location = '/403';
    return false;
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.message || 'Could not load inventory metadata.');
  }

  setSelectOptions(filterCategoryEl, data.categories || [], 'All categories');
  setSelectOptions(filterSupplierEl, data.suppliers || [], 'All suppliers');
  setSelectOptions(ingredientCategoryEl, data.categories || [], '-- Select category --');
  setSelectOptions(ingredientSupplierEl, data.suppliers || [], '-- Select supplier --');

  return true;
}

function currentFiltersQuery() {
  const params = new URLSearchParams();
  const search = filterSearchEl.value.trim();
  const category = filterCategoryEl.value;
  const supplier = filterSupplierEl.value;

  if (search) params.set('search', search);
  if (category) params.set('category', category);
  if (supplier) params.set('supplier', supplier);

  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

async function loadInventory() {
  const res = await fetch(`/api/inventory${currentFiltersQuery()}`);

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
    throw new Error(data.message || 'Could not load inventory list.');
  }

  latestItems = data.items || [];
  renderRows(latestItems);
  renderIngredientOptions(latestItems);
}

ingredientForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage();

  const payload = {
    name: ingredientNameEl.value.trim(),
    unitOfMeasure: ingredientUnitEl.value.trim(),
    category: ingredientCategoryEl.value,
    supplier: ingredientSupplierEl.value,
    reorderLevel: Number(ingredientReorderEl.value || 0),
    maxStockLevel: Number(ingredientMaxEl.value || 0),
    expirationDate: ingredientExpirationEl.value || null,
  };

  try {
    const res = await fetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      showMessage(data.message || 'Could not create ingredient.', 'error');
      return;
    }

    showMessage(data.message || 'Ingredient created.', 'success');
    ingredientForm.reset();
    ingredientReorderEl.value = '0';
    ingredientMaxEl.value = '0';
    await loadInventory();
  } catch (err) {
    showMessage('Network error. Please try again.', 'error');
  }
});

transactionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage();

  const payload = {
    ingredientId: Number(txIngredientEl.value),
    transactionType: txTypeEl.value,
    quantity: Number(txQuantityEl.value),
    referenceNo: txReferenceEl.value.trim(),
    reason: txReasonEl.value.trim(),
    expirationDate: txExpirationEl.value || null,
  };

  try {
    const res = await fetch('/api/inventory/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      showMessage(data.message || 'Could not record transaction.', 'error');
      return;
    }

    showMessage(data.message || 'Inventory updated.', 'success');
    transactionForm.reset();
    await loadInventory();
  } catch (err) {
    showMessage('Network error. Please try again.', 'error');
  }
});

filterForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearMessage();
  try {
    await loadInventory();
  } catch (err) {
    showMessage(err.message || 'Could not load inventory.', 'error');
    bodyEl.innerHTML = '<tr><td colspan="8" class="muted">Unable to load data.</td></tr>';
  }
});

expiryDaysEl.addEventListener('input', () => {
  renderRows(latestItems);
});

(async () => {
  try {
    const metaLoaded = await loadMeta();
    if (!metaLoaded) return;
    await loadInventory();
  } catch (err) {
    showMessage(err.message || 'Could not load inventory.', 'error');
    bodyEl.innerHTML = '<tr><td colspan="8" class="muted">Unable to load data.</td></tr>';
  }
})();
