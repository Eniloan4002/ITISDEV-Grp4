// AM Restaurant RMIS — Schedules page (Sprint 3, Attendance & Manpower).
// Story: create and manage employee work schedules.
//   - managers assign shifts (employee, date, start, end); overlaps are blocked
//   - managers edit / remove shifts; employees see their own schedule read-only
//   - approved leave is reflected in the schedule (shown as "On leave" rows)

(async () => {
  const { esc, api, shortDate, openModal, closeModal, notice } = window.RMISUI;
  const me = await window.RMIS.ready;
  if (!me) return;
  const isManager = me.role === 'Admin' || me.role === 'Manager';

  const body = document.getElementById('sched-body');
  const empty = document.getElementById('sched-empty');
  const fEmp = document.getElementById('f-emp');
  const fDate = document.getElementById('f-date');
  let employees = [];

  // 'HH:MM' (24h) -> 'h:MM AM/PM'
  function fmtTime(hhmm) {
    if (!hhmm) return '';
    const [h, m] = hhmm.split(':').map(Number);
    const ap = h < 12 ? 'AM' : 'PM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ap}`;
  }

  function empOptions(selectedId) {
    return employees.map((e) => `<option value="${e.id}"${e.id === selectedId ? ' selected' : ''}>${esc(e.name)} (${esc(e.role)})</option>`).join('');
  }

  function render(shifts, leave) {
    // Merge shifts + approved leave into one date-sorted timeline.
    const rows = [];
    shifts.forEach((s) => rows.push({ kind: 'shift', date: s.date, sort: s.date + s.start, data: s }));
    leave.forEach((l) => rows.push({ kind: 'leave', date: l.startDate, sort: l.startDate + '00:00', data: l }));
    rows.sort((a, b) => (a.sort < b.sort ? -1 : a.sort > b.sort ? 1 : 0));

    if (!rows.length) { body.innerHTML = ''; empty.hidden = false; return; }
    empty.hidden = true;
    body.innerHTML = rows.map((r) => {
      if (r.kind === 'leave') {
        const l = r.data;
        const range = l.startDate === l.endDate ? shortDate(l.startDate) : `${shortDate(l.startDate)} → ${shortDate(l.endDate)}`;
        return `<tr class="row-leave">
          <td>${range}</td>
          <td>${esc(l.employee)}</td>
          <td>On leave${l.reason ? ' — ' + esc(l.reason) : ''}</td>
          <td><span class="tag tag-approved">Leave (${esc(l.type)})</span></td>
          <td></td>
        </tr>`;
      }
      const s = r.data;
      const actions = isManager
        ? `<div class="row-actions">
             <button class="btn-ghost btn-sm" data-edit="${s.id}">Edit</button>
             <button class="btn-ghost btn-sm" data-del="${s.id}">Remove</button>
           </div>`
        : '';
      return `<tr>
        <td>${shortDate(s.date)}</td>
        <td>${esc(s.employee)}</td>
        <td>${fmtTime(s.start)} – ${fmtTime(s.end)}</td>
        <td><span class="tag tag-ok">Shift</span></td>
        <td>${actions}</td>
      </tr>`;
    }).join('');
  }

  let cache = { shifts: [], leave: [] };
  async function load() {
    const p = new URLSearchParams();
    if (isManager && fEmp.value) p.set('employee', fEmp.value);
    if (fDate.value) p.set('date', fDate.value);
    const { data } = await api('GET', '/api/shifts?' + p.toString());
    cache = { shifts: data.shifts || [], leave: data.leave || [] };
    render(cache.shifts, cache.leave);
  }

  // ---- manager: create + edit ----
  if (isManager) {
    document.getElementById('create-card').hidden = false;
    document.getElementById('filter-emp-wrap').hidden = false;
    document.getElementById('th-actions').textContent = 'Actions';
    const { data } = await api('GET', '/api/employees');
    employees = data.employees || [];
    document.getElementById('s-emp').innerHTML = '<option value="">— select —</option>' + empOptions();
    fEmp.innerHTML = '<option value="">All employees</option>' + empOptions();
    fEmp.addEventListener('change', load);

    document.getElementById('shift-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const payload = { employeeId: Number(f.employeeId.value), date: f.date.value, start: f.start.value, end: f.end.value };
      const errEl = document.getElementById('shift-err');
      errEl.textContent = '';
      if (!payload.employeeId) { errEl.textContent = 'Choose an employee.'; return; }
      document.getElementById('shift-submit').disabled = true;
      const { ok, data: d } = await api('POST', '/api/shifts', payload);
      document.getElementById('shift-submit').disabled = false;
      if (!ok) { errEl.textContent = d.message || 'Could not save shift.'; return; }
      f.reset();
      notice('page-notice', 'ok', `Shift assigned to <strong>${esc(d.shift.employee)}</strong> on ${shortDate(d.shift.date)}.`);
      await load();
    });
  }

  function openEdit(id) {
    const s = cache.shifts.find((x) => x.id === id);
    if (!s) return;
    openModal(`
      <div class="modal-head"><h2>Edit shift</h2><button class="modal-close" data-close>&times;</button></div>
      <form id="edit-form" novalidate>
        <div class="modal-body">
          <div class="form-grid">
            <div class="field-inline"><label>Employee *</label>
              <select class="rmis-select" name="employeeId">${empOptions(s.userId)}</select></div>
            <div class="field-inline"><label>Date *</label>
              <input class="rmis-input" name="date" type="date" value="${esc(s.date)}"></div>
            <div class="field-inline"><label>Start time *</label>
              <input class="rmis-input" name="start" type="time" value="${esc(s.start)}"></div>
            <div class="field-inline"><label>End time *</label>
              <input class="rmis-input" name="end" type="time" value="${esc(s.end)}"></div>
          </div>
          <div class="field-err" id="edit-err"></div>
        </div>
        <div class="modal-foot">
          <button type="button" class="btn-ghost" data-close>Cancel</button>
          <button type="submit" class="btn-primary" id="edit-submit">Save changes</button>
        </div>
      </form>`);
    document.getElementById('edit-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const f = e.target;
      const payload = { employeeId: Number(f.employeeId.value), date: f.date.value, start: f.start.value, end: f.end.value };
      document.getElementById('edit-submit').disabled = true;
      const { ok, data: d } = await api('PATCH', `/api/shifts/${id}`, payload);
      document.getElementById('edit-submit').disabled = false;
      if (!ok) { document.getElementById('edit-err').textContent = d.message || 'Could not update shift.'; return; }
      closeModal();
      notice('page-notice', 'ok', 'Shift updated.');
      await load();
    });
  }

  async function removeShift(id) {
    const s = cache.shifts.find((x) => x.id === id);
    if (!s) return;
    if (!window.confirm(`Remove ${s.employee}'s shift on ${shortDate(s.date)}?`)) return;
    const { ok, data: d } = await api('DELETE', `/api/shifts/${id}`);
    if (!ok) { notice('page-notice', 'err', esc(d.message || 'Could not remove shift.')); return; }
    notice('page-notice', 'ok', 'Shift removed.');
    await load();
  }

  body.addEventListener('click', (e) => {
    const edit = e.target.closest('button[data-edit]');
    const del = e.target.closest('button[data-del]');
    if (edit) openEdit(Number(edit.dataset.edit));
    else if (del) removeShift(Number(del.dataset.del));
  });
  fDate.addEventListener('change', load);
  document.getElementById('f-clear').addEventListener('click', () => { if (isManager) fEmp.value = ''; fDate.value = ''; load(); });

  await load();
})();
