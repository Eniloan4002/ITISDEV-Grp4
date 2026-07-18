// Persistence layer — Node's built-in `node:sqlite` (no npm install).
//
// Replaces the old in-memory `accounts` array with a real file-backed SQLite
// database at `data/rmis.db`. Zero external dependencies: DatabaseSync ships
// with Node 22+/24. (You may see an ExperimentalWarning about SQLite — that's
// expected and harmless.)
//
// Conventions (do not deviate):
//   - DDL via db.exec(...); queries via db.prepare(...).get/all/run(...).
//   - POSITIONAL `?` params only (named params caused a past breakage).
//   - lastInsertRowid is a BigInt — wrap with Number() before returning.

const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'rmis.db');
const db = new DatabaseSync(DB_PATH);

// Schema — idempotent, runs on every load.
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL,
    contact_number TEXT DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    token TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  );

  -- ===== Sprint 2: Inventory / Stock / Procurement =====
  CREATE TABLE IF NOT EXISTS suppliers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ingredients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    unit TEXT NOT NULL,                 -- unit of measure (kg, L, pcs, ...)
    category TEXT NOT NULL DEFAULT '',
    supplier_id INTEGER,                -- nullable; FK -> suppliers.id
    quantity REAL NOT NULL DEFAULT 0,   -- current quantity on hand (never < 0)
    reorder_level REAL NOT NULL DEFAULT 0,
    expiration_date TEXT NOT NULL DEFAULT '',  -- 'YYYY-MM-DD' or '' if N/A
    created_at TEXT NOT NULL
  );
  -- Every stock movement. txn_type: receiving | consumption | adjustment.
  -- quantity is the SIGNED effect on hand (+received, -consumed, +/-adjusted).
  CREATE TABLE IF NOT EXISTS inventory_txns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ingredient_id INTEGER NOT NULL,
    txn_type TEXT NOT NULL,
    adjustment_type TEXT NOT NULL DEFAULT '',  -- damage|spoilage|return|manual (adjustments only)
    quantity REAL NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    reference TEXT NOT NULL DEFAULT '',
    po_id INTEGER,                      -- set when the movement is a PO goods receipt
    user_id INTEGER NOT NULL,
    user_name TEXT NOT NULL DEFAULT '', -- snapshot for traceability display
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS purchase_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_number TEXT NOT NULL DEFAULT '',
    supplier_id INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'Draft',  -- Draft|Sent|Partially Received|Completed
    notes TEXT NOT NULL DEFAULT '',
    created_by INTEGER NOT NULL,
    created_by_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS po_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id INTEGER NOT NULL,
    ingredient_id INTEGER NOT NULL,
    quantity REAL NOT NULL,
    unit_price REAL NOT NULL DEFAULT 0,
    received_qty REAL NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT ''
  );
`);

// node:sqlite's DatabaseSync has no better-sqlite3-style db.transaction();
// wrap work in an explicit BEGIN/COMMIT (ROLLBACK on throw) instead. Synchronous.
function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function findUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(email);
}

function findUserById(id) {
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id);
}

function createUser({ fullName, email, passwordHash, role }) {
  const info = db.prepare('INSERT INTO users (full_name, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)').run(fullName, email, passwordHash, role, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

function updateProfile(id, { fullName, contactNumber }) {
  return db.prepare('UPDATE users SET full_name = ?, contact_number = ? WHERE id = ?').run(fullName, contactNumber, id);
}

function updatePassword(id, passwordHash) {
  return db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, id);
}

function createReset(token, userId, expiresAt) {
  return db.prepare('INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expiresAt);
}

function getReset(token) {
  return db.prepare('SELECT * FROM password_resets WHERE token = ?').get(token);
}

function markResetUsed(token) {
  return db.prepare('UPDATE password_resets SET used = 1 WHERE token = ?').run(token);
}

// ===== Sprint 2: Suppliers =====

function listSuppliers() {
  return db.prepare('SELECT * FROM suppliers ORDER BY name').all();
}

function findSupplierById(id) {
  return db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id);
}

function findSupplierByName(name) {
  return db.prepare('SELECT * FROM suppliers WHERE name = ?').get(name);
}

function createSupplier(name) {
  const info = db.prepare('INSERT INTO suppliers (name, created_at) VALUES (?, ?)').run(name, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

// Return an existing supplier id for `name`, creating the row if needed.
function ensureSupplier(name) {
  const existing = findSupplierByName(name);
  if (existing) return existing.id;
  return createSupplier(name);
}

// ===== Sprint 2: Ingredients =====

// List ingredients (joined with supplier name), optionally filtered. All
// filters are optional; text search is a case-insensitive LIKE on the name.
function listIngredients({ q, category, supplierId } = {}) {
  const where = [];
  const params = [];
  if (q) { where.push('LOWER(i.name) LIKE ?'); params.push('%' + q.toLowerCase() + '%'); }
  if (category) { where.push('i.category = ?'); params.push(category); }
  if (supplierId) { where.push('i.supplier_id = ?'); params.push(supplierId); }
  const sql =
    'SELECT i.*, s.name AS supplier_name FROM ingredients i ' +
    'LEFT JOIN suppliers s ON s.id = i.supplier_id ' +
    (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
    'ORDER BY i.name';
  return db.prepare(sql).all(...params);
}

function findIngredientById(id) {
  return db.prepare(
    'SELECT i.*, s.name AS supplier_name FROM ingredients i ' +
    'LEFT JOIN suppliers s ON s.id = i.supplier_id WHERE i.id = ?'
  ).get(id);
}

function createIngredient({ name, unit, category, supplierId, quantity, reorderLevel, expirationDate }) {
  const info = db.prepare(
    'INSERT INTO ingredients (name, unit, category, supplier_id, quantity, reorder_level, expiration_date, created_at) ' +
    'VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(name, unit, category || '', supplierId || null, quantity || 0, reorderLevel || 0, expirationDate || '', new Date().toISOString());
  return Number(info.lastInsertRowid);
}

// Update the editable metadata (not quantity — that only moves via transactions).
function updateIngredientMeta(id, { name, unit, category, supplierId, reorderLevel, expirationDate }) {
  return db.prepare(
    'UPDATE ingredients SET name = ?, unit = ?, category = ?, supplier_id = ?, reorder_level = ?, expiration_date = ? WHERE id = ?'
  ).run(name, unit, category || '', supplierId || null, reorderLevel || 0, expirationDate || '', id);
}

// Distinct non-empty categories, for the filter dropdown.
function listCategories() {
  return db.prepare("SELECT DISTINCT category FROM ingredients WHERE category <> '' ORDER BY category")
    .all().map((r) => r.category);
}

// ===== Sprint 2: Inventory transactions (receiving / consumption / adjustment) =====

// Apply a signed movement to an ingredient and log it, atomically.
// `quantity` is the SIGNED effect; caller must have validated it won't go < 0.
function applyTransaction({ ingredientId, txnType, adjustmentType, quantity, reason, reference, poId, userId, userName }) {
  const now = new Date().toISOString();
  return tx(() => {
    db.prepare('UPDATE ingredients SET quantity = quantity + ? WHERE id = ?').run(quantity, ingredientId);
    const info = db.prepare(
      'INSERT INTO inventory_txns (ingredient_id, txn_type, adjustment_type, quantity, reason, reference, po_id, user_id, user_name, created_at) ' +
      'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(ingredientId, txnType, adjustmentType || '', quantity, reason || '', reference || '', poId || null, userId, userName || '', now);
    return Number(info.lastInsertRowid);
  });
}

// Movement history for one ingredient, newest first.
function listTransactions(ingredientId) {
  return db.prepare('SELECT * FROM inventory_txns WHERE ingredient_id = ? ORDER BY id DESC').all(ingredientId);
}

// ===== Sprint 2: Purchase orders =====

function createPurchaseOrder({ supplierId, notes, createdBy, createdByName, items }) {
  const now = new Date().toISOString();
  return tx(() => {
    const info = db.prepare(
      'INSERT INTO purchase_orders (po_number, supplier_id, status, notes, created_by, created_by_name, created_at) ' +
      "VALUES ('', ?, 'Draft', ?, ?, ?, ?)"
    ).run(supplierId, notes || '', createdBy, createdByName || '', now);
    const poId = Number(info.lastInsertRowid);
    // Human-friendly PO number derived from the row id, e.g. PO-001.
    const poNumber = 'PO-' + String(poId).padStart(3, '0');
    db.prepare('UPDATE purchase_orders SET po_number = ? WHERE id = ?').run(poNumber, poId);
    for (const it of items) {
      db.prepare(
        'INSERT INTO po_items (po_id, ingredient_id, quantity, unit_price, notes) VALUES (?, ?, ?, ?, ?)'
      ).run(poId, it.ingredientId, it.quantity, it.unitPrice || 0, it.notes || '');
    }
    return poId;
  });
}

function listPurchaseOrders({ supplierId, status, from, to } = {}) {
  const where = [];
  const params = [];
  if (supplierId) { where.push('p.supplier_id = ?'); params.push(supplierId); }
  if (status) { where.push('p.status = ?'); params.push(status); }
  if (from) { where.push('p.created_at >= ?'); params.push(from); }
  if (to) { where.push('p.created_at <= ?'); params.push(to + 'T23:59:59.999Z'); }
  const sql =
    'SELECT p.*, s.name AS supplier_name, ' +
    '(SELECT COALESCE(SUM(quantity * unit_price), 0) FROM po_items WHERE po_id = p.id) AS total ' +
    'FROM purchase_orders p LEFT JOIN suppliers s ON s.id = p.supplier_id ' +
    (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
    'ORDER BY p.id DESC';
  return db.prepare(sql).all(...params);
}

function findPurchaseOrderById(id) {
  return db.prepare(
    'SELECT p.*, s.name AS supplier_name FROM purchase_orders p ' +
    'LEFT JOIN suppliers s ON s.id = p.supplier_id WHERE p.id = ?'
  ).get(id);
}

function listPoItems(poId) {
  return db.prepare(
    'SELECT pi.*, i.name AS ingredient_name, i.unit AS unit FROM po_items pi ' +
    'LEFT JOIN ingredients i ON i.id = pi.ingredient_id WHERE pi.po_id = ? ORDER BY pi.id'
  ).all(poId);
}

function findPoItemById(itemId) {
  return db.prepare('SELECT * FROM po_items WHERE id = ?').get(itemId);
}

function setPurchaseOrderStatus(id, status) {
  return db.prepare('UPDATE purchase_orders SET status = ? WHERE id = ?').run(status, id);
}

// Record a receipt against one PO line: bump received_qty. (Inventory itself is
// moved by applyTransaction; the caller does both.)
function addPoItemReceived(itemId, qty) {
  return db.prepare('UPDATE po_items SET received_qty = received_qty + ? WHERE id = ?').run(qty, itemId);
}

module.exports = {
  db,
  findUserByEmail, findUserById, createUser, updateProfile, updatePassword, createReset, getReset, markResetUsed,
  // suppliers
  listSuppliers, findSupplierById, findSupplierByName, createSupplier, ensureSupplier,
  // ingredients
  listIngredients, findIngredientById, createIngredient, updateIngredientMeta, listCategories,
  // transactions
  applyTransaction, listTransactions,
  // purchase orders
  createPurchaseOrder, listPurchaseOrders, findPurchaseOrderById, listPoItems, findPoItemById,
  setPurchaseOrderStatus, addPoItemReceived,
};
