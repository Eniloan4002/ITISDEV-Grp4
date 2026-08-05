// Audit trail recorder (SI-27).
//
// server/audit-logs.js is the read-only viewer; this is the write side. The
// viewer deliberately rejects POST/PUT/DELETE ("Audit logs are read-only"), so
// entries can only ever come from the application itself — which is the point
// of an audit trail. Without this module nothing writes the table at all.
//
// Two rules hold everywhere:
//   1. Recording NEVER breaks the action being recorded. A failure here is
//      logged to the console and swallowed; a user must not lose a sale or be
//      unable to log in because the audit insert failed.
//   2. audit_logs.user_id is NOT NULL and foreign-keyed to accounts, so an
//      entry can only be written when the actor is a known account. A failed
//      login for an address that does not exist is therefore not recordable.

const dbApi = require('./db');

// Best-effort client address. Behind a proxy, X-Forwarded-For's first entry is
// the original client; fall back to the socket.
function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim().slice(0, 45);
  return (req.socket && req.socket.remoteAddress ? String(req.socket.remoteAddress) : '').slice(0, 45);
}

/**
 * Write one audit entry. Fire-and-forget: callers do not await it.
 *
 * @param {object} req         the request, for the IP address
 * @param {object} actor       { userId, email } — userId must be a real account
 * @param {string} actionType  e.g. 'LOGIN_SUCCESS', 'ROLE_CHANGED'
 * @param {string} target      table or subsystem the action touched
 * @param {string} details     human-readable summary
 */
function record(req, actor, actionType, target, details) {
  if (!actor || !actor.userId) return; // FK requires a real account
  Promise.resolve()
    .then(() =>
      dbApi.createAuditLog({
        userId: actor.userId,
        userEmail: actor.email || null,
        actionType,
        target: target || 'system',
        details: details || null,
        ipAddress: clientIp(req),
      })
    )
    .catch((err) => console.error('[audit] could not record %s:', actionType, err.message));
}

module.exports = { record, clientIp };
