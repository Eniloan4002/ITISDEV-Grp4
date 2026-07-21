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

  -- ===== Sprint 3: Attendance & Manpower =====
  -- One row per shift worked. An "open" row has time_out = '' (clocked in,
  -- not yet out); a user may only have one open row at a time.
  CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    employee_name TEXT NOT NULL,        -- snapshot at time-in
    work_date TEXT NOT NULL,            -- 'YYYY-MM-DD' (local)
    time_in TEXT NOT NULL,             -- ISO timestamp
    time_out TEXT NOT NULL DEFAULT '', -- ISO timestamp or '' while open
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS shifts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    employee_name TEXT NOT NULL,        -- snapshot
    shift_date TEXT NOT NULL,           -- 'YYYY-MM-DD'
    start_time TEXT NOT NULL,           -- 'HH:MM' (24h)
    end_time TEXT NOT NULL,             -- 'HH:MM' (24h)
    created_by INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS leave_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    employee_name TEXT NOT NULL,        -- snapshot
    leave_type TEXT NOT NULL,           -- Vacation | Sick | Emergency | Personal
    start_date TEXT NOT NULL,           -- 'YYYY-MM-DD'
    end_date TEXT NOT NULL,             -- 'YYYY-MM-DD'
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Pending', -- Pending | Approved | Rejected
    reviewed_by INTEGER,
    reviewed_by_name TEXT NOT NULL DEFAULT '',
    reviewed_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  -- ===== Sprint 2: Sales & Billing (POS) =====
  -- A bill/receipt. Totals are computed and stored server-side; the client
  -- never sets them. status: Open (running bill) | Paid (settled) | Void.
  CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_number TEXT NOT NULL DEFAULT '',
    table_label TEXT NOT NULL DEFAULT '', -- optional table / customer reference
    sale_date TEXT NOT NULL DEFAULT '',   -- local 'YYYY-MM-DD' (for day grouping/filter)
    status TEXT NOT NULL DEFAULT 'Open',
    subtotal REAL NOT NULL DEFAULT 0,
    discount REAL NOT NULL DEFAULT 0,
    tax REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT '', -- Cash | Card | GCash (on settle)
    amount_tendered REAL NOT NULL DEFAULT 0,
    change_due REAL NOT NULL DEFAULT 0,
    cashier_id INTEGER NOT NULL,
    cashier_name TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    settled_at TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS sale_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    quantity REAL NOT NULL,
    unit_price REAL NOT NULL,
    line_total REAL NOT NULL
  );
`);

// Add a column to an existing table if a prior schema version lacked it.
// (CREATE TABLE IF NOT EXISTS won't alter an existing table.) Keeps dev DBs
// forward-compatible without a destructive rebuild.
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}
ensureColumn('sales', 'sale_date', "sale_date TEXT NOT NULL DEFAULT ''");

// Local calendar date 'YYYY-MM-DD' (not UTC — matters for day grouping).
function localDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

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

// ===== Admin user management (SI-10) =====

function updateUserRole(id, role) {
  return db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
}

function deleteUser(id) {
  return db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

// How many Admin accounts exist — used to block removing the last one.
function countAdmins() {
  return db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'Admin'").get().n;
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

// ===== Sprint 3: Employees (users as the employee directory) =====

function listUsers() {
  return db.prepare('SELECT id, full_name, email, role FROM users ORDER BY full_name').all();
}

// ===== Sprint 3: Attendance =====

// The user's currently-open attendance row (clocked in, not yet out), or undefined.
function findOpenAttendance(userId) {
  return db.prepare("SELECT * FROM attendance WHERE user_id = ? AND time_out = '' ORDER BY id DESC LIMIT 1").get(userId);
}

function createTimeIn({ userId, employeeName, workDate, timeIn }) {
  const info = db.prepare(
    'INSERT INTO attendance (user_id, employee_name, work_date, time_in, created_at) VALUES (?, ?, ?, ?, ?)'
  ).run(userId, employeeName, workDate, timeIn, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

function setTimeOut(id, timeOut) {
  return db.prepare('UPDATE attendance SET time_out = ? WHERE id = ?').run(timeOut, id);
}

// All attendance rows, optionally filtered by employee and/or date. Newest first.
function listAttendance({ userId, date } = {}) {
  const where = [];
  const params = [];
  if (userId) { where.push('user_id = ?'); params.push(userId); }
  if (date) { where.push('work_date = ?'); params.push(date); }
  const sql = 'SELECT * FROM attendance ' +
    (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
    'ORDER BY work_date DESC, id DESC';
  return db.prepare(sql).all(...params);
}

// ===== Sprint 3: Shifts / schedules =====

function findShiftById(id) {
  return db.prepare('SELECT * FROM shifts WHERE id = ?').get(id);
}

// Shifts for one employee on one date — used for overlap checks.
function listShiftsForDate(userId, shiftDate) {
  return db.prepare('SELECT * FROM shifts WHERE user_id = ? AND shift_date = ?').all(userId, shiftDate);
}

function listShifts({ userId, date } = {}) {
  const where = [];
  const params = [];
  if (userId) { where.push('user_id = ?'); params.push(userId); }
  if (date) { where.push('shift_date = ?'); params.push(date); }
  const sql = 'SELECT * FROM shifts ' +
    (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
    'ORDER BY shift_date DESC, start_time';
  return db.prepare(sql).all(...params);
}

function createShift({ userId, employeeName, shiftDate, startTime, endTime, createdBy }) {
  const info = db.prepare(
    'INSERT INTO shifts (user_id, employee_name, shift_date, start_time, end_time, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(userId, employeeName, shiftDate, startTime, endTime, createdBy, new Date().toISOString());
  return Number(info.lastInsertRowid);
}

function updateShift(id, { userId, employeeName, shiftDate, startTime, endTime }) {
  return db.prepare(
    'UPDATE shifts SET user_id = ?, employee_name = ?, shift_date = ?, start_time = ?, end_time = ? WHERE id = ?'
  ).run(userId, employeeName, shiftDate, startTime, endTime, id);
}

function deleteShift(id) {
  return db.prepare('DELETE FROM shifts WHERE id = ?').run(id);
}

// ===== Sprint 3: Leave requests =====

function findLeaveById(id) {
  return db.prepare('SELECT * FROM leave_requests WHERE id = ?').get(id);
}

function listLeave({ userId, status } = {}) {
  const where = [];
  const params = [];
  if (userId) { where.push('user_id = ?'); params.push(userId); }
  if (status) { where.push('status = ?'); params.push(status); }
  const sql = 'SELECT * FROM leave_requests ' +
    (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
    'ORDER BY id DESC';
  return db.prepare(sql).all(...params);
}

function createLeave({ userId, employeeName, leaveType, startDate, endDate, reason }) {
  const info = db.prepare(
    'INSERT INTO leave_requests (user_id, employee_name, leave_type, start_date, end_date, reason, status, created_at) ' +
    "VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?)"
  ).run(userId, employeeName, leaveType, startDate, endDate, reason || '', new Date().toISOString());
  return Number(info.lastInsertRowid);
}

function setLeaveStatus(id, status, reviewedBy, reviewedByName) {
  return db.prepare(
    'UPDATE leave_requests SET status = ?, reviewed_by = ?, reviewed_by_name = ?, reviewed_at = ? WHERE id = ?'
  ).run(status, reviewedBy, reviewedByName || '', new Date().toISOString(), id);
}

// Approved leave overlapping a given date (or all approved for a user). Used to
// reflect approved leave in the schedule view.
function listApprovedLeave({ userId, date } = {}) {
  const where = ["status = 'Approved'"];
  const params = [];
  if (userId) { where.push('user_id = ?'); params.push(userId); }
  if (date) { where.push('start_date <= ? AND end_date >= ?'); params.push(date, date); }
  return db.prepare('SELECT * FROM leave_requests WHERE ' + where.join(' AND ') + ' ORDER BY start_date').all(...params);
}

// ===== Sprint 2: Sales & Billing =====

function createSale({ tableLabel, subtotal, discount, tax, total, cashierId, cashierName, items }) {
  const now = new Date().toISOString();
  return tx(() => {
    const info = db.prepare(
      'INSERT INTO sales (bill_number, table_label, sale_date, status, subtotal, discount, tax, total, cashier_id, cashier_name, created_at) ' +
      "VALUES ('', ?, ?, 'Open', ?, ?, ?, ?, ?, ?, ?)"
    ).run(tableLabel || '', localDate(), subtotal, discount, tax, total, cashierId, cashierName || '', now);
    const saleId = Number(info.lastInsertRowid);
    // Official-receipt-style number derived from the row id, e.g. OR-001.
    const billNumber = 'OR-' + String(saleId).padStart(3, '0');
    db.prepare('UPDATE sales SET bill_number = ? WHERE id = ?').run(billNumber, saleId);
    for (const it of items) {
      db.prepare('INSERT INTO sale_items (sale_id, name, quantity, unit_price, line_total) VALUES (?, ?, ?, ?, ?)')
        .run(saleId, it.name, it.quantity, it.unitPrice, it.lineTotal);
    }
    return saleId;
  });
}

function listSales({ status, date, cashierId } = {}) {
  const where = [];
  const params = [];
  if (status) { where.push('status = ?'); params.push(status); }
  if (date) { where.push('sale_date = ?'); params.push(date); }
  if (cashierId) { where.push('cashier_id = ?'); params.push(cashierId); }
  const sql = 'SELECT * FROM sales ' +
    (where.length ? 'WHERE ' + where.join(' AND ') + ' ' : '') +
    'ORDER BY id DESC';
  return db.prepare(sql).all(...params);
}

function findSaleById(id) {
  return db.prepare('SELECT * FROM sales WHERE id = ?').get(id);
}

function listSaleItems(saleId) {
  return db.prepare('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id').all(saleId);
}

function settleSale(id, { paymentMethod, amountTendered, changeDue }) {
  return db.prepare(
    "UPDATE sales SET status = 'Paid', payment_method = ?, amount_tendered = ?, change_due = ?, settled_at = ? WHERE id = ?"
  ).run(paymentMethod, amountTendered, changeDue, new Date().toISOString(), id);
}

function voidSale(id) {
  return db.prepare("UPDATE sales SET status = 'Void' WHERE id = ?").run(id);
}

module.exports = {
  db,
  findUserByEmail, findUserById, createUser, updateProfile, updatePassword, createReset, getReset, markResetUsed,
  // admin user management
  updateUserRole, deleteUser, countAdmins,
  // sales & billing
  createSale, listSales, findSaleById, listSaleItems, settleSale, voidSale,
  // suppliers
  listSuppliers, findSupplierById, findSupplierByName, createSupplier, ensureSupplier,
  // ingredients
  listIngredients, findIngredientById, createIngredient, updateIngredientMeta, listCategories,
  // transactions
  applyTransaction, listTransactions,
  // purchase orders
  createPurchaseOrder, listPurchaseOrders, findPurchaseOrderById, listPoItems, findPoItemById,
  setPurchaseOrderStatus, addPoItemReceived,
  // employees / attendance / schedules / leave
  listUsers,
  findOpenAttendance, createTimeIn, setTimeOut, listAttendance,
  findShiftById, listShiftsForDate, listShifts, createShift, updateShift, deleteShift,
  findLeaveById, listLeave, createLeave, setLeaveStatus, listApprovedLeave,
};
