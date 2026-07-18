// AM Restaurant RMIS — Sprint 2 Sales & Billing (POS) API.
//
// Same shape as rmis.js / attendance.js: index.js delegates /api/* here and
// route() returns true once it has handled the request. A "sale" is a bill:
//   - create an Open bill with free-form line items (name, qty, unit price)
//   - totals (subtotal, discount, 12% VAT, total) are computed SERVER-SIDE
//   - settle with a payment method (Cash/Card/GCash); cash returns change
//   - void an Open bill (managers only)
//   - list / filter by status, date, cashier; view a receipt
// Every bill is timestamped and linked to the acting cashier.
//
// Scope notes: line items are free-form and NOT linked to inventory (no menu/
// recipe entity yet), so settling a bill does not deduct stock.

const dbApi = require('./db');

const SALES_ROLES = ['Admin', 'Manager', 'Cashier']; // create / settle / view
const MANAGER_ROLES = ['Admin', 'Manager'];          // void
const PAYMENT_METHODS = ['Cash', 'Card', 'GCash'];
const VAT_RATE = 0.12; // Philippine VAT, applied on (subtotal - discount).

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
function requireRole(req, res, getSession, roles) {
  const s = getSession(req);
  if (!s) { sendJson(res, 401, { message: 'Not authenticated.' }); return null; }
  if (!roles.includes(s.role)) { sendJson(res, 403, { message: 'You do not have access to this action.' }); return null; }
  return s;
}
function sessionName(s) {
  const u = dbApi.findUserById(s.userId);
  return u ? u.full_name : (s.email || '').split('@')[0];
}
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const posNum = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
const nonNegNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;

function serializeSale(s) {
  return {
    id: s.id, billNumber: s.bill_number, tableLabel: s.table_label, status: s.status,
    subtotal: s.subtotal, discount: s.discount, tax: s.tax, total: s.total,
    paymentMethod: s.payment_method, amountTendered: s.amount_tendered, changeDue: s.change_due,
    cashier: s.cashier_name, cashierId: s.cashier_id, createdAt: s.created_at, settledAt: s.settled_at,
  };
}
function saleDetail(id) {
  const s = dbApi.findSaleById(id);
  if (!s) return null;
  const items = dbApi.listSaleItems(id).map((it) => ({
    id: it.id, name: it.name, quantity: it.quantity, unitPrice: it.unit_price, lineTotal: it.line_total,
  }));
  return { ...serializeSale(s), items };
}

// ---- list / detail ----
function getSales(req, res, getSession, query) {
  if (!requireRole(req, res, getSession, SALES_ROLES)) return;
  const cashierId = query.get('cashier') ? Number(query.get('cashier')) : undefined;
  const rows = dbApi.listSales({
    status: query.get('status') || undefined,
    date: query.get('date') || undefined,
    cashierId: Number.isFinite(cashierId) ? cashierId : undefined,
  });
  sendJson(res, 200, { sales: rows.map(serializeSale) });
}

function getSale(req, res, getSession, id) {
  if (!requireRole(req, res, getSession, SALES_ROLES)) return;
  const detail = saleDetail(id);
  if (!detail) return sendJson(res, 404, { message: 'Bill not found.' });
  sendJson(res, 200, { sale: detail });
}

// ---- create ----
async function postSale(req, res, getSession) {
  const s = requireRole(req, res, getSession, SALES_ROLES);
  if (!s) return;
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }

  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items = [];
  for (const it of rawItems) {
    const name = (it.name || '').trim();
    const quantity = Number(it.quantity);
    const unitPrice = Number(it.unitPrice);
    if (!name || !posNum(quantity) || !nonNegNum(unitPrice)) continue;
    items.push({ name, quantity, unitPrice, lineTotal: round2(quantity * unitPrice) });
  }
  if (!items.length) return sendJson(res, 400, { message: 'Add at least one valid line item (name + positive quantity).' });

  const subtotal = round2(items.reduce((sum, it) => sum + it.lineTotal, 0));
  let discount = data.discount == null || data.discount === '' ? 0 : Number(data.discount);
  if (!nonNegNum(discount)) return sendJson(res, 400, { message: 'Discount cannot be negative.', errors: { discount: 'Invalid discount.' } });
  if (discount > subtotal) return sendJson(res, 400, { message: 'Discount cannot exceed the subtotal.', errors: { discount: 'Too large.' } });
  const tax = round2((subtotal - discount) * VAT_RATE);
  const total = round2(subtotal - discount + tax);

  const id = dbApi.createSale({
    tableLabel: (data.tableLabel || '').trim(),
    subtotal, discount: round2(discount), tax, total,
    cashierId: s.userId, cashierName: sessionName(s), items,
  });
  sendJson(res, 201, { sale: saleDetail(id) });
}

// ---- settle ----
async function settle(req, res, getSession, id) {
  if (!requireRole(req, res, getSession, SALES_ROLES)) return;
  const sale = dbApi.findSaleById(id);
  if (!sale) return sendJson(res, 404, { message: 'Bill not found.' });
  if (sale.status !== 'Open') return sendJson(res, 400, { message: `This bill is already ${sale.status.toLowerCase()}.` });
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }

  const paymentMethod = data.paymentMethod;
  if (!PAYMENT_METHODS.includes(paymentMethod)) {
    return sendJson(res, 400, { message: 'Choose a valid payment method.', errors: { paymentMethod: 'Required.' } });
  }
  let amountTendered = Number(data.amountTendered);
  let changeDue = 0;
  if (paymentMethod === 'Cash') {
    if (!nonNegNum(amountTendered) || amountTendered < sale.total) {
      return sendJson(res, 400, { message: `Cash tendered must be at least the total (${sale.total.toFixed(2)}).`, errors: { amountTendered: 'Insufficient.' } });
    }
    changeDue = round2(amountTendered - sale.total);
  } else {
    // Card / GCash: exact amount, no change.
    amountTendered = sale.total;
  }
  dbApi.settleSale(id, { paymentMethod, amountTendered: round2(amountTendered), changeDue });
  sendJson(res, 200, { sale: saleDetail(id) });
}

// ---- void ----
async function voidSale(req, res, getSession, id) {
  if (!requireRole(req, res, getSession, MANAGER_ROLES)) return;
  const sale = dbApi.findSaleById(id);
  if (!sale) return sendJson(res, 404, { message: 'Bill not found.' });
  if (sale.status !== 'Open') return sendJson(res, 400, { message: 'Only an open bill can be voided.' });
  dbApi.voidSale(id);
  sendJson(res, 200, { sale: saleDetail(id) });
}

// ---- router ----
async function route(req, res, getSession) {
  const parsed = new URL(req.url, 'http://localhost');
  const p = parsed.pathname;
  const q = parsed.searchParams;
  const method = req.method;
  if (!p.startsWith('/api/sales')) return false;

  if (p === '/api/sales' && method === 'GET') { getSales(req, res, getSession, q); return true; }
  if (p === '/api/sales' && method === 'POST') { await postSale(req, res, getSession); return true; }
  let m;
  if ((m = p.match(/^\/api\/sales\/(\d+)$/)) && method === 'GET') { getSale(req, res, getSession, Number(m[1])); return true; }
  if ((m = p.match(/^\/api\/sales\/(\d+)\/settle$/)) && method === 'POST') { await settle(req, res, getSession, Number(m[1])); return true; }
  if ((m = p.match(/^\/api\/sales\/(\d+)\/void$/)) && method === 'POST') { await voidSale(req, res, getSession, Number(m[1])); return true; }

  return false;
}

module.exports = { route };
