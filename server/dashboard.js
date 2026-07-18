// AM Restaurant RMIS — dashboard summary API.
//
// GET /api/dashboard/summary returns the KPI tiles for the apps-home page,
// computed from live data and filtered to what the current role may see (so
// the client never has to call several role-gated endpoints and swallow 403s).
// Each role gets four relevant tiles.

const dbApi = require('./db');

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function money(n) {
  return '₱' + (Number(n) || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function localDate() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function buildKpis(s) {
  const role = s.role;
  const isSales = ['Admin', 'Manager', 'Cashier'].includes(role);
  const isInventory = ['Admin', 'Manager', 'Staff'].includes(role);
  const isManager = ['Admin', 'Manager'].includes(role);
  const today = localDate();
  const kpis = [];

  // Sales snapshot (Admin / Manager / Cashier).
  if (isSales) {
    const todays = dbApi.listSales({ date: today });
    const paid = todays.filter((x) => x.status === 'Paid');
    const salesTotal = paid.reduce((sum, x) => sum + x.total, 0);
    const open = dbApi.listSales({ status: 'Open' }).length;
    kpis.push({ label: "Today's Sales", value: money(salesTotal), sub: `${paid.length} paid bill${paid.length === 1 ? '' : 's'}` });
    kpis.push({ label: 'Open Bills', value: String(open), sub: open ? 'awaiting settlement' : 'all settled' });
  }

  // Inventory snapshot (Admin / Manager / Staff).
  if (isInventory) {
    const ings = dbApi.listIngredients();
    const out = ings.filter((i) => i.quantity <= 0).length;
    const low = ings.filter((i) => i.quantity > 0 && i.quantity <= i.reorder_level).length;
    kpis.push({ label: 'Low-stock Items', value: String(low + out), sub: out ? `${out} out of stock` : 'at/below reorder level' });
  }

  // Manpower snapshot — managers see the whole floor; employees see themselves.
  if (isManager) {
    const onShift = dbApi.listAttendance().filter((a) => a.time_out === '').length;
    kpis.push({ label: 'Staff On Shift', value: String(onShift), sub: 'clocked in now' });
  } else {
    const open = dbApi.findOpenAttendance(s.userId);
    kpis.push({ label: 'My Shift', value: open ? 'Clocked In' : 'Off shift', sub: open ? 'don’t forget to time out' : 'time in on the clock' });
  }

  // Fourth tile, role-specific, so every role gets a full row.
  if (role === 'Cashier') {
    const mine = dbApi.listSales({ date: today, cashierId: s.userId }).length;
    kpis.push({ label: 'My Bills Today', value: String(mine), sub: 'bills you created' });
  } else if (role === 'Staff') {
    const pending = dbApi.listLeave({ userId: s.userId, status: 'Pending' }).length;
    kpis.push({ label: 'My Pending Leave', value: String(pending), sub: 'awaiting approval' });
  } else {
    // Admin / Manager
    const pending = dbApi.listLeave({ status: 'Pending' }).length;
    kpis.push({ label: 'Pending Leave', value: String(pending), sub: 'awaiting review' });
  }

  return kpis;
}

async function route(req, res, getSession) {
  if (req.method !== 'GET' || req.url.split('?')[0] !== '/api/dashboard/summary') return false;
  const s = getSession(req);
  if (!s) { sendJson(res, 401, { message: 'Not authenticated.' }); return true; }
  sendJson(res, 200, { kpis: buildKpis(s) });
  return true;
}

module.exports = { route };
