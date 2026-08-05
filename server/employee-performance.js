const dbApi = require('./db');

const REPORT_ROLES = ['Admin', 'Manager'];
const EXPORT_TYPES = ['csv', 'pdf'];

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
  if (!roles.includes(s.role)) { sendJson(res, 403, { message: 'Manager or Admin access required.' }); return null; }
  return s;
}

function validatePerformancePayload(data = {}) {
  const errors = {};
  const employeeName = String(data.employeeName || '').trim();
  const role = String(data.role || '').trim();
  const period = String(data.period || '').trim();
  if (!employeeName) errors.employeeName = 'Employee name is required.';
  if (!role) errors.role = 'Role is required.';
  if (!period) errors.period = 'Reporting period is required.';
  return errors;
}

function buildCsv(rows) {
  const headers = ['Employee', 'Role', 'Orders Served', 'Sales', 'Punctuality', 'Period'];
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push([
      row.employeeName,
      row.role,
      row.ordersServed,
      row.sales,
      row.punctuality,
      row.period,
    ].map((value) => `"${String(value || '').replace(/"/g, '""')}"`).join(','));
  }
  return lines.join('\n');
}

async function listReports(req, res, getSession, query) {
  const s = requireRole(req, res, getSession, REPORT_ROLES);
  if (!s) return;

  const employeeName = (query.get('employeeName') || '').trim();
  const role = (query.get('role') || '').trim();
  const period = (query.get('period') || '').trim();
  try {
    const rows = await dbApi.listEmployeePerformanceReports({ employeeName, role, period });
    sendJson(res, 200, { reports: rows });
  } catch (err) {
    console.error('[employee-performance:list] failed:', err);
    sendJson(res, 500, { message: 'Could not load employee performance reports.' });
  }
}

async function createReport(req, res, getSession) {
  const s = requireRole(req, res, getSession, REPORT_ROLES);
  if (!s) return;

  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }

  const errors = validatePerformancePayload(data);
  if (Object.keys(errors).length) return sendJson(res, 400, { message: 'Please correct the highlighted fields.', errors });

  try {
    const id = await dbApi.createEmployeePerformanceReport({
      employeeName: data.employeeName.trim(),
      role: data.role.trim(),
      period: data.period.trim(),
      ordersServed: Number(data.ordersServed || 0),
      sales: Number(data.sales || 0),
      punctuality: String(data.punctuality || 'N/A').trim(),
      notes: data.notes || null,
      createdBy: s.userId,
    });
    sendJson(res, 201, { message: 'Performance report saved.', id });
  } catch (err) {
    console.error('[employee-performance:create] failed:', err);
    sendJson(res, 500, { message: 'Could not save the performance report.' });
  }
}

async function getReport(req, res, getSession, id) {
  const s = requireRole(req, res, getSession, REPORT_ROLES);
  if (!s) return;

  try {
    const row = await dbApi.findEmployeePerformanceReportById(id);
    if (!row) return sendJson(res, 404, { message: 'Performance report not found.' });
    sendJson(res, 200, { report: row });
  } catch (err) {
    console.error('[employee-performance:get] failed:', err);
    sendJson(res, 500, { message: 'Could not load the performance report.' });
  }
}

async function exportReport(req, res, getSession) {
  const s = requireRole(req, res, getSession, REPORT_ROLES);
  if (!s) return;

  const parsed = new URL(req.url, 'http://localhost');
  const format = (parsed.searchParams.get('format') || 'csv').toLowerCase();
  if (!EXPORT_TYPES.includes(format)) return sendJson(res, 400, { message: 'Unsupported export format.' });

  try {
    const rows = await dbApi.listEmployeePerformanceReports({
      employeeName: (parsed.searchParams.get('employeeName') || '').trim(),
      role: (parsed.searchParams.get('role') || '').trim(),
      period: (parsed.searchParams.get('period') || '').trim(),
    });
    const payload = format === 'pdf' ? 'PDF export placeholder' : buildCsv(rows);
    res.writeHead(200, { 'Content-Type': format === 'pdf' ? 'application/pdf' : 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename=employee-performance.${format}` });
    res.end(payload);
  } catch (err) {
    console.error('[employee-performance:export] failed:', err);
    sendJson(res, 500, { message: 'Could not export the performance report.' });
  }
}

async function updateReport(req, res, getSession, id) {
  const s = requireRole(req, res, getSession, REPORT_ROLES);
  if (!s) return;
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }
  const errors = validatePerformancePayload(data);
  if (Object.keys(errors).length) return sendJson(res, 400, { message: 'Please correct the highlighted fields.', errors });
  try {
    const ok = await dbApi.updateEmployeePerformanceReport(id, { ...data, employeeName: data.employeeName.trim(), role: data.role.trim(), period: data.period.trim() });
    if (!ok) return sendJson(res, 404, { message: 'Performance report not found.' });
    sendJson(res, 200, { message: 'Performance report updated.' });
  } catch (err) {
    console.error('[employee-performance:update] failed:', err);
    sendJson(res, 500, { message: 'Could not update the performance report.' });
  }
}

async function deleteReport(req, res, getSession, id) {
  const s = requireRole(req, res, getSession, REPORT_ROLES);
  if (!s) return;
  try {
    const ok = await dbApi.deleteEmployeePerformanceReport(id);
    if (!ok) return sendJson(res, 404, { message: 'Performance report not found.' });
    sendJson(res, 200, { message: 'Performance report deleted.' });
  } catch (err) {
    console.error('[employee-performance:delete] failed:', err);
    sendJson(res, 500, { message: 'Could not delete the performance report.' });
  }
}

async function route(req, res, getSession) {
  const parsed = new URL(req.url, 'http://localhost');
  const p = parsed.pathname;
  const method = req.method;
  if (!p.startsWith('/api/employee-performance')) return false;

  if (p === '/api/employee-performance' && method === 'GET') { await listReports(req, res, getSession, parsed.searchParams); return true; }
  if (p === '/api/employee-performance' && method === 'POST') { await createReport(req, res, getSession); return true; }
  if (p === '/api/employee-performance/export' && method === 'GET') { await exportReport(req, res, getSession); return true; }
  let m;
  if ((m = p.match(/^\/api\/employee-performance\/(\d+)$/)) && method === 'GET') { await getReport(req, res, getSession, Number(m[1])); return true; }
  if ((m = p.match(/^\/api\/employee-performance\/(\d+)$/)) && method === 'PUT') { await updateReport(req, res, getSession, Number(m[1])); return true; }
  if ((m = p.match(/^\/api\/employee-performance\/(\d+)$/)) && method === 'DELETE') { await deleteReport(req, res, getSession, Number(m[1])); return true; }
  return false;
}

module.exports = { route, validatePerformancePayload };
