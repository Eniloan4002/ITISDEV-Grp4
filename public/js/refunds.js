// AM Restaurant RMIS — Refund Processing (SI-18).
//
// Two distinct steps, deliberately: anyone in Sales roles raises a request, and
// a Manager or Admin must then explicitly approve or reject it — including
// requests they raised themselves. The server enforces both halves; the UI only
// hides controls it knows will be refused.

(async () => {
  const me = await window.RMIS.ready;
  if (!me) return;

  const { esc, money, api, openModal, closeModal, notice } = window.RMISUI;
  const body = document.getElementById('refund-body');
  const empty = document.getElementById('refund-empty');
  const statusFilter = document.getElementById('f-status');
  const eligible = document.getElementById('eligible');
  const lookupErr = document.getElementById('lookup-err');
  let canReview = false;

  if (!['Admin', 'Manager'].includes(me.role)) {
    const nav = document.getElementById('nav-dash');
    if (nav) nav.remove();
  }

  const TAG = { Pending: 'tag-pending', Completed: 'tag-ok', Rejected: 'tag-danger', Approved: 'tag-ok' };
  const tag = (s) => `<span class="tag ${TAG[s] || ''}">${esc(s)}</span>`;

  // --- request list --------------------------------------------------------

  function render(rows) {
    empty.hidden = rows.length > 0;
    body.innerHTML = rows.map((r) => `
      <tr>
        <td>#${esc(r.id)}</td>
        <td>${esc(r.bill_number)}</td>
        <td class="num">${money(r.amount)}</td>
        <td>${esc(r.method)}</td>
        <td>${tag(r.status)}</td>
        <td>${esc(r.requested_by)}</td>
        <td>${esc(r.reviewed_by) || '<span class="muted">&mdash;</span>'}</td>
        <td>${r.status === 'Pending' && canReview
              ? `<button class="btn-ghost btn-sm" data-review="${r.id}">Review</button>`
              : `<button class="btn-ghost btn-sm" data-view="${r.id}">View</button>`}</td>
      </tr>`).join('');
  }

  async function load() {
    const p = new URLSearchParams();
    if (statusFilter.value) p.set('status', statusFilter.value);
    const { ok, data } = await api('GET', '/api/refunds?' + p.toString());
    if (!ok) return render([]);
    canReview = !!data.canReview;
    render(data.refunds || []);
  }

  // --- step 1: find an eligible transaction --------------------------------

  document.getElementById('lookup').addEventListener('submit', async (e) => {
    e.preventDefault();
    lookupErr.textContent = '';
    eligible.innerHTML = '';
    const billNo = document.getElementById('f-bill').value.trim();
    if (!billNo) { lookupErr.textContent = 'Enter a transaction number.'; return; }

    // Resolve the number to an id through sales history, then load refundability.
    const found = await api('GET', '/api/sales-history?transactionNo=' + encodeURIComponent(billNo));
    const match = found.ok && (found.data.sales || [])
      .find((s) => String(s.bill_number).toLowerCase() === billNo.toLowerCase());
    if (!match) { lookupErr.textContent = `No transaction found for "${billNo}".`; return; }

    const { ok, status, data } = await api('GET', `/api/refunds/eligible/${match.id}`);
    if (!ok) {
      lookupErr.textContent = (data && data.message) || `Not eligible (${status}).`;
      return;
    }
    renderEligible(data);
  });

  function renderEligible({ sale, items, defaultMethod, anyRefundable }) {
    if (!anyRefundable) {
      eligible.innerHTML = `<div class="empty-state">Every unit on ${esc(sale.bill_number)}
        has already been refunded.</div>`;
      return;
    }
    const rows = items.map((i) => `
      <tr>
        <td>${esc(i.name)}</td>
        <td class="num">${esc(i.quantity)}</td>
        <td class="num">${money(i.unit_price)}</td>
        <td class="num">${esc(i.refunded_qty)}</td>
        <td class="num">${esc(i.refundable_qty)}</td>
        <td><input class="rmis-input" type="number" min="0" step="1" value="0"
                   max="${esc(i.refundable_qty)}" data-line="${esc(i.id)}"
                   ${Number(i.refundable_qty) === 0 ? 'disabled' : ''}></td>
      </tr>`).join('');

    eligible.innerHTML = `
      <h3 class="section-title">${esc(sale.bill_number)} &mdash; ${money(sale.total)}</h3>
      <table class="mock">
        <thead><tr><th>Item</th><th class="num">Sold</th><th class="num">Unit</th>
          <th class="num">Refunded</th><th class="num">Refundable</th><th>Refund qty</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <form id="refund-form" novalidate>
        <input type="hidden" id="r-sale" value="${esc(sale.id)}">
        <div class="form-grid">
          <div class="field-inline"><label>Refund method *</label>
            <select class="rmis-select" id="r-method">
              ${['Cash', 'Card', 'GCash', 'Maya', 'Other'].map((m) =>
                `<option ${m === defaultMethod ? 'selected' : ''}>${m}</option>`).join('')}
            </select></div>
          <div class="field-inline full"><label>Reason *</label>
            <input class="rmis-input" id="r-reason" placeholder="Why is this being refunded?" required></div>
        </div>
        <div class="field-err" id="refund-err"></div>
        <div style="margin-top:14px"><button type="submit" class="btn-primary">Submit refund request</button></div>
      </form>`;

    document.getElementById('refund-form').addEventListener('submit', submitRequest);
  }

  async function submitRequest(e) {
    e.preventDefault();
    const err = document.getElementById('refund-err');
    err.textContent = '';

    const lines = [...document.querySelectorAll('[data-line]')]
      .map((el) => ({ saleItemId: Number(el.dataset.line), quantity: Number(el.value) }))
      .filter((l) => l.quantity > 0);

    const payload = {
      saleId: Number(document.getElementById('r-sale').value),
      method: document.getElementById('r-method').value,
      reason: document.getElementById('r-reason').value.trim(),
      lines,
    };

    const { ok, status, data } = await api('POST', '/api/refunds', payload);
    if (ok) {
      eligible.innerHTML = '';
      document.getElementById('f-bill').value = '';
      notice('page-notice', 'ok',
        `Refund request <strong>#${esc(data.refund.id)}</strong> raised for ${money(data.refund.amount)}. ` +
        'It needs a Manager or Admin approval before anything changes.');
      return load();
    }
    err.textContent = (data && (data.message ||
      Object.values(data.errors || {})[0])) || `Could not submit the request (${status}).`;
  }

  // --- review (Manager / Admin) -------------------------------------------

  async function openReview(id, readOnly) {
    const { ok, data } = await api('GET', `/api/refunds/${id}`);
    if (!ok) return;
    const { refund, items } = data;

    const rows = items.map((i) => `
      <tr><td>${esc(i.name)}</td><td class="num">${esc(i.quantity)}</td>
          <td class="num">${money(i.amount)}</td></tr>`).join('');

    openModal(`
      <div class="modal-head"><h2>Refund #${esc(refund.id)} &mdash; ${esc(refund.bill_number)}</h2>
        <button class="modal-close" data-close>&times;</button></div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="field-inline"><label>Amount</label><span>${money(refund.amount)}</span></div>
          <div class="field-inline"><label>Method</label><span>${esc(refund.method)}</span></div>
          <div class="field-inline"><label>Status</label><span>${tag(refund.status)}</span></div>
          <div class="field-inline"><label>Requested by</label><span>${esc(refund.requested_by)}</span></div>
          <div class="field-inline full"><label>Reason</label><span>${esc(refund.reason)}</span></div>
          ${refund.reviewed_by ? `
          <div class="field-inline"><label>Reviewed by</label><span>${esc(refund.reviewed_by)}</span></div>
          <div class="field-inline full"><label>Review note</label>
            <span>${esc(refund.review_notes) || '&mdash;'}</span></div>` : ''}
        </div>

        <h3 class="section-title">Lines</h3>
        <table class="mock"><thead><tr><th>Item</th><th class="num">Qty</th>
          <th class="num">Amount</th></tr></thead><tbody>${rows}</tbody></table>

        ${readOnly ? '' : `
        <div class="form-grid" style="margin-top:14px">
          <div class="field-inline full"><label>Review note</label>
            <input class="rmis-input" id="review-notes"
                   placeholder="Required when rejecting"></div>
        </div>
        <div class="field-err" id="review-err"></div>
        <div style="margin-top:14px; display:flex; gap:10px">
          <button type="button" class="btn-primary" id="do-approve">Approve refund</button>
          <button type="button" class="btn-ghost btn-danger" id="do-reject">Reject</button>
        </div>
        <p class="field-hint">Approving restores stock, records the movement and sets the
           transaction to Refunded or Partially Refunded. It cannot be undone.</p>`}
      </div>`);

    if (readOnly) return;

    const decide = async (decision) => {
      const err = document.getElementById('review-err');
      err.textContent = '';
      const notes = document.getElementById('review-notes').value.trim();
      const { ok, status, data } = await api('POST', `/api/refunds/${id}/${decision}`, { notes });
      if (ok) {
        closeModal();
        notice('page-notice', decision === 'approve' ? 'ok' : 'warn',
          decision === 'approve'
            ? `Refund #${esc(id)} approved. Transaction is now <strong>${esc(data.saleStatus)}</strong>, ` +
              `${esc(data.restoredIngredients.length)} ingredient movement(s) recorded.`
            : `Refund #${esc(id)} rejected.`);
        return load();
      }
      err.textContent = (data && (data.message ||
        Object.values(data.errors || {})[0])) || `Could not ${decision} (${status}).`;
    };

    document.getElementById('do-approve').addEventListener('click', () => decide('approve'));
    document.getElementById('do-reject').addEventListener('click', () => decide('reject'));
  }

  body.addEventListener('click', (e) => {
    const d = e.target.dataset || {};
    if (d.review) openReview(d.review, false);
    else if (d.view) openReview(d.view, true);
  });

  statusFilter.addEventListener('change', load);
  await load();
})();
