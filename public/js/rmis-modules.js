// AM Restaurant RMIS — shared dashboard runtime (Sprint 2).
//
// Loaded by dashboard.html and every module page. Responsibilities:
//   1. Single source of truth for the 6 RMIS modules (label, icon, roles).
//      Role lists MUST stay in sync with PROTECTED_PAGES in server/index.js —
//      the server gate is the real enforcement; this only shapes the UI.
//   2. Hydrate the shared top bar from GET /api/me (name + role badge), redirect
//      to /login when the session is missing, and wire the Logout button.
//
// Modules are placeholders for now; real screens land in later sprints.

(function () {
  // Feather-style inline icons, keyed by module.
  const ICONS = {
    inventory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.27 6.96 12 12l8.73-5.04"/><path d="M12 22V12"/></svg>',
    sales: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><path d="M12 11v4"/><path d="M10 13h4"/></svg>',
    attendance: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M19 8v6"/><path d="M22 11h-6"/></svg>',
    supplier: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>',
    reservations: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/><path d="m9 16 2 2 4-4"/></svg>',
    analytics: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  };

  // The 6 RMIS modules. `sprint` = when the real screen is scheduled.
  const MODULES = [
    { key: 'inventory',    href: '/inventory',    label: 'Inventory & Stock',   desc: 'Stock levels & movement',    sprint: 2, roles: ['Admin', 'Manager', 'Staff'] },
    { key: 'sales',        href: '/sales',        label: 'Sales & Billing',     desc: 'Transactions & receipts',    sprint: 2, roles: ['Admin', 'Manager', 'Cashier'] },
    { key: 'attendance',   href: '/attendance',   label: 'Attendance & Manpower', desc: 'Employee time & staffing', sprint: 3, roles: ['Admin', 'Manager'] },
    { key: 'supplier',     href: '/supplier',     label: 'Supplier & Commissary', desc: 'Procurement & supply',     sprint: 3, roles: ['Admin', 'Manager'] },
    { key: 'reservations', href: '/reservations', label: 'Reservations & Tables', desc: 'Booking & table management', sprint: 3, roles: ['Admin', 'Manager', 'Cashier'] },
    { key: 'analytics',    href: '/analytics',    label: 'Analytics Dashboard', desc: 'Sales reports & insights',   sprint: 4, roles: ['Admin', 'Manager'] },
  ];

  // Admin/identity links (real Sprint 1 pages) surfaced on the home screen.
  const ADMIN_LINKS = [
    { key: 'settings', href: '/register',        label: 'Create User Account', desc: 'Register a new staff member', roles: ['Admin'] },
    { key: 'settings', href: '/admin-settings',  label: 'Admin Settings',      desc: 'Roles & permissions',         roles: ['Admin'] },
  ];

  function hydrateTopbar(me) {
    const nameEl = document.getElementById('user-name');
    const roleEl = document.getElementById('user-role');
    if (nameEl) nameEl.textContent = me.fullName;
    if (roleEl) roleEl.textContent = me.role;
    const logout = document.getElementById('logout-btn');
    if (logout) {
      logout.addEventListener('click', async () => {
        try { await fetch('/api/logout', { method: 'POST' }); }
        finally { window.location = '/login'; }
      });
    }
  }

  // Resolve the session once; expose it (and the registry) to page scripts.
  const ready = (async () => {
    let me;
    try {
      const res = await fetch('/api/me');
      if (res.status === 401) { window.location = '/login'; return null; }
      me = await res.json();
    } catch {
      window.location = '/login';
      return null;
    }
    hydrateTopbar(me);
    return me;
  })();

  window.RMIS = { ICONS, MODULES, ADMIN_LINKS, ready };
})();
