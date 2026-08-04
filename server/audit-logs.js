const dbApi = require('./db');

const AUDIT_ROLES = ['Admin'];

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

function requireRole(req, res, getSession, roles) {
  const s = getSession(req);
  if (!s) { sendJson(res, 401, { message: 'Not authenticated.' }); return null; }
  if (!roles.includes(s.role)) { sendJson(res, 403, { message: 'Admin access required.' }); return null; }
  return s;
}

function canMutateAuditLogs(method) {
  return method === 'GET';
}

async function listLogs(req, res, getSession, query) {
  const s = requireRole(req, res, getSession, AUDIT_ROLES);
  if (!s) return;

  try {
    const rows = await dbApi.listAuditLogs({ keyword: (query.get('keyword') || '').trim() });
    sendJson(res, 200, { logs: rows });
  } catch (err) {
    console.error('[audit-logs:list] failed:', err);
    sendJson(res, 500, { message: 'Could not load audit logs.' });
  }
}

async function createLog(req, res, getSession) {
  const s = requireRole(req, res, getSession, AUDIT_ROLES);
  if (!s) return;

  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }

  if (!data.actionType) return sendJson(res, 400, { message: 'Action type is required.' });

  try {
    const id = await dbApi.createAuditLog({
      userId: s.userId,
      userEmail: s.email,
      actionType: data.actionType,
      target: data.target || 'system',
      details: data.details || '',
      ipAddress: data.ipAddress || '127.0.0.1',
    });
    sendJson(res, 201, { message: 'Audit entry recorded.', id });
  } catch (err) {
    console.error('[audit-logs:create] failed:', err);
    sendJson(res, 500, { message: 'Could not record the audit entry.' });
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
