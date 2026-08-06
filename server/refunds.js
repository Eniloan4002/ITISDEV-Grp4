// SI-18 Refund Processing.
//
// Cashiers, Managers and Admins may raise a request; only Managers and Admins
// may approve or reject. A Manager's own request still needs an explicit
// approval action — the spec is deliberate that submission and approval are
// separate steps whoever raises it, so the workflow stays auditable.
//
// All the transactional work lives in db.approveRefund / db.rejectRefund; this
// layer is validation, authorisation and error mapping.

const dbApi = require('./db');
const audit = require('./audit');
const roles = require('./roles');
const { sendJson, readJson, requireRole } = require('./http-util');

const METHODS = ['Cash', 'Card', 'GCash', 'Maya', 'Other'];

// Map the data layer's error codes onto HTTP.
function statusFor(code) {
  switch (code) {
    case 'NOT_FOUND': return 404;
    case 'INVALID_STATE': return 409;
    case 'STALE': return 409;
    case 'BAD_LINE':
    case 'BAD_QTY': return 400;
    default: return 500;
  }
}

async function getRefunds(req, res, getSession, query) {
  const s = requireRole(req, res, getSession, roles.SALES);
  if (!s) return;
  sendJson(res, 200, {
    refunds: await dbApi.listRefunds({
      status: (query.get('status') || '').trim(),
      saleId: Number(query.get('saleId')) || null,
    }),
    // Only these roles see the approve/reject controls; the server re-checks.
    canReview: roles.MANAGER.includes(s.role),
  });
}

async function getRefund(req, res, getSession, id) {
  const s = requireRole(req, res, getSession, roles.SALES);
  if (!s) return;
  const refund = await dbApi.findRefundById(id);
  if (!refund) return sendJson(res, 404, { message: 'Refund request not found.' });
  sendJson(res, 200, {
    refund,
    items: await dbApi.listRefundItems(id),
    canReview: roles.MANAGER.includes(s.role),
  });
}

// Eligible original transaction plus per-line refundable quantities — the
// search result the requester works from.
async function getRefundableSale(req, res, getSession, id) {
  const s = requireRole(req, res, getSession, roles.SALES);
  if (!s) return;
  const sale = await dbApi.findSaleById(id);
  if (!sale) return sendJson(res, 404, { message: 'Transaction not found.' });
  if (sale.status === 'Void') {
    return sendJson(res, 409, { message: 'A voided transaction cannot be refunded.' });
  }
  const items = await dbApi.listSaleItemsWithRefunds(id);
  sendJson(res, 200, {
    sale,
    items,
    // The spec defaults the refund method to whatever the bill was settled with.
    defaultMethod: METHODS.includes(sale.payment_method) ? sale.payment_method : 'Cash',
    refunds: await dbApi.listRefunds({ saleId: id }),
    anyRefundable: items.some((i) => i.refundable_qty > 0),
  });
}

async function postRefund(req, res, getSession) {
  const s = requireRole(req, res, getSession, roles.SALES);
  if (!s) return;
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }

  const errors = {};
  const saleId = Number(data.saleId);
  const reason = String(data.reason || '').trim();
  const method = String(data.method || '').trim();
  const rawLines = Array.isArray(data.lines) ? data.lines : [];

  if (!saleId) errors.saleId = 'Choose the original transaction.';
  if (!reason) errors.reason = 'A reason is required.';
  if (!METHODS.includes(method)) errors.method = 'Choose a refund method.';

  const lines = rawLines
    .map((l) => ({ saleItemId: Number(l.saleItemId), quantity: Number(l.quantity) }))
    .filter((l) => l.saleItemId && l.quantity > 0);
  if (!lines.length) errors.lines = 'Select at least one item and a quantity to refund.';

  if (Object.keys(errors).length) {
    return sendJson(res, 400, { message: 'Please correct the highlighted fields.', errors });
  }

  try {
    const id = await dbApi.createRefundRequest({
      saleId, requestedBy: s.userId, reason, method, lines,
    });
    const refund = await dbApi.findRefundById(id);
    audit.record(req, { userId: s.userId, email: s.email }, 'REFUND_REQUESTED', 'refunds',
      `Requested refund ${id} of ${refund.amount} on bill ${refund.bill_number}. ${reason}`);
    sendJson(res, 201, { refund, items: await dbApi.listRefundItems(id) });
  } catch (err) {
    const status = statusFor(err.code);
    if (status === 500) throw err;
    sendJson(res, status, { message: err.message });
  }
}

async function reviewRefund(req, res, getSession, id, decision) {
  const s = requireRole(req, res, getSession, roles.MANAGER,
    'Only a Manager or Admin can approve or reject a refund.');
  if (!s) return;
  let data = {};
  try { data = await readJson(req); } catch { /* notes are optional */ }
  const notes = String(data.notes || '').trim();

  if (decision === 'reject' && !notes) {
    return sendJson(res, 400, {
      message: 'Please correct the highlighted fields.',
      errors: { notes: 'A rejection needs a note explaining why.' },
    });
  }

  try {
    if (decision === 'approve') {
      const result = await dbApi.approveRefund(id, s.userId, notes);
      const refund = await dbApi.findRefundById(id);
      audit.record(req, { userId: s.userId, email: s.email }, 'REFUND_APPROVED', 'refunds',
        `Approved refund ${id} of ${refund.amount} on bill ${refund.bill_number}; ` +
        `transaction now ${result.saleStatus}; ${result.restoredIngredients.length} ingredient movement(s).`);
      return sendJson(res, 200, { refund, ...result });
    }
    await dbApi.rejectRefund(id, s.userId, notes);
    const refund = await dbApi.findRefundById(id);
    audit.record(req, { userId: s.userId, email: s.email }, 'REFUND_REJECTED', 'refunds',
      `Rejected refund ${id} on bill ${refund.bill_number}. ${notes}`);
    return sendJson(res, 200, { refund });
  } catch (err) {
    const status = statusFor(err.code);
    if (status === 500) throw err;
    sendJson(res, status, { message: err.message });
  }
}

async function route(req, res, getSession) {
  const parsed = new URL(req.url, 'http://localhost');
  const p = parsed.pathname;
  const query = parsed.searchParams;
  const method = req.method;
  let m;

  if (!p.startsWith('/api/refunds')) return false;

  if (p === '/api/refunds' && method === 'GET') { await getRefunds(req, res, getSession, query); return true; }
  if (p === '/api/refunds' && method === 'POST') { await postRefund(req, res, getSession); return true; }
  if ((m = p.match(/^\/api\/refunds\/eligible\/(\d+)$/)) && method === 'GET') {
    await getRefundableSale(req, res, getSession, Number(m[1])); return true;
  }
  if ((m = p.match(/^\/api\/refunds\/(\d+)$/)) && method === 'GET') {
    await getRefund(req, res, getSession, Number(m[1])); return true;
  }
  if ((m = p.match(/^\/api\/refunds\/(\d+)\/(approve|reject)$/)) && method === 'POST') {
    await reviewRefund(req, res, getSession, Number(m[1]), m[2]); return true;
  }

  return false;
}

module.exports = { route };
