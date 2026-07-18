// AM Restaurant RMIS — Time Clock page (Sprint 3, Attendance & Manpower).
// Story: record employee time-in / time-out logs.
//   - one-click clock in / out; only one open shift at a time (server-enforced)
//   - my own logs table (date, in, out, hours)
//   - managers additionally get everyone's logs, searchable by employee + date
// Open to all employees; the "All employee logs" section is manager-only.

(async () => {
  const { esc, api, shortDate, notice } = window.RMISUI;
  const me = await window.RMIS.ready;
  if (!me) return;
  const isManager = me.role === 'Admin' || me.role === 'Manager';

  // ---- live wall clock ----
  const timeEl = document.getElementById('clock-time');
  const dateEl = document.getElementById('clock-date');
  function tick() {
    const now = new Date();
    timeEl.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    dateEl.textContent = now.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }
  tick();
  setInterval(tick, 1000);

  function fmtTime(iso) {
    if (!iso) return '<span class="muted">&mdash;</span>';
    return new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }
  function hours(inIso, outIso) {
    if (!inIso || !outIso) return '<span class="muted">&mdash;</span>';
    const h = (new Date(outIso) - new Date(inIso)) / 3600000;
    return (Math.round(h * 100) / 100).toFixed(2);
  }

  const btnIn = document.getElementById('btn-in');
  const btnOut = document.getElementById('btn-out');
  const stateEl = document.getElementById('clock-state');
  const myBody = document.getElementById('my-logs');
  const myEmpty = document.getElementById('my-empty');

  function renderState(open) {
    if (open) {
      stateEl.textContent = 'Clocked in at ' + new Date(open.timeIn).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
      stateEl.className = 'clock-state on';
      btnIn.disabled = true;
      btnOut.disabled = false;
    } else {
      stateEl.textContent = 'Not clocked in';
      stateEl.className = 'clock-state off';
      btnIn.disabled = false;
      btnOut.disabled = true;
    }
  }

  function renderMyLogs(logs) {
    if (!logs.length) { myBody.innerHTML = ''; myEmpty.hidden = false; return; }
    myEmpty.hidden = true;
    myBody.innerHTML = logs.map((r) => `
      <tr${r.open ? ' class="row-low"' : ''}>
        <td>${shortDate(r.date)}</td>
        <td>${fmtTime(r.timeIn)}</td>
        <td>${r.open ? '<span class="tag tag-pending">In progress</span>' : fmtTime(r.timeOut)}</td>
        <td class="num">${hours(r.timeIn, r.timeOut)}</td>
      </tr>`).join('');
  }

  async function loadMine() {
    const { data } = await api('GET', '/api/attendance/me');
    renderState(data.open);
    renderMyLogs(data.logs || []);
  }

  btnIn.addEventListener('click', async () => {
    btnIn.disabled = true;
    const { ok, data } = await api('POST', '/api/attendance/time-in');
    if (!ok) { notice('page-notice', 'err', esc(data.message || 'Could not clock in.')); btnIn.disabled = false; return; }
    notice('page-notice', 'ok', 'Timed in at ' + new Date(data.record.timeIn).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) + '.');
    await loadMine();
    if (isManager) loadAll();
  });

  btnOut.addEventListener('click', async () => {
    btnOut.disabled = true;
    const { ok, data } = await api('POST', '/api/attendance/time-out');
    if (!ok) { notice('page-notice', 'err', esc(data.message || 'Could not clock out.')); btnOut.disabled = false; return; }
    notice('page-notice', 'ok', 'Timed out at ' + new Date(data.record.timeOut).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) + '.');
    await loadMine();
    if (isManager) loadAll();
  });

  // ---- manager: all logs ----
  const allBody = document.getElementById('all-logs');
  const allEmpty = document.getElementById('all-empty');
  const fEmp = document.getElementById('f-emp');
  const fDate = document.getElementById('f-date');

  async function loadAll() {
    const p = new URLSearchParams();
    if (fEmp.value) p.set('employee', fEmp.value);
    if (fDate.value) p.set('date', fDate.value);
    const { data } = await api('GET', '/api/attendance?' + p.toString());
    const logs = data.logs || [];
    if (!logs.length) { allBody.innerHTML = ''; allEmpty.hidden = false; return; }
    allEmpty.hidden = true;
    allBody.innerHTML = logs.map((r) => `
      <tr>
        <td>${esc(r.employee)}</td>
        <td>${shortDate(r.date)}</td>
        <td>${fmtTime(r.timeIn)}</td>
        <td>${r.open ? '<span class="tag tag-pending">In progress</span>' : fmtTime(r.timeOut)}</td>
        <td class="num">${hours(r.timeIn, r.timeOut)}</td>
        <td>${r.open ? '<span class="tag tag-low">Open</span>' : '<span class="tag tag-ok">Complete</span>'}</td>
      </tr>`).join('');
  }

  if (isManager) {
    document.getElementById('mgr-section').hidden = false;
    const { data } = await api('GET', '/api/employees');
    fEmp.innerHTML = '<option value="">All employees</option>' +
      (data.employees || []).map((e) => `<option value="${e.id}">${esc(e.name)} (${esc(e.role)})</option>`).join('');
    fEmp.addEventListener('change', loadAll);
    fDate.addEventListener('change', loadAll);
    document.getElementById('f-clear').addEventListener('click', () => { fEmp.value = ''; fDate.value = ''; loadAll(); });
    await loadAll();
  }

  await loadMine();
})();
