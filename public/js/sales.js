// AM Restaurant RMIS — Sales & Billing page (POS).
//   - build a bill from free-form line items; totals + 12% VAT preview live
//   - create as Open, then settle with Cash / Card / GCash (cash shows change)
//   - managers can void an open bill
//   - list / filter by status and date; view a printable receipt
// Roles: Admin, Manager, Cashier (void is manager-only).

(async () => {
  const { esc, fmt, money, shortDate, api, openModal, closeModal, notice } = window.RMISUI;
  const me = await window.RMIS.ready;
  if (!me) return;
  const isManager = me.role === 'Admin' || me.role === 'Manager';
  const VAT_RATE = 0.12;

  const body = document.getElementById('sales-body');
  const empty = document.getElementById('sales-empty');
  const fStatus = document.getElementById('f-status');
  const fDate = document.getElementById('f-date');

  const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
  function todayStr() {
    const d = new Date(); const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }
  function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : ''; }

  const STATUS_TAG = { Open: 'tag-pending', Paid: 'tag-approved', Void: 'tag-rejected' };
  const statusTag = (s) => `<span class="tag ${STATUS_TAG[s] || 'tag-pending'}">${esc(s)}</span>`;

  // ---- KPIs ----
  async function loadKpis() {
    const [todayRes, openRes] = await Promise.all([
      api('GET', '/api/sales?date=' + todayStr()),
      api('GET', '/api/sales?status=Open'),
    ]);
    const today = todayRes.data.sales || [];
    const paidToday = today.filter((s) => s.status === 'Paid');
    const salesTotal = paidToday.reduce((sum, s) => sum + s.total, 0);
    const kpis = [
      { label: "Today's Sales", value: money(salesTotal) },
      { label: 'Paid Bills Today', value: paidToday.length },
      { label: 'Open Bills', value: (openRes.data.sales || []).length },
      { label: 'Bills Today', value: today.length },
    ];
    document.getElementById('kpi-row').innerHTML = kpis.map((k) => `
      <div class="kpi"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div></div>`).join('');
  }

  // ---- list ----
  async function load() {
    const p = new URLSearchParams();
    if (fStatus.value) p.set('status', fStatus.value);
    if (fDate.value) p.set('date', fDate.value);
    const { data } = await api('GET', '/api/sales?' + p.toString());
    render(data.sales || []);
    await loadKpis();
  }

  function render(sales) {
    if (!sales.length) { body.innerHTML = ''; empty.hidden = false; return; }
    empty.hidden = true;
    body.innerHTML = sales.map((s) => `
      <tr>
        <td>${esc(s.billNumber)}</td>
        <td>${s.tableLabel ? esc(s.tableLabel) : '<span class="muted">&mdash;</span>'}</td>
        <td>${shortDate(s.createdAt)} ${fmtTime(s.createdAt)}</td>
        <td>${esc(s.cashier)}</td>
        <td class="num">${money(s.total)}</td>
        <td>${statusTag(s.status)}</td>
        <td><button class="btn-ghost btn-sm" data-view="${s.id}">View</button></td>
      </tr>`).join('');
  }

  // ---- new bill ----
  function lineRow() {
    return `<div class="line-row" data-line>
      <div class="field-inline"><label>Item</label>
        <input class="rmis-input" data-f="name" placeholder="e.g. Beef Tapa"></div>
      <div class="field-inline"><label>Qty</label>
        <input class="rmis-input" data-f="quantity" type="number" min="0" step="any" value="1"></div>
      <div class="field-inline"><label>Unit price</label>
        <input class="rmis-input" data-f="unitPrice" type="number" min="0" step="any" value="0"></div>
      <button type="button" class="btn-ghost btn-sm" data-remove>Remove</button>
    </div>`;
  }

  function readLines() {
    const items = [];
    document.querySelectorAll('#bill-lines [data-line]').forEach((row) => {
      const name = row.querySelector('[data-f="name"]').value.trim();
      const quantity = Number(row.querySelector('[data-f="quantity"]').value);
      const unitPrice = Number(row.querySelector('[data-f="unitPrice"]').value || 0);
      if (name && quantity > 0) items.push({ name, quantity, unitPrice });
    });
    return items;
  }

  function refreshTotals() {
    const items = readLines();
    const subtotal = round2(items.reduce((s, it) => s + it.quantity * it.unitPrice, 0));
    let discount = Number(document.getElementById('bill-discount').value || 0);
    if (!(discount >= 0)) discount = 0;
    if (discount > subtotal) discount = subtotal;
    const tax = round2((subtotal - discount) * VAT_RATE);
    const total = round2(subtotal - discount + tax);
    document.getElementById('t-subtotal').textContent = money(subtotal);
    document.getElementById('t-tax').textContent = money(tax);
    document.getElementById('t-total').textContent = money(total);
  }

  function openNewBill() {
    openModal(`
      <div class="modal-head"><h2>New Bill</h2><button class="modal-close" data-close>&times;</button></div>
      <form id="bill-form" novalidate>
        <div class="modal-body">
          <div class="form-grid">
            <div class="field-inline full"><label>Table / customer reference (optional)</label>
              <input class="rmis-input" name="tableLabel" placeholder="e.g. Table 5 / Walk-in"></div>
          </div>
          <div class="side-section" style="padding:0;margin:18px 0 8px">Items</div>
          <div id="bill-lines">${lineRow()}</div>
          <button type="button" class="btn-ghost btn-sm" id="add-line">+ Add item</button>
          <div class="form-grid" style="margin-top:16px">
            <div class="field-inline"><label>Discount (₱, optional)</label>
              <input class="rmis-input" id="bill-discount" type="number" min="0" step="any" value="0"></div>
          </div>
          <div class="receipt-totals" style="margin-top:14px">
            <div><span>Subtotal</span><span id="t-subtotal">₱0.00</span></div>
            <div><span>VAT (12%)</span><span id="t-tax">₱0.00</span></div>
            <div class="grand"><span>Total</span><span id="t-total">₱0.00</span></div>
          </div>
          <div class="field-err" id="bill-err" style="margin-top:10px"></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn-primary" id="bill-submit">Create bill</button>
        </div>
      </form>`);

    document.getElementById('add-line').addEventListener('click', () => {
      document.getElementById('bill-lines').insertAdjacentHTML('beforeend', lineRow());
    });
    document.getElementById('bill-lines').addEventListener('click', (e) => {
      if (e.target.matches('[data-remove]')) {
        const lines = document.querySelectorAll('#bill-lines [data-line]');
        if (lines.length > 1) { e.target.closest('[data-line]').remove(); refreshTotals(); }
      }
    });
    document.getElementById('modal-card').addEventListener('input', (e) => {
      if (e.target.matches('[data-f], #bill-discount')) refreshTotals();
    });

    document.getElementById('bill-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const items = readLines();
      const errEl = document.getElementById('bill-err');
      if (!items.length) { errEl.textContent = 'Add at least one item with a name and positive quantity.'; return; }
      const payload = { tableLabel: e.target.tableLabel.value, items, discount: Number(document.getElementById('bill-discount').value || 0) };
      document.getElementById('bill-submit').disabled = true;
      const { ok, data } = await api('POST', '/api/sales', payload);
      document.getElementById('bill-submit').disabled = false;
      if (!ok) { errEl.textContent = data.message || 'Could not create bill.'; return; }
      closeModal();
      await load();
      notice('page-notice', 'ok', `Created <strong>${esc(data.sale.billNumber)}</strong> — total ${money(data.sale.total)}.`);
      openReceipt(data.sale.id);
    });
    refreshTotals();
  }

  // ---- receipt / settle ----
  async function openReceipt(id) {
    const { ok, data } = await api('GET', `/api/sales/${id}`);
    if (!ok) return;
    const s = data.sale;
    const itemRows = s.items.map((it) => `
      <tr><td>${esc(it.name)}</td><td class="num">${fmt(it.quantity)}</td>
      <td class="num">${money(it.unitPrice)}</td><td class="num">${money(it.lineTotal)}</td></tr>`).join('');

    const paidBlock = s.status === 'Paid' ? `
      <div class="receipt-totals" style="margin-top:8px">
        <div><span>Payment</span><span>${esc(s.paymentMethod)}</span></div>
        <div><span>Tendered</span><span>${money(s.amountTendered)}</span></div>
        <div><span>Change</span><span>${money(s.changeDue)}</span></div>
        <div><span>Settled</span><span>${shortDate(s.settledAt)} ${fmtTime(s.settledAt)}</span></div>
      </div>` : '';

    let actionArea = '';
    if (s.status === 'Open') {
      actionArea = `
        <div class="side-section" style="padding:0;margin:18px 0 8px">Settle payment</div>
        <div class="form-grid">
          <div class="field-inline"><label>Payment method *</label>
            <select class="rmis-select" id="pay-method">
              <option value="">— select —</option>
              <option>Cash</option><option>Card</option><option>GCash</option>
            </select></div>
          <div class="field-inline" id="tendered-wrap" hidden><label>Amount tendered (₱) *</label>
            <input class="rmis-input" id="pay-tendered" type="number" min="0" step="any"></div>
        </div>
        <div class="receipt-totals" id="change-preview" hidden><div class="grand"><span>Change</span><span id="pay-change">₱0.00</span></div></div>
        <div class="field-err" id="settle-err" style="margin-top:10px"></div>`;
    }

    openModal(`
      <div class="modal-head"><h2>${esc(s.billNumber)} &nbsp; ${statusTag(s.status)}</h2><button class="modal-close" data-close>&times;</button></div>
      <div class="modal-body">
        <p class="muted" style="margin-bottom:12px">
          ${s.tableLabel ? esc(s.tableLabel) + ' &middot; ' : ''}Cashier ${esc(s.cashier)} &middot; ${shortDate(s.createdAt)} ${fmtTime(s.createdAt)}
        </p>
        <table class="mock">
          <thead><tr><th>Item</th><th class="num">Qty</th><th class="num">Price</th><th class="num">Amount</th></tr></thead>
          <tbody>${itemRows}</tbody>
        </table>
        <div class="receipt-totals" style="margin-top:12px">
          <div><span>Subtotal</span><span>${money(s.subtotal)}</span></div>
          ${s.discount ? `<div><span>Discount</span><span>-${money(s.discount)}</span></div>` : ''}
          <div><span>VAT (12%)</span><span>${money(s.tax)}</span></div>
          <div class="grand"><span>Total</span><span>${money(s.total)}</span></div>
        </div>
        ${paidBlock}
        ${actionArea}
      </div>
      <div class="modal-foot">
        <button type="button" class="btn-ghost" data-close>Close</button>
        ${s.status === 'Open' && isManager ? `<button type="button" class="btn-ghost" data-void="${s.id}">Void bill</button>` : ''}
        ${s.status === 'Open' ? `<button type="button" class="btn-primary" data-settle="${s.id}">Settle payment</button>` : ''}
      </div>`);

    if (s.status === 'Open') {
      const method = document.getElementById('pay-method');
      const tenderedWrap = document.getElementById('tendered-wrap');
      const tendered = document.getElementById('pay-tendered');
      const changePreview = document.getElementById('change-preview');
      const updateChange = () => {
        const isCash = method.value === 'Cash';
        tenderedWrap.hidden = !isCash;
        changePreview.hidden = !isCash;
        if (isCash) {
          const change = round2(Number(tendered.value || 0) - s.total);
          document.getElementById('pay-change').textContent = money(change >= 0 ? change : 0);
        }
      };
      method.addEventListener('change', updateChange);
      tendered.addEventListener('input', updateChange);

      document.querySelector('[data-settle]').addEventListener('click', async () => {
        const errEl = document.getElementById('settle-err');
        errEl.textContent = '';
        const payload = { paymentMethod: method.value, amountTendered: Number(tendered.value || 0) };
        if (!payload.paymentMethod) { errEl.textContent = 'Choose a payment method.'; return; }
        const { ok, data: d } = await api('POST', `/api/sales/${id}/settle`, payload);
        if (!ok) { errEl.textContent = d.message || 'Could not settle bill.'; return; }
        closeModal();
        await load();
        notice('page-notice', 'ok', `<strong>${esc(d.sale.billNumber)}</strong> settled (${esc(d.sale.paymentMethod)})${d.sale.changeDue ? ' — change ' + money(d.sale.changeDue) : ''}.`);
        openReceipt(id);
      });

      const voidBtn = document.querySelector('[data-void]');
      if (voidBtn) voidBtn.addEventListener('click', async () => {
        if (!window.confirm(`Void ${s.billNumber}? This cannot be undone.`)) return;
        const { ok, data: d } = await api('POST', `/api/sales/${id}/void`);
        if (!ok) { notice('page-notice', 'err', esc(d.message || 'Could not void.')); return; }
        closeModal();
        await load();
        notice('page-notice', 'ok', `<strong>${esc(d.sale.billNumber)}</strong> voided.`);
      });
    }
  }

  // ---- events ----
  document.getElementById('btn-new').addEventListener('click', openNewBill);
  body.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-view]');
    if (btn) openReceipt(Number(btn.dataset.view));
  });
  fStatus.addEventListener('change', load);
  fDate.addEventListener('change', load);
  document.getElementById('f-clear').addEventListener('click', () => { fStatus.value = ''; fDate.value = ''; load(); });

  await load();
})();
