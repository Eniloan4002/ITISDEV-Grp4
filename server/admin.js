// AM Restaurant RMIS — Admin Settings API (SI-10 Roles & Permissions).
//
// User & role administration, Admin-only. index.js delegates /api/admin/* here.
//   GET    /api/admin/users                     list all accounts
//   PATCH  /api/admin/users/:id/role            change a user's role
//   POST   /api/admin/users/:id/reset-password  set a new temporary password
//   DELETE /api/admin/users/:id                 remove an account
//
// Safeguards: an admin cannot change their own role or delete their own
// account here, and the LAST remaining Admin can never be demoted or deleted
// (prevents locking the whole system out of administration).

const dbApi = require('./db');
const { sendJson, readJson, requireAdmin } = require('./http-util');
const audit = require('./audit');
const { hashPassword } = require('./password');

const ROLES = ['Admin', 'Manager', 'Cashier', 'Staff'];

function serializeUser(u, meId) {
  return {
    id: u.id, fullName: u.full_name, email: u.email, role: u.role,
    contactNumber: u.contact_number, createdAt: u.created_at, isSelf: u.id === meId,
  };
}

async function getUsers(req, res, getSession) {
  const s = requireAdmin(req, res, getSession);
  if (!s) return;
  // listUsers only returns id/name/email/role; re-read full rows for created_at.
  const rows = await dbApi.listUsers();
  const users = await Promise.all(
    rows.map(async (u) => serializeUser(await dbApi.findUserById(u.id), s.userId))
  );
  sendJson(res, 200, { users, adminCount: await dbApi.countAdmins() });
}

async function patchRole(req, res, getSession, id) {
  const s = requireAdmin(req, res, getSession);
  if (!s) return;
  const target = await dbApi.findUserById(id);
  if (!target) return sendJson(res, 404, { message: 'User not found.' });
  if (target.id === s.userId) return sendJson(res, 400, { message: 'You cannot change your own role.' });
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }
  const role = data.role;
  if (!ROLES.includes(role)) return sendJson(res, 400, { message: 'Choose a valid role.' });
  // Never demote the last remaining Admin.
  if (target.role === 'Admin' && role !== 'Admin' && await dbApi.countAdmins() <= 1) {
    return sendJson(res, 400, { message: 'Cannot change the role of the last remaining Admin.' });
  }
  await dbApi.updateUserRole(id, role);
  audit.record(req, { userId: s.userId, email: s.email }, 'ROLE_CHANGED', 'account_roles',
    `${target.email}: ${target.role} -> ${role}.`);
  sendJson(res, 200, { user: serializeUser(await dbApi.findUserById(id), s.userId) });
}

async function resetPassword(req, res, getSession, id) {
  const s = requireAdmin(req, res, getSession);
  if (!s) return;
  const target = await dbApi.findUserById(id);
  if (!target) return sendJson(res, 404, { message: 'User not found.' });
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }
  const newPassword = data.newPassword || '';
  if (newPassword.length < 8) {
    return sendJson(res, 400, { message: 'Temporary password must be at least 8 characters.', errors: { newPassword: 'At least 8 characters.' } });
  }
  await dbApi.updatePassword(id, hashPassword(newPassword));
  audit.record(req, { userId: s.userId, email: s.email }, 'PASSWORD_RESET', 'accounts',
    `Admin reset the password for ${target.email}.`);
  sendJson(res, 200, { message: `Password reset for ${target.full_name}.` });
}

async function deleteUser(req, res, getSession, id) {
  const s = requireAdmin(req, res, getSession);
  if (!s) return;
  const target = await dbApi.findUserById(id);
  if (!target) return sendJson(res, 404, { message: 'User not found.' });
  if (target.id === s.userId) return sendJson(res, 400, { message: 'You cannot delete your own account.' });
  if (target.role === 'Admin' && await dbApi.countAdmins() <= 1) {
    return sendJson(res, 400, { message: 'Cannot delete the last remaining Admin.' });
  }
  await dbApi.deleteUser(id);
  audit.record(req, { userId: s.userId, email: s.email }, 'USER_DEACTIVATED', 'accounts',
    `Deactivated ${target.email} (${target.role}).`);
  sendJson(res, 200, { ok: true, message: `Deleted ${target.full_name}.` });
}

async function route(req, res, getSession) {
  const p = req.url.split('?')[0];
  const method = req.method;
  if (!p.startsWith('/api/admin/')) return false;

  if (p === '/api/admin/users' && method === 'GET') { await getUsers(req, res, getSession); return true; }
  let m;
  if ((m = p.match(/^\/api\/admin\/users\/(\d+)\/role$/)) && method === 'PATCH') { await patchRole(req, res, getSession, Number(m[1])); return true; }
  if ((m = p.match(/^\/api\/admin\/users\/(\d+)\/reset-password$/)) && method === 'POST') { await resetPassword(req, res, getSession, Number(m[1])); return true; }
  if ((m = p.match(/^\/api\/admin\/users\/(\d+)$/)) && method === 'DELETE') { await deleteUser(req, res, getSession, Number(m[1])); return true; }

  return false;
}

module.exports = { route };
