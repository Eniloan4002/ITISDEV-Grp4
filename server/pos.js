const dbApi = require('./db');

const POS_ROLES = ['Admin', 'Manager', 'Cashier'];
const PAYMENT_METHODS = ['Cash', 'Card', 'GCash', 'Maya', 'Other'];

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

function calculateCheckoutTotals(items = []) {
  const subtotal = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);
  const discountAmount = 0;
  const taxAmount = 0;
  const totalAmount = subtotal;
  return { subtotal, discountAmount, taxAmount, totalAmount };
}

function validateCheckoutPayload(data = {}) {
  const errors = {};
  if (!Array.isArray(data.items) || !data.items.length) errors.items = 'At least one item is required.';
  if (!data.paymentMethod) errors.paymentMethod = 'Payment method is required.';
  else if (!PAYMENT_METHODS.includes(data.paymentMethod)) errors.paymentMethod = 'Choose a valid payment method.';
  if (data.paymentMethod && data.paymentMethod !== 'Cash' && !data.paymentReference) errors.paymentReference = 'Payment reference is required.';
  return errors;
}

async function getMenu(req, res, getSession) {
  const s = requireRole(req, res, getSession, POS_ROLES);
  if (!s) return;
  try {
    const menu = await dbApi.listMenuItems();
    sendJson(res, 200, { menu });
  } catch (err) {
    console.error('[pos:menu] failed:', err);
    sendJson(res, 500, { message: 'Could not load menu.' });
  }
}

async function checkout(req, res, getSession) {
  const s = requireRole(req, res, getSession, POS_ROLES);
  if (!s) return;
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }

  const errors = validateCheckoutPayload(data);
  if (Object.keys(errors).length) return sendJson(res, 400, { message: 'Please correct the highlighted fields.', errors });

  const totals = calculateCheckoutTotals(data.items);
  const receipt = {
    transactionNumber: `POS-${Date.now()}`,
    cashier: s.email,
    items: data.items,
    subtotal: totals.subtotal,
    discountAmount: totals.discountAmount,
    taxAmount: totals.taxAmount,
    totalAmount: totals.totalAmount,
    paymentMethod: data.paymentMethod,
    paymentReference: data.paymentReference || null,
    changeAmount: data.paymentMethod === 'Cash' ? Math.max(0, Number(data.amountTendered || 0) - totals.totalAmount) : 0,
  };

  sendJson(res, 201, { receipt, message: 'Checkout completed.' });
}

async function route(req, res, getSession) {
  const parsed = new URL(req.url, 'http://localhost');
  const p = parsed.pathname;
  const method = req.method;
  if (!p.startsWith('/api/pos')) return false;

  if (p === '/api/pos/menu' && method === 'GET') { await getMenu(req, res, getSession); return true; }
  if (p === '/api/pos/checkout' && method === 'POST') { await checkout(req, res, getSession); return true; }
  return false;
}

module.exports = { route, calculateCheckoutTotals, validateCheckoutPayload };
