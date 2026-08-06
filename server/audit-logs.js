const dbApi = require('./db');
const { sendJson, readJson, requireRole } = require('./http-util');

const AUDIT_ROLES = ['Admin'];

function canMutateAuditLogs(method) {
  return method === 'GET';
}

async function listLogs(req, res, getSession, query) {
  const s = requireRole(req, res, getSession, AUDIT_ROLES, 'Admin access required.');
  if (!s) return;

  try {
    const rows = await dbApi.listAuditLogs({ keyword: (query.get('keyword') || '').trim() });
    sendJson(res, 200, { logs: rows });
  } catch (err) {
    console.error('[audit-logs:list] failed:', err);
    sendJson(res, 500, { message: 'Could not load audit logs.' });
  }
}

async function route(req, res, getSession) {
  const parsed = new URL(req.url, 'http://localhost');
  const p = parsed.pathname;
  const method = req.method;
  if (!p.startsWith('/api/audit-logs')) return false;

  if (p === '/api/audit-logs' && method === 'GET') { await listLogs(req, res, getSession, parsed.searchParams); return true; }
  if (p === '/api/audit-logs' && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
    sendJson(res, 405, { message: 'Audit logs are read-only.' });
    return true;
  }
  if (p.startsWith('/api/audit-logs/') && (method === 'POST' || method === 'PUT' || method === 'DELETE')) {
    sendJson(res, 405, { message: 'Audit logs are read-only.' });
    return true;
  }
  return false;
}

module.exports = { route, canMutateAuditLogs };
