// AM Restaurant RMIS — apps home (Sprint 2).
// Renders the greeting, KPI stat tiles, and the role-aware module grid.
// Depends on rmis-modules.js (loaded first) for the session + registry.

(async () => {
  const me = await window.RMIS.ready;
  if (!me) return; // rmis-modules.js already redirected to /login.

  document.getElementById('greeting').textContent =
    `Welcome, ${me.fullName}`;

  // Live KPI tiles, computed server-side and filtered to this role.
  const kpiRow = document.getElementById('kpi-row');
  try {
    const res = await fetch('/api/dashboard/summary');
    const data = await res.json();
    const kpis = (data && data.kpis) || [];
    kpiRow.innerHTML = kpis.map((k) => `
      <div class="kpi">
        <div class="kpi-label">${k.label}</div>
        <div class="kpi-value">${k.value}</div>
        <div class="kpi-sub">${k.sub}</div>
      </div>`).join('');
  } catch {
    kpiRow.innerHTML = '<div class="kpi"><div class="kpi-label">Metrics</div><div class="kpi-value">&mdash;</div><div class="kpi-sub">unavailable</div></div>';
  }

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
