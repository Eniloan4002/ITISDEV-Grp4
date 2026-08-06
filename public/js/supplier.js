// AM Restaurant RMIS — Supplier Records (SI-15).
//
// Lists active suppliers with search across every field the spec names, and
// lets Managers/Admins create or edit one. Validation is authoritative on the
// server; this surfaces the field-level errors it returns.

(async () => {
  const me = await window.RMIS.ready;
  if (!me) return;

  const { esc, api, openModal, closeModal, notice } = window.RMISUI;
  const body = document.getElementById('supplier-body');
  const empty = document.getElementById('supplier-empty');
  const search = document.getElementById('f-search');
  const canManage = ['Admin', 'Manager'].includes(me.role);

  const newBtn = document.getElementById('new-supplier');
  if (!canManage && newBtn) newBtn.hidden = true;

  const FIELDS = [
    ['name', 'Company name', 'text'],
    ['contactPerson', 'Contact person', 'text'],
    ['email', 'Email', 'email'],
    ['phone', 'Phone number', 'text'],
    ['tin', 'TIN / business ID', 'text'],
    ['address', 'Physical address', 'text'],
    ['billingAddress', 'Billing address', 'text'],
  ];

  // server column -> form field
  const toForm = (s) => ({
    name: s.name, contactPerson: s.contact_person, email: s.email,
    phone: s.phone, tin: s.tin, address: s.address, billingAddress: s.billing_address,
  });

  function render(rows) {
    empty.hidden = rows.length > 0;
    body.innerHTML = rows.map((s) => `
      <tr>
        <td><strong>${esc(s.name)}</strong></td>
        <td>${esc(s.contact_person) || '<span class="muted">&mdash;</span>'}</td>
        <td>${esc(s.email) || '<span class="muted">&mdash;</span>'}</td>
        <td>${esc(s.phone) || '<span class="muted">&mdash;</span>'}</td>
        <td>${esc(s.tin) || '<span class="muted">&mdash;</span>'}</td>
        <td>${esc(s.address) || '<span class="muted">&mdash;</span>'}</td>
        <td>${canManage ? `<button class="btn-ghost btn-sm" data-edit="${s.id}">Edit</button>` : ''}</td>
      </tr>`).join('');
  }

  async function load() {
    const q = search.value.trim();
    const { ok, data } = await api('GET', '/api/suppliers?q=' + encodeURIComponent(q));
    render(ok && data.suppliers ? data.suppliers : []);
  }

  function formHtml(values, title) {
    const rows = FIELDS.map(([key, label, type]) => `
      <div class="field-inline${key === 'address' || key === 'billingAddress' ? ' full' : ''}">
        <label>${label} *</label>
        <input class="rmis-input" type="${type}" name="${key}" value="${esc(values[key] || '')}" required>
        <span class="field-err" data-err="${key}"></span>
      </div>`).join('');
    return `
      <div class="modal-head"><h2>${esc(title)}</h2>
        <button class="modal-close" data-close>&times;</button></div>
      <div class="modal-body">
        <form id="supplier-form" novalidate>
          <div class="form-grid">${rows}</div>
          <div class="field-err" id="supplier-err"></div>
          <div style="margin-top:14px"><button type="submit" class="btn-primary">Save supplier</button></div>
        </form>
      </div>`;
  }

  function openForm(supplier) {
    const values = supplier ? toForm(supplier) : {};
    openModal(formHtml(values, supplier ? `Edit — ${supplier.name}` : 'New supplier'));

    document.getElementById('supplier-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      document.querySelectorAll('[data-err]').forEach((el) => { el.textContent = ''; });
      document.getElementById('supplier-err').textContent = '';

      const payload = {};
      for (const [key] of FIELDS) payload[key] = e.target[key].value;

      const { ok, status, data } = supplier
        ? await api('PATCH', `/api/suppliers/${supplier.id}`, payload)
        : await api('POST', '/api/suppliers', payload);

      if (ok) {
        closeModal();
        notice('page-notice', 'ok', `Supplier <strong>${esc(payload.name)}</strong> saved.`);
        return load();
      }
      // 400 carries per-field errors; 409 is the duplicate-name race.
      if (data && data.errors) {
        for (const [key, msg] of Object.entries(data.errors)) {
          const el = document.querySelector(`[data-err="${key}"]`);
          if (el) el.textContent = msg;
        }
      }
      document.getElementById('supplier-err').textContent =
        (data && data.message) || `Could not save supplier (${status}).`;
    });
  }

  if (newBtn) newBtn.addEventListener('click', () => openForm(null));

  body.addEventListener('click', async (e) => {
    const id = e.target.dataset && e.target.dataset.edit;
    if (!id) return;
    const { ok, data } = await api('GET', `/api/suppliers/${id}`);
    if (ok && data.supplier) openForm(data.supplier);
  });

  let t;
  search.addEventListener('input', () => { clearTimeout(t); t = setTimeout(load, 250); });

  await load();
})();
