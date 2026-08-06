// AM Restaurant RMIS — Sales History (SI-17).
//
// All filtering is server-side; this only collects the inputs. Opening a row
// loads the line items, payment details and any refund history.

(async () => {
  const me = await window.RMIS.ready;
  if (!me) return;

  const { esc, money, api, openModal } = window.RMISUI;
  const body = document.getElementById('history-body');
  const empty = document.getElementById('history-empty');
  const count = document.getElementById('row-count');

  // The dashboard is Manager/Admin only; hide the link for Cashiers rather than
  // let them click into a 403.
  if (!['Admin', 'Manager'].includes(me.role)) {
    const nav = document.getElementById('nav-dash');
    if (nav) nav.remove();
  }

  const F = {
    no: document.getElementById('f-no'),
    from: document.getElementById('f-from'),
    to: document.getElementById('f-to'),
    cashier: document.getElementById('f-cashier'),
    method: document.getElementById('f-method'),
    status: document.getElementById('f-status'),
  };

  const STATUS_TAG = {
    Open: 'tag-pending', Paid: 'tag-ok', Void: 'tag-danger',
    Refunded: 'tag-warn', 'Partially Refunded': 'tag-warn',
  };
  const tag = (s) => `<span class="tag ${STATUS_TAG[s] || ''}">${esc(s)}</span>`;

  function stamp(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return esc(iso);
    return d.toLocaleString('en-PH', {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  }

  function render(rows) {
    empty.hidden = rows.length > 0;
    count.textContent = rows.length ? `— ${rows.length} shown` : '';
    body.innerHTML = rows.map((s) => `
      <tr>
        <td><strong>${esc(s.bill_number)}</strong></td>
        <td>${stamp(s.created_at)}</td>
        <td>${esc(s.cashier_name) || '<span class="muted">&mdash;</span>'}</td>
        <td class="num">${money(s.total)}</td>
        <td>${esc(s.payment_method) || '<span class="muted">&mdash;</span>'}</td>
        <td>${tag(s.status)}${Number(s.pending_refunds) > 0
              ? ' <span class="tag tag-pending">refund pending</span>' : ''}</td>
        <td class="num">${Number(s.refunded_amount) > 0 ? money(s.refunded_amount) : '<span class="muted">&mdash;</span>'}</td>
        <td><button class="btn-ghost btn-sm" data-view="${s.id}">View</button></td>
      </tr>`).join('');
  }

  async function load() {
    const p = new URLSearchParams();
    if (F.no.value.trim()) p.set('transactionNo', F.no.value.trim());
    if (F.from.value) p.set('from', F.from.value);
    if (F.to.value) p.set('to', F.to.value);
    if (F.cashier.value) p.set('cashierId', F.cashier.value);
    if (F.method.value) p.set('paymentMethod', F.method.value);
    if (F.status.value) p.set('status', F.status.value);

    const { ok, data } = await api('GET', '/api/sales-history?' + p.toString());
    if (!ok) return render([]);
    render(data.sales || []);

    // Populate the cashier filter once, preserving the current choice.
    if (F.cashier.options.length <= 1 && Array.isArray(data.cashiers)) {
      const keep = F.cashier.value;
      F.cashier.innerHTML = '<option value="">All cashiers</option>' +
        data.cashiers.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
      F.cashier.value = keep;
    }
  }

  async function openDetail(id) {
    const { ok, data } = await api('GET', `/api/sales-history/${id}`);
    if (!ok) return;
    const { sale, items, refunds } = data;

    const lines = items.map((i) => `
      <tr>
        <td>${esc(i.name)}</td>
        <td class="num">${esc(i.quantity)}</td>
        <td class="num">${money(i.unit_price)}</td>
        <td class="num">${money(i.line_total)}</td>
        <td class="num">${Number(i.refunded_qty) > 0 ? esc(i.refunded_qty) : '<span class="muted">&mdash;</span>'}</td>
        <td class="num">${esc(i.refundable_qty)}</td>
      </tr>`).join('');

    const refundRows = refunds.length ? refunds.map((r) => `
      <tr>
        <td>#${esc(r.id)}</td>
        <td class="num">${money(r.amount)}</td>
        <td>${esc(r.method)}</td>
        <td>${tag(r.status)}</td>
        <td>${esc(r.requested_by)}</td>
        <td>${esc(r.reviewed_by) || '<span class="muted">&mdash;</span>'}</td>
        <td>${esc(r.reason)}</td>
      </tr>`).join('') : '';

    openModal(`
      <div class="modal-head"><h2>${esc(sale.bill_number)}</h2>
        <button class="modal-close" data-close>&times;</button></div>
      <div class="modal-body">
        <div class="form-grid">
          <div class="field-inline"><label>Date &amp; time</label><span>${stamp(sale.created_at)}</span></div>
          <div class="field-inline"><label>Cashier</label><span>${esc(sale.cashier_name) || '&mdash;'}</span></div>
          <div class="field-inline"><label>Status</label><span>${tag(sale.status)}</span></div>
          <div class="field-inline"><label>Table / reference</label><span>${esc(sale.table_label) || '&mdash;'}</span></div>
          <div class="field-inline"><label>Payment method</label><span>${esc(sale.payment_method) || '&mdash;'}</span></div>
          <div class="field-inline"><label>Amount tendered</label><span>${money(sale.amount_tendered)}</span></div>
        </div>

        <h3 class="section-title">Items</h3>
        <table class="mock">
          <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Unit</th>
            <th class="num">Line total</th><th class="num">Refunded</th><th class="num">Refundable</th></tr></thead>
          <tbody>${lines}</tbody>
        </table>

        <div class="receipt-totals">
          <div><span>Subtotal</span><strong>${money(sale.subtotal)}</strong></div>
          <div><span>Discount</span><strong>${money(sale.discount)}</strong></div>
          <div><span>VAT (12%)</span><strong>${money(sale.tax)}</strong></div>
          <div><span>Total</span><strong>${money(sale.total)}</strong></div>
        </div>

        <h3 class="section-title">Refunds</h3>
        ${refundRows
          ? `<table class="mock"><thead><tr><th>Refund</th><th class="num">Amount</th><th>Method</th>
               <th>Status</th><th>Requested by</th><th>Reviewed by</th><th>Reason</th></tr></thead>
             <tbody>${refundRows}</tbody></table>`
          : '<div class="empty-state">No refunds on this transaction.</div>'}
      </div>`);
  }

  body.addEventListener('click', (e) => {
    const id = e.target.dataset && e.target.dataset.view;
    if (id) openDetail(id);
  });

  let t;
  document.getElementById('filters').addEventListener('input', () => {
    clearTimeout(t); t = setTimeout(load, 250);
  });
  document.getElementById('filters').addEventListener('change', load);
  document.getElementById('f-clear').addEventListener('click', () => {
    Object.values(F).forEach((el) => { el.value = ''; });
    load();
  });

  await load();
})();
