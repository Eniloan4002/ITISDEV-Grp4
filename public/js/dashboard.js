// AM Restaurant RMIS — apps home (Sprint 2).
// Renders the greeting, KPI stat tiles, and the role-aware module grid.
// Depends on rmis-modules.js (loaded first) for the session + registry.

// Escape any value that reaches innerHTML. Reservation names, ingredient names,
// table locations and profile display names are all user-supplied and stored, so
// interpolating them raw is a stored-XSS vector.
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}


(async () => {
  const me = await window.RMIS.ready;
  if (!me) return; // rmis-modules.js already redirected to /login.

  document.getElementById('greeting').textContent =
    `Welcome, ${esc(me.fullName)}`;

  // Live KPI tiles, computed server-side and filtered to this role.
  const kpiRow = document.getElementById('kpi-row');
  try {
    const res = await fetch('/api/dashboard/summary');
    const data = await res.json();
    const kpis = (data && data.kpis) || [];
    kpiRow.innerHTML = kpis.map((k) => `
      <div class="kpi">
        <div class="kpi-label">${esc(k.label)}</div>
        <div class="kpi-value">${esc(k.value)}</div>
        <div class="kpi-sub">${esc(k.sub)}</div>
      </div>`).join('');
  } catch {
    kpiRow.innerHTML = '<div class="kpi"><div class="kpi-label">Metrics</div><div class="kpi-value">&mdash;</div><div class="kpi-sub">unavailable</div></div>';
  }

  function tile(m) {
    const badge = m.sprint
      ? `<span class="pill pill-sprint">Sprint ${m.sprint}</span>`
      : `<span class="pill pill-live">Live</span>`;
    return `
      <a class="app-tile" href="${esc(m.href)}">
        <span class="app-icon">${window.RMIS.ICONS[m.key] || ''}</span>
        <span class="app-tile-body">
          <h3>${esc(m.label)}</h3>
          <p>${esc(m.desc)}</p>
          ${badge}
        </span>
      </a>`;
  }

  // One section per umbrella category, in the order GROUPS declares, each
  // filtered to the roles this user may access. A group with nothing visible is
  // omitted entirely rather than left as an empty heading — a Cashier, for
  // instance, sees no Reservations & Tables section at all.
  const visible = window.RMIS.MODULES.filter((m) => m.roles.includes(me.role));
  const sections = window.RMIS.GROUPS
    .map((group) => ({ group, items: visible.filter((m) => m.group === group) }))
    .filter((s) => s.items.length);

  // Anything without a recognised group would otherwise vanish silently; collect
  // it under a trailing "Other" heading so a registry typo is visible.
  const grouped = new Set(sections.flatMap((s) => s.items));
  const ungrouped = visible.filter((m) => !grouped.has(m));
  if (ungrouped.length) sections.push({ group: 'Other', items: ungrouped });

  document.getElementById('app-grid').innerHTML = sections.map((s) => `
    <h2 class="section-title">${esc(s.group)}</h2>
    <div class="app-grid">${s.items.map(tile).join('')}</div>
  `).join('');

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
