// AM Restaurant RMIS — Ingredient Inventory page (Sprint 2).
// Story: track ingredient quantities, stock levels, expiry, and usage.
//   - list + search/filter by name, category, supplier
//   - create ingredient records (name, unit, category, supplier, reorder, expiry)
//   - move stock via receiving / consumption transactions (never edit the total)
//   - highlight low-stock and near-expiry rows; per-ingredient movement history
// Reads/movements: Admin, Manager, Staff. Editing metadata: Admin, Manager.

(async () => {
  const { esc, fmt, shortDate, api, openModal, closeModal, notice } = window.RMISUI;
  const me = await window.RMIS.ready;
  if (!me) return;

  const canManage = me.role === 'Admin' || me.role === 'Manager';
  // Hide sidebar links this role can't open (mirrors server RBAC).
  if (!canManage) {
    document.getElementById('nav-adjust')?.remove();
    document.getElementById('nav-po')?.remove();
  }

  const body = document.getElementById('inv-body');
  const emptyEl = document.getElementById('inv-empty');
  const fSearch = document.getElementById('f-search');
  const fCategory = document.getElementById('f-category');
  const fSupplier = document.getElementById('f-supplier');

  let suppliers = [];

  function statusTag(it) {
    if (it.status === 'out') return '<span class="tag tag-out">Out of stock</span>';
    if (it.status === 'low') return '<span class="tag tag-low">Low stock</span>';
    return '<span class="tag tag-ok">OK</span>';
  }
  function expiryCell(it) {
    if (!it.expirationDate) return '<span class="muted">&mdash;</span>';
    let tag = '';
    if (it.expired) tag = ' <span class="tag tag-exp">Expired</span>';
    else if (it.expiringSoon) tag = ` <span class="tag tag-soon">${it.daysToExpiry}d left</span>`;
    return `${shortDate(it.expirationDate)}${tag}`;
  }

  function renderKpis(items) {
    const total = items.length;
    const low = items.filter((i) => i.status === 'low').length;
    const out = items.filter((i) => i.status === 'out').length;
    const expiring = items.filter((i) => i.expiringSoon || i.expired).length;
    const kpis = [
      { label: 'Ingredients', value: total },
      { label: 'Low Stock', value: low },
      { label: 'Out of Stock', value: out },
      { label: 'Expiring / Expired', value: expiring },
    ];
    document.getElementById('kpi-row').innerHTML = kpis.map((k) => `
      <div class="kpi"><div class="kpi-label">${k.label}</div>
        <div class="kpi-value">${k.value}</div></div>`).join('');
  }

  function renderLowStockNotice(items) {
    const flagged = items.filter((i) => i.lowStock);
    if (!flagged.length) { notice('lowstock-notice', 'warn', ''); return; }
    const names = flagged.slice(0, 6).map((i) => esc(i.name)).join(', ');
    const more = flagged.length > 6 ? ` +${flagged.length - 6} more` : '';
    notice('lowstock-notice', 'warn',
      `<strong>${flagged.length} ingredient${flagged.length > 1 ? 's' : ''} at or below reorder level:</strong> ${names}${more}. ` +
      `<a href="/stock-alerts">View Stock Alerts &rarr;</a>`);
  }

  function rowClass(it) {
    const c = [];
    if (it.status === 'out') c.push('row-out');
    else if (it.status === 'low') c.push('row-low');
    if (it.expiringSoon || it.expired) c.push('row-expiring');
    return c.join(' ');
  }

  function renderTable(items) {
    if (!items.length) { body.innerHTML = ''; emptyEl.hidden = false; return; }
    emptyEl.hidden = true;
    body.innerHTML = items.map((it) => `
      <tr class="${rowClass(it)}">
        <td>${esc(it.name)}</td>
        <td>${it.category ? esc(it.category) : '<span class="muted">&mdash;</span>'}</td>
        <td>${it.supplier ? esc(it.supplier) : '<span class="muted">&mdash;</span>'}</td>
        <td>${esc(it.unit)}</td>
        <td class="num">${fmt(it.quantity)}</td>
        <td class="num">${fmt(it.reorderLevel)}</td>
        <td>${expiryCell(it)}</td>
        <td>${statusTag(it)}</td>
        <td class="row-actions">
          <button class="btn-ghost btn-sm" data-act="receive" data-id="${it.id}">Receive</button>
          <button class="btn-ghost btn-sm" data-act="consume" data-id="${it.id}">Consume</button>
          <button class="btn-ghost btn-sm" data-act="history" data-id="${it.id}">History</button>
        </td>
      </tr>`).join('');
  }

  function currentItems() { return itemsCache; }
  let itemsCache = [];

  async function load() {
    const params = new URLSearchParams();
    if (fSearch.value.trim()) params.set('q', fSearch.value.trim());
    if (fCategory.value) params.set('category', fCategory.value);
    if (fSupplier.value) params.set('supplier', fSupplier.value);
    const { data } = await api('GET', '/api/ingredients?' + params.toString());
    itemsCache = data.ingredients || [];
    renderTable(itemsCache);
    renderKpis(itemsCache);
    renderLowStockNotice(itemsCache);
  }

  async function loadFilters() {
    const [cats, sups] = await Promise.all([
      api('GET', '/api/categories'),
      api('GET', '/api/suppliers'),
    ]);
    suppliers = sups.data.suppliers || [];
    fCategory.innerHTML = '<option value="">All categories</option>' +
      (cats.data.categories || []).map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    fSupplier.innerHTML = '<option value="">All suppliers</option>' +
      suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  }

  // ---- create ingredient modal ----
  function supplierOptions(selectedId) {
    return '<option value="">&mdash; none &mdash;</option>' +
      suppliers.map((s) => `<option value="${s.id}"${s.id === selectedId ? ' selected' : ''}>${esc(s.name)}</option>`).join('');
  }

  function openNewIngredient() {
    openModal(`
      <div class="modal-head"><h2>New Ingredient</h2><button class="modal-close" data-close>&times;</button></div>
      <form id="ing-form" novalidate>
        <div class="modal-body">
          <div class="form-grid">
            <div class="field-inline full"><label>Name *</label>
              <input class="rmis-input" name="name" required></div>
            <div class="field-inline"><label>Unit of measure *</label>
              <input class="rmis-input" name="unit" placeholder="kg, L, pcs" required></div>
            <div class="field-inline"><label>Category</label>
              <input class="rmis-input" name="category" placeholder="Meat, Dry goods&hellip;"></div>
            <div class="field-inline"><label>Supplier</label>
              <select class="rmis-select" name="supplierId">${supplierOptions()}</select></div>
            <div class="field-inline"><label>New supplier (optional)</label>
              <input class="rmis-input" name="supplierNew" placeholder="Type to add a supplier"></div>
            <div class="field-inline"><label>Starting quantity</label>
              <input class="rmis-input" name="quantity" type="number" min="0" step="any" value="0"></div>
            <div class="field-inline"><label>Reorder level</label>
              <input class="rmis-input" name="reorderLevel" type="number" min="0" step="any" value="0"></div>
            <div class="field-inline full"><label>Expiration date (optional)</label>
              <input class="rmis-input" name="expirationDate" type="date"></div>
          </div>
          <div class="field-err" id="ing-err"></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn-primary" id="ing-submit">Create ingredient</button>
        </div>
      </form>`);

    document.getElementById('ing-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const payload = {
        name: f.name.value, unit: f.unit.value, category: f.category.value,
        quantity: Number(f.quantity.value || 0), reorderLevel: Number(f.reorderLevel.value || 0),
        expirationDate: f.expirationDate.value,
      };
      const newSup = f.supplierNew.value.trim();
      if (newSup) payload.supplier = newSup;
      else if (f.supplierId.value) payload.supplierId = Number(f.supplierId.value);

      document.getElementById('ing-submit').disabled = true;
      const { ok, data } = await api('POST', '/api/ingredients', payload);
      document.getElementById('ing-submit').disabled = false;
      if (!ok) { document.getElementById('ing-err').textContent = data.message || 'Could not create ingredient.'; return; }
      closeModal();
      await loadFilters();
      await load();
      notice('page-notice', 'ok', `Added <strong>${esc(data.ingredient.name)}</strong>.`);
    });
  }

  // ---- receiving / consumption modal ----
  function openTxn(id, mode) {
    const it = currentItems().find((x) => x.id === id);
    if (!it) return;
    const verb = mode === 'receive' ? 'Receive' : 'Consume';
    openModal(`
      <div class="modal-head"><h2>${verb} &mdash; ${esc(it.name)}</h2><button class="modal-close" data-close>&times;</button></div>
      <form id="txn-form" novalidate>
        <div class="modal-body">
          <p class="muted" style="margin-bottom:14px">On hand: <strong>${fmt(it.quantity)} ${esc(it.unit)}</strong>${it.reorderLevel ? ` &middot; reorder at ${fmt(it.reorderLevel)}` : ''}</p>
          <div class="form-grid">
            <div class="field-inline"><label>Quantity (${esc(it.unit)}) *</label>
              <input class="rmis-input" name="quantity" type="number" min="0" step="any" required autofocus></div>
            <div class="field-inline"><label>Reference (optional)</label>
              <input class="rmis-input" name="reference" placeholder="Delivery / order no."></div>
          </div>
          <div class="field-err" id="txn-err"></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn-primary" id="txn-submit">${verb}</button>
        </div>
      </form>`);

    document.getElementById('txn-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const payload = {
        type: mode === 'receive' ? 'receiving' : 'consumption',
        quantity: Number(f.quantity.value),
        reference: f.reference.value,
      };
      document.getElementById('txn-submit').disabled = true;
      const { ok, data } = await api('POST', `/api/ingredients/${id}/transactions`, payload);
      document.getElementById('txn-submit').disabled = false;
      if (!ok) { document.getElementById('txn-err').textContent = data.message || 'Transaction failed.'; return; }
      closeModal();
      await load();
      const u = data.ingredient;
      notice('page-notice', 'ok', `${verb}d ${fmt(payload.quantity)} ${esc(u.unit)} of <strong>${esc(u.name)}</strong>. New on-hand: ${fmt(u.quantity)} ${esc(u.unit)}.`);
    });
  }

  // ---- history modal ----
  async function openHistory(id) {
    const { ok, data } = await api('GET', `/api/ingredients/${id}`);
    if (!ok) return;
    const it = data.ingredient;
    const txns = data.transactions || [];
    const rows = txns.length ? txns.map((t) => {
      const label = t.type === 'adjustment' ? `Adjustment (${esc(t.adjustmentType)})` : (t.type === 'receiving' ? 'Receiving' : 'Consumption');
      const sign = t.quantity > 0 ? '+' : '';
      return `<tr>
        <td>${shortDate(t.createdAt)}</td>
        <td>${label}</td>
        <td class="num">${sign}${fmt(t.quantity)}</td>
        <td>${esc(t.user)}</td>
        <td>${esc(t.reason || t.reference || '')}</td>
      </tr>`;
    }).join('') : '<tr><td colspan="5" class="muted">No movements yet.</td></tr>';

    openModal(`
      <div class="modal-head"><h2>${esc(it.name)} &mdash; History</h2><button class="modal-close" data-close>&times;</button></div>
      <div class="modal-body">
        <p class="muted" style="margin-bottom:14px">
          ${esc(it.unit)} &middot; on hand <strong>${fmt(it.quantity)}</strong> &middot; reorder ${fmt(it.reorderLevel)}
          ${it.supplier ? ' &middot; ' + esc(it.supplier) : ''}
          ${it.expirationDate ? ' &middot; exp ' + shortDate(it.expirationDate) : ''}
        </p>
        <table class="mock">
          <thead><tr><th>Date</th><th>Type</th><th class="num">Qty</th><th>User</th><th>Note</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="modal-foot"><button type="button" class="btn-ghost" data-close>Close</button></div>`);
  }

  // ---- events ----
  document.getElementById('btn-new').addEventListener('click', openNewIngredient);
  body.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-act]');
    if (!btn) return;
    const id = Number(btn.dataset.id);
    if (btn.dataset.act === 'receive') openTxn(id, 'receive');
    else if (btn.dataset.act === 'consume') openTxn(id, 'consume');
    else if (btn.dataset.act === 'history') openHistory(id);
  });

  let searchTimer;
  fSearch.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(load, 250); });
  fCategory.addEventListener('change', load);
  fSupplier.addEventListener('change', load);

  await loadFilters();
  await load();
})();
