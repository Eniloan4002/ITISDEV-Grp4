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
const { hashPassword } = require('./password');

const ROLES = ['Admin', 'Manager', 'Cashier', 'Staff'];

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}
function requireAdmin(req, res, getSession) {
  const s = getSession(req);
  if (!s) { sendJson(res, 401, { message: 'Not authenticated.' }); return null; }
  if (s.role !== 'Admin') { sendJson(res, 403, { message: 'Admin access required.' }); return null; }
  return s;
}

function serializeUser(u, meId) {
  return {
    id: u.id, fullName: u.full_name, email: u.email, role: u.role,
    contactNumber: u.contact_number, createdAt: u.created_at, isSelf: u.id === meId,
  };
}

function getUsers(req, res, getSession) {
  const s = requireAdmin(req, res, getSession);
  if (!s) return;
  // listUsers only returns id/name/email/role; re-read full rows for created_at.
  const users = dbApi.listUsers().map((u) => serializeUser(dbApi.findUserById(u.id), s.userId));
  sendJson(res, 200, { users, adminCount: dbApi.countAdmins() });
}

async function patchRole(req, res, getSession, id) {
  const s = requireAdmin(req, res, getSession);
  if (!s) return;
  const target = dbApi.findUserById(id);
  if (!target) return sendJson(res, 404, { message: 'User not found.' });
  if (target.id === s.userId) return sendJson(res, 400, { message: 'You cannot change your own role.' });
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }
  const role = data.role;
  if (!ROLES.includes(role)) return sendJson(res, 400, { message: 'Choose a valid role.' });
  // Never demote the last remaining Admin.
  if (target.role === 'Admin' && role !== 'Admin' && dbApi.countAdmins() <= 1) {
    return sendJson(res, 400, { message: 'Cannot change the role of the last remaining Admin.' });
  }
  dbApi.updateUserRole(id, role);
  sendJson(res, 200, { user: serializeUser(dbApi.findUserById(id), s.userId) });
}

async function resetPassword(req, res, getSession, id) {
  const s = requireAdmin(req, res, getSession);
  if (!s) return;
  const target = dbApi.findUserById(id);
  if (!target) return sendJson(res, 404, { message: 'User not found.' });
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }
  const newPassword = data.newPassword || '';
  if (newPassword.length < 8) {
    return sendJson(res, 400, { message: 'Temporary password must be at least 8 characters.', errors: { newPassword: 'At least 8 characters.' } });
  }
  dbApi.updatePassword(id, hashPassword(newPassword));
  sendJson(res, 200, { message: `Password reset for ${target.full_name}.` });
}

function deleteUser(req, res, getSession, id) {
  const s = requireAdmin(req, res, getSession);
  if (!s) return;
  const target = dbApi.findUserById(id);
  if (!target) return sendJson(res, 404, { message: 'User not found.' });
  if (target.id === s.userId) return sendJson(res, 400, { message: 'You cannot delete your own account.' });
  if (target.role === 'Admin' && dbApi.countAdmins() <= 1) {
    return sendJson(res, 400, { message: 'Cannot delete the last remaining Admin.' });
  }
  dbApi.deleteUser(id);
  sendJson(res, 200, { ok: true, message: `Deleted ${target.full_name}.` });
}

async function route(req, res, getSession) {
  const p = req.url.split('?')[0];
  const method = req.method;
  if (!p.startsWith('/api/admin/')) return false;

  if (p === '/api/admin/users' && method === 'GET') { getUsers(req, res, getSession); return true; }
  let m;
  if ((m = p.match(/^\/api\/admin\/users\/(\d+)\/role$/)) && method === 'PATCH') { await patchRole(req, res, getSession, Number(m[1])); return true; }
  if ((m = p.match(/^\/api\/admin\/users\/(\d+)\/reset-password$/)) && method === 'POST') { await resetPassword(req, res, getSession, Number(m[1])); return true; }
  if ((m = p.match(/^\/api\/admin\/users\/(\d+)$/)) && method === 'DELETE') { deleteUser(req, res, getSession, Number(m[1])); return true; }

  return false;
}

module.exports = { route };
