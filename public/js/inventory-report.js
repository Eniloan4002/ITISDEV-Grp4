// AM Restaurant RMIS — Inventory Reports (SI-25).
//
// The report plus the physical-count workflow. A count is a reconciliation, not
// a delta: the user enters what they actually counted and the server computes
// the discrepancy against the system quantity inside a locked transaction.

(async () => {
  const me = await window.RMIS.ready;
  if (!me) return;

  const { esc, fmt, api, shortDate, openModal, closeModal, notice } = window.RMISUI;
  const body = document.getElementById('report-body');
  const empty = document.getElementById('report-empty');
  const count = document.getElementById('row-count');

  const F = {
    q: document.getElementById('f-q'),
    category: document.getElementById('f-category'),
    supplier: document.getElementById('f-supplier'),
    status: document.getElementById('f-status'),
  };

  // An item at or below its reorder level is flagged red; zero reads Out of Stock.
  const STATUS = {
    'In Stock': 'tag-ok',
    'Low Stock': 'tag-low',
    'Out of Stock': 'tag-out',
  };
  const ROW = { 'Low Stock': 'row-low', 'Out of Stock': 'row-out' };

  function render(items) {
    empty.hidden = items.length > 0;
    count.textContent = items.length ? `— ${items.length} shown` : '';
    body.innerHTML = items.map((i) => `
      <tr class="${ROW[i.stock_status] || ''}">
        <td><strong>${esc(i.name)}</strong></td>
        <td>${esc(i.category) || '<span class="muted">&mdash;</span>'}</td>
        <td>${esc(i.unit)}</td>
        <td class="num">${fmt(i.quantity)}</td>
        <td class="num">${fmt(i.reorder_level)}</td>
        <td class="num">${i.max_stock_level != null ? fmt(i.max_stock_level) : '<span class="muted">&mdash;</span>'}</td>
        <td>${esc(i.supplier_name) || '<span class="muted">&mdash;</span>'}</td>
        <td>${i.expiration_date ? shortDate(i.expiration_date) : '<span class="muted">&mdash;</span>'}</td>
        <td><span class="tag ${STATUS[i.stock_status] || ''}">${esc(i.stock_status)}</span></td>
        <td><button class="btn-ghost btn-sm" data-count="${esc(i.id)}"
                    data-name="${esc(i.name)}" data-qty="${esc(i.quantity)}"
                    data-unit="${esc(i.unit)}">Count</button></td>
      </tr>`).join('');
  }

  function renderCounts(rows) {
    document.getElementById('count-empty').hidden = rows.length > 0;
    document.getElementById('count-body').innerHTML = rows.map((c) => {
      const d = Number(c.discrepancy);
      const cls = d === 0 ? '' : (d < 0 ? 'tag-danger' : 'tag-ok');
      return `<tr>
        <td>${new Date(c.at).toLocaleString('en-PH', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
        <td>${esc(c.ingredient)}</td>
        <td class="num">${c.expected != null ? fmt(c.expected) : '<span class="muted">&mdash;</span>'}</td>
        <td class="num">${c.actual != null ? fmt(c.actual) : '<span class="muted">&mdash;</span>'}</td>
        <td class="num"><span class="tag ${cls}">${d > 0 ? '+' : ''}${fmt(d)}</span></td>
        <td>${esc(c.reason)}</td>
        <td>${esc(c.user) || '<span class="muted">&mdash;</span>'}</td>
      </tr>`;
    }).join('');
  }

  async function load() {
    const p = new URLSearchParams();
    if (F.q.value.trim()) p.set('q', F.q.value.trim());
    if (F.category.value) p.set('category', F.category.value);
    if (F.supplier.value) p.set('supplierId', F.supplier.value);
    if (F.status.value) p.set('stockStatus', F.status.value);

    const { ok, data } = await api('GET', '/api/inventory-report?' + p.toString());
    if (!ok) return render([]);
    render(data.items || []);

    // Fill the dropdowns once, preserving any current selection.
    if (F.category.options.length <= 1 && Array.isArray(data.categories)) {
      const keep = F.category.value;
      F.category.innerHTML = '<option value="">All categories</option>' +
        data.categories.map((c) => `<option>${esc(c)}</option>`).join('');
      F.category.value = keep;
    }
    if (F.supplier.options.length <= 1 && Array.isArray(data.suppliers)) {
      const keep = F.supplier.value;
      F.supplier.innerHTML = '<option value="">All suppliers</option>' +
        data.suppliers.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
      F.supplier.value = keep;
    }
  }

  async function loadCounts() {
    const { ok, data } = await api('GET', '/api/physical-counts');
    renderCounts(ok && data.counts ? data.counts : []);
  }

  function openCount(id, name, systemQty, unit) {
    openModal(`
      <div class="modal-head"><h2>Physical count &mdash; ${esc(name)}</h2>
        <button class="modal-close" data-close>&times;</button></div>
      <div class="modal-body">
        <form id="count-form" novalidate>
          <div class="form-grid">
            <div class="field-inline"><label>System quantity</label>
              <span>${fmt(systemQty)} ${esc(unit)}</span></div>
            <div class="field-inline"><label>Counted quantity *</label>
              <input class="rmis-input" id="c-actual" type="number" min="0" step="any"
                     value="${esc(systemQty)}" required>
              <span class="field-err" data-err="actualQuantity"></span></div>
            <div class="field-inline full"><label>Reason / audit note *</label>
              <input class="rmis-input" id="c-reason"
                     placeholder="e.g. Monthly stocktake, spillage found" required>
              <span class="field-err" data-err="reason"></span></div>
          </div>
          <div class="field-err" id="count-err"></div>
          <p class="field-hint">Saving overwrites the live quantity with the counted figure and
             records the difference in the audit archive.</p>
          <div style="margin-top:14px"><button type="submit" class="btn-primary">Record count</button></div>
        </form>
      </div>`);

    document.getElementById('count-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      document.querySelectorAll('[data-err]').forEach((el) => { el.textContent = ''; });
      document.getElementById('count-err').textContent = '';

      const payload = {
        actualQuantity: Number(document.getElementById('c-actual').value),
        reason: document.getElementById('c-reason').value.trim(),
      };
      const { ok, status, data } = await api('POST', `/api/inventory-report/${id}/count`, payload);
      if (ok) {
        closeModal();
        const d = Number(data.discrepancy);
        notice('page-notice', d === 0 ? 'ok' : 'warn',
          d === 0
            ? `${esc(name)} counted at ${fmt(data.actualQuantity)} — no discrepancy.`
            : `${esc(name)}: system ${fmt(data.previousQuantity)}, counted ${fmt(data.actualQuantity)}, ` +
              `discrepancy <strong>${d > 0 ? '+' : ''}${fmt(d)}</strong>.`);
        await load();
        return loadCounts();
      }
      if (data && data.errors) {
        for (const [k, msg] of Object.entries(data.errors)) {
          const el = document.querySelector(`[data-err="${k}"]`);
          if (el) el.textContent = msg;
        }
      }
      document.getElementById('count-err').textContent =
        (data && data.message) || `Could not record the count (${status}).`;
    });
  }

  body.addEventListener('click', (e) => {
    const d = e.target.dataset || {};
    if (d.count) openCount(d.count, d.name, d.qty, d.unit);
  });

  let t;
  F.q.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });
  [F.category, F.supplier, F.status].forEach((el) => el.addEventListener('change', load));
  document.getElementById('f-clear').addEventListener('click', () => {
    Object.values(F).forEach((el) => { el.value = ''; });
    load();
  });

  await load();
  await loadCounts();
})();
