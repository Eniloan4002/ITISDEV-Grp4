// Shared HTTP helpers for the module routers.
//
// These were previously copy-pasted into every router: sendJson 8x, readJson 7x,
// requireRole 5x, sessionName 3x. The copies had already drifted — three
// different 403 messages, three whitespace variants of readJson — which is the
// usual way a fix lands in one copy and not the other seven.
//
// readJson also gained a body-size cap here. None of the original copies had
// one, so an unbounded request body would buffer into memory until the process
// died.

const dbApi = require('./db');

const MAX_BODY_BYTES = 1024 * 256; // 256 KB — far above any form this app posts

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

/** Resolve the JSON body, or reject. An empty body resolves to {}. */
function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    let bytes = 0;
    req.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      raw += chunk;
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('bad json'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Gate an API action on the caller's role.
 * @param {string[]} roles      roles permitted to proceed
 * @param {string} [denyMessage] 403 text; the routers used to word this three
 *                               different ways, so it stays overridable
 * @returns the session, or null when a response has already been sent
 */
function requireRole(req, res, getSession, roles, denyMessage) {
  const s = getSession(req);
  if (!s) {
    sendJson(res, 401, { message: 'Not authenticated.' });
    return null;
  }
  if (!roles.includes(s.role)) {
    sendJson(res, 403, { message: denyMessage || 'You do not have access to this action.' });
    return null;
  }
  return s;
}

function requireAdmin(req, res, getSession) {
  return requireRole(req, res, getSession, ['Admin'], 'Admin access required.');
}

/** Display name for the signed-in user, falling back to the email local part. */
async function sessionName(s) {
  const u = await dbApi.findUserById(s.userId);
  return u ? u.full_name : String(s.email || '').split('@')[0];
}

/** Escape a value destined for HTML. Server-side mirror of the client helper. */
function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

module.exports = { sendJson, readJson, requireRole, requireAdmin, sessionName, escapeHtml, MAX_BODY_BYTES };
