// AM Restaurant RMIS — Sprint 1 backend (auth & user management).
//
// Zero external dependencies: uses Node's built-in `http`, `crypto`, and
// `node:sqlite` modules, so the app runs with `node server/index.js`
// (no `npm install` step).
//
// SCOPE: the full Sprint 1 identity slice —
//   SI-6 Registration, SI-7 Login, SI-8 Password Reset,
//   SI-9 Profile Management, SI-10 Roles & Permissions.
//
// PERSISTENCE: users live in a file-backed SQLite database (see server/db.js)
// and survive restarts. Sessions are in-memory (a restart just forces re-login).

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dbApi = require('./db');
const { hashPassword, verifyPassword } = require('./password');

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// SI-10 — which role may access which protected pages. '*' = all pages.
const ROLE_PAGES = {
  Admin:   ['*'],
  Manager: ['/dashboard.html', '/profile.html', '/modules.html'],
  Cashier: ['/dashboard.html', '/profile.html'],
  Staff:   ['/dashboard.html', '/profile.html'],
};
// Pages that require auth + specific roles. Anything not listed is public (landing, login, css, js, images).
const PROTECTED_PAGES = {
  '/register.html': ['Admin'],          // "Create User" — admin only
  '/admin-settings.html': ['Admin'],    // admin-only stub
};

// In-memory session store (SI-7). token -> { userId, email, role }.
// Acceptable MVP: a server restart just forces re-login; user data persists in SQLite.
const sessions = new Map();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validate the submitted fields. Returns a { field: message } map (empty = valid).
function validate(data) {
  const errors = {};
  if (!data.fullName || !data.fullName.trim()) {
    errors.fullName = 'Full name is required.';
  }
  if (!data.email || !data.email.trim()) {
    errors.email = 'Email is required.';
  } else if (!EMAIL_RE.test(data.email.trim())) {
    errors.email = 'Enter a valid email address.';
  }
  if (!data.password || data.password.length < 8) {
    errors.password = 'Temporary password must be at least 8 characters.';
  }
  if (!data.role || !data.role.trim()) {
    errors.role = 'Please select a role.';
  }
  return errors;
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// POST /api/register — create a new staff account (SI-6).
function handleRegister(req, res) {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    let data;
    try {
      data = JSON.parse(raw || '{}');
    } catch {
      return sendJson(res, 400, { message: 'Invalid request.' });
    }

    // AC2 — invalid input (including bad email format) is rejected.
    const errors = validate(data);
    if (Object.keys(errors).length > 0) {
      return sendJson(res, 400, { message: 'Please correct the highlighted fields.', errors });
    }

    const email = data.email.trim().toLowerCase();

    // AC2 — reject a duplicate email with a clear message.
    if (dbApi.findUserByEmail(email)) {
      return sendJson(res, 409, {
        message: 'Email already registered.',
        errors: { email: 'Email already registered.' },
      });
    }

    // AC1 — save the new account with a hashed password (never plaintext).
    dbApi.createUser({
      fullName: data.fullName.trim(),
      email,
      passwordHash: hashPassword(data.password),
      role: data.role,
    });

    // AC1 — ...and trigger the welcome/activation email (stubbed to a log for now).
    console.log(`[email] Welcome email triggered for ${email} (role: ${data.role}).`);

    sendJson(res, 201, {
      message: 'Account created. A welcome email has been sent to the staff member.',
    });
  });
}

// Parse the Cookie header into a plain object (SI-7). Returns {} if absent.
function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  const cookies = {};
  for (const pair of header.split('; ')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    cookies[pair.slice(0, idx)] = pair.slice(idx + 1);
  }
  return cookies;
}

// Resolve the current session from the `sid` cookie, or null. Reused by later phases.
function getSession(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  return sessions.get(token) || null;
}

// POST /api/login — authenticate a staff member and start a session (SI-7).
function handleLogin(req, res) {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    let data;
    try {
      data = JSON.parse(raw || '{}');
    } catch {
      return sendJson(res, 400, { message: 'Invalid request.' });
    }

    if (!data.email || !data.password) {
      return sendJson(res, 400, { message: 'Email and password are required.' });
    }

    const email = data.email.trim().toLowerCase();
    const user = dbApi.findUserByEmail(email);

    // Generic message — never reveal which part failed (AC requirement).
    if (!user || !verifyPassword(data.password, user.password_hash)) {
      return sendJson(res, 401, { message: 'Invalid email or password.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { userId: user.id, email: user.email, role: user.role });

    // Set the session cookie AND a JSON body, so we write the head manually.
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Set-Cookie': 'sid=' + token + '; HttpOnly; Path=/; Max-Age=86400',
    });
    res.end(JSON.stringify({ redirect: '/dashboard.html', role: user.role }));
  });
}

// POST /api/logout — end the current session and clear the cookie (SI-7).
function handleLogout(req, res) {
  const token = parseCookies(req).sid;
  if (token) sessions.delete(token);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0',
  });
  res.end(JSON.stringify({ message: 'Logged out.' }));
}

// GET /api/me — return the logged-in user's display info, or 401 (SI-7).
function handleMe(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { message: 'Not authenticated.' });
  const u = dbApi.findUserById(s.userId);
  if (!u) return sendJson(res, 401, { message: 'Not authenticated.' });
  return sendJson(res, 200, { fullName: u.full_name, email: u.email, role: u.role });
}

// GET /api/profile — return the logged-in user's editable profile (SI-9).
function handleGetProfile(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { message: 'Not authenticated.' });
  const u = dbApi.findUserById(s.userId);
  if (!u) return sendJson(res, 401, { message: 'Not authenticated.' });
  return sendJson(res, 200, {
    fullName: u.full_name,
    email: u.email,
    role: u.role,
    contactNumber: u.contact_number,
  });
}

// POST /api/profile — update display name + contact number only (SI-9).
// CRITICAL (AC): role and email are READ-ONLY — never read or write them from
// the request body, even if the client sends them.
const CONTACT_RE = /^[0-9+\-()\s]{7,20}$/;
function handleUpdateProfile(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { message: 'Not authenticated.' });

  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    let data;
    try {
      data = JSON.parse(raw || '{}');
    } catch {
      return sendJson(res, 400, { message: 'Invalid request.' });
    }

    const errors = {};
    if (!data.fullName || !data.fullName.trim()) {
      errors.fullName = 'Display name is required.';
    }
    if (!data.contactNumber || !data.contactNumber.trim()) {
      errors.contactNumber = 'Contact number is required.';
    } else if (!CONTACT_RE.test(data.contactNumber.trim())) {
      errors.contactNumber = 'Enter a valid contact number.';
    }

    if (Object.keys(errors).length > 0) {
      return sendJson(res, 400, { message: 'Please correct the highlighted fields.', errors });
    }

    // Only fullName + contactNumber are ever written. role/email are ignored.
    dbApi.updateProfile(s.userId, {
      fullName: data.fullName.trim(),
      contactNumber: data.contactNumber.trim(),
    });
    return sendJson(res, 200, { message: 'Profile updated.' });
  });
}

// POST /api/password-reset/request — issue a time-limited reset token (SI-8).
// Delivery (MVP, no SMTP): the link is logged to the server console AND returned
// in the response so the page can show it. The response message is ALWAYS generic
// so the endpoint never reveals whether an email is registered.
function handleResetRequest(req, res) {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    let data;
    try {
      data = JSON.parse(raw || '{}');
    } catch {
      return sendJson(res, 400, { message: 'Invalid request.' });
    }

    const email = (data.email || '').trim().toLowerCase();
    const user = email ? dbApi.findUserByEmail(email) : null;

    // Only generate a token if the email actually exists. For unknown emails we
    // fall through to the same generic response with NO resetLink (no existence leak).
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + 60 * 60 * 1000; // 1 hour, ms epoch (matches integer column).
      dbApi.createReset(token, user.id, expiresAt);
      const resetPath = '/reset-password.html?token=' + token;
      console.log('[reset] Password reset link for ' + email + ': http://localhost:3000' + resetPath);
      return sendJson(res, 200, {
        message: 'If that email is registered, a reset link has been generated below.',
        resetLink: resetPath,
      });
    }

    return sendJson(res, 200, {
      message: 'If that email is registered, a reset link has been generated below.',
    });
  });
}

// POST /api/password-reset/confirm — consume a token and set a new password (SI-8).
// Token is validated SERVER-SIDE: must exist, be unused, and not expired. Single-use.
function handleResetConfirm(req, res) {
  let raw = '';
  req.on('data', (chunk) => { raw += chunk; });
  req.on('end', () => {
    let data;
    try {
      data = JSON.parse(raw || '{}');
    } catch {
      return sendJson(res, 400, { message: 'Invalid request.' });
    }

    const token = data.token;
    const newPassword = data.newPassword;

    if (!token) {
      return sendJson(res, 400, { message: 'Invalid or missing reset token.' });
    }

    const row = dbApi.getReset(token);
    if (!row || row.used || row.expires_at < Date.now()) {
      return sendJson(res, 400, { message: 'Reset link is invalid or expired.' });
    }

    // AC — new password must be at least 8 chars and alphanumeric (letters + numbers).
    const p = newPassword || '';
    if (p.length < 8 || !/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) {
      return sendJson(res, 400, {
        message: 'Password must be at least 8 characters and contain letters and numbers.',
        errors: { newPassword: 'At least 8 characters, letters and numbers.' },
      });
    }

    dbApi.updatePassword(row.user_id, hashPassword(newPassword));
    dbApi.markResetUsed(token); // single-use: the link cannot be replayed.
    return sendJson(res, 200, { message: 'Password updated. You can now log in.' });
  });
}

// Serve the static frontend from public/ (index.html, register.html, css, js).
const CONTENT_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
};

function serveStatic(req, res) {
  const rawPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];

  // Decode %20 and other escapes so filenames with spaces (e.g. "AM logo.jpg") resolve.
  let urlPath;
  try {
    urlPath = decodeURIComponent(rawPath);
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }

  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath));

  // Block path traversal outside public/.
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(filePath, (err, content) => {
    if (err) {
      res.writeHead(404);
      return res.end('Not found');
    }
    const type = CONTENT_TYPES[path.extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type });
    res.end(content);
  });
}

// SI-10 — serve the 403 page for an authenticated-but-unauthorized request.
function serve403(res) {
  fs.readFile(path.join(PUBLIC_DIR, '403.html'), (err, content) => {
    if (err) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('403 Unauthorized');
    }
    res.writeHead(403, { 'Content-Type': 'text/html' });
    res.end(content);
  });
}

// Bootstrap — create a default Admin so RBAC can be demoed. Idempotent.
const SEED_EMAIL = 'admin@amrestaurant.local';
function ensureSeedAdmin() {
  if (dbApi.findUserByEmail(SEED_EMAIL)) return;
  dbApi.createUser({
    fullName: 'Default Admin',
    email: SEED_EMAIL,
    passwordHash: hashPassword('admin1234'),
    role: 'Admin',
  });
  console.log('[seed] Default admin created: admin@amrestaurant.local / admin1234 (change after first login)');
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/register') {
    return handleRegister(req, res);
  }
  if (req.method === 'POST' && req.url === '/api/login') {
    return handleLogin(req, res);
  }
  if (req.method === 'POST' && req.url === '/api/logout') {
    return handleLogout(req, res);
  }
  if (req.method === 'GET' && req.url === '/api/me') {
    return handleMe(req, res);
  }
  if (req.method === 'GET' && req.url === '/api/profile') {
    return handleGetProfile(req, res);
  }
  if (req.method === 'POST' && req.url === '/api/profile') {
    return handleUpdateProfile(req, res);
  }
  if (req.method === 'POST' && req.url === '/api/password-reset/request') {
    return handleResetRequest(req, res);
  }
  if (req.method === 'POST' && req.url === '/api/password-reset/confirm') {
    return handleResetConfirm(req, res);
  }
  if (req.method === 'GET') {
    // SI-10 — server-side RBAC gate for protected static pages (blocks direct-URL access).
    let urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    try {
      urlPath = decodeURIComponent(urlPath);
    } catch {
      // Leave urlPath as the raw split; serveStatic re-decodes and handles bad input.
    }
    const allowedRoles = PROTECTED_PAGES[urlPath];
    if (allowedRoles) {
      const s = getSession(req);
      if (!s) {
        res.writeHead(302, { Location: '/login.html' });
        return res.end();
      }
      if (!allowedRoles.includes(s.role)) {
        return serve403(res);
      }
    }
    return serveStatic(req, res);
  }
  res.writeHead(404);
  res.end('Not found');
});

ensureSeedAdmin();

server.listen(PORT, () => {
  console.log(`AM Restaurant RMIS running at http://localhost:${PORT}`);
});
