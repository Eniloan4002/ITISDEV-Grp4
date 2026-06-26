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
`);

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

module.exports = { db, findUserByEmail, findUserById, createUser, updateProfile, updatePassword, createReset, getReset, markResetUsed };
