const dbApi = require('./db');

const SUPPLIER_ROLES = ['Admin', 'Manager'];
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^[0-9+\-()\s]{7,20}$/;

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => {
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

function requireRole(req, res, getSession, roles) {
  const s = getSession(req);
  if (!s) { sendJson(res, 401, { message: 'Not authenticated.' }); return null; }
  if (!roles.includes(s.role)) { sendJson(res, 403, { message: 'You do not have access to this action.' }); return null; }
  return s;
}

function validateSupplierPayload(data = {}) {
  const errors = {};
  const companyName = String(data.companyName || '').trim();
  const contactPerson = String(data.contactPerson || '').trim();
  const email = String(data.email || '').trim();
  const phoneNumber = String(data.phoneNumber || '').trim();
  const physicalAddress = String(data.physicalAddress || '').trim();
  const billingAddress = String(data.billingAddress || '').trim();
  const taxIdentificationNo = String(data.taxIdentificationNo || '').trim();

  if (!companyName) errors.companyName = 'Company name is required.';
  if (!contactPerson) errors.contactPerson = 'Primary contact person is required.';
  if (!email) errors.email = 'Email is required.';
  else if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';
  if (!phoneNumber) errors.phoneNumber = 'Phone number is required.';
  else if (!PHONE_RE.test(phoneNumber)) errors.phoneNumber = 'Enter a valid phone number.';
  if (!physicalAddress) errors.physicalAddress = 'Physical address is required.';
  if (!billingAddress) errors.billingAddress = 'Billing address is required.';
  if (!taxIdentificationNo) errors.taxIdentificationNo = 'TIN/business ID is required.';
  return errors;
}

async function listSuppliers(req, res, getSession) {
  const s = requireRole(req, res, getSession, SUPPLIER_ROLES);
  if (!s) return;
  try {
    const rows = await dbApi.listSuppliers();
    sendJson(res, 200, { suppliers: rows });
  } catch (err) {
    console.error('[suppliers:list] failed:', err);
    sendJson(res, 500, { message: 'Could not load suppliers.' });
  }
}

async function getSupplier(req, res, getSession, id) {
  const s = requireRole(req, res, getSession, SUPPLIER_ROLES);
  if (!s) return;
  try {
    const row = await dbApi.findSupplierById(id);
    if (!row) return sendJson(res, 404, { message: 'Supplier not found.' });
    sendJson(res, 200, { supplier: row });
  } catch (err) {
    console.error('[suppliers:get] failed:', err);
    sendJson(res, 500, { message: 'Could not load supplier.' });
  }
}

async function createSupplier(req, res, getSession) {
  const s = requireRole(req, res, getSession, SUPPLIER_ROLES);
  if (!s) return;
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }

  const errors = validateSupplierPayload(data);
  if (Object.keys(errors).length) return sendJson(res, 400, { message: 'Please correct the highlighted fields.', errors });

  try {
    const existing = await dbApi.findSupplierByName(data.companyName.trim());
    if (existing) return sendJson(res, 409, { message: 'Supplier already exists.', errors: { companyName: 'Supplier already exists.' } });

    const id = await dbApi.createSupplierRecord({
      companyName: data.companyName.trim(),
      contactPerson: data.contactPerson.trim(),
      email: data.email.trim(),
      phoneNumber: data.phoneNumber.trim(),
      physicalAddress: data.physicalAddress.trim(),
      billingAddress: data.billingAddress.trim(),
      taxIdentificationNo: data.taxIdentificationNo.trim(),
    });
    sendJson(res, 201, { id, message: 'Supplier created.' });
  } catch (err) {
    console.error('[suppliers:create] failed:', err);
    sendJson(res, 500, { message: 'Could not create supplier.' });
  }
}

async function updateSupplier(req, res, getSession, id) {
  const s = requireRole(req, res, getSession, SUPPLIER_ROLES);
  if (!s) return;
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }

  const errors = validateSupplierPayload(data);
  if (Object.keys(errors).length) return sendJson(res, 400, { message: 'Please correct the highlighted fields.', errors });

  try {
    const existing = await dbApi.findSupplierByName(data.companyName.trim());
    if (existing && existing.id !== id) return sendJson(res, 409, { message: 'Supplier name is already in use.', errors: { companyName: 'Supplier already exists.' } });

    const updated = await dbApi.updateSupplierRecord(id, {
      companyName: data.companyName.trim(),
      contactPerson: data.contactPerson.trim(),
      email: data.email.trim(),
      phoneNumber: data.phoneNumber.trim(),
      physicalAddress: data.physicalAddress.trim(),
      billingAddress: data.billingAddress.trim(),
      taxIdentificationNo: data.taxIdentificationNo.trim(),
    });
    if (!updated) return sendJson(res, 404, { message: 'Supplier not found.' });
    sendJson(res, 200, { id, message: 'Supplier updated.' });
  } catch (err) {
    console.error('[suppliers:update] failed:', err);
    sendJson(res, 500, { message: 'Could not update supplier.' });
  }
}

async function route(req, res, getSession) {
  const parsed = new URL(req.url, 'http://localhost');
  const p = parsed.pathname;
  const method = req.method;
  if (!p.startsWith('/api/suppliers')) return false;

  if (p === '/api/suppliers' && method === 'GET') { await listSuppliers(req, res, getSession); return true; }
  if (p === '/api/suppliers' && method === 'POST') { await createSupplier(req, res, getSession); return true; }
  let m;
  if ((m = p.match(/^\/api\/suppliers\/(\d+)$/)) && method === 'GET') { await getSupplier(req, res, getSession, Number(m[1])); return true; }
  if ((m = p.match(/^\/api\/suppliers\/(\d+)$/)) && method === 'PUT') { await updateSupplier(req, res, getSession, Number(m[1])); return true; }
  return false;
}

module.exports = { route, validateSupplierPayload };
