// AM Restaurant RMIS — Sprint 3 Attendance & Manpower API.
//
// Same shape as rmis.js: index.js delegates /api/* here and route() returns
// true once it has handled the request. Covers three backlog stories:
//   - Time-in / time-out logging (one open shift per employee at a time)
//   - Work schedules (manager-managed shifts, overlap prevention)
//   - Leave requests (employee-submitted, manager approve/reject; approved
//     leave surfaces in the schedule view)
//
// Employees ARE the users table — anyone who can log in can clock in, view
// their own schedule, and file leave. Managers/Admins manage everyone.

const dbApi = require('./db');

const ALL_ROLES = ['Admin', 'Manager', 'Cashier', 'Staff']; // any employee
const MANAGER_ROLES = ['Admin', 'Manager'];                 // manage/approve

const LEAVE_TYPES = ['Vacation', 'Sick', 'Emergency', 'Personal'];

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { if (!raw) return resolve({}); try { resolve(JSON.parse(raw)); } catch { reject(new Error('bad json')); } });
    req.on('error', reject);
  });
}

function requireRole(req, res, getSession, roles) {
  const s = getSession(req);
  if (!s) { sendJson(res, 401, { message: 'Not authenticated.' }); return null; }
  if (!roles.includes(s.role)) { sendJson(res, 403, { message: 'You do not have access to this action.' }); return null; }
  return s;
}

// Local calendar date 'YYYY-MM-DD' (not UTC — matters near midnight).
function todayStr() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function nowIso() { return new Date().toISOString(); }

function sessionName(s) {
  const u = dbApi.findUserById(s.userId);
  return u ? u.full_name : (s.email || '').split('@')[0];
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

// ---- serializers ----
function serAttendance(r) {
  return { id: r.id, userId: r.user_id, employee: r.employee_name, date: r.work_date,
    timeIn: r.time_in, timeOut: r.time_out, open: r.time_out === '' };
}
function serShift(r) {
  return { id: r.id, userId: r.user_id, employee: r.employee_name, date: r.shift_date,
    start: r.start_time, end: r.end_time };
}
function serLeave(r) {
  return { id: r.id, userId: r.user_id, employee: r.employee_name, type: r.leave_type,
    startDate: r.start_date, endDate: r.end_date, reason: r.reason, status: r.status,
    reviewedBy: r.reviewed_by_name, reviewedAt: r.reviewed_at };
}

// ---- employees ----
function getEmployees(req, res, getSession) {
  if (!requireRole(req, res, getSession, MANAGER_ROLES)) return;
  sendJson(res, 200, { employees: dbApi.listUsers().map((u) => ({ id: u.id, name: u.full_name, role: u.role })) });
}

// ---- attendance ----
function getMyAttendance(req, res, getSession) {
  const s = requireRole(req, res, getSession, ALL_ROLES);
  if (!s) return;
  const open = dbApi.findOpenAttendance(s.userId);
  const logs = dbApi.listAttendance({ userId: s.userId }).slice(0, 30).map(serAttendance);
  sendJson(res, 200, { open: open ? serAttendance(open) : null, logs });
}

function postTimeIn(req, res, getSession) {
  const s = requireRole(req, res, getSession, ALL_ROLES);
  if (!s) return;
  // AC: prevent a duplicate time-in without a corresponding time-out.
  if (dbApi.findOpenAttendance(s.userId)) {
    return sendJson(res, 409, { message: 'You are already timed in. Time out before clocking in again.' });
  }
  const id = dbApi.createTimeIn({ userId: s.userId, employeeName: sessionName(s), workDate: todayStr(), timeIn: nowIso() });
  sendJson(res, 201, { record: serAttendance(dbApi.listAttendance({ userId: s.userId }).find((r) => r.id === id)) });
}

function postTimeOut(req, res, getSession) {
  const s = requireRole(req, res, getSession, ALL_ROLES);
  if (!s) return;
  const open = dbApi.findOpenAttendance(s.userId);
  if (!open) return sendJson(res, 409, { message: 'No open time-in found. Clock in first.' });
  dbApi.setTimeOut(open.id, nowIso());
  const updated = dbApi.listAttendance({ userId: s.userId }).find((r) => r.id === open.id);
  sendJson(res, 200, { record: serAttendance(updated) });
}

// Manager view of everyone's logs, searchable by employee + date.
function getAllAttendance(req, res, getSession, query) {
  if (!requireRole(req, res, getSession, MANAGER_ROLES)) return;
  const employee = query.get('employee') ? Number(query.get('employee')) : undefined;
  const date = query.get('date') || undefined;
  const logs = dbApi.listAttendance({ userId: Number.isFinite(employee) ? employee : undefined, date }).map(serAttendance);
  sendJson(res, 200, { logs });
}

// ---- shifts / schedules ----
function timesOverlap(aStart, aEnd, bStart, bEnd) { return aStart < bEnd && bStart < aEnd; }

function getShifts(req, res, getSession, query) {
  const s = requireRole(req, res, getSession, ALL_ROLES);
  if (!s) return;
  const isManager = MANAGER_ROLES.includes(s.role);
  // Employees only ever see their own schedule; managers may filter by employee.
  const filterEmp = query.get('employee') ? Number(query.get('employee')) : undefined;
  const userId = isManager ? (Number.isFinite(filterEmp) ? filterEmp : undefined) : s.userId;
  const date = query.get('date') || undefined;
  const shifts = dbApi.listShifts({ userId, date }).map(serShift);
  // AC: approved leave is reflected in the schedule.
  const leave = dbApi.listApprovedLeave({ userId, date }).map(serLeave);
  sendJson(res, 200, { shifts, leave, canManage: isManager });
}

async function postShift(req, res, getSession) {
  const s = requireRole(req, res, getSession, MANAGER_ROLES);
  if (!s) return;
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }
  const v = validateShift(data);
  if (v.error) return sendJson(res, 400, v.error);

  // AC: prevent overlapping shifts for the same employee on the same date.
  const clash = dbApi.listShiftsForDate(v.userId, v.shiftDate)
    .find((x) => timesOverlap(v.startTime, v.endTime, x.start_time, x.end_time));
  if (clash) {
    return sendJson(res, 409, { message: `Shift overlaps an existing ${clash.start_time}–${clash.end_time} shift for ${v.employeeName} on ${v.shiftDate}.` });
  }
  const id = dbApi.createShift({ ...v, createdBy: s.userId });
  sendJson(res, 201, { shift: serShift(dbApi.findShiftById(id)) });
}

async function patchShift(req, res, getSession, id) {
  const s = requireRole(req, res, getSession, MANAGER_ROLES);
  if (!s) return;
  const existing = dbApi.findShiftById(id);
  if (!existing) return sendJson(res, 404, { message: 'Shift not found.' });
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }
  const v = validateShift(data);
  if (v.error) return sendJson(res, 400, v.error);

  const clash = dbApi.listShiftsForDate(v.userId, v.shiftDate)
    .find((x) => x.id !== id && timesOverlap(v.startTime, v.endTime, x.start_time, x.end_time));
  if (clash) {
    return sendJson(res, 409, { message: `Shift overlaps an existing ${clash.start_time}–${clash.end_time} shift for ${v.employeeName} on ${v.shiftDate}.` });
  }
  dbApi.updateShift(id, v);
  sendJson(res, 200, { shift: serShift(dbApi.findShiftById(id)) });
}

function deleteShiftHandler(req, res, getSession, id) {
  if (!requireRole(req, res, getSession, MANAGER_ROLES)) return;
  if (!dbApi.findShiftById(id)) return sendJson(res, 404, { message: 'Shift not found.' });
  dbApi.deleteShift(id);
  sendJson(res, 200, { ok: true });
}

// Shared validation for create/edit. Returns { error } or resolved fields.
function validateShift(data) {
  const errors = {};
  const userId = Number(data.employeeId);
  const emp = Number.isFinite(userId) ? dbApi.findUserById(userId) : null;
  if (!emp) errors.employeeId = 'Choose an employee.';
  const shiftDate = (data.date || '').trim();
  if (!DATE_RE.test(shiftDate)) errors.date = 'Use a valid date.';
  const startTime = (data.start || '').trim();
  const endTime = (data.end || '').trim();
  if (!TIME_RE.test(startTime)) errors.start = 'Enter a start time.';
  if (!TIME_RE.test(endTime)) errors.end = 'Enter an end time.';
  if (TIME_RE.test(startTime) && TIME_RE.test(endTime) && endTime <= startTime) errors.end = 'End time must be after start time.';
  if (Object.keys(errors).length) return { error: { message: 'Please correct the highlighted fields.', errors } };
  return { userId, employeeName: emp.full_name, shiftDate, startTime, endTime };
}

// ---- leave ----
function getLeave(req, res, getSession, query) {
  const s = requireRole(req, res, getSession, ALL_ROLES);
  if (!s) return;
  const isManager = MANAGER_ROLES.includes(s.role);
  const filterEmp = query.get('employee') ? Number(query.get('employee')) : undefined;
  const userId = isManager ? (Number.isFinite(filterEmp) ? filterEmp : undefined) : s.userId;
  const status = query.get('status') || undefined;
  const requests = dbApi.listLeave({ userId, status }).map(serLeave);
  sendJson(res, 200, { requests, canManage: isManager });
}

async function postLeave(req, res, getSession) {
  const s = requireRole(req, res, getSession, ALL_ROLES);
  if (!s) return;
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }
  const errors = {};
  const leaveType = (data.leaveType || '').trim();
  if (!LEAVE_TYPES.includes(leaveType)) errors.leaveType = 'Choose a leave type.';
  const startDate = (data.startDate || '').trim();
  const endDate = (data.endDate || '').trim();
  if (!DATE_RE.test(startDate)) errors.startDate = 'Use a valid start date.';
  if (!DATE_RE.test(endDate)) errors.endDate = 'Use a valid end date.';
  if (DATE_RE.test(startDate) && DATE_RE.test(endDate) && endDate < startDate) errors.endDate = 'End date cannot be before start date.';
  const reason = (data.reason || '').trim();
  if (!reason) errors.reason = 'A reason is required.';
  if (Object.keys(errors).length) return sendJson(res, 400, { message: 'Please correct the highlighted fields.', errors });

  const id = dbApi.createLeave({ userId: s.userId, employeeName: sessionName(s), leaveType, startDate, endDate, reason });
  sendJson(res, 201, { request: serLeave(dbApi.findLeaveById(id)) });
}

async function patchLeave(req, res, getSession, id) {
  const s = requireRole(req, res, getSession, MANAGER_ROLES);
  if (!s) return;
  const existing = dbApi.findLeaveById(id);
  if (!existing) return sendJson(res, 404, { message: 'Leave request not found.' });
  let data;
  try { data = await readJson(req); } catch { return sendJson(res, 400, { message: 'Invalid request.' }); }
  const status = data.status;
  if (status !== 'Approved' && status !== 'Rejected') {
    return sendJson(res, 400, { message: 'Status must be Approved or Rejected.' });
  }
  if (existing.status !== 'Pending') {
    return sendJson(res, 400, { message: `This request was already ${existing.status.toLowerCase()}.` });
  }
  dbApi.setLeaveStatus(id, status, s.userId, sessionName(s));
  sendJson(res, 200, { request: serLeave(dbApi.findLeaveById(id)) });
}

// ---- router ----
async function route(req, res, getSession) {
  const parsed = new URL(req.url, 'http://localhost');
  const p = parsed.pathname;
  const q = parsed.searchParams;
  const method = req.method;
  if (!p.startsWith('/api/')) return false;

  if (p === '/api/employees' && method === 'GET') { getEmployees(req, res, getSession); return true; }

  if (p === '/api/attendance/me' && method === 'GET') { getMyAttendance(req, res, getSession); return true; }
  if (p === '/api/attendance/time-in' && method === 'POST') { postTimeIn(req, res, getSession); return true; }
  if (p === '/api/attendance/time-out' && method === 'POST') { postTimeOut(req, res, getSession); return true; }
  if (p === '/api/attendance' && method === 'GET') { getAllAttendance(req, res, getSession, q); return true; }

  if (p === '/api/shifts' && method === 'GET') { getShifts(req, res, getSession, q); return true; }
  if (p === '/api/shifts' && method === 'POST') { await postShift(req, res, getSession); return true; }
  let m;
  if ((m = p.match(/^\/api\/shifts\/(\d+)$/))) {
    const id = Number(m[1]);
    if (method === 'PATCH') { await patchShift(req, res, getSession, id); return true; }
    if (method === 'DELETE') { deleteShiftHandler(req, res, getSession, id); return true; }
  }

  if (p === '/api/leave' && method === 'GET') { getLeave(req, res, getSession, q); return true; }
  if (p === '/api/leave' && method === 'POST') { await postLeave(req, res, getSession); return true; }
  if ((m = p.match(/^\/api\/leave\/(\d+)$/)) && method === 'PATCH') { await patchLeave(req, res, getSession, Number(m[1])); return true; }

  return false;
}

module.exports = { route };
