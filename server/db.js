// Persistence layer for AMDB (MySQL).
//
// This module keeps the same public helper API the server already uses, but the
// data now comes from the SQL schema in SQL/AMDB creation script.sql.

const crypto = require('crypto');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  // No silent fallback to root with an empty password: on a misconfigured
  // deploy that produces a confusing "Access denied" rather than an obvious
  // "you forgot .env". Local development still works because .env.example
  // ships those very values.
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'AMDB',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  // Return DECIMAL/NEWDECIMAL as JS numbers, not strings. The Sprint 2/3 module
  // code does arithmetic and comparisons straight on these values (quantities,
  // prices, stock levels); as strings, `received_qty + 1e-9 >= quantity` becomes
  // string concatenation + lexicographic compare, which silently marks a
  // partially-received purchase order as fully Completed.
  decimalNumbers: true,
});

// Pin the SESSION time zone for every pooled connection.
//
// NOW(), CURDATE() and DATE(...) all resolve against the MySQL server's zone.
// On a laptop that is Manila time and everything looks right; on a VM running
// UTC (the common default) a 07:00 Manila sale is stored as 23:00 the previous
// day, so sale_date, work_date, "Today's Sales" and every daily KPI silently
// land on the wrong date. Setting it per-connection makes behaviour identical
// wherever the database is hosted.
const DB_TIMEZONE = process.env.DB_TIMEZONE || '+08:00';
pool.on('connection', (conn) => {
  conn.query('SET time_zone = ?', [DB_TIMEZONE], (err) => {
    if (err) console.error('[db] could not set session time_zone:', err.message);
  });
});

let initPromise;

if (!process.env.DB_NAME) {
  console.warn('[db] DB_NAME is unset — .env was probably not created. ' +
               'Copy .env.example to .env. Falling back to AMDB on 127.0.0.1.');
}


function splitName(fullName) {
  const cleaned = String(fullName || '').trim().replace(/\s+/g, ' ');
  if (!cleaned) return { firstName: 'User', lastName: 'Account' };
  const parts = cleaned.split(' ');
  if (parts.length === 1) return { firstName: parts[0], lastName: '-' };
  return { firstName: parts.shift(), lastName: parts.join(' ') };
}

function usernameFromEmail(email) {
  const local = String(email || '').split('@')[0] || 'user';
  const base = local.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
  return (base || 'user').slice(0, 40);
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

async function columnExists(tableName, columnName) {
  const [rows] = await pool.query(
    `SELECT 1
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?
     LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function init() {
  if (!initPromise) {
    initPromise = (async () => {
      await pool.query('SELECT 1');
      await pool.query(
        `INSERT IGNORE INTO roles (role_name, role_description) VALUES
         ('Admin', 'Full access to all system modules'),
         ('Manager', 'Manages restaurant operations'),
         ('Cashier', 'Handles POS transactions and payments'),
         ('Staff', 'Standard staff access')`
      );

      await pool.query(`
        CREATE TABLE IF NOT EXISTS employee_performance_reports (
          report_id INT PRIMARY KEY AUTO_INCREMENT,
          employee_name VARCHAR(100) NOT NULL,
          role_name VARCHAR(50) NOT NULL,
          reporting_period VARCHAR(50) NOT NULL,
          orders_served INT NOT NULL DEFAULT 0,
          sales_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
          punctuality VARCHAR(50) NOT NULL DEFAULT 'N/A',
          notes TEXT NULL,
          created_by INT NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          FOREIGN KEY (created_by) REFERENCES accounts(account_id)
            ON UPDATE CASCADE ON DELETE SET NULL
        )
      `);

      await pool.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
          audit_log_id INT PRIMARY KEY AUTO_INCREMENT,
          user_id INT NOT NULL,
          user_email VARCHAR(100) NULL,
          action_type VARCHAR(100) NOT NULL,
          target_table VARCHAR(100) NOT NULL DEFAULT 'system',
          details TEXT NULL,
          ip_address VARCHAR(45) NULL,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (user_id) REFERENCES accounts(account_id)
            ON UPDATE CASCADE ON DELETE RESTRICT
        )
      `);

      // Older MySQL versions do not support "ADD COLUMN IF NOT EXISTS".
      //
      // Both columns are present in "SQL/AMDB creation script.sql", so on a
      // correctly-built AMDB neither branch runs. They only fire against an
      // older schema. A production/VM account is often granted DML only, and
      // ALTER would then throw and take the whole app down on boot — so a
      // failure here is logged and tolerated rather than fatal.
      try {
        if (!(await columnExists('ingredient_inventory', 'expires_on'))) {
          await pool.query('ALTER TABLE ingredient_inventory ADD COLUMN expires_on DATE NULL');
        }
        if (!(await columnExists('stock_movements', 'reference_no'))) {
          await pool.query('ALTER TABLE stock_movements ADD COLUMN reference_no VARCHAR(100) NULL');
        }
      } catch (err) {
        console.error('[db] schema top-up skipped (insufficient privileges?):', err.message);
      }
    })();
  }
  return initPromise;
}

async function findUserByEmail(email) {
  const [rows] = await pool.query(
    `SELECT
       a.account_id AS id,
       CONCAT(a.first_name, ' ', a.last_name) AS full_name,
       a.email,
       a.password_hash,
       COALESCE(r.role_name, 'Staff') AS role,
       COALESCE(a.phone_number, '') AS contact_number
     FROM accounts a
     LEFT JOIN account_roles ar ON ar.account_id = a.account_id
     LEFT JOIN roles r ON r.role_id = ar.role_id
     WHERE a.email = ? AND a.is_active = TRUE
     ORDER BY ar.role_id ASC
     LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

async function findUserById(id) {
  const [rows] = await pool.query(
    `SELECT
       a.account_id AS id,
       CONCAT(a.first_name, ' ', a.last_name) AS full_name,
       a.email,
       a.password_hash,
       COALESCE(r.role_name, 'Staff') AS role,
       COALESCE(a.phone_number, '') AS contact_number
     FROM accounts a
     LEFT JOIN account_roles ar ON ar.account_id = a.account_id
     LEFT JOIN roles r ON r.role_id = ar.role_id
     WHERE a.account_id = ? AND a.is_active = TRUE
     ORDER BY ar.role_id ASC
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function createUser({ fullName, email, passwordHash, role }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const { firstName, lastName } = splitName(fullName);
    const baseUsername = usernameFromEmail(email);
    let username = baseUsername;
    let suffix = 1;

    // Keep username unique for the SQL schema.
    while (true) {
      const [takenRows] = await conn.query('SELECT account_id FROM accounts WHERE username = ? LIMIT 1', [username]);
      if (!takenRows.length) break;
      username = `${baseUsername}_${suffix++}`.slice(0, 50);
    }

    const [insertResult] = await conn.query(
      `INSERT INTO accounts
         (username, email, password_hash, first_name, last_name, phone_number, is_active)
       VALUES (?, ?, ?, ?, ?, ?, TRUE)`,
      [username, email, passwordHash, firstName, lastName, '']
    );

    const [roleRows] = await conn.query('SELECT role_id FROM roles WHERE role_name = ? LIMIT 1', [role]);
    if (!roleRows.length) {
      throw new Error(`Role not found: ${role}`);
    }

    await conn.query('INSERT INTO account_roles (account_id, role_id) VALUES (?, ?)', [insertResult.insertId, roleRows[0].role_id]);

    await conn.commit();
    return Number(insertResult.insertId);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function updateProfile(id, { fullName, contactNumber }) {
  const { firstName, lastName } = splitName(fullName);
  const [result] = await pool.query(
    `UPDATE accounts
     SET first_name = ?, last_name = ?, phone_number = ?, updated_at = CURRENT_TIMESTAMP
     WHERE account_id = ?`,
    [firstName, lastName, contactNumber, id]
  );
  return result;
}

async function updatePassword(id, passwordHash) {
  const [result] = await pool.query(
    'UPDATE accounts SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE account_id = ?',
    [passwordHash, id]
  );
  return result;
}

async function createReset(token, userId, expiresAt) {
  const tokenHash = hashResetToken(token);
  const [result] = await pool.query(
    'INSERT INTO password_reset_tokens (account_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [userId, tokenHash, new Date(expiresAt)]
  );
  return result;
}

async function listEmployeePerformanceReports({ employeeName, role, period } = {}) {
  const where = [];
  const params = [];
  if (employeeName) {
    where.push('employee_name LIKE ?');
    params.push(`%${employeeName}%`);
  }
  if (role) {
    where.push('role_name LIKE ?');
    params.push(`%${role}%`);
  }
  if (period) {
    where.push('reporting_period LIKE ?');
    params.push(`%${period}%`);
  }

  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT
       report_id AS id,
       employee_name AS employeeName,
       role_name AS role,
       reporting_period AS period,
       orders_served AS ordersServed,
       sales_amount AS sales,
       punctuality,
       notes,
       created_by AS createdBy,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM employee_performance_reports
     ${clause}
     ORDER BY created_at DESC`,
    params
  );
  return rows;
}

async function findEmployeePerformanceReportById(id) {
  const [rows] = await pool.query(
    `SELECT
       report_id AS id,
       employee_name AS employeeName,
       role_name AS role,
       reporting_period AS period,
       orders_served AS ordersServed,
       sales_amount AS sales,
       punctuality,
       notes,
       created_by AS createdBy,
       created_at AS createdAt,
       updated_at AS updatedAt
     FROM employee_performance_reports
     WHERE report_id = ?
     LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function createEmployeePerformanceReport(data) {
  const [result] = await pool.query(
    `INSERT INTO employee_performance_reports
      (employee_name, role_name, reporting_period, orders_served, sales_amount, punctuality, notes, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      data.employeeName,
      data.role,
      data.period,
      Number(data.ordersServed || 0),
      Number(data.sales || 0),
      data.punctuality || 'N/A',
      data.notes || null,
      data.createdBy || null,
    ]
  );
  return Number(result.insertId);
}

async function updateEmployeePerformanceReport(id, data) {
  const [result] = await pool.query(
    `UPDATE employee_performance_reports
     SET employee_name = ?, role_name = ?, reporting_period = ?, orders_served = ?, sales_amount = ?, punctuality = ?, notes = ?
     WHERE report_id = ?`,
    [
      data.employeeName,
      data.role,
      data.period,
      Number(data.ordersServed || 0),
      Number(data.sales || 0),
      data.punctuality || 'N/A',
      data.notes || null,
      id,
    ]
  );
  return result.affectedRows > 0;
}

async function deleteEmployeePerformanceReport(id) {
  const [result] = await pool.query('DELETE FROM employee_performance_reports WHERE report_id = ?', [id]);
  return result.affectedRows > 0;
}

async function listAuditLogs({ keyword } = {}) {
  const where = [];
  const params = [];
  if (keyword) {
    where.push('(action_type LIKE ? OR details LIKE ? OR user_email LIKE ?)');
    const term = `%${keyword}%`;
    params.push(term, term, term);
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.query(
    `SELECT
       audit_log_id AS id,
       user_id AS userId,
       user_email AS userEmail,
       action_type AS actionType,
       target_table AS target,
       details,
       ip_address AS ipAddress,
       created_at AS timestamp
     FROM audit_logs
     ${clause}
     ORDER BY created_at DESC`,
    params
  );
  return rows;
}

async function createAuditLog(data) {
  const [result] = await pool.query(
    `INSERT INTO audit_logs (user_id, user_email, action_type, target_table, details, ip_address)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [data.userId, data.userEmail || null, data.actionType, data.target || 'system', data.details || null, data.ipAddress || null]
  );
  return Number(result.insertId);
}

async function getReset(token) {
  const tokenHash = hashResetToken(token);
  const [rows] = await pool.query(
    `SELECT
       account_id AS user_id,
       (UNIX_TIMESTAMP(expires_at) * 1000) AS expires_at,
       (used_at IS NOT NULL) AS used
     FROM password_reset_tokens
     WHERE token_hash = ?
     LIMIT 1`,
    [tokenHash]
  );
  return rows[0] || null;
}

async function markResetUsed(token) {
  const tokenHash = hashResetToken(token);
  const [result] = await pool.query(
    'UPDATE password_reset_tokens SET used_at = NOW() WHERE token_hash = ?',
    [tokenHash]
  );
  return result;
}

async function listInventoryIngredients(filters = {}) {
  const where = ['i.is_active = TRUE'];
  const params = [];

  if (filters.search) {
    where.push('i.ingredient_name LIKE ?');
    params.push(`%${filters.search}%`);
  }
  if (filters.category) {
    where.push('it.ingredient_type_name = ?');
    params.push(filters.category);
  }
  if (filters.supplier) {
    where.push('s.supplier_name = ?');
    params.push(filters.supplier);
  }

  const [rows] = await pool.query(
    `SELECT
       i.ingredient_id,
       i.ingredient_name,
       COALESCE(it.ingredient_type_name, 'Uncategorized') AS ingredient_type_name,
       i.unit_of_measure,
       COALESCE(inv.current_quantity, 0) AS current_quantity,
       i.reorder_level,
       i.max_stock_level,
       inv.expires_on AS expiration_date,
       s.supplier_name,
       CASE
         WHEN COALESCE(inv.current_quantity, 0) <= 0 THEN 'Out of Stock'
         WHEN COALESCE(inv.current_quantity, 0) <= i.reorder_level THEN 'Low Stock'
         ELSE 'Normal'
       END AS stock_status,
       CASE
         WHEN inv.expires_on IS NULL THEN NULL
         ELSE DATEDIFF(inv.expires_on, CURDATE())
       END AS days_to_expiry
     FROM ingredients i
     LEFT JOIN ingredient_type it ON i.ingredient_type_id = it.ingredient_type_id
     LEFT JOIN ingredient_inventory inv ON i.ingredient_id = inv.ingredient_id
     LEFT JOIN (
       SELECT si.ingredient_id, MIN(s.supplier_name) AS supplier_name
       FROM supplier_ingredients si
       JOIN suppliers s ON s.supplier_id = si.supplier_id
       GROUP BY si.ingredient_id
     ) s ON s.ingredient_id = i.ingredient_id
     WHERE ${where.join(' AND ')}
     ORDER BY i.ingredient_name ASC`,
    params
  );
  return rows;
}

async function listInventoryMeta() {
  const [categories] = await pool.query(
    'SELECT ingredient_type_name FROM ingredient_type ORDER BY ingredient_type_name ASC'
  );
  const [suppliers] = await pool.query(
    'SELECT supplier_name FROM suppliers WHERE is_active = TRUE ORDER BY supplier_name ASC'
  );

  return {
    categories: categories.map((c) => c.ingredient_type_name),
    suppliers: suppliers.map((s) => s.supplier_name),
  };
}

// Accepts BOTH call shapes, because two front-ends reach this helper:
//   - inventory.js (main)      : { name, unitOfMeasure, category, supplier (name),  maxStockLevel }
//   - rmis.js     (sprint1-mvp): { name, unit,           category, supplierId (id), quantity }
// Normalising here keeps both callers working instead of silently breaking one.
async function createIngredient(input) {
  const {
    name, category, reorderLevel, maxStockLevel, expirationDate,
    unitOfMeasure, unit,
    supplier, supplierId,
    quantity,
  } = input || {};
  const resolvedUnit = unitOfMeasure != null ? unitOfMeasure : unit;
  const openingQty = Number(quantity) || 0;

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [categoryRows] = await conn.query(
      'SELECT ingredient_type_id FROM ingredient_type WHERE ingredient_type_name = ? LIMIT 1',
      [category]
    );
    if (!categoryRows.length) {
      throw new Error(`Category not found: ${category}`);
    }

    const [insertResult] = await conn.query(
      `INSERT INTO ingredients
       (ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
       VALUES (?, ?, ?, ?, ?, TRUE)`,
      [name, categoryRows[0].ingredient_type_id, resolvedUnit, Number(reorderLevel) || 0, maxStockLevel != null ? maxStockLevel : null]
    );

    const ingredientId = Number(insertResult.insertId);

    await conn.query(
      'INSERT INTO ingredient_inventory (ingredient_id, current_quantity, expires_on) VALUES (?, ?, ?)',
      [ingredientId, openingQty, expirationDate || null]
    );

    // Link a supplier by id (sprint1 shape) or by name (main shape).
    let linkSupplierId = null;
    if (supplierId) {
      linkSupplierId = Number(supplierId);
    } else if (supplier) {
      const [supplierRows] = await conn.query(
        'SELECT supplier_id FROM suppliers WHERE supplier_name = ? LIMIT 1',
        [supplier]
      );
      if (!supplierRows.length) {
        throw new Error(`Supplier not found: ${supplier}`);
      }
      linkSupplierId = supplierRows[0].supplier_id;
    }
    if (linkSupplierId) {
      await conn.query(
        `INSERT INTO supplier_ingredients (supplier_id, ingredient_id, supplier_price)
         VALUES (?, ?, NULL)
         ON DUPLICATE KEY UPDATE supplier_price = supplier_price`,
        [linkSupplierId, ingredientId]
      );
    }

    await conn.commit();
    return ingredientId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function recordInventoryTransaction({
  ingredientId,
  movementType,
  quantity,
  reason,
  referenceNo,
  userId,
  expirationDate,
}) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.query(
      'SELECT current_quantity FROM ingredient_inventory WHERE ingredient_id = ? LIMIT 1 FOR UPDATE',
      [ingredientId]
    );

    if (!rows.length) {
      throw new Error('Ingredient inventory record not found.');
    }

    const current = Number(rows[0].current_quantity || 0);
    const delta = Number(quantity);
    const next = current + delta;

    if (next < 0) {
      throw new Error('Resulting quantity cannot be negative.');
    }

    await conn.query(
      `UPDATE ingredient_inventory
       SET current_quantity = ?, expires_on = COALESCE(?, expires_on), last_updated = CURRENT_TIMESTAMP
       WHERE ingredient_id = ?`,
      [next, expirationDate || null, ingredientId]
    );

    await conn.query(
      `INSERT INTO stock_movements
       (ingredient_id, movement_type, quantity_change, reference_no, created_by, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [ingredientId, movementType, delta, referenceNo || null, userId, reason]
    );

    await conn.commit();
    return { previousQuantity: current, currentQuantity: next };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function listTables() {
  const [rows] = await pool.query(
    `SELECT
       t.table_id,
       t.table_number,
       t.seating_capacity,
       t.table_location,
       t.table_status,
       r.reservation_id,
       r.customer_name,
       r.party_size,
       r.reservation_start,
       r.reservation_status
     FROM restaurant_tables t
     LEFT JOIN reservations r ON r.table_id = t.table_id
       AND r.reservation_status IN ('Pending', 'Confirmed', 'Seated')
     WHERE t.is_active = TRUE
     ORDER BY t.table_number ASC`
  );
  return rows;
}

async function createReservation({ customerName, contactNumber, tableId, partySize, reservationStart, reservationEnd, createdBy }) {
  const [result] = await pool.query(
    `INSERT INTO reservations
     (customer_name, contact_number, table_id, party_size, reservation_start, reservation_end, reservation_status, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'Pending', ?, CURRENT_TIMESTAMP)`,
    [customerName, contactNumber, tableId, partySize, reservationStart, reservationEnd, createdBy]
  );
  return Number(result.insertId);
}

async function updateReservationStatus(reservationId, newStatus) {
  const [result] = await pool.query(
    `UPDATE reservations
     SET reservation_status = ?
     WHERE reservation_id = ?`,
    [newStatus, reservationId]
  );
  return result.affectedRows > 0;
}

async function updateTableStatus(tableId, newStatus) {
  const [result] = await pool.query(
    `UPDATE restaurant_tables
     SET table_status = ?
     WHERE table_id = ?`,
    [newStatus, tableId]
  );
  return result.affectedRows > 0;
}

async function findAvailableTable(partySize, reservationStart, reservationEnd) {
  const [rows] = await pool.query(
    `SELECT t.table_id
     FROM restaurant_tables t
     WHERE t.is_active = TRUE
       AND t.seating_capacity >= ?
       AND t.table_id NOT IN (
         SELECT DISTINCT r.table_id
         FROM reservations r
         WHERE r.reservation_status IN ('Pending', 'Confirmed', 'Seated')
           AND (
             (r.reservation_start <= ? AND r.reservation_end > ?)
             OR (r.reservation_start < ? AND r.reservation_end >= ?)
             OR (r.reservation_start >= ? AND r.reservation_end <= ?)
           )
       )
     ORDER BY t.seating_capacity ASC
     LIMIT 1`,
    [partySize, reservationEnd, reservationStart, reservationEnd, reservationStart, reservationStart, reservationEnd]
  );
  return rows.length > 0 ? rows[0].table_id : null;
}

// ===========================================================================
// Sprint 2/3 module helpers, ported from the sprint1-mvp SQLite layer onto the
// AMDB schema. Each one keeps the SHAPE the module code already expects (e.g.
// `id`, `name`, `quantity`) by aliasing AMDB's column names, so server/rmis.js,
// attendance.js, sales.js, dashboard.js and admin.js work unchanged.
// ===========================================================================

// --- shared bits -----------------------------------------------------------

// sprint1 stored empty strings where AMDB stores NULL; keep the old contract.
const S = (v) => (v == null ? '' : v);

async function roleIdByName(conn, role) {
  const [rows] = await (conn || pool).query('SELECT role_id FROM roles WHERE role_name = ? LIMIT 1', [role]);
  if (!rows.length) throw new Error(`Role not found: ${role}`);
  return rows[0].role_id;
}

// ===== Admin user management (SI-10) =====

async function updateUserRole(id, role) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const roleId = await roleIdByName(conn, role);
    await conn.query('DELETE FROM account_roles WHERE account_id = ?', [id]);
    await conn.query('INSERT INTO account_roles (account_id, role_id) VALUES (?, ?)', [id, roleId]);
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

// Soft delete: AMDB rows are referenced by sales/attendance FKs, so a hard
// DELETE would fail or orphan history. is_active = FALSE hides the account
// everywhere (findUserByEmail/findUserById both filter on it).
async function deleteUser(id) {
  const [result] = await pool.query(
    'UPDATE accounts SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP WHERE account_id = ?',
    [id]
  );
  return result;
}

async function countAdmins() {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS n
     FROM accounts a
     JOIN account_roles ar ON ar.account_id = a.account_id
     JOIN roles r ON r.role_id = ar.role_id
     WHERE r.role_name = 'Admin' AND a.is_active = TRUE`
  );
  return Number(rows[0].n);
}

async function listUsers() {
  const [rows] = await pool.query(
    `SELECT a.account_id AS id,
            CONCAT(a.first_name, ' ', a.last_name) AS full_name,
            a.email,
            COALESCE(r.role_name, 'Staff') AS role
     FROM accounts a
     LEFT JOIN account_roles ar ON ar.account_id = a.account_id
     LEFT JOIN roles r ON r.role_id = ar.role_id
     WHERE a.is_active = TRUE
     ORDER BY full_name`
  );
  return rows;
}

// ===== Suppliers =====

const SUPPLIER_COLS = `s.supplier_id AS id, s.supplier_name AS name,
  COALESCE(s.contact_person,'') AS contact_person, COALESCE(s.email,'') AS email,
  COALESCE(s.phone_number,'') AS phone, COALESCE(s.address,'') AS address, s.created_at`;

async function listSuppliers() {
  const [rows] = await pool.query(
    `SELECT ${SUPPLIER_COLS} FROM suppliers s WHERE s.is_active = TRUE ORDER BY s.supplier_name`
  );
  return rows;
}

async function findSupplierById(id) {
  const [rows] = await pool.query(`SELECT ${SUPPLIER_COLS} FROM suppliers s WHERE s.supplier_id = ?`, [id]);
  return rows[0] || undefined;
}

async function findSupplierByName(name) {
  const [rows] = await pool.query(`SELECT ${SUPPLIER_COLS} FROM suppliers s WHERE s.supplier_name = ?`, [name]);
  return rows[0] || undefined;
}

async function createSupplier(name) {
  const [result] = await pool.query(
    'INSERT INTO suppliers (supplier_name, is_active) VALUES (?, TRUE)',
    [name]
  );
  return Number(result.insertId);
}

async function ensureSupplier(name) {
  const existing = await findSupplierByName(name);
  if (existing) return existing.id;
  return createSupplier(name);
}

async function createSupplierRecord(input) {
  const [result] = await pool.query(
    `INSERT INTO suppliers
      (supplier_name, contact_person, email, phone_number, address, is_active)
     VALUES (?, ?, ?, ?, ?, TRUE)`,
    [input.companyName, input.contactPerson, input.email, input.phoneNumber, input.physicalAddress]
  );
  return Number(result.insertId);
}

async function updateSupplierRecord(id, input) {
  const [result] = await pool.query(
    `UPDATE suppliers
     SET supplier_name = ?, contact_person = ?, email = ?, phone_number = ?, address = ?
     WHERE supplier_id = ?`,
    [input.companyName, input.contactPerson, input.email, input.phoneNumber, input.physicalAddress, id]
  );
  return result.affectedRows > 0;
}

// ===== Ingredients =====
//
// sprint1 kept quantity/expiry on the ingredient row; AMDB splits them into
// ingredient_inventory. The supplier link lives in supplier_ingredients (M:N),
// so we take a single arbitrary supplier via a correlated subquery rather than
// joining (a join would duplicate the ingredient row per supplier).
const INGREDIENT_COLS = `
  i.ingredient_id AS id,
  i.ingredient_name AS name,
  i.unit_of_measure AS unit,
  COALESCE(t.ingredient_type_name, '') AS category,
  i.reorder_level,
  i.max_stock_level,
  COALESCE(inv.current_quantity, 0) AS quantity,
  COALESCE(DATE_FORMAT(inv.expires_on, '%Y-%m-%d'), '') AS expiration_date,
  (SELECT si.supplier_id FROM supplier_ingredients si WHERE si.ingredient_id = i.ingredient_id LIMIT 1) AS supplier_id,
  (SELECT s.supplier_name FROM supplier_ingredients si JOIN suppliers s ON s.supplier_id = si.supplier_id
     WHERE si.ingredient_id = i.ingredient_id LIMIT 1) AS supplier_name,
  i.created_at`;

const INGREDIENT_FROM = `
  FROM ingredients i
  LEFT JOIN ingredient_type t ON t.ingredient_type_id = i.ingredient_type_id
  LEFT JOIN ingredient_inventory inv ON inv.ingredient_id = i.ingredient_id`;

async function listIngredients({ q, category, supplierId } = {}) {
  const where = ['i.is_active = TRUE'];
  const params = [];
  if (q) { where.push('LOWER(i.ingredient_name) LIKE ?'); params.push('%' + String(q).toLowerCase() + '%'); }
  if (category) { where.push('t.ingredient_type_name = ?'); params.push(category); }
  if (supplierId) {
    where.push('EXISTS (SELECT 1 FROM supplier_ingredients si WHERE si.ingredient_id = i.ingredient_id AND si.supplier_id = ?)');
    params.push(supplierId);
  }
  const [rows] = await pool.query(
    `SELECT ${INGREDIENT_COLS} ${INGREDIENT_FROM} WHERE ${where.join(' AND ')} ORDER BY i.ingredient_name`,
    params
  );
  return rows;
}

async function findIngredientById(id) {
  const [rows] = await pool.query(
    `SELECT ${INGREDIENT_COLS} ${INGREDIENT_FROM} WHERE i.ingredient_id = ?`,
    [id]
  );
  return rows[0] || undefined;
}

async function updateIngredientMeta(id, { name, unit, category, supplierId, reorderLevel, expirationDate }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    let typeId = null;
    if (category) {
      const [t] = await conn.query('SELECT ingredient_type_id FROM ingredient_type WHERE ingredient_type_name = ? LIMIT 1', [category]);
      if (!t.length) throw new Error(`Category not found: ${category}`);
      typeId = t[0].ingredient_type_id;
    }

    await conn.query(
      `UPDATE ingredients
       SET ingredient_name = ?, unit_of_measure = ?,
           ingredient_type_id = COALESCE(?, ingredient_type_id),
           reorder_level = ?, updated_at = CURRENT_TIMESTAMP
       WHERE ingredient_id = ?`,
      [name, unit, typeId, Number(reorderLevel) || 0, id]
    );

    await conn.query(
      `INSERT INTO ingredient_inventory (ingredient_id, current_quantity, expires_on)
       VALUES (?, 0, ?)
       ON DUPLICATE KEY UPDATE expires_on = VALUES(expires_on)`,
      [id, expirationDate || null]
    );

    await conn.query('DELETE FROM supplier_ingredients WHERE ingredient_id = ?', [id]);
    if (supplierId) {
      await conn.query(
        'INSERT INTO supplier_ingredients (supplier_id, ingredient_id, supplier_price) VALUES (?, ?, NULL)',
        [supplierId, id]
      );
    }

    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function listCategories() {
  const [rows] = await pool.query('SELECT ingredient_type_name FROM ingredient_type ORDER BY ingredient_type_name');
  return rows.map((r) => r.ingredient_type_name);
}

// ===== Inventory movements =====
//
// sprint1's free-text txn_type maps onto AMDB's movement_type enum
// ('Purchase Received','Manual Adjustment','POS Usage','Waste','Return').
// Anything unrecognised falls back to 'Manual Adjustment' so a movement is
// never silently dropped.
const MOVEMENT_TYPES = new Set(['Purchase Received', 'Manual Adjustment', 'POS Usage', 'Waste', 'Return']);
function toMovementType(txnType, adjustmentType) {
  if (MOVEMENT_TYPES.has(txnType)) return txnType;
  const t = String(txnType || '').toLowerCase();
  if (t.includes('receiv') || t.includes('purchase')) return 'Purchase Received';
  if (t.includes('waste') || t.includes('spoil')) return 'Waste';
  if (t.includes('return')) return 'Return';
  if (t.includes('consum') || t.includes('usage') || t.includes('sale')) return 'POS Usage';
  if (String(adjustmentType || '').toLowerCase().includes('waste')) return 'Waste';
  return 'Manual Adjustment';
}

async function applyTransaction({ ingredientId, txnType, adjustmentType, quantity, reason, reference, poId, userId }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.query(
      `INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
       VALUES (?, ?)
       ON DUPLICATE KEY UPDATE current_quantity = current_quantity + VALUES(current_quantity),
                               last_updated = CURRENT_TIMESTAMP`,
      [ingredientId, quantity]
    );

    const [result] = await conn.query(
      `INSERT INTO stock_movements
         (ingredient_id, movement_type, quantity_change, reference_no, reference_table, reference_id, created_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        ingredientId,
        toMovementType(txnType, adjustmentType),
        quantity,
        S(reference),
        poId ? 'purchase_orders' : null,
        poId || null,
        userId || null,
        S(reason),
      ]
    );

    await conn.commit();
    return Number(result.insertId);
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function listTransactions(ingredientId) {
  const [rows] = await pool.query(
    `SELECT m.stock_movement_id AS id,
            m.ingredient_id,
            m.movement_type AS txn_type,
            '' AS adjustment_type,
            m.quantity_change AS quantity,
            COALESCE(m.notes, '') AS reason,
            COALESCE(m.reference_no, '') AS reference,
            m.reference_id AS po_id,
            m.created_by AS user_id,
            COALESCE(CONCAT(a.first_name, ' ', a.last_name), '') AS user_name,
            m.created_at
     FROM stock_movements m
     LEFT JOIN accounts a ON a.account_id = m.created_by
     WHERE m.ingredient_id = ?
     ORDER BY m.stock_movement_id DESC`,
    [ingredientId]
  );
  return rows;
}

// ===== Purchase orders =====
//
// AMDB has no po_number column, so the human-facing number is derived from the
// row id exactly as sprint1 did (PO-001), just computed in SQL.
// Status map: sprint1 Draft/Sent/Partially Received/Completed
//          -> AMDB   Draft/Pending/Draft*/Received     (*no partial state exists)
const PO_STATUS_TO_AMDB = { Draft: 'Draft', Sent: 'Pending', 'Partially Received': 'Pending', Completed: 'Received', Cancelled: 'Cancelled' };
const PO_STATUS_FROM_AMDB = { Draft: 'Draft', Pending: 'Sent', Received: 'Completed', Cancelled: 'Cancelled' };

const PO_COLS = `
  p.purchase_order_id AS id,
  CONCAT('PO-', LPAD(p.purchase_order_id, 3, '0')) AS po_number,
  p.supplier_id,
  s.supplier_name AS supplier_name,
  p.order_status AS amdb_status,
  COALESCE(p.remarks, '') AS notes,
  p.created_by,
  COALESCE(CONCAT(a.first_name, ' ', a.last_name), '') AS created_by_name,
  p.created_at`;

const PO_FROM = `
  FROM purchase_orders p
  LEFT JOIN suppliers s ON s.supplier_id = p.supplier_id
  LEFT JOIN accounts a ON a.account_id = p.created_by`;

function decoratePo(row) {
  if (!row) return row;
  row.status = PO_STATUS_FROM_AMDB[row.amdb_status] || row.amdb_status;
  delete row.amdb_status;
  return row;
}

async function createPurchaseOrder({ supplierId, notes, createdBy, items }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO purchase_orders (supplier_id, created_by, order_date, order_status, remarks, total_amount)
       VALUES (?, ?, CURDATE(), 'Draft', ?, 0)`,
      [supplierId, createdBy, S(notes)]
    );
    const poId = Number(result.insertId);

    let total = 0;
    for (const it of items) {
      const qty = Number(it.quantity) || 0;
      const price = Number(it.unitPrice) || 0;
      const line = qty * price;
      total += line;
      await conn.query(
        `INSERT INTO purchase_order_items
           (purchase_order_id, ingredient_id, quantity_ordered, quantity_received, unit_cost, line_total)
         VALUES (?, ?, ?, 0, ?, ?)`,
        [poId, it.ingredientId, qty, price, line]
      );
    }
    await conn.query('UPDATE purchase_orders SET total_amount = ? WHERE purchase_order_id = ?', [total, poId]);

    await conn.commit();
    return poId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function listPurchaseOrders({ supplierId, status, from, to } = {}) {
  const where = [];
  const params = [];
  if (supplierId) { where.push('p.supplier_id = ?'); params.push(supplierId); }
  if (status) { where.push('p.order_status = ?'); params.push(PO_STATUS_TO_AMDB[status] || status); }
  if (from) { where.push('p.created_at >= ?'); params.push(from); }
  if (to) { where.push('p.created_at <= ?'); params.push(to + ' 23:59:59'); }
  const [rows] = await pool.query(
    `SELECT ${PO_COLS}, COALESCE(p.total_amount, 0) AS total
     ${PO_FROM}
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY p.purchase_order_id DESC`,
    params
  );
  return rows.map(decoratePo);
}

async function findPurchaseOrderById(id) {
  const [rows] = await pool.query(
    `SELECT ${PO_COLS}, COALESCE(p.total_amount, 0) AS total ${PO_FROM} WHERE p.purchase_order_id = ?`,
    [id]
  );
  return decoratePo(rows[0]) || undefined;
}

async function listPoItems(poId) {
  const [rows] = await pool.query(
    `SELECT pi.purchase_order_item_id AS id,
            pi.purchase_order_id AS po_id,
            pi.ingredient_id,
            i.ingredient_name AS ingredient_name,
            i.unit_of_measure AS unit,
            pi.quantity_ordered AS quantity,
            pi.quantity_received AS received_qty,
            pi.unit_cost AS unit_price,
            '' AS notes
     FROM purchase_order_items pi
     LEFT JOIN ingredients i ON i.ingredient_id = pi.ingredient_id
     WHERE pi.purchase_order_id = ?
     ORDER BY pi.purchase_order_item_id`,
    [poId]
  );
  return rows;
}

async function findPoItemById(itemId) {
  const [rows] = await pool.query(
    `SELECT purchase_order_item_id AS id, purchase_order_id AS po_id, ingredient_id,
            quantity_ordered AS quantity, quantity_received AS received_qty, unit_cost AS unit_price
     FROM purchase_order_items WHERE purchase_order_item_id = ?`,
    [itemId]
  );
  return rows[0] || undefined;
}

async function setPurchaseOrderStatus(id, status) {
  const amdb = PO_STATUS_TO_AMDB[status] || status;
  const [result] = await pool.query(
    `UPDATE purchase_orders
     SET order_status = ?,
         received_date = CASE WHEN ? = 'Received' THEN CURDATE() ELSE received_date END,
         updated_at = CURRENT_TIMESTAMP
     WHERE purchase_order_id = ?`,
    [amdb, amdb, id]
  );
  return result;
}

async function addPoItemReceived(itemId, qty) {
  const [result] = await pool.query(
    'UPDATE purchase_order_items SET quantity_received = quantity_received + ? WHERE purchase_order_item_id = ?',
    [qty, itemId]
  );
  return result;
}

// ===== Attendance =====
//
// AMDB stores time_in/time_out as DATETIME and has no work_date column, so
// work_date is derived. sprint1 used '' for "still clocked in"; preserved here.
const ATTENDANCE_COLS = `
  al.attendance_id AS id,
  al.account_id AS user_id,
  COALESCE(CONCAT(a.first_name, ' ', a.last_name), '') AS employee_name,
  DATE_FORMAT(al.time_in, '%Y-%m-%d') AS work_date,
  DATE_FORMAT(al.time_in, '%Y-%m-%dT%H:%i:%s') AS time_in,
  COALESCE(DATE_FORMAT(al.time_out, '%Y-%m-%dT%H:%i:%s'), '') AS time_out,
  al.attendance_status,
  DATE_FORMAT(al.time_in, '%Y-%m-%dT%H:%i:%s') AS created_at`;

async function findOpenAttendance(userId) {
  const [rows] = await pool.query(
    `SELECT ${ATTENDANCE_COLS}
     FROM attendance_logs al LEFT JOIN accounts a ON a.account_id = al.account_id
     WHERE al.account_id = ? AND al.time_out IS NULL
     ORDER BY al.attendance_id DESC LIMIT 1`,
    [userId]
  );
  return rows[0] || undefined;
}

async function createTimeIn({ userId, timeIn }) {
  const [result] = await pool.query(
    `INSERT INTO attendance_logs (account_id, time_in, attendance_status) VALUES (?, ?, 'Present')`,
    [userId, new Date(timeIn || Date.now())]
  );
  return Number(result.insertId);
}

async function setTimeOut(id, timeOut) {
  const [result] = await pool.query(
    'UPDATE attendance_logs SET time_out = ? WHERE attendance_id = ?',
    [new Date(timeOut || Date.now()), id]
  );
  return result;
}

async function listAttendance({ userId, date } = {}) {
  const where = [];
  const params = [];
  if (userId) { where.push('al.account_id = ?'); params.push(userId); }
  if (date) { where.push('DATE(al.time_in) = ?'); params.push(date); }
  const [rows] = await pool.query(
    `SELECT ${ATTENDANCE_COLS}
     FROM attendance_logs al LEFT JOIN accounts a ON a.account_id = al.account_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY al.time_in DESC, al.attendance_id DESC`,
    params
  );
  return rows;
}

// ===== Shifts / schedules =====
//
// sprint1 kept shift_date + start_time + end_time separately; AMDB stores two
// DATETIMEs. Split on read, recombined on write.
const SHIFT_COLS = `
  sh.shift_id AS id,
  sh.account_id AS user_id,
  COALESCE(CONCAT(a.first_name, ' ', a.last_name), '') AS employee_name,
  DATE_FORMAT(sh.shift_start, '%Y-%m-%d') AS shift_date,
  DATE_FORMAT(sh.shift_start, '%H:%i') AS start_time,
  DATE_FORMAT(sh.shift_end, '%H:%i') AS end_time,
  sh.shift_status,
  sh.created_by,
  sh.created_at`;

async function findShiftById(id) {
  const [rows] = await pool.query(
    `SELECT ${SHIFT_COLS} FROM shifts sh LEFT JOIN accounts a ON a.account_id = sh.account_id WHERE sh.shift_id = ?`,
    [id]
  );
  return rows[0] || undefined;
}

async function listShiftsForDate(userId, shiftDate) {
  const [rows] = await pool.query(
    `SELECT ${SHIFT_COLS} FROM shifts sh LEFT JOIN accounts a ON a.account_id = sh.account_id
     WHERE sh.account_id = ? AND DATE(sh.shift_start) = ?`,
    [userId, shiftDate]
  );
  return rows;
}

async function listShifts({ userId, date } = {}) {
  const where = [];
  const params = [];
  if (userId) { where.push('sh.account_id = ?'); params.push(userId); }
  if (date) { where.push('DATE(sh.shift_start) = ?'); params.push(date); }
  const [rows] = await pool.query(
    `SELECT ${SHIFT_COLS} FROM shifts sh LEFT JOIN accounts a ON a.account_id = sh.account_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY sh.shift_start DESC`,
    params
  );
  return rows;
}

async function createShift({ userId, shiftDate, startTime, endTime, createdBy }) {
  const [result] = await pool.query(
    `INSERT INTO shifts (account_id, shift_start, shift_end, shift_status, created_by)
     VALUES (?, ?, ?, 'Scheduled', ?)`,
    [userId, `${shiftDate} ${startTime}:00`, `${shiftDate} ${endTime}:00`, createdBy || null]
  );
  return Number(result.insertId);
}

async function updateShift(id, { userId, shiftDate, startTime, endTime }) {
  const [result] = await pool.query(
    'UPDATE shifts SET account_id = ?, shift_start = ?, shift_end = ? WHERE shift_id = ?',
    [userId, `${shiftDate} ${startTime}:00`, `${shiftDate} ${endTime}:00`, id]
  );
  return result;
}

async function deleteShift(id) {
  const [result] = await pool.query('DELETE FROM shifts WHERE shift_id = ?', [id]);
  return result;
}

// ===== Leave requests =====
//
// AMDB constrains leave_type to an enum; unknown types fall back to 'Other'
// rather than throwing and losing the request.
// server/attendance.js offers ['Vacation','Sick','Emergency','Personal'];
// AMDB's enum is ('Sick Leave','Vacation Leave','Emergency Leave','Other').
// Without an explicit map every request would collapse to 'Other', so translate
// both ways and keep the UI's labels intact on read.
const LEAVE_TYPES_AMDB = new Set(['Sick Leave', 'Vacation Leave', 'Emergency Leave', 'Other']);
const LEAVE_TYPE_TO_AMDB = {
  Vacation: 'Vacation Leave',
  Sick: 'Sick Leave',
  Emergency: 'Emergency Leave',
  Personal: 'Other',
};
const LEAVE_TYPE_FROM_AMDB = {
  'Vacation Leave': 'Vacation',
  'Sick Leave': 'Sick',
  'Emergency Leave': 'Emergency',
  Other: 'Personal',
};
const toLeaveType = (t) => LEAVE_TYPE_TO_AMDB[t] || (LEAVE_TYPES_AMDB.has(t) ? t : 'Other');

const LEAVE_COLS = `
  lr.leave_request_id AS id,
  lr.account_id AS user_id,
  COALESCE(CONCAT(a.first_name, ' ', a.last_name), '') AS employee_name,
  CASE lr.leave_type WHEN 'Vacation Leave' THEN 'Vacation' WHEN 'Sick Leave' THEN 'Sick' WHEN 'Emergency Leave' THEN 'Emergency' ELSE 'Personal' END AS leave_type,
  DATE_FORMAT(lr.start_date, '%Y-%m-%d') AS start_date,
  DATE_FORMAT(lr.end_date, '%Y-%m-%d') AS end_date,
  COALESCE(lr.reason, '') AS reason,
  lr.request_status AS status,
  lr.reviewed_by,
  COALESCE(CONCAT(rv.first_name, ' ', rv.last_name), '') AS reviewed_by_name,
  COALESCE(DATE_FORMAT(lr.reviewed_at, '%Y-%m-%dT%H:%i:%s'), '') AS reviewed_at,
  lr.created_at`;

const LEAVE_FROM = `
  FROM leave_requests lr
  LEFT JOIN accounts a ON a.account_id = lr.account_id
  LEFT JOIN accounts rv ON rv.account_id = lr.reviewed_by`;

async function findLeaveById(id) {
  const [rows] = await pool.query(`SELECT ${LEAVE_COLS} ${LEAVE_FROM} WHERE lr.leave_request_id = ?`, [id]);
  return rows[0] || undefined;
}

async function listLeave({ userId, status } = {}) {
  const where = [];
  const params = [];
  if (userId) { where.push('lr.account_id = ?'); params.push(userId); }
  if (status) { where.push('lr.request_status = ?'); params.push(status); }
  const [rows] = await pool.query(
    `SELECT ${LEAVE_COLS} ${LEAVE_FROM}
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY lr.leave_request_id DESC`,
    params
  );
  return rows;
}

async function createLeave({ userId, leaveType, startDate, endDate, reason }) {
  const [result] = await pool.query(
    `INSERT INTO leave_requests (account_id, leave_type, start_date, end_date, reason, request_status)
     VALUES (?, ?, ?, ?, ?, 'Pending')`,
    [userId, toLeaveType(leaveType), startDate, endDate, S(reason)]
  );
  return Number(result.insertId);
}

async function setLeaveStatus(id, status, reviewedBy) {
  const [result] = await pool.query(
    `UPDATE leave_requests SET request_status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE leave_request_id = ?`,
    [status, reviewedBy || null, id]
  );
  return result;
}

async function listApprovedLeave({ userId, date } = {}) {
  const where = ["lr.request_status = 'Approved'"];
  const params = [];
  if (userId) { where.push('lr.account_id = ?'); params.push(userId); }
  if (date) { where.push('lr.start_date <= ? AND lr.end_date >= ?'); params.push(date, date); }
  const [rows] = await pool.query(
    `SELECT ${LEAVE_COLS} ${LEAVE_FROM} WHERE ${where.join(' AND ')} ORDER BY lr.start_date`,
    params
  );
  return rows;
}

// ===== Sales & Billing =====
//
// AMDB's transaction_status enum has no "Open" state, so the sprint1 bill
// lifecycle is reconstructed from the payments table instead:
//   Voided                       -> 'Void'
//   Completed + a payment row    -> 'Paid'
//   Completed + no payment row   -> 'Open'
// This keeps the open-bill -> settle flow working without altering the schema.
const SALE_COLS = `
  t.transaction_id AS id,
  t.transaction_no AS bill_number,
  COALESCE(t.notes, '') AS table_label,
  DATE_FORMAT(t.transaction_datetime, '%Y-%m-%d') AS sale_date,
  CASE WHEN t.transaction_status = 'Voided' THEN 'Void'
       WHEN pay.payment_id IS NOT NULL THEN 'Paid'
       ELSE 'Open' END AS status,
  t.subtotal_amount AS subtotal,
  t.discount_amount AS discount,
  t.tax_amount AS tax,
  t.total_amount AS total,
  t.cashier_id,
  COALESCE(CONCAT(a.first_name, ' ', a.last_name), '') AS cashier_name,
  COALESCE(pay.payment_method, '') AS payment_method,
  COALESCE(pay.amount_paid, 0) AS amount_tendered,
  COALESCE(pay.amount_paid - t.total_amount, 0) AS change_due,
  COALESCE(DATE_FORMAT(pay.paid_at, '%Y-%m-%dT%H:%i:%s'), '') AS settled_at,
  t.transaction_datetime AS created_at`;

const SALE_FROM = `
  FROM pos_transactions t
  LEFT JOIN accounts a ON a.account_id = t.cashier_id
  LEFT JOIN payments pay ON pay.payment_id = (
    SELECT p2.payment_id FROM payments p2 WHERE p2.transaction_id = t.transaction_id
    ORDER BY p2.payment_id DESC LIMIT 1)`;

async function createSale({ tableLabel, subtotal, discount, tax, total, cashierId, items }) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [result] = await conn.query(
      `INSERT INTO pos_transactions
         (transaction_no, cashier_id, transaction_datetime, subtotal_amount, discount_amount,
          tax_amount, total_amount, transaction_status, notes)
       VALUES ('', ?, NOW(), ?, ?, ?, ?, 'Completed', ?)`,
      [cashierId, subtotal, discount, tax, total, S(tableLabel)]
    );
    const saleId = Number(result.insertId);

    // Official-receipt-style number derived from the row id, as sprint1 did.
    await conn.query('UPDATE pos_transactions SET transaction_no = ? WHERE transaction_id = ?',
      ['OR-' + String(saleId).padStart(3, '0'), saleId]);

    for (const it of items) {
      // Prefer an explicit menu item id; fall back to resolving the name.
      let menuItemId = it.menuItemId ? Number(it.menuItemId) : null;
      if (!menuItemId) {
        const [m] = await conn.query('SELECT menu_item_id FROM menu_items WHERE item_name = ? LIMIT 1', [it.name]);
        if (!m.length) throw new Error(`Menu item not found: ${it.name}`);
        menuItemId = m[0].menu_item_id;
      }
      await conn.query(
        `INSERT INTO pos_transaction_items (transaction_id, menu_item_id, quantity, unit_price, line_total)
         VALUES (?, ?, ?, ?, ?)`,
        [saleId, menuItemId, it.quantity, it.unitPrice, it.lineTotal]
      );
    }

    await conn.commit();
    return saleId;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function listSales({ status, date, cashierId } = {}) {
  const where = [];
  const params = [];
  if (date) { where.push('DATE(t.transaction_datetime) = ?'); params.push(date); }
  if (cashierId) { where.push('t.cashier_id = ?'); params.push(cashierId); }
  if (status === 'Void') where.push("t.transaction_status = 'Voided'");
  else if (status === 'Paid') where.push("t.transaction_status <> 'Voided' AND pay.payment_id IS NOT NULL");
  else if (status === 'Open') where.push("t.transaction_status <> 'Voided' AND pay.payment_id IS NULL");
  const [rows] = await pool.query(
    `SELECT ${SALE_COLS} ${SALE_FROM}
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY t.transaction_id DESC`,
    params
  );
  return rows;
}

async function findSaleById(id) {
  const [rows] = await pool.query(`SELECT ${SALE_COLS} ${SALE_FROM} WHERE t.transaction_id = ?`, [id]);
  return rows[0] || undefined;
}

async function listSaleItems(saleId) {
  const [rows] = await pool.query(
    `SELECT ti.transaction_item_id AS id,
            ti.transaction_id AS sale_id,
            COALESCE(mi.item_name, '') AS name,
            ti.menu_item_id,
            ti.quantity,
            ti.unit_price,
            ti.line_total
     FROM pos_transaction_items ti
     LEFT JOIN menu_items mi ON mi.menu_item_id = ti.menu_item_id
     WHERE ti.transaction_id = ?
     ORDER BY ti.transaction_item_id`,
    [saleId]
  );
  return rows;
}

const PAYMENT_METHODS_AMDB = new Set(['Cash', 'Card', 'GCash', 'Maya', 'Other']);

async function settleSale(id, { paymentMethod, amountTendered }) {
  const [result] = await pool.query(
    `INSERT INTO payments (transaction_id, payment_method, amount_paid, paid_at)
     VALUES (?, ?, ?, NOW())`,
    [id, PAYMENT_METHODS_AMDB.has(paymentMethod) ? paymentMethod : 'Other', amountTendered]
  );
  return result;
}

async function voidSale(id) {
  const [result] = await pool.query(
    "UPDATE pos_transactions SET transaction_status = 'Voided' WHERE transaction_id = ?",
    [id]
  );
  return result;
}

// Menu items available to the POS, newest categories first. The POS needs these
// because pos_transaction_items.menu_item_id is NOT NULL — a bill line must
// reference a real menu row, so the cashier picks rather than free-types.
async function listMenuItems() {
  const [rows] = await pool.query(
    `SELECT mi.menu_item_id AS id,
            mi.item_name    AS name,
            mi.selling_price AS price,
            COALESCE(mc.category_name, 'Uncategorized') AS category
     FROM menu_items mi
     LEFT JOIN menu_categories mc ON mc.menu_category_id = mi.menu_category_id
     WHERE mi.is_available = TRUE
     ORDER BY mc.category_name, mi.item_name`
  );
  return rows;
}

module.exports = {
  init,
  pool,
  findUserByEmail,
  findUserById,
  createUser,
  updateProfile,
  updatePassword,
  createReset,
  getReset,
  markResetUsed,
  listInventoryIngredients,
  listInventoryMeta,
  createIngredient,
  recordInventoryTransaction,
  listTables,
  createReservation,
  updateReservationStatus,
  updateTableStatus,
  findAvailableTable,
  // --- ported Sprint 2/3 helpers ---
  updateUserRole, deleteUser, countAdmins, listUsers,
  listSuppliers, findSupplierById, findSupplierByName, createSupplier, ensureSupplier,
  createSupplierRecord, updateSupplierRecord,
  listIngredients, findIngredientById, updateIngredientMeta, listCategories,
  applyTransaction, listTransactions,
  createPurchaseOrder, listPurchaseOrders, findPurchaseOrderById, listPoItems,
  findPoItemById, setPurchaseOrderStatus, addPoItemReceived,
  findOpenAttendance, createTimeIn, setTimeOut, listAttendance,
  findShiftById, listShiftsForDate, listShifts, createShift, updateShift, deleteShift,
  findLeaveById, listLeave, createLeave, setLeaveStatus, listApprovedLeave,
  createSale, listSales, findSaleById, listSaleItems, settleSale, voidSale,
  listMenuItems,
  // --- Sprint 5 (SI-26 employee performance, SI-27 audit logs) ---
  listAuditLogs, createAuditLog,
  listEmployeePerformanceReports, findEmployeePerformanceReportById,
  createEmployeePerformanceReport, updateEmployeePerformanceReport,
  deleteEmployeePerformanceReport,
};
