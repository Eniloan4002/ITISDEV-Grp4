// AM Restaurant RMIS backend.
//
// Runtime stack:
// - Node core modules (http, fs, path, crypto)
// - MySQL persistence via server/db.js (AMDB schema)

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dbApi = require('./db');
const { hashPassword, verifyPassword } = require('./password');

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// SI-10 role-based visible modules. '*' = all pages.
const ROLE_PAGES = {
  Admin: ['*'],
  Manager: ['/dashboard', '/profile', '/modules', '/inventory'],
  Cashier: ['/dashboard', '/profile'],
  Staff: ['/dashboard', '/profile'],
};

// Pages that require auth + specific roles.
const PROTECTED_PAGES = {
  '/register': ['Admin'],
  '/admin-settings': ['Admin'],
  '/inventory': ['Admin', 'Manager'],
};

// In-memory session store (MVP): restart forces re-login.
const sessions = new Map();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CONTACT_RE = /^[0-9+\-()\s]{7,20}$/;

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

function getSession(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  return sessions.get(token) || null;
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        reject(new Error('INVALID_JSON'));
      }
    });
    req.on('error', reject);
  });
}

async function handleRegister(req, res) {
  let data;
  try {
    data = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { message: 'Invalid request.' });
  }

  const s = getSession(req);
  if (!s) return sendJson(res, 401, { message: 'Not authenticated.' });
  if (s.role !== 'Admin') return sendJson(res, 403, { message: 'Unauthorized.' });

  const errors = validate(data);
  if (Object.keys(errors).length > 0) {
    return sendJson(res, 400, { message: 'Please correct the highlighted fields.', errors });
  }

  const email = data.email.trim().toLowerCase();

  try {
    if (await dbApi.findUserByEmail(email)) {
      return sendJson(res, 409, {
        message: 'Email already registered.',
        errors: { email: 'Email already registered.' },
      });
    }

    await dbApi.createUser({
      fullName: data.fullName.trim(),
      email,
      passwordHash: hashPassword(data.password),
      role: data.role,
    });
  } catch (err) {
    console.error('[register] failed:', err);
    return sendJson(res, 500, { message: 'Could not create account. Please try again.' });
  }

  console.log(`[email] Welcome email triggered for ${email} (role: ${data.role}).`);
  return sendJson(res, 201, {
    message: 'Account created. A welcome email has been sent to the staff member.',
  });
}

async function handleLogin(req, res) {
  let data;
  try {
    data = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { message: 'Invalid request.' });
  }

  if (!data.email || !data.password) {
    return sendJson(res, 400, { message: 'Email and password are required.' });
  }

  const email = data.email.trim().toLowerCase();
  let user;

  try {
    user = await dbApi.findUserByEmail(email);
  } catch (err) {
    console.error('[login] failed:', err);
    return sendJson(res, 500, { message: 'Could not process login. Please try again.' });
  }

  if (!user || !verifyPassword(data.password, user.password_hash)) {
    return sendJson(res, 401, { message: 'Invalid email or password.' });
  }

  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, { userId: user.id, email: user.email, role: user.role });

  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': 'sid=' + token + '; HttpOnly; Path=/; Max-Age=86400',
  });
  res.end(JSON.stringify({ redirect: '/dashboard', role: user.role }));
}

function handleLogout(req, res) {
  const token = parseCookies(req).sid;
  if (token) sessions.delete(token);
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Set-Cookie': 'sid=; HttpOnly; Path=/; Max-Age=0',
  });
  res.end(JSON.stringify({ message: 'Logged out.' }));
}

async function handleMe(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { message: 'Not authenticated.' });

  try {
    const u = await dbApi.findUserById(s.userId);
    if (!u) return sendJson(res, 401, { message: 'Not authenticated.' });
    return sendJson(res, 200, { fullName: u.full_name, email: u.email, role: u.role });
  } catch (err) {
    console.error('[me] failed:', err);
    return sendJson(res, 500, { message: 'Could not load current user.' });
  }
}

async function handleGetProfile(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { message: 'Not authenticated.' });

  try {
    const u = await dbApi.findUserById(s.userId);
    if (!u) return sendJson(res, 401, { message: 'Not authenticated.' });
    return sendJson(res, 200, {
      fullName: u.full_name,
      email: u.email,
      role: u.role,
      contactNumber: u.contact_number,
    });
  } catch (err) {
    console.error('[profile:get] failed:', err);
    return sendJson(res, 500, { message: 'Could not load profile.' });
  }
}

async function handleUpdateProfile(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { message: 'Not authenticated.' });

  let data;
  try {
    data = await readJsonBody(req);
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

  try {
    await dbApi.updateProfile(s.userId, {
      fullName: data.fullName.trim(),
      contactNumber: data.contactNumber.trim(),
    });
    return sendJson(res, 200, { message: 'Profile updated.' });
  } catch (err) {
    console.error('[profile:update] failed:', err);
    return sendJson(res, 500, { message: 'Could not update profile. Please try again.' });
  }
}

async function handleResetRequest(req, res) {
  let data;
  try {
    data = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { message: 'Invalid request.' });
  }

  const email = (data.email || '').trim().toLowerCase();

  try {
    const user = email ? await dbApi.findUserByEmail(email) : null;

    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expiresAt = Date.now() + 60 * 60 * 1000;
      await dbApi.createReset(token, user.id, expiresAt);

      const resetPath = '/reset-password?token=' + token;
      console.log('[reset] Password reset link for ' + email + ': http://localhost:3000' + resetPath);
      return sendJson(res, 200, {
        message: 'If that email is registered, a reset link has been generated below.',
        resetLink: resetPath,
      });
    }

    return sendJson(res, 200, {
      message: 'If that email is registered, a reset link has been generated below.',
    });
  } catch (err) {
    console.error('[reset:request] failed:', err);
    return sendJson(res, 500, { message: 'Could not process the reset request.' });
  }
}

async function handleResetConfirm(req, res) {
  let data;
  try {
    data = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { message: 'Invalid request.' });
  }

  const token = data.token;
  const newPassword = data.newPassword;

  if (!token) {
    return sendJson(res, 400, { message: 'Invalid or missing reset token.' });
  }

  try {
    const row = await dbApi.getReset(token);
    if (!row || row.used || row.expires_at < Date.now()) {
      return sendJson(res, 400, { message: 'Reset link is invalid or expired.' });
    }

    const p = newPassword || '';
    if (p.length < 8 || !/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) {
      return sendJson(res, 400, {
        message: 'Password must be at least 8 characters and contain letters and numbers.',
        errors: { newPassword: 'At least 8 characters, letters and numbers.' },
      });
    }

    await dbApi.updatePassword(row.user_id, hashPassword(newPassword));
    await dbApi.markResetUsed(token);
    return sendJson(res, 200, { message: 'Password updated. You can now log in.' });
  } catch (err) {
    console.error('[reset:confirm] failed:', err);
    return sendJson(res, 500, { message: 'Could not reset password. Please try again.' });
  }
}

async function handleGetInventory(req, res) {
  const s = getSession(req);
  if (!s) return sendJson(res, 401, { message: 'Not authenticated.' });
  if (!['Admin', 'Manager'].includes(s.role)) {
    return sendJson(res, 403, { message: 'Unauthorized.' });
  }

  try {
    const items = await dbApi.listInventoryIngredients();
    return sendJson(res, 200, { items });
  } catch (err) {
    console.error('[inventory] failed:', err);
    return sendJson(res, 500, { message: 'Could not load inventory.' });
  }
}

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

function resolveFilePath(req) {
  const rawPath = req.url.split('?')[0];
  let urlPath;
  try {
    urlPath = decodeURIComponent(rawPath);
  } catch {
    return null;
  }

  if (urlPath === '/') {
    return path.join(PUBLIC_DIR, 'index.html');
  }
  if (!path.extname(urlPath)) {
    return path.join(PUBLIC_DIR, 'pages', path.normalize(urlPath) + '.html');
  }
  return path.join(PUBLIC_DIR, path.normalize(urlPath));
}

function serveStatic(req, res) {
  const filePath = resolveFilePath(req);
  if (filePath === null) {
    res.writeHead(400);
    return res.end('Bad request');
  }

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

function serve403(res) {
  fs.readFile(path.join(PUBLIC_DIR, 'pages', '403.html'), (err, content) => {
    if (err) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      return res.end('403 Unauthorized');
    }
    res.writeHead(403, { 'Content-Type': 'text/html' });
    res.end(content);
  });
}

const SEED_EMAIL = 'admin@amrestaurant.local';

async function ensureSeedAdmin() {
  if (await dbApi.findUserByEmail(SEED_EMAIL)) return;
  await dbApi.createUser({
    fullName: 'Default Admin',
    email: SEED_EMAIL,
    passwordHash: hashPassword('admin1234'),
    role: 'Admin',
  });
  console.log('[seed] Default admin created: admin@amrestaurant.local / admin1234 (change after first login)');
}

const server = http.createServer(async (req, res) => {
  try {
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
    if (req.method === 'GET' && req.url === '/api/inventory') {
      return handleGetInventory(req, res);
    }

    if (req.method === 'GET') {
      let urlPath = req.url.split('?')[0];
      try {
        urlPath = decodeURIComponent(urlPath);
      } catch {
        // Keep raw urlPath and let static handling deal with malformed paths.
      }

      const allowedRoles = PROTECTED_PAGES[urlPath];
      if (allowedRoles) {
        const s = getSession(req);
        if (!s) {
          res.writeHead(302, { Location: '/login' });
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
  } catch (err) {
    console.error('[server] unhandled error:', err);
    sendJson(res, 500, { message: 'Internal server error.' });
  }
});

async function bootstrap() {
  try {
    await dbApi.init();
    await ensureSeedAdmin();

    server.listen(PORT, () => {
      console.log(`AM Restaurant RMIS running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('[bootstrap] Failed to start server:', err);
    process.exit(1);
  }
}

bootstrap();
