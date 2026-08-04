// AM Restaurant RMIS — Purchase Orders page (Sprint 2).
// Manager/Admin create POs for suppliers, send them, and receive goods.
//   - create a PO (supplier + line items) saved as Draft
//   - Draft -> Sent; goods receipt updates ingredient stock and PO status
//   - a PO auto-completes when every line is fully received, or can be closed
//   - list + filter by supplier, status, and created-date range
// Page + API gated to Admin/Manager server-side.

(async () => {
  const { esc, fmt, money, shortDate, api, openModal, closeModal, notice } = window.RMISUI;
  const me = await window.RMIS.ready;
  if (!me) return;

  const poBody = document.getElementById('po-body');
  const poEmpty = document.getElementById('po-empty');
  const fSupplier = document.getElementById('f-supplier');
  const fStatus = document.getElementById('f-status');
  const fFrom = document.getElementById('f-from');
  const fTo = document.getElementById('f-to');

  let suppliers = [];
  let ingredients = [];

  const STATUS_TAG = {
    Draft: 'tag-soon', Sent: 'tag-low',
    'Partially Received': 'tag-low', Completed: 'tag-ok',
  };
  function statusTag(s) { return `<span class="tag ${STATUS_TAG[s] || 'tag-ok'}">${esc(s)}</span>`; }

  async function loadRefs() {
    const [sups, ings] = await Promise.all([
      api('GET', '/api/suppliers'),
      api('GET', '/api/ingredients'),
    ]);
    suppliers = sups.data.suppliers || [];
    ingredients = ings.data.ingredients || [];
    fSupplier.innerHTML = '<option value="">All suppliers</option>' +
      suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  }

  async function load() {
    const p = new URLSearchParams();
    if (fSupplier.value) p.set('supplier', fSupplier.value);
    if (fStatus.value) p.set('status', fStatus.value);
    if (fFrom.value) p.set('from', fFrom.value);
    if (fTo.value) p.set('to', fTo.value);
    const { data } = await api('GET', '/api/purchase-orders?' + p.toString());
    render(data.orders || []);
  }

  function render(orders) {
    if (!orders.length) { poBody.innerHTML = ''; poEmpty.hidden = false; return; }
    poEmpty.hidden = true;
    poBody.innerHTML = orders.map((o) => `
      <tr>
        <td>${esc(o.poNumber)}</td>
        <td>${esc(o.supplier)}</td>
        <td>${shortDate(o.createdAt)}</td>
        <td>${esc(o.createdBy)}</td>
        <td class="num">${money(o.total)}</td>
        <td>${statusTag(o.status)}</td>
        <td><button class="btn-ghost btn-sm" data-view="${o.id}">View</button></td>
      </tr>`).join('');
  }

  // ---- create PO ----
  function ingredientOptions() {
    return '<option value="">&mdash; ingredient &mdash;</option>' +
      ingredients.map((i) => `<option value="${i.id}">${esc(i.name)} (${esc(i.unit)})</option>`).join('');
  }
  function supplierSelect() {
    return '<option value="">&mdash; select &mdash;</option>' +
      suppliers.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  }
  function lineRow() {
    return `<div class="line-row" data-line>
      <div class="field-inline"><label>Ingredient</label>
        <select class="rmis-select" data-f="ingredientId">${ingredientOptions()}</select></div>
      <div class="field-inline"><label>Qty</label>
        <input class="rmis-input" data-f="quantity" type="number" min="0" step="any"></div>
      <div class="field-inline"><label>Unit price</label>
        <input class="rmis-input" data-f="unitPrice" type="number" min="0" step="any" value="0"></div>
      <button type="button" class="btn-ghost btn-sm" data-remove>Remove</button>
    </div>`;
  }

  function openCreate() {
    openModal(`
      <div class="modal-head"><h2>New Purchase Order</h2><button class="modal-close" data-close>&times;</button></div>
      <form id="po-form" novalidate>
        <div class="modal-body">
          <div class="form-grid">
            <div class="field-inline"><label>Supplier *</label>
              <select class="rmis-select" name="supplierId" id="po-supplier">${supplierSelect()}</select></div>
            <div class="field-inline"><label>New supplier (optional)</label>
              <input class="rmis-input" name="supplierNew" placeholder="Type to add a supplier"></div>
            <div class="field-inline full"><label>Notes (optional)</label>
              <input class="rmis-input" name="notes" placeholder="Delivery instructions, terms&hellip;"></div>
          </div>
          <div class="side-section" style="padding:0;margin:18px 0 8px">Line items</div>
          <div id="po-lines">${lineRow()}</div>
          <button type="button" class="btn-ghost btn-sm" id="po-addline">+ Add line</button>
          <div class="field-err" id="po-err" style="margin-top:12px"></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn-primary" id="po-submit">Save as Draft</button>
        </div>
      </form>`);

    document.getElementById('po-addline').addEventListener('click', () => {
      document.getElementById('po-lines').insertAdjacentHTML('beforeend', lineRow());
    });
    document.getElementById('po-lines').addEventListener('click', (e) => {
      if (e.target.matches('[data-remove]')) {
        const lines = document.querySelectorAll('#po-lines [data-line]');
        if (lines.length > 1) e.target.closest('[data-line]').remove();
      }
    });

    document.getElementById('po-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const items = [];
      document.querySelectorAll('#po-lines [data-line]').forEach((row) => {
        const ingredientId = Number(row.querySelector('[data-f="ingredientId"]').value);
        const quantity = Number(row.querySelector('[data-f="quantity"]').value);
        const unitPrice = Number(row.querySelector('[data-f="unitPrice"]').value || 0);
        if (ingredientId && quantity > 0) items.push({ ingredientId, quantity, unitPrice });
      });
      const errEl = document.getElementById('po-err');
      if (!items.length) { errEl.textContent = 'Add at least one line with an ingredient and positive quantity.'; return; }

      const payload = { notes: f.notes.value, items };
      const newSup = f.supplierNew.value.trim();
      if (newSup) payload.supplier = newSup;
      else if (f.supplierId.value) payload.supplierId = Number(f.supplierId.value);
      else { errEl.textContent = 'Choose or enter a supplier.'; return; }

      document.getElementById('po-submit').disabled = true;
      const { ok, data } = await api('POST', '/api/purchase-orders', payload);
      document.getElementById('po-submit').disabled = false;
      if (!ok) { errEl.textContent = data.message || 'Could not create purchase order.'; return; }
      closeModal();
      await loadRefs();
      await load();
      notice('page-notice', 'ok', `Created <strong>${esc(data.order.poNumber)}</strong> (Draft).`);
      openDetail(data.order.id);
    });
  }

  // ---- PO detail / receive ----
  async function openDetail(id) {
    const { ok, data } = await api('GET', `/api/purchase-orders/${id}`);
    if (!ok) return;
    const o = data.order;
    const receivable = o.status === 'Sent' || o.status === 'Partially Received';

    const itemRows = o.items.map((it) => {
      const remaining = it.quantity - it.receivedQty;
      const recvInput = receivable && remaining > 1e-9
        ? `<input class="rmis-input num" style="max-width:110px" data-recv="${it.id}" type="number" min="0" step="any" max="${remaining}" placeholder="0">`
        : '<span class="muted">&mdash;</span>';
      return `<tr>
        <td>${esc(it.ingredient)}</td>
        <td class="num">${fmt(it.quantity)} ${esc(it.unit)}</td>
        <td class="num">${fmt(it.receivedQty)}</td>
        <td class="num">${money(it.unitPrice)}</td>
        <td class="num">${money(it.lineTotal)}</td>
        <td>${recvInput}</td>
      </tr>`;
    }).join('');

    let actions = '';
    if (o.status === 'Draft') {
      actions = `<button type="button" class="btn-primary" data-send="${o.id}">Mark as Sent</button>`;
    } else if (receivable) {
      actions = `<button type="button" class="btn-primary" data-receive="${o.id}">Receive goods</button>
                 <button type="button" class="btn-ghost" data-close-po="${o.id}">Close PO</button>`;
    }

    openModal(`
      <div class="modal-head"><h2>${esc(o.poNumber)} &nbsp; ${statusTag(o.status)}</h2><button class="modal-close" data-close>&times;</button></div>
      <div class="modal-body">
        <p class="muted" style="margin-bottom:14px">
          Supplier: <strong>${esc(o.supplier)}</strong> &middot; Created ${shortDate(o.createdAt)} by ${esc(o.createdBy)}
          ${o.notes ? '<br>Notes: ' + esc(o.notes) : ''}
        </p>
        <table class="mock">
          <thead><tr><th>Ingredient</th><th class="num">Ordered</th><th class="num">Received</th><th class="num">Unit price</th><th class="num">Line total</th><th>Receive</th></tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        <p style="margin-top:12px;text-align:right"><strong>Total: ${money(o.total)}</strong></p>
        ${receivable ? '<p class="muted" style="margin-top:6px">Enter received quantities, then “Receive goods”. Stock updates automatically; the PO completes when every line is fully received.</p>' : ''}
        <div class="field-err" id="detail-err" style="margin-top:10px"></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn-ghost" data-close>Close</button>
        ${actions}
      </div>`);

    const card = document.getElementById('modal-card');
    const sendBtn = card.querySelector('[data-send]');
    if (sendBtn) sendBtn.addEventListener('click', () => changeStatus(o.id, 'Sent'));
    const closeBtn = card.querySelector('[data-close-po]');
    if (closeBtn) closeBtn.addEventListener('click', () => changeStatus(o.id, 'Completed'));
    const recvBtn = card.querySelector('[data-receive]');
    if (recvBtn) recvBtn.addEventListener('click', () => submitReceipt(o.id));
  }

  async function changeStatus(id, status) {
    const { ok, data } = await api('PATCH', `/api/purchase-orders/${id}`, { status });
    const errEl = document.getElementById('detail-err');
    if (!ok) { if (errEl) errEl.textContent = data.message || 'Could not update status.'; return; }
    closeModal();
    await load();
    notice('page-notice', 'ok', `<strong>${esc(data.order.poNumber)}</strong> is now ${esc(data.order.status)}.`);
    openDetail(id);
  }

  async function submitReceipt(id) {
    const receipts = [];
    document.querySelectorAll('[data-recv]').forEach((inp) => {
      const qty = Number(inp.value);
      if (qty > 0) receipts.push({ itemId: Number(inp.dataset.recv), receivedQty: qty });
    });
    const errEl = document.getElementById('detail-err');
    if (!receipts.length) { errEl.textContent = 'Enter at least one received quantity.'; return; }
    const { ok, data } = await api('POST', `/api/purchase-orders/${id}/receive`, { receipts });
    if (!ok) { errEl.textContent = data.message || 'Could not record receipt.'; return; }
    closeModal();
    await load();
    notice('page-notice', 'ok', `Goods received against <strong>${esc(data.order.poNumber)}</strong>. Status: ${esc(data.order.status)}.`);
    openDetail(id);
  }

  // ---- events ----
  document.getElementById('btn-new').addEventListener('click', openCreate);
  poBody.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (btn) openDetail(Number(btn.dataset.view));
  });
  [fSupplier, fStatus, fFrom, fTo].forEach((el) => el.addEventListener('change', load));

  await loadRefs();
  await load();
})();
