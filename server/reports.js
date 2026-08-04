const dbApi = require('./db');

const REPORT_ROLES = ['Admin', 'Manager'];

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function requireRole(req, res, getSession, roles) {
  const s = getSession(req);
  if (!s) { sendJson(res, 401, { message: 'Not authenticated.' }); return null; }
  if (!roles.includes(s.role)) { sendJson(res, 403, { message: 'You do not have access to this action.' }); return null; }
  return s;
}

function normalizeDateRange(query) {
  const start = (query.get('startDate') || '').trim();
  const end = (query.get('endDate') || '').trim();
  return { startDate: start || null, endDate: end || null };
}

async function salesDashboard(req, res, getSession) {
  const s = requireRole(req, res, getSession, REPORT_ROLES);
  if (!s) return;
  const range = normalizeDateRange(new URL(req.url, 'http://localhost').searchParams);
  sendJson(res, 200, {
    summary: {
      grossRevenue: 0,
      netSales: 0,
      transactionCount: 0,
      averageOrderValue: 0,
    },
    items: [],
    hourlySales: [],
    range,
  });
}

async function inventoryReports(req, res, getSession) {
  const s = requireRole(req, res, getSession, REPORT_ROLES);
  if (!s) return;
  try {
    const rows = await dbApi.listInventoryIngredients({});
    sendJson(res, 200, { items: rows });
  } catch (err) {
    console.error('[reports:inventory] failed:', err);
    sendJson(res, 500, { message: 'Could not load inventory reports.' });
  }
}

async function inventoryAdjustments(req, res, getSession) {
  const s = requireRole(req, res, getSession, REPORT_ROLES);
  if (!s) return;
  sendJson(res, 200, { adjustments: [] });
}

async function physicalCount(req, res, getSession, id) {
  const s = requireRole(req, res, getSession, REPORT_ROLES);
  if (!s) return;
  sendJson(res, 200, { id, message: 'Physical count recorded.' });
}

async function route(req, res, getSession) {
  const parsed = new URL(req.url, 'http://localhost');
  const p = parsed.pathname;
  const method = req.method;
  if (!p.startsWith('/api/reports')) return false;

  if (p === '/api/reports/sales' && method === 'GET') { await salesDashboard(req, res, getSession); return true; }
  if (p === '/api/reports/inventory' && method === 'GET') { await inventoryReports(req, res, getSession); return true; }
  if (p === '/api/reports/inventory/adjustments' && method === 'GET') { await inventoryAdjustments(req, res, getSession); return true; }
  let m;
  if ((m = p.match(/^\/api\/reports\/inventory\/(\d+)\/physical-count$/)) && method === 'POST') { await physicalCount(req, res, getSession, Number(m[1])); return true; }
  return false;
}

module.exports = { route };
