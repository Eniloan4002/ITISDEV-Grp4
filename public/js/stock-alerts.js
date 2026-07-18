// AM Restaurant RMIS — Stock Alerts page (Sprint 2).
// Dedicated view of every ingredient at or below its reorder level (or out of
// stock). Computed live from current quantities, so it always reflects the
// latest receiving / consumption / adjustment activity. Refresh re-queries.

(async () => {
  const { esc, fmt, api } = window.RMISUI;
  const me = await window.RMIS.ready;
  if (!me) return;

  const canManage = me.role === 'Admin' || me.role === 'Manager';
  if (!canManage) {
    document.getElementById('nav-adjust')?.remove();
    document.getElementById('nav-po')?.remove();
  }

  const body = document.getElementById('alerts-body');
  const emptyEl = document.getElementById('alerts-empty');
  const allClear = document.getElementById('all-clear');

  function statusTag(it) {
    return it.status === 'out'
      ? '<span class="tag tag-out">Out of stock</span>'
      : '<span class="tag tag-low">Low stock</span>';
  }

  function render(alerts) {
    const out = alerts.filter((a) => a.status === 'out').length;
    const low = alerts.filter((a) => a.status === 'low').length;
    document.getElementById('kpi-row').innerHTML = [
      { label: 'Alerts', value: alerts.length },
      { label: 'Low Stock', value: low },
      { label: 'Out of Stock', value: out },
    ].map((k) => `<div class="kpi"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div></div>`).join('');

    if (!alerts.length) {
      body.innerHTML = '';
      emptyEl.hidden = false;
      allClear.hidden = false;
      return;
    }
    emptyEl.hidden = true;
    allClear.hidden = true;
    body.innerHTML = alerts.map((it) => {
      const shortfall = Math.max(0, it.reorderLevel - it.quantity);
      return `<tr class="${it.status === 'out' ? 'row-out' : 'row-low'}">
        <td>${esc(it.name)}</td>
        <td>${it.category ? esc(it.category) : '<span class="muted">&mdash;</span>'}</td>
        <td>${it.supplier ? esc(it.supplier) : '<span class="muted">&mdash;</span>'}</td>
        <td class="num">${fmt(it.quantity)} ${esc(it.unit)}</td>
        <td class="num">${fmt(it.reorderLevel)}</td>
        <td class="num">${fmt(shortfall)}</td>
        <td>${statusTag(it)}</td>
      </tr>`;
    }).join('');
  }

  async function load() {
    const { data } = await api('GET', '/api/alerts');
    render(data.alerts || []);
  }

  document.getElementById('btn-refresh').addEventListener('click', load);
  await load();
})();
