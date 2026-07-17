// AM Restaurant RMIS — apps home (Sprint 2).
// Renders the greeting, KPI stat tiles, and the role-aware module grid.
// Depends on rmis-modules.js (loaded first) for the session + registry.

(async () => {
  const me = await window.RMIS.ready;
  if (!me) return; // rmis-modules.js already redirected to /login.

  document.getElementById('greeting').textContent =
    `Welcome, ${me.fullName}`;

  // KPI tiles are illustrative placeholders (no live data yet).
  const KPIS = [
    { label: "Today's Sales", value: '₱12,480', sub: 'demo data' },
    { label: 'Open Orders',   value: '8',        sub: 'demo data' },
    { label: 'Low-stock Items', value: '3',      sub: 'demo data' },
    { label: 'Staff On Shift', value: '11',      sub: 'demo data' },
  ];
  document.getElementById('kpi-row').innerHTML = KPIS.map((k) => `
    <div class="kpi">
      <div class="kpi-label">${k.label}</div>
      <div class="kpi-value">${k.value}</div>
      <div class="kpi-sub">${k.sub}</div>
    </div>`).join('');

  function tile(m) {
    const badge = m.sprint
      ? `<span class="pill pill-sprint">Sprint ${m.sprint}</span>`
      : `<span class="pill pill-live">Live</span>`;
    return `
      <a class="app-tile" href="${m.href}">
        <span class="app-icon">${window.RMIS.ICONS[m.key] || ''}</span>
        <span class="app-tile-body">
          <h3>${m.label}</h3>
          <p>${m.desc}</p>
          ${badge}
        </span>
      </a>`;
  }

  // Module grid, filtered to the roles the current user may access.
  const visible = window.RMIS.MODULES.filter((m) => m.roles.includes(me.role));
  document.getElementById('app-grid').innerHTML = visible.map(tile).join('');

  // Administration section (Admin only) — real Sprint 1 pages.
  const adminLinks = window.RMIS.ADMIN_LINKS.filter((l) => l.roles.includes(me.role));
  const adminSection = document.getElementById('admin-section');
  if (adminLinks.length) {
    document.getElementById('admin-grid').innerHTML = adminLinks
      .map((l) => tile({ ...l, sprint: 0 })).join('');
  } else {
    adminSection.remove();
  }
})();
