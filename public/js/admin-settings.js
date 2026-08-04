// AM Restaurant RMIS — Admin Settings page (SI-10 Roles & Permissions).
// Admin-only user management: list accounts, change roles, reset passwords,
// and delete users. Self-role/self-delete and last-admin actions are blocked
// (server-enforced; the UI also disables them and surfaces any error).

(async () => {
  const { esc, shortDate, api, openModal, closeModal, notice } = window.RMISUI;
  const me = await window.RMIS.ready;
  if (!me) return;

  const body = document.getElementById('users-body');
  const empty = document.getElementById('users-empty');
  const fSearch = document.getElementById('f-search');
  const fRole = document.getElementById('f-role');
  const ROLES = ['Admin', 'Manager', 'Cashier', 'Staff'];

  let users = [];
  let adminCount = 0;

  const roleTag = (r) => `<span class="tag ${r === 'Admin' ? 'tag-rejected' : r === 'Manager' ? 'tag-approved' : 'tag-pending'}">${esc(r)}</span>`;

  function renderKpis() {
    const by = (role) => users.filter((u) => u.role === role).length;
    const kpis = [
      { label: 'Total Users', value: users.length },
      { label: 'Admins', value: by('Admin') },
      { label: 'Managers', value: by('Manager') },
      { label: 'Cashiers / Staff', value: by('Cashier') + by('Staff') },
    ];
    document.getElementById('kpi-row').innerHTML = kpis.map((k) => `
      <div class="kpi"><div class="kpi-label">${k.label}</div><div class="kpi-value">${k.value}</div></div>`).join('');
  }

  function visibleUsers() {
    const q = fSearch.value.trim().toLowerCase();
    const role = fRole.value;
    return users.filter((u) => {
      if (role && u.role !== role) return false;
      if (q && !(u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))) return false;
      return true;
    });
  }

  function render() {
    const list = visibleUsers();
    if (!list.length) { body.innerHTML = ''; empty.hidden = false; return; }
    empty.hidden = true;
    body.innerHTML = list.map((u) => `
      <tr>
        <td>${esc(u.fullName)}${u.isSelf ? ' <span class="muted">(you)</span>' : ''}</td>
        <td>${esc(u.email)}</td>
        <td>${roleTag(u.role)}</td>
        <td>${shortDate(u.createdAt)}</td>
        <td><button class="btn-ghost btn-sm" data-manage="${u.id}">Manage</button></td>
      </tr>`).join('');
  }

  async function load() {
    const { data } = await api('GET', '/api/admin/users');
    users = data.users || [];
    adminCount = data.adminCount || 0;
    renderKpis();
    render();
  }

  function openManage(id) {
    const u = users.find((x) => x.id === id);
    if (!u) return;
    const lastAdmin = u.role === 'Admin' && adminCount <= 1;
    const roleLocked = u.isSelf || lastAdmin;
    const deleteLocked = u.isSelf || lastAdmin;

    openModal(`
      <div class="modal-head"><h2>Manage &mdash; ${esc(u.fullName)}</h2><button class="modal-close" data-close>&times;</button></div>
      <div class="modal-body">
        <p class="muted" style="margin-bottom:14px">${esc(u.email)}</p>

        <div class="field-inline" style="margin-bottom:8px"><label>Role</label>
          <select class="rmis-select" id="m-role" ${roleLocked ? 'disabled' : ''}>
            ${ROLES.map((r) => `<option value="${r}"${r === u.role ? ' selected' : ''}>${r}</option>`).join('')}
          </select>
        </div>
        ${u.isSelf ? '<p class="muted" style="font-size:12px;margin-bottom:12px">You cannot change your own role.</p>'
          : lastAdmin ? '<p class="muted" style="font-size:12px;margin-bottom:12px">This is the last Admin — role is locked.</p>' : ''}
        <button type="button" class="btn-primary btn-sm" id="m-save-role" ${roleLocked ? 'disabled' : ''}>Save role</button>

        <div class="side-section" style="padding:0;margin:20px 0 8px">Reset password</div>
        <div class="field-inline" style="margin-bottom:8px"><label>New temporary password</label>
          <input class="rmis-input" id="m-pass" type="text" placeholder="At least 8 characters" autocomplete="new-password"></div>
        <button type="button" class="btn-ghost btn-sm" id="m-reset">Reset password</button>

        <div class="field-err" id="m-err" style="margin-top:14px"></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn-ghost" data-close>Close</button>
        <button type="button" class="btn-ghost" id="m-delete" ${deleteLocked ? 'disabled title="Cannot delete this account"' : ''}
          style="${deleteLocked ? '' : 'color:#a5311f;border-color:#e0a89d'}">Delete user</button>
      </div>`);

    const err = () => document.getElementById('m-err');

    if (!roleLocked) {
      document.getElementById('m-save-role').addEventListener('click', async () => {
        const role = document.getElementById('m-role').value;
        const { ok, data } = await api('PATCH', `/api/admin/users/${id}/role`, { role });
        if (!ok) { err().textContent = data.message || 'Could not update role.'; return; }
        closeModal();
        await load();
        notice('page-notice', 'ok', `Role updated to <strong>${esc(data.user.role)}</strong> for ${esc(data.user.fullName)}.`);
      });
    }

    document.getElementById('m-reset').addEventListener('click', async () => {
      const newPassword = document.getElementById('m-pass').value;
      err().textContent = '';
      const { ok, data } = await api('POST', `/api/admin/users/${id}/reset-password`, { newPassword });
      if (!ok) { err().textContent = data.message || 'Could not reset password.'; return; }
      closeModal();
      notice('page-notice', 'ok', esc(data.message) + ' Share the temporary password securely.');
    });

    if (!deleteLocked) {
      document.getElementById('m-delete').addEventListener('click', async () => {
        if (!window.confirm(`Delete ${u.fullName}'s account? This cannot be undone.`)) return;
        const { ok, data } = await api('DELETE', `/api/admin/users/${id}`);
        if (!ok) { err().textContent = data.message || 'Could not delete user.'; return; }
        closeModal();
        await load();
        notice('page-notice', 'ok', esc(data.message || 'User deleted.'));
      });
    }
  }

  body.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-manage]');
    if (btn) openManage(Number(btn.dataset.manage));
  });
  fSearch.addEventListener('input', render);
  fRole.addEventListener('change', render);

  await load();
})();
