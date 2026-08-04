// AM Restaurant RMIS — shared UI helpers for the Sprint 2 module pages.
// Loaded after rmis-modules.js, before each page's own script. Exposes a small
// grab-bag on window.RMISUI so the inventory / alerts / adjustment / PO pages
// don't each re-implement escaping, fetch, modals, and banners.

(function () {
  // Escape user-supplied text before injecting into innerHTML.
  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Compact number: integers as-is, otherwise up to 2 decimals (no trailing 0s).
  function fmt(n) {
    if (n == null || n === '') return '';
    const num = Number(n);
    if (!Number.isFinite(num)) return '';
    return Number.isInteger(num) ? String(num) : String(Math.round(num * 100) / 100);
  }

  // Peso currency with thousands separators.
  function money(n) {
    const num = Number(n) || 0;
    return '₱' + num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  // Short date (YYYY-MM-DD -> e.g. "Jul 18, 2026"); passes through ISO strings.
  function shortDate(s) {
    if (!s) return '';
    const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s);
    if (Number.isNaN(d.getTime())) return esc(s);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // fetch wrapper -> { ok, status, data }. Redirects to /login on 401.
  async function api(method, url, body) {
    const opts = { method, headers: {} };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    const res = await fetch(url, opts);
    if (res.status === 401) { window.location = '/login'; throw new Error('unauthenticated'); }
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    return { ok: res.ok, status: res.status, data };
  }

  // Modal: fill #modal-card and reveal #modal. Any element with [data-close]
  // (or a click on the backdrop, or Escape) closes it.
  function openModal(html) {
    const overlay = document.getElementById('modal');
    const card = document.getElementById('modal-card');
    card.innerHTML = html;
    overlay.hidden = false;
    card.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeModal));
  }
  function closeModal() {
    const overlay = document.getElementById('modal');
    if (overlay) overlay.hidden = true;
  }
  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'modal') closeModal();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  // Show/hide a notice banner by element id. type: 'warn' | 'ok' | 'err'.
  function notice(id, type, msg) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!msg) { el.hidden = true; return; }
    el.className = 'notice notice-' + type;
    el.innerHTML = msg;
    el.hidden = false;
  }

  window.RMISUI = { esc, fmt, money, shortDate, api, openModal, closeModal, notice };
})();
