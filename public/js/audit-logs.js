(async () => {
  const me = await window.RMIS.ready;
  if (!me) return;

  const body = document.getElementById('audit-body');
  const filterForm = document.getElementById('audit-filter');
  const refreshBtn = document.getElementById('refresh-logs');

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  }

  async function loadLogs() {
    const params = new URLSearchParams();
    const keyword = document.getElementById('audit-keyword').value.trim();
    if (keyword) params.set('keyword', keyword);

    const res = await fetch('/api/audit-logs?' + params.toString(), { method: 'GET' });
    const data = await res.json();
    if (!res.ok) {
      body.innerHTML = `<tr><td colspan="6" class="muted">${data.message || 'Unable to load audit logs.'}</td></tr>`;
      return;
    }

    const logs = data.logs || [];
    if (!logs.length) {
      body.innerHTML = '<tr><td colspan="6" class="muted">No audit entries found.</td></tr>';
      return;
    }

    body.innerHTML = logs.map((log) => `
      <tr>
        <td>${escapeHtml(log.timestamp)}</td>
        <td>${escapeHtml(log.userEmail || log.userId)}</td>
        <td>${escapeHtml(log.actionType)}</td>
        <td>${escapeHtml(log.target)}</td>
        <td>${escapeHtml(log.details)}</td>
        <td>${escapeHtml(log.ipAddress)}</td>
      </tr>
    `).join('');
  }

  filterForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await loadLogs();
  });

  refreshBtn.addEventListener('click', async () => {
    document.getElementById('audit-keyword').value = '';
    await loadLogs();
  });

  await loadLogs();
})();
