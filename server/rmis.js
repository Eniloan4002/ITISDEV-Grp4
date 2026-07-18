// AM Restaurant RMIS — Sprint 2 inventory/procurement API.
//
// Zero external dependencies (built-in http only). index.js delegates every
// /api/* request that it doesn't own to route() below; it returns true once it
// has handled (and responded to) the request, false if the path is unknown so
// index.js can fall through to static serving.
//
// Covers the Sprint 2 backlog slice:
//   - Ingredient inventory (records, current qty, reorder level, expiry)
//   - Stock movements (receiving / consumption) and manager adjustments
//   - Low-stock alerts (computed, always live)
//   - Purchase orders (draft -> sent -> received) with goods receipt
// All mutations are timestamped and linked to the acting user (traceability).

const dbApi = require('./db');

// Ingredients nearing expiry within this many days are flagged for highlight.
const EXPIRY_WINDOW_DAYS = 7;

// Role sets, mirroring PROTECTED_PAGES / ROLE_PAGES in index.js. The page gate
// is the first line of defence; these are the API-level enforcement.
const INVENTORY_ROLES = ['Admin', 'Manager', 'Staff']; // view + receive/consume
const MANAGER_ROLES = ['Admin', 'Manager'];            // adjustments, POs, edits

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Read + parse a JSON request body. Resolves to {} for an empty body,
// rejects (caller responds 400) for malformed JSON.
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

// ---- derived fields -------------------------------------------------------

// 'out' (<= 0), 'low' (<= reorder level), or 'ok'. A reorder level of 0 means
// the item only ever alerts when it hits zero.
function stockStatus(row) {
  if (row.quantity <= 0) return 'out';
  if (row.quantity <= row.reorder_level) return 'low';
  return 'ok';
}

// Days until expiry (negative = already expired) plus highlight flags. Returns
// null days when no expiration date is set.
function expiryInfo(dateStr) {
  if (!dateStr) return { daysToExpiry: null, expired: false, expiringSoon: false };
  const exp = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(exp.getTime())) return { daysToExpiry: null, expired: false, expiringSoon: false };
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round((exp - today) / 86400000);
  return {
    daysToExpiry: days,
    expired: days < 0,
    expiringSoon: days >= 0 && days <= EXPIRY_WINDOW_DAYS,
  };
}

function serializeIngredient(row) {
  const status = stockStatus(row);
  const exp = expiryInfo(row.expiration_date);
  return {
    id: row.id,
    name: row.name,
    unit: row.unit,
    category: row.category,
    supplierId: row.supplier_id,
    supplier: row.supplier_name || '',
    quantity: row.quantity,
    reorderLevel: row.reorder_level,
    expirationDate: row.expiration_date,
    daysToExpiry: exp.daysToExpiry,
    expired: exp.expired,
    expiringSoon: exp.expiringSoon,
    status,
    lowStock: status === 'low' || status === 'out',
    createdAt: row.created_at,
  };
}

function serializeTxn(t) {
  return {
    id: t.id,
    type: t.txn_type,
    adjustmentType: t.adjustment_type,
    quantity: t.quantity,
    reason: t.reason,
    reference: t.reference,
    poId: t.po_id,
    user: t.user_name,
    userId: t.user_id,
    createdAt: t.created_at,
  };
}

// ---- guards ---------------------------------------------------------------

// Resolve the session and enforce a role set. Responds (401/403) and returns
// null when the request is not allowed; returns the session otherwise.
function requireRole(req, res, getSession, roles) {
  const s = getSession(req);
  if (!s) { sendJson(res, 401, { message: 'Not authenticated.' }); return null; }
  if (!roles.includes(s.role)) { sendJson(res, 403, { message: 'You do not have access to this action.' }); return null; }
  return s;
}

// Positive finite number check.
function posNum(v) { return typeof v === 'number' && Number.isFinite(v) && v > 0; }
function nonNegNum(v) { return typeof v === 'number' && Number.isFinite(v) && v >= 0; }

// ---- suppliers ------------------------------------------------------------

function getSuppliers(req, res, getSession) {
  if (!requireRole(req, res, getSession, INVENTORY_ROLES)) return;
  sendJson(res, 200, { suppliers: dbApi.listSuppliers() });
}

async function postSupplier(req, res, getSession) {
  if (!requireRole(req, res, getSession, MANAGER_ROLES)) return;
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }
  const name = (data.name || '').trim();
  if (!name) return sendJson(res, 400, { message: 'Supplier name is required.', errors: { name: 'Required.' } });
  if (dbApi.findSupplierByName(name)) return sendJson(res, 409, { message: 'Supplier already exists.', errors: { name: 'Already exists.' } });
  const id = dbApi.createSupplier(name);
  sendJson(res, 201, { id, name });
}

// ---- ingredients ----------------------------------------------------------

function getCategories(req, res, getSession) {
  if (!requireRole(req, res, getSession, INVENTORY_ROLES)) return;
  sendJson(res, 200, { categories: dbApi.listCategories() });
}

function getIngredients(req, res, getSession, query) {
  if (!requireRole(req, res, getSession, INVENTORY_ROLES)) return;
  const supplierId = query.get('supplier') ? Number(query.get('supplier')) : undefined;
  const rows = dbApi.listIngredients({
    q: query.get('q') || undefined,
    category: query.get('category') || undefined,
    supplierId: Number.isFinite(supplierId) ? supplierId : undefined,
  });
  sendJson(res, 200, { ingredients: rows.map(serializeIngredient) });
}

// Resolve a supplier reference from a request body: prefer supplierId, else a
// supplier name (created on the fly). Returns id or null.
function resolveSupplier(data) {
  if (data.supplierId) {
    const s = dbApi.findSupplierById(Number(data.supplierId));
    return s ? s.id : null;
  }
  const name = (data.supplier || '').trim();
  if (name) return dbApi.ensureSupplier(name);
  return null;
}

async function postIngredient(req, res, getSession) {
  if (!requireRole(req, res, getSession, INVENTORY_ROLES)) return;
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }

  const errors = {};
  const name = (data.name || '').trim();
  const unit = (data.unit || '').trim();
  if (!name) errors.name = 'Ingredient name is required.';
  if (!unit) errors.unit = 'Unit of measure is required.';
  const quantity = data.quantity == null || data.quantity === '' ? 0 : Number(data.quantity);
  const reorderLevel = data.reorderLevel == null || data.reorderLevel === '' ? 0 : Number(data.reorderLevel);
  if (!nonNegNum(quantity)) errors.quantity = 'Quantity cannot be negative.';
  if (!nonNegNum(reorderLevel)) errors.reorderLevel = 'Reorder level cannot be negative.';
  const expirationDate = (data.expirationDate || '').trim();
  if (expirationDate && !/^\d{4}-\d{2}-\d{2}$/.test(expirationDate)) errors.expirationDate = 'Use YYYY-MM-DD.';
  if (Object.keys(errors).length) return sendJson(res, 400, { message: 'Please correct the highlighted fields.', errors });

  const supplierId = resolveSupplier(data);
  const id = dbApi.createIngredient({
    name, unit,
    category: (data.category || '').trim(),
    supplierId,
    quantity, reorderLevel, expirationDate,
  });
  sendJson(res, 201, { ingredient: serializeIngredient(dbApi.findIngredientById(id)) });
}

function getIngredient(req, res, getSession, id) {
  if (!requireRole(req, res, getSession, INVENTORY_ROLES)) return;
  const row = dbApi.findIngredientById(id);
  if (!row) return sendJson(res, 404, { message: 'Ingredient not found.' });
  sendJson(res, 200, {
    ingredient: serializeIngredient(row),
    transactions: dbApi.listTransactions(id).map(serializeTxn),
  });
}

async function patchIngredient(req, res, getSession, id) {
  if (!requireRole(req, res, getSession, MANAGER_ROLES)) return;
  const row = dbApi.findIngredientById(id);
  if (!row) return sendJson(res, 404, { message: 'Ingredient not found.' });
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }

  const errors = {};
  const name = (data.name != null ? String(data.name) : row.name).trim();
  const unit = (data.unit != null ? String(data.unit) : row.unit).trim();
  if (!name) errors.name = 'Ingredient name is required.';
  if (!unit) errors.unit = 'Unit of measure is required.';
  const reorderLevel = data.reorderLevel == null || data.reorderLevel === '' ? row.reorder_level : Number(data.reorderLevel);
  if (!nonNegNum(reorderLevel)) errors.reorderLevel = 'Reorder level cannot be negative.';
  const expirationDate = data.expirationDate != null ? String(data.expirationDate).trim() : row.expiration_date;
  if (expirationDate && !/^\d{4}-\d{2}-\d{2}$/.test(expirationDate)) errors.expirationDate = 'Use YYYY-MM-DD.';
  if (Object.keys(errors).length) return sendJson(res, 400, { message: 'Please correct the highlighted fields.', errors });

  const supplierId = (data.supplierId || data.supplier) ? resolveSupplier(data) : row.supplier_id;
  dbApi.updateIngredientMeta(id, {
    name, unit,
    category: (data.category != null ? String(data.category) : row.category).trim(),
    supplierId, reorderLevel, expirationDate,
  });
  sendJson(res, 200, { ingredient: serializeIngredient(dbApi.findIngredientById(id)) });
}

// ---- stock movements ------------------------------------------------------

// POST /api/ingredients/:id/transactions — receiving or consumption.
async function postTransaction(req, res, getSession, id) {
  const s = requireRole(req, res, getSession, INVENTORY_ROLES);
  if (!s) return;
  const row = dbApi.findIngredientById(id);
  if (!row) return sendJson(res, 404, { message: 'Ingredient not found.' });
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }

  const type = data.type;
  const quantity = Number(data.quantity);
  if (type !== 'receiving' && type !== 'consumption') {
    return sendJson(res, 400, { message: 'Transaction type must be receiving or consumption.' });
  }
  if (!posNum(quantity)) {
    return sendJson(res, 400, { message: 'Quantity must be a positive number.', errors: { quantity: 'Enter a positive amount.' } });
  }
  const delta = type === 'receiving' ? quantity : -quantity;
  if (row.quantity + delta < 0) {
    return sendJson(res, 400, { message: `Cannot consume ${quantity} ${row.unit}; only ${row.quantity} ${row.unit} on hand.` });
  }
  dbApi.applyTransaction({
    ingredientId: id, txnType: type, quantity: delta,
    reference: (data.reference || '').trim(),
    userId: s.userId, userName: sessionName(s),
  });
  const updated = dbApi.findIngredientById(id);
  sendJson(res, 201, { ingredient: serializeIngredient(updated) });
}

// POST /api/ingredients/:id/adjustments — manager stock adjustment.
async function postAdjustment(req, res, getSession, id) {
  const s = requireRole(req, res, getSession, MANAGER_ROLES);
  if (!s) return;
  const row = dbApi.findIngredientById(id);
  if (!row) return sendJson(res, 404, { message: 'Ingredient not found.' });
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }

  const errors = {};
  const adjustmentType = data.adjustmentType;
  const TYPES = ['damage', 'spoilage', 'return', 'manual'];
  if (!TYPES.includes(adjustmentType)) errors.adjustmentType = 'Choose an adjustment type.';
  const direction = data.direction; // 'increase' | 'decrease'
  if (direction !== 'increase' && direction !== 'decrease') errors.direction = 'Choose increase or decrease.';
  const quantity = Number(data.quantity);
  if (!posNum(quantity)) errors.quantity = 'Enter a positive amount.';
  const reason = (data.reason || '').trim();
  if (!reason) errors.reason = 'A reason is required.';
  if (Object.keys(errors).length) return sendJson(res, 400, { message: 'Please correct the highlighted fields.', errors });

  const delta = direction === 'increase' ? quantity : -quantity;
  if (row.quantity + delta < 0) {
    return sendJson(res, 400, { message: `Adjustment would drop stock below zero (on hand: ${row.quantity} ${row.unit}).` });
  }
  dbApi.applyTransaction({
    ingredientId: id, txnType: 'adjustment', adjustmentType, quantity: delta, reason,
    userId: s.userId, userName: sessionName(s),
  });
  sendJson(res, 201, { ingredient: serializeIngredient(dbApi.findIngredientById(id)) });
}

// ---- alerts ---------------------------------------------------------------

function getAlerts(req, res, getSession) {
  if (!requireRole(req, res, getSession, INVENTORY_ROLES)) return;
  const items = dbApi.listIngredients().map(serializeIngredient).filter((i) => i.lowStock);
  sendJson(res, 200, { alerts: items });
}

// ---- purchase orders ------------------------------------------------------

function getPurchaseOrders(req, res, getSession, query) {
  if (!requireRole(req, res, getSession, MANAGER_ROLES)) return;
  const supplierId = query.get('supplier') ? Number(query.get('supplier')) : undefined;
  const rows = dbApi.listPurchaseOrders({
    supplierId: Number.isFinite(supplierId) ? supplierId : undefined,
    status: query.get('status') || undefined,
    from: query.get('from') || undefined,
    to: query.get('to') || undefined,
  });
  sendJson(res, 200, { orders: rows.map(serializePo) });
}

function serializePo(p) {
  return {
    id: p.id, poNumber: p.po_number, supplierId: p.supplier_id, supplier: p.supplier_name || '',
    status: p.status, notes: p.notes, total: p.total != null ? p.total : undefined,
    createdBy: p.created_by_name, createdAt: p.created_at,
  };
}

async function postPurchaseOrder(req, res, getSession) {
  const s = requireRole(req, res, getSession, MANAGER_ROLES);
  if (!s) return;
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }

  const supplierId = resolveSupplier(data);
  if (!supplierId) return sendJson(res, 400, { message: 'A supplier is required.', errors: { supplier: 'Choose or enter a supplier.' } });

  const rawItems = Array.isArray(data.items) ? data.items : [];
  const items = [];
  for (const it of rawItems) {
    const ingredientId = Number(it.ingredientId);
    const quantity = Number(it.quantity);
    const unitPrice = it.unitPrice == null || it.unitPrice === '' ? 0 : Number(it.unitPrice);
    if (!Number.isFinite(ingredientId) || !dbApi.findIngredientById(ingredientId)) continue;
    if (!posNum(quantity)) continue;
    if (!nonNegNum(unitPrice)) continue;
    items.push({ ingredientId, quantity, unitPrice, notes: (it.notes || '').trim() });
  }
  if (!items.length) return sendJson(res, 400, { message: 'Add at least one valid line item (ingredient + positive quantity).' });

  const id = dbApi.createPurchaseOrder({
    supplierId, notes: (data.notes || '').trim(),
    createdBy: s.userId, createdByName: sessionName(s), items,
  });
  sendJson(res, 201, { order: poDetail(id) });
}

function poDetail(id) {
  const p = dbApi.findPurchaseOrderById(id);
  if (!p) return null;
  const items = dbApi.listPoItems(id).map((it) => ({
    id: it.id, ingredientId: it.ingredient_id, ingredient: it.ingredient_name, unit: it.unit,
    quantity: it.quantity, unitPrice: it.unit_price, receivedQty: it.received_qty,
    lineTotal: it.quantity * it.unit_price, notes: it.notes,
  }));
  const total = items.reduce((sum, it) => sum + it.lineTotal, 0);
  return { ...serializePo(p), total, items };
}

function getPurchaseOrder(req, res, getSession, id) {
  if (!requireRole(req, res, getSession, MANAGER_ROLES)) return;
  const detail = poDetail(id);
  if (!detail) return sendJson(res, 404, { message: 'Purchase order not found.' });
  sendJson(res, 200, { order: detail });
}

// PATCH /api/purchase-orders/:id — status change (send, or explicit close).
async function patchPurchaseOrder(req, res, getSession, id) {
  if (!requireRole(req, res, getSession, MANAGER_ROLES)) return;
  const p = dbApi.findPurchaseOrderById(id);
  if (!p) return sendJson(res, 404, { message: 'Purchase order not found.' });
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }

  const target = data.status;
  if (target === 'Sent') {
    if (p.status !== 'Draft') return sendJson(res, 400, { message: 'Only a Draft purchase order can be sent.' });
    dbApi.setPurchaseOrderStatus(id, 'Sent');
  } else if (target === 'Completed') {
    // Explicit close — permitted from Sent or Partially Received (AC allows an
    // explicit close even if not fully received).
    if (p.status === 'Draft' || p.status === 'Completed') {
      return sendJson(res, 400, { message: 'This purchase order cannot be closed from its current status.' });
    }
    dbApi.setPurchaseOrderStatus(id, 'Completed');
  } else {
    return sendJson(res, 400, { message: 'Unsupported status change.' });
  }
  sendJson(res, 200, { order: poDetail(id) });
}

// POST /api/purchase-orders/:id/receive — goods receipt against PO lines.
async function receivePurchaseOrder(req, res, getSession, id) {
  const s = requireRole(req, res, getSession, MANAGER_ROLES);
  if (!s) return;
  const p = dbApi.findPurchaseOrderById(id);
  if (!p) return sendJson(res, 404, { message: 'Purchase order not found.' });
  if (p.status === 'Draft') return sendJson(res, 400, { message: 'Send the purchase order before receiving goods.' });
  if (p.status === 'Completed') return sendJson(res, 400, { message: 'This purchase order is already completed.' });
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }

  const receipts = Array.isArray(data.receipts) ? data.receipts : [];
  if (!receipts.length) return sendJson(res, 400, { message: 'Nothing to receive.' });

  // Validate everything first, then apply (so a bad line rejects the whole receipt).
  const toApply = [];
  for (const r of receipts) {
    const item = dbApi.findPoItemById(Number(r.itemId));
    const qty = Number(r.receivedQty);
    if (!item || item.po_id !== id) return sendJson(res, 400, { message: 'A receipt line does not belong to this purchase order.' });
    if (qty === 0) continue;
    if (!posNum(qty)) return sendJson(res, 400, { message: 'Received quantity must be a positive number.' });
    if (item.received_qty + qty > item.quantity + 1e-9) {
      return sendJson(res, 400, { message: `Cannot receive more than ordered for line #${item.id} (ordered ${item.quantity}, already received ${item.received_qty}).` });
    }
    toApply.push({ item, qty });
  }
  if (!toApply.length) return sendJson(res, 400, { message: 'Nothing to receive.' });

  for (const { item, qty } of toApply) {
    dbApi.applyTransaction({
      ingredientId: item.ingredient_id, txnType: 'receiving', quantity: qty,
      reference: p.po_number, poId: id, userId: s.userId, userName: sessionName(s),
    });
    dbApi.addPoItemReceived(item.id, qty);
  }

  // Recompute status: fully received -> Completed, otherwise Partially Received.
  const items = dbApi.listPoItems(id);
  const allReceived = items.every((it) => it.received_qty + 1e-9 >= it.quantity);
  dbApi.setPurchaseOrderStatus(id, allReceived ? 'Completed' : 'Partially Received');
  sendJson(res, 200, { order: poDetail(id) });
}

// ---- helpers --------------------------------------------------------------

// Display name for traceability. The session stores email + role; fall back to
// the email local-part when we don't have a full name to hand.
function sessionName(s) {
  const u = dbApi.findUserById(s.userId);
  return u ? u.full_name : (s.email || '').split('@')[0];
}

// ---- router ---------------------------------------------------------------

// Returns true if this module handled the request. `getSession` comes from
// index.js (shared in-memory session store).
async function route(req, res, getSession) {
  const parsed = new URL(req.url, 'http://localhost');
  const pathName = parsed.pathname;
  const query = parsed.searchParams;
  const method = req.method;

  if (!pathName.startsWith('/api/')) return false;

  // /api/suppliers
  if (pathName === '/api/suppliers' && method === 'GET') { getSuppliers(req, res, getSession); return true; }
  if (pathName === '/api/suppliers' && method === 'POST') { await postSupplier(req, res, getSession); return true; }

  // /api/categories
  if (pathName === '/api/categories' && method === 'GET') { getCategories(req, res, getSession); return true; }

  // /api/alerts
  if (pathName === '/api/alerts' && method === 'GET') { getAlerts(req, res, getSession); return true; }

  // /api/ingredients ...
  if (pathName === '/api/ingredients' && method === 'GET') { getIngredients(req, res, getSession, query); return true; }
  if (pathName === '/api/ingredients' && method === 'POST') { await postIngredient(req, res, getSession); return true; }

  let m;
  if ((m = pathName.match(/^\/api\/ingredients\/(\d+)$/))) {
    const id = Number(m[1]);
    if (method === 'GET') { getIngredient(req, res, getSession, id); return true; }
    if (method === 'PATCH') { await patchIngredient(req, res, getSession, id); return true; }
  }
  if ((m = pathName.match(/^\/api\/ingredients\/(\d+)\/transactions$/)) && method === 'POST') {
    await postTransaction(req, res, getSession, Number(m[1])); return true;
  }
  if ((m = pathName.match(/^\/api\/ingredients\/(\d+)\/adjustments$/)) && method === 'POST') {
    await postAdjustment(req, res, getSession, Number(m[1])); return true;
  }

  // /api/purchase-orders ...
  if (pathName === '/api/purchase-orders' && method === 'GET') { getPurchaseOrders(req, res, getSession, query); return true; }
  if (pathName === '/api/purchase-orders' && method === 'POST') { await postPurchaseOrder(req, res, getSession); return true; }
  if ((m = pathName.match(/^\/api\/purchase-orders\/(\d+)$/))) {
    const id = Number(m[1]);
    if (method === 'GET') { getPurchaseOrder(req, res, getSession, id); return true; }
    if (method === 'PATCH') { await patchPurchaseOrder(req, res, getSession, id); return true; }
  }
  if ((m = pathName.match(/^\/api\/purchase-orders\/(\d+)\/receive$/)) && method === 'POST') {
    await receivePurchaseOrder(req, res, getSession, Number(m[1])); return true;
  }

  return false;
}

module.exports = { route };
