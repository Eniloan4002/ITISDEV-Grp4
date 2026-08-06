// SI-17 Sales History, SI-24 Sales Dashboard, SI-25 Inventory Reports.
//
// Grouped in one router because all three are read-mostly reporting surfaces
// over the same sales and inventory data. SI-18 refunds live in server/refunds.js
// because they mutate.

const dbApi = require('./db');
const audit = require('./audit');
const roles = require('./roles');
const { sendJson, readJson, requireRole } = require('./http-util');

// --- period normalisation (SI-24) ------------------------------------------
//
// The server owns the [from, to] pair so every card and chart on a dashboard
// refresh uses identical bounds; the client only names a period. Dates are
// inclusive and computed in the app's configured zone, not the browser's.
function localToday() {
  // DB_TIMEZONE pins the SQL side; mirror it here so "today" agrees.
  const offsetMin = (() => {
    const tz = process.env.DB_TIMEZONE || '+08:00';
    const m = /^([+-])(\d{2}):(\d{2})$/.exec(tz);
    if (!m) return -new Date().getTimezoneOffset();
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  })();
  const now = new Date(Date.now() + offsetMin * 60000);
  return now.toISOString().slice(0, 10);
}

const iso = (d) => d.toISOString().slice(0, 10);

function resolvePeriod(period, fromParam, toParam) {
  const today = localToday();
  const base = new Date(today + 'T00:00:00Z');

  switch (period) {
    case 'week': {
      // ISO-ish week starting Monday
      const dow = (base.getUTCDay() + 6) % 7;
      const start = new Date(base); start.setUTCDate(base.getUTCDate() - dow);
      return { from: iso(start), to: today, label: 'This week' };
    }
    case 'month': {
      const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
      return { from: iso(start), to: today, label: 'This month' };
    }
    case 'custom': {
      const from = String(fromParam || '').slice(0, 10);
      const to = String(toParam || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
      if (from > to) return null;
      return { from, to, label: `${from} to ${to}` };
    }
    case 'day':
    default:
      return { from: today, to: today, label: 'Today' };
  }
}

// --- SI-17 Sales History ---------------------------------------------------

async function getSalesHistory(req, res, getSession, query) {
  // Cashiers may view history; they cannot reach the dashboard or reports.
  const s = requireRole(req, res, getSession, roles.SALES);
  if (!s) return;
  const filters = {
    transactionNo: (query.get('transactionNo') || '').trim(),
    from: (query.get('from') || '').trim(),
    to: (query.get('to') || '').trim(),
    cashierId: Number(query.get('cashierId')) || null,
    paymentMethod: (query.get('paymentMethod') || '').trim(),
    status: (query.get('status') || '').trim(),
  };
  sendJson(res, 200, {
    sales: await dbApi.listSalesHistory(filters),
    cashiers: await dbApi.listCashiers(),
  });
}

async function getSalesHistoryDetail(req, res, getSession, id) {
  const s = requireRole(req, res, getSession, roles.SALES);
  if (!s) return;
  const sale = await dbApi.findSaleById(id);
  if (!sale) return sendJson(res, 404, { message: 'Transaction not found.' });
  sendJson(res, 200, {
    sale,
    items: await dbApi.listSaleItemsWithRefunds(id),
    refunds: await dbApi.listRefunds({ saleId: id }),
  });
}

// --- SI-24 Sales Dashboard ------------------------------------------------

async function getSalesDashboard(req, res, getSession, query) {
  const s = requireRole(req, res, getSession, roles.REPORTS, 'Manager or Admin access required.');
  if (!s) return;
  const period = resolvePeriod(query.get('period') || 'day', query.get('from'), query.get('to'));
  if (!period) {
    return sendJson(res, 400, {
      message: 'Provide a valid inclusive date range.',
      errors: { from: 'Use YYYY-MM-DD, with start on or before end.' },
    });
  }
  const [summary, topItems, byHour] = await Promise.all([
    dbApi.salesSummary(period.from, period.to),
    dbApi.topMenuItems(period.from, period.to),
    dbApi.salesByHour(period.from, period.to),
  ]);
  sendJson(res, 200, { period, summary, topItems, byHour });
}

// --- SI-25 Inventory Reports ---------------------------------------------

async function getInventoryReport(req, res, getSession, query) {
  const s = requireRole(req, res, getSession, roles.REPORTS, 'Manager or Admin access required.');
  if (!s) return;
  sendJson(res, 200, {
    items: await dbApi.inventoryReport({
      q: (query.get('q') || '').trim(),
      category: (query.get('category') || '').trim(),
      supplierId: Number(query.get('supplierId')) || null,
      stockStatus: (query.get('stockStatus') || '').trim(),
    }),
    categories: await dbApi.listCategories(),
    suppliers: await dbApi.listSuppliers({}),
  });
}

async function postPhysicalCount(req, res, getSession, id) {
  const s = requireRole(req, res, getSession, roles.REPORTS, 'Manager or Admin access required.');
  if (!s) return;
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }

  const errors = {};
  const actual = Number(data.actualQuantity);
  const reason = String(data.reason || '').trim();
  if (!Number.isFinite(actual) || actual < 0) errors.actualQuantity = 'Enter the counted quantity (0 or more).';
  if (!reason) errors.reason = 'A reason or audit note is required.';
  if (Object.keys(errors).length) {
    return sendJson(res, 400, { message: 'Please correct the highlighted fields.', errors });
  }

  try {
    const result = await dbApi.recordPhysicalCount({
      ingredientId: id, actualQuantity: actual, reason, userId: s.userId,
    });
    audit.record(req, { userId: s.userId, email: s.email }, 'PHYSICAL_COUNT', 'stock_adjustments',
      `Ingredient ${id}: system ${result.previousQuantity}, counted ${result.actualQuantity}, ` +
      `discrepancy ${result.discrepancy}. ${reason}`);
    sendJson(res, 201, result);
  } catch (err) {
    if (err.code === 'NOT_FOUND') return sendJson(res, 404, { message: err.message });
    throw err;
  }
}

async function getPhysicalCounts(req, res, getSession, query) {
  const s = requireRole(req, res, getSession, roles.REPORTS, 'Manager or Admin access required.');
  if (!s) return;
  sendJson(res, 200, {
    counts: await dbApi.listPhysicalCounts({ ingredientId: Number(query.get('ingredientId')) || null }),
  });
}

async function route(req, res, getSession) {
  const parsed = new URL(req.url, 'http://localhost');
  const p = parsed.pathname;
  const query = parsed.searchParams;
  const method = req.method;
  let m;

  if (!p.startsWith('/api/')) return false;

  if (p === '/api/sales-history' && method === 'GET') { await getSalesHistory(req, res, getSession, query); return true; }
  if ((m = p.match(/^\/api\/sales-history\/(\d+)$/)) && method === 'GET') {
    await getSalesHistoryDetail(req, res, getSession, Number(m[1])); return true;
  }

  if (p === '/api/sales-dashboard' && method === 'GET') { await getSalesDashboard(req, res, getSession, query); return true; }

  if (p === '/api/inventory-report' && method === 'GET') { await getInventoryReport(req, res, getSession, query); return true; }
  if (p === '/api/physical-counts' && method === 'GET') { await getPhysicalCounts(req, res, getSession, query); return true; }
  if ((m = p.match(/^\/api\/inventory-report\/(\d+)\/count$/)) && method === 'POST') {
    await postPhysicalCount(req, res, getSession, Number(m[1])); return true;
  }

  return false;
}

module.exports = { route, resolvePeriod };
