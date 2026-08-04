const dbApi = require('./db');

const REFUND_ROLES = ['Admin', 'Manager', 'Cashier'];

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
  if (!roles.includes(s.role)) { sendJson(res, 403, { message: 'You do not have access to this action.' }); return null; }
  return s;
}

function validateRefundPayload(data = {}) {
  const errors = {};
  if (!Array.isArray(data.items) || !data.items.length) errors.items = 'Select at least one item to refund.';
  if (!String(data.reason || '').trim()) errors.reason = 'Refund reason is required.';
  return errors;
}

async function createRefund(req, res, getSession) {
  const s = requireRole(req, res, getSession, REFUND_ROLES);
  if (!s) return;
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }

  const errors = validateRefundPayload(data);
  if (Object.keys(errors).length) return sendJson(res, 400, { message: 'Please correct the highlighted fields.', errors });

  sendJson(res, 201, { id: Date.now(), message: 'Refund submitted for review.' });
}

async function listPending(req, res, getSession) {
  const s = requireRole(req, res, getSession, ['Admin', 'Manager']);
  if (!s) return;
  sendJson(res, 200, { refunds: [] });
}

async function approveRefund(req, res, getSession, id) {
  const s = requireRole(req, res, getSession, ['Admin', 'Manager']);
  if (!s) return;
  sendJson(res, 200, { id, message: 'Refund approved.' });
}

async function rejectRefund(req, res, getSession, id) {
  const s = requireRole(req, res, getSession, ['Admin', 'Manager']);
  if (!s) return;
  sendJson(res, 200, { id, message: 'Refund rejected.' });
}

async function route(req, res, getSession) {
  const parsed = new URL(req.url, 'http://localhost');
  const p = parsed.pathname;
  const method = req.method;
  if (!p.startsWith('/api/refunds')) return false;

  if (p === '/api/refunds' && method === 'POST') { await createRefund(req, res, getSession); return true; }
  if (p === '/api/refunds/pending' && method === 'GET') { await listPending(req, res, getSession); return true; }
  let m;
  if ((m = p.match(/^\/api\/refunds\/(\d+)\/approve$/)) && method === 'POST') { await approveRefund(req, res, getSession, Number(m[1])); return true; }
  if ((m = p.match(/^\/api\/refunds\/(\d+)\/reject$/)) && method === 'POST') { await rejectRefund(req, res, getSession, Number(m[1])); return true; }
  return false;
}

module.exports = { route, validateRefundPayload };
