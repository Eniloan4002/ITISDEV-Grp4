(async () => {
  const me = await window.RMIS.ready;
  if (!me) return;

  const filterForm = document.getElementById('performance-form');
  const editorForm = document.getElementById('report-editor');
  const body = document.getElementById('performance-body');
  const exportBtn = document.getElementById('export-btn');
  const cancelBtn = document.getElementById('cancel-edit');
  const deleteBtn = document.getElementById('delete-selected');
  const formMessage = document.getElementById('form-message');
  const reportIdInput = document.getElementById('report-id');
  const fields = {
    employeeName: document.getElementById('report-employee-name'),
    role: document.getElementById('report-role'),
    period: document.getElementById('report-period'),
    ordersServed: document.getElementById('orders-served'),
    sales: document.getElementById('sales-amount'),
    punctuality: document.getElementById('punctuality'),
    notes: document.getElementById('notes'),
  };

  let selectedReportId = null;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  function resetForm() {
    selectedReportId = null;
    reportIdInput.value = '';
    Object.values(fields).forEach((field) => {
      if (field.tagName === 'TEXTAREA') field.value = '';
      else field.value = field.type === 'number' ? '0' : '';
    });
    fields.ordersServed.value = '0';
    fields.sales.value = '0';
    if (formMessage) formMessage.textContent = '';
  }

  function setFormMessage(message, isError) {
    if (!formMessage) return;
    formMessage.textContent = message;
    formMessage.style.color = isError ? '#b91c1c' : '#0f766e';
  }

  async function loadReports() {
    const params = new URLSearchParams();
    const employeeName = document.getElementById('employee-name').value.trim();
    const role = document.getElementById('role').value.trim();
    const period = document.getElementById('period').value.trim();
    if (employeeName) params.set('employeeName', employeeName);
    if (role) params.set('role', role);
    if (period) params.set('period', period);

    const res = await fetch('/api/employee-performance?' + params.toString(), { method: 'GET' });
    const data = await res.json();
    if (!res.ok) {
      body.innerHTML = `<tr><td colspan="7" class="muted">${data.message || 'Unable to load report.'}</td></tr>`;
      return;
    }

    const rows = data.reports || [];
    if (!rows.length) {
      body.innerHTML = '<tr><td colspan="7" class="muted">No performance data found.</td></tr>';
      return;
    }

    body.innerHTML = rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.employeeName)}</td>
        <td>${escapeHtml(row.role)}</td>
        <td>${escapeHtml(row.ordersServed)}</td>
        <td>${escapeHtml(row.sales)}</td>
        <td>${escapeHtml(row.punctuality)}</td>
        <td>${escapeHtml(row.period)}</td>
        <td>
          <button type="button" data-action="edit" data-id="${row.id}">Edit</button>
          <button type="button" data-action="delete" data-id="${row.id}">Delete</button>
        </td>
      </tr>
    `).join('');
  }

  body.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const id = button.getAttribute('data-id');
    if (button.getAttribute('data-action') === 'edit') {
      const res = await fetch(`/api/employee-performance/${id}`);
      const data = await res.json();
      if (!res.ok) {
        setFormMessage(data.message || 'Unable to load the selected report.', true);
        return;
      }
      const report = data.report || {};
      selectedReportId = report.id;
      reportIdInput.value = report.id || '';
      fields.employeeName.value = report.employeeName || '';
      fields.role.value = report.role || '';
      fields.period.value = report.period || '';
      fields.ordersServed.value = report.ordersServed ?? '0';
      fields.sales.value = report.sales ?? '0';
      fields.punctuality.value = report.punctuality || '';
      fields.notes.value = report.notes || '';
      setFormMessage('Editing report. Save when ready.', false);
      return;
    }
    if (button.getAttribute('data-action') === 'delete') {
      const res = await fetch(`/api/employee-performance/${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setFormMessage(data.message || 'Unable to delete the report.', true);
        return;
      }
      setFormMessage(data.message || 'Report deleted.', false);
      await loadReports();
      resetForm();
    }
  });

  filterForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await loadReports();
  });

  editorForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const payload = {
      employeeName: fields.employeeName.value.trim(),
      role: fields.role.value.trim(),
      period: fields.period.value.trim(),
      ordersServed: Number(fields.ordersServed.value || 0),
      sales: Number(fields.sales.value || 0),
      punctuality: fields.punctuality.value.trim(),
      notes: fields.notes.value.trim(),
    };
    const url = selectedReportId ? `/api/employee-performance/${selectedReportId}` : '/api/employee-performance';
    const method = selectedReportId ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setFormMessage(data.message || 'Unable to save the report.', true);
      return;
    }
    setFormMessage(data.message || 'Report saved.', false);
    await loadReports();
    resetForm();
  });

  cancelBtn.addEventListener('click', () => {
    resetForm();
  });

  deleteBtn.addEventListener('click', async () => {
    if (!selectedReportId) {
      setFormMessage('Select a report to delete first.', true);
      return;
    }
    const res = await fetch(`/api/employee-performance/${selectedReportId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      setFormMessage(data.message || 'Unable to delete the report.', true);
      return;
    }
    setFormMessage(data.message || 'Report deleted.', false);
    await loadReports();
    resetForm();
  });

  exportBtn.addEventListener('click', async () => {
    const params = new URLSearchParams();
    const employeeName = document.getElementById('employee-name').value.trim();
    const role = document.getElementById('role').value.trim();
    const period = document.getElementById('period').value.trim();
    if (employeeName) params.set('employeeName', employeeName);
    if (role) params.set('role', role);
    if (period) params.set('period', period);
    window.location = '/api/employee-performance/export?' + params.toString();
  });

  resetForm();
  await loadReports();
})();
