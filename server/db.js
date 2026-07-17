// Persistence layer for AMDB (MySQL).
//
// This module keeps the same public helper API the server already uses, but the
// data now comes from the SQL schema in SQL/AMDB creation script.sql.

const crypto = require('crypto');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'AMDB',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

let initPromise;

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

      // Older MySQL versions do not support "ADD COLUMN IF NOT EXISTS".
      if (!(await columnExists('ingredient_inventory', 'expires_on'))) {
        await pool.query('ALTER TABLE ingredient_inventory ADD COLUMN expires_on DATE NULL');
      }
      if (!(await columnExists('stock_movements', 'reference_no'))) {
        await pool.query('ALTER TABLE stock_movements ADD COLUMN reference_no VARCHAR(100) NULL');
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

async function createIngredient({ name, unitOfMeasure, category, supplier, reorderLevel, maxStockLevel, expirationDate }) {
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
      [name, categoryRows[0].ingredient_type_id, unitOfMeasure, reorderLevel, maxStockLevel]
    );

    const ingredientId = Number(insertResult.insertId);

    await conn.query(
      'INSERT INTO ingredient_inventory (ingredient_id, current_quantity, expires_on) VALUES (?, 0, ?)',
      [ingredientId, expirationDate || null]
    );

    if (supplier) {
      const [supplierRows] = await conn.query(
        'SELECT supplier_id FROM suppliers WHERE supplier_name = ? LIMIT 1',
        [supplier]
      );
      if (!supplierRows.length) {
        throw new Error(`Supplier not found: ${supplier}`);
      }
      await conn.query(
        `INSERT INTO supplier_ingredients (supplier_id, ingredient_id, supplier_price)
         VALUES (?, ?, NULL)
         ON DUPLICATE KEY UPDATE supplier_price = supplier_price`,
        [supplierRows[0].supplier_id, ingredientId]
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
};
