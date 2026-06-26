// SI-6 Registration — minimal backend.
//
// Zero external dependencies: uses Node's built-in `http` module, so the app
// runs with `node server/index.js` (no `npm install` step).
//
// SCOPE: this file covers ONLY the Registration story (SI-6). Login (SI-7),
// Password Reset (SI-8), Profile (SI-9), and Roles & Permissions (SI-10) are
// separate stories owned by other teammates — they are intentionally not here.
//
// PERSISTENCE: accounts are stored in a file-backed SQLite database via Node's
// built-in `node:sqlite` (see server/db.js), so they survive server restarts.
// Still zero external dependencies — DatabaseSync ships with Node.

const http = require('http');
const fs = require('fs');
const path = require('path');
const dbApi = require('./db');

const PORT = 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

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

    // AC1 — save the new account...
    // passwordHash carries plaintext for now; Phase 2 will hash before storing.
    dbApi.createUser({
      fullName: data.fullName.trim(),
      email,
      passwordHash: data.password,
      role: data.role,
    });

    // AC1 — ...and trigger the welcome/activation email (stubbed to a log for now).
    console.log(`[email] Welcome email triggered for ${email} (role: ${data.role}).`);

    sendJson(res, 201, {
      message: 'Account created. A welcome email has been sent to the staff member.',
    });
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

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/api/register') {
    return handleRegister(req, res);
  }
  if (req.method === 'GET') {
    return serveStatic(req, res);
  }
  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`RMIS Registration running at http://localhost:${PORT}`);
});
