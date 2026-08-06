// AM Restaurant RMIS — Sales Dashboard (SI-24).
//
// Visualisation is plain HTML/CSS: the spec says not to add a charting
// dependency unless the existing stack cannot present the comparison clearly,
// and proportional bars do that fine for share-of-revenue and peak hours.
//
// One fetch drives every panel, so all cards and charts always describe the same
// server-normalised period.

(async () => {
  const me = await window.RMIS.ready;
  if (!me) return;

  const { esc, money, api, notice } = window.RMISUI;
  const period = document.getElementById('f-period');
  const wrapFrom = document.getElementById('wrap-from');
  const wrapTo = document.getElementById('wrap-to');
  const from = document.getElementById('f-from');
  const to = document.getElementById('f-to');
  const label = document.getElementById('period-label');

  function renderKpis(s) {
    const tiles = [
      ['Gross revenue', money(s.gross), 'before refunds'],
      ['Net sales', money(s.net), `less ${money(s.refunded)} refunded`],
      ['Transactions', String(s.transactionCount), s.transactionCount === 1 ? 'bill' : 'bills'],
      ['Average order', money(s.averageOrderValue), 'per transaction'],
    ];
    document.getElementById('kpi-row').innerHTML = tiles.map(([l, v, sub]) => `
      <div class="kpi">
        <div class="kpi-label">${esc(l)}</div>
        <div class="kpi-value">${esc(v)}</div>
        <div class="kpi-sub">${esc(sub)}</div>
      </div>`).join('');
  }

  function renderTop(items) {
    const empty = document.getElementById('top-empty');
    empty.hidden = items.length > 0;
    const max = items.reduce((m, i) => Math.max(m, Number(i.revenue)), 0) || 1;
    document.getElementById('top-body').innerHTML = items.map((i) => {
      const pct = Math.round((Number(i.revenue) / max) * 100);
      return `<tr>
        <td>${esc(i.name)}</td>
        <td class="num">${esc(i.quantity)}</td>
        <td class="num">${money(i.revenue)}</td>
        <td><div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div></td>
      </tr>`;
    }).join('');
  }

  function renderHours(byHour) {
    const max = byHour.reduce((m, h) => Math.max(m, h.revenue), 0);
    document.getElementById('hour-chart').innerHTML = byHour.map((h) => {
      const pct = max ? Math.round((h.revenue / max) * 100) : 0;
      const hh = String(h.hour).padStart(2, '0');
      const peak = max && h.revenue === max ? ' is-peak' : '';
      return `<div class="hour-col" title="${hh}:00 — ${money(h.revenue)} across ${h.transactionCount} bill(s)">
                <div class="hour-bar-wrap"><div class="hour-bar${peak}" style="height:${pct}%"></div></div>
                <div class="hour-label">${hh}</div>
              </div>`;
    }).join('');
  }

  async function load() {
    const custom = period.value === 'custom';
    wrapFrom.hidden = !custom;
    wrapTo.hidden = !custom;
    if (custom && (!from.value || !to.value)) {
      label.textContent = 'Choose both dates.';
      return;
    }

    const p = new URLSearchParams({ period: period.value });
    if (custom) { p.set('from', from.value); p.set('to', to.value); }

    const { ok, data } = await api('GET', '/api/sales-dashboard?' + p.toString());
    if (!ok) {
      label.textContent = '';
      return notice('page-notice', 'warn',
        esc((data && data.message) || 'Could not load the dashboard.'));
    }
    label.textContent = `${data.period.label} (${data.period.from} to ${data.period.to})`;
    renderKpis(data.summary);
    renderTop(data.topItems || []);
    renderHours(data.byHour || []);
  }

  period.addEventListener('change', load);
  from.addEventListener('change', load);
  to.addEventListener('change', load);

  await load();
})();
