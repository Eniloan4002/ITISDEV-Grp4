// AM Restaurant RMIS — Leave Requests page (Sprint 3, Attendance & Manpower).
// Story: employees submit leave for approval.
//   - anyone files a request (type, start, end, reason) -> status Pending
//   - managers view all requests and Approve / Reject them
//   - employees see the current status of their own requests
//   - approved leave is reflected on the Schedules page (see schedules.js)

(async () => {
  const { esc, api, shortDate, notice } = window.RMISUI;
  const me = await window.RMIS.ready;
  if (!me) return;
  const isManager = me.role === 'Admin' || me.role === 'Manager';

  const body = document.getElementById('leave-body');
  const empty = document.getElementById('leave-empty');
  const fStatus = document.getElementById('f-status');
  const fEmp = document.getElementById('f-emp');

  const STATUS_TAG = { Pending: 'tag-pending', Approved: 'tag-approved', Rejected: 'tag-rejected' };
  function statusTag(s) { return `<span class="tag ${STATUS_TAG[s] || 'tag-pending'}">${esc(s)}</span>`; }

  function render(requests) {
    if (!requests.length) { body.innerHTML = ''; empty.hidden = false; return; }
    empty.hidden = true;
    body.innerHTML = requests.map((r) => {
      const range = r.startDate === r.endDate ? shortDate(r.startDate) : `${shortDate(r.startDate)} → ${shortDate(r.endDate)}`;
      const empCell = isManager ? `<td>${esc(r.employee)}</td>` : '';
      const actions = (isManager && r.status === 'Pending')
        ? `<div class="row-actions">
             <button class="btn-ghost btn-sm" data-approve="${r.id}">Approve</button>
             <button class="btn-ghost btn-sm" data-reject="${r.id}">Reject</button>
           </div>`
        : (r.reviewedBy ? '' : '<span class="muted">—</span>');
      return `<tr>
        ${empCell}
        <td>${esc(r.type)}</td>
        <td>${range}</td>
        <td>${esc(r.reason)}</td>
        <td>${statusTag(r.status)}</td>
        <td>${r.reviewedBy ? esc(r.reviewedBy) : '<span class="muted">—</span>'}</td>
        <td>${actions}</td>
      </tr>`;
    }).join('');
  }

  async function load() {
    const p = new URLSearchParams();
    if (fStatus.value) p.set('status', fStatus.value);
    if (isManager && fEmp.value) p.set('employee', fEmp.value);
    const { data } = await api('GET', '/api/leave?' + p.toString());
    render(data.requests || []);
  }

  document.getElementById('leave-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target;
    const payload = {
      leaveType: f.leaveType.value, startDate: f.startDate.value,
      endDate: f.endDate.value, reason: f.reason.value,
    };
    const errEl = document.getElementById('leave-err');
    errEl.textContent = '';
    document.getElementById('leave-submit').disabled = true;
    const { ok, data } = await api('POST', '/api/leave', payload);
    document.getElementById('leave-submit').disabled = false;
    if (!ok) { errEl.textContent = data.message || 'Could not submit request.'; return; }
    f.reset();
    notice('page-notice', 'ok', `Leave request submitted — status <strong>${esc(data.request.status)}</strong>.`);
    await load();
  });

  async function review(id, status) {
    const { ok, data } = await api('PATCH', `/api/leave/${id}`, { status });
    if (!ok) { notice('page-notice', 'err', esc(data.message || 'Could not update request.')); return; }
    notice('page-notice', 'ok', `Request ${esc(data.request.status.toLowerCase())} for <strong>${esc(data.request.employee)}</strong>.`);
    await load();
  }

  body.addEventListener('click', (e) => {
    const ap = e.target.closest('button[data-approve]');
    const rj = e.target.closest('button[data-reject]');
    if (ap) review(Number(ap.dataset.approve), 'Approved');
    else if (rj) review(Number(rj.dataset.reject), 'Rejected');
  });

  // Manager view: show employee column + filter, and re-label the list.
  if (isManager) {
    document.getElementById('list-head').textContent = 'All leave requests';
    document.getElementById('th-emp').hidden = false;
    document.getElementById('th-actions').textContent = 'Actions';
    document.getElementById('filter-emp-wrap').hidden = false;
    const { data } = await api('GET', '/api/employees');
    fEmp.innerHTML = '<option value="">All employees</option>' +
      (data.employees || []).map((emp) => `<option value="${emp.id}">${esc(emp.name)} (${esc(emp.role)})</option>`).join('');
    fEmp.addEventListener('change', load);
  }
  fStatus.addEventListener('change', load);
  document.getElementById('f-clear').addEventListener('click', () => { fStatus.value = ''; if (isManager) fEmp.value = ''; load(); });

  await load();
})();
