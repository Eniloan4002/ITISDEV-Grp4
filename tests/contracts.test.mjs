// Contract tests — no database required, so they run anywhere.
//
// Every case here corresponds to a bug that actually shipped. The point is not
// coverage for its own sake; it is that all four of these were invisible in
// review and only surfaced by running the app.
//
//   npm test

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------
// 1. Every module a router requires must exist.
//
// PR #4 merged with require('./suppliers'), './pos', './refunds' and './reports'
// left behind after the files were deleted. require() runs at module load, so
// the server died before listen() — every page down, not just the new ones.
// ---------------------------------------------------------------------------
test('every server require resolves to a real file', () => {
  const files = readdirSync(new URL('../server', import.meta.url)).filter((f) => f.endsWith('.js'));
  const present = new Set(files.map((f) => f.replace(/\.js$/, '')));
  const missing = [];
  for (const f of files) {
    for (const m of read(`server/${f}`).matchAll(/require\('\.\/([a-z-]+)'\)/g)) {
      if (!present.has(m[1])) missing.push(`${f} -> ./${m[1]}`);
    }
  }
  assert.deepEqual(missing, [], `dangling require(s): ${missing.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 2. Every dbApi.* helper a router calls must be exported by db.js.
//
// The Sprint 5 merge defined all seven helpers and exported none, so both new
// screens returned 500 with "db.listAuditLogs is not a function". The same
// omission was on the feature branch, meaning those screens had never worked.
// ---------------------------------------------------------------------------
test('every dbApi helper used by a router is exported from db.js', () => {
  const db = read('server/db.js');
  const exportsBlock = db.slice(db.indexOf('module.exports'));
  const files = readdirSync(new URL('../server', import.meta.url)).filter((f) => f.endsWith('.js'));

  const missing = [];
  for (const f of files) {
    for (const m of read(`server/${f}`).matchAll(/dbApi\.([a-zA-Z][\w]*)/g)) {
      const name = m[1];
      if (!new RegExp(`\\b${name}\\b`).test(exportsBlock)) missing.push(`${f}: ${name}`);
    }
  }
  assert.deepEqual([...new Set(missing)], [], `not exported from db.js: ${missing.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 3. Dashboard tile roles must match the server's page gate.
//
// The tile list offered Cashiers "Table Availability" while PROTECTED_PAGES
// denied them, so clicking it produced a 403. The server is the real gate; the
// tiles must not promise more than it allows.
// ---------------------------------------------------------------------------
test('module tile roles never exceed the server page gate', () => {
  const idx = read('server/index.js');
  const block = idx.slice(idx.indexOf('const PROTECTED_PAGES'), idx.indexOf('// In-memory session store'));
  const ALL = ['Admin', 'Manager', 'Cashier', 'Staff'];

  const gate = {};
  for (const m of block.matchAll(/'(\/[a-z-]+)':\s*(ALL_ROLES|\[([^\]]*)\])/g)) {
    gate[m[1]] = m[2] === 'ALL_ROLES'
      ? ALL
      : m[3].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
  }

  const tiles = read('public/js/rmis-modules.js');
  const problems = [];
  for (const m of tiles.matchAll(/href: '([^']+)'[^\n]*?roles: \[([^\]]*)\]/g)) {
    const href = m[1];
    const roles = m[2].split(',').map((s) => s.trim().replace(/'/g, '')).filter(Boolean);
    if (!(href in gate)) continue; // /login, /profile are ungated
    const over = roles.filter((r) => !gate[href].includes(r));
    if (over.length) problems.push(`${href} shows ${over.join('/')} but the server denies them`);
  }
  assert.deepEqual(problems, [], problems.join('; '));
});

// ---------------------------------------------------------------------------
// 4. Fields a user can type must never reach innerHTML unescaped.
//
// reservations.js rendered r.customer_name raw. A reservation named
// <img src=x onerror=...> executed for every staff member who opened the page —
// confirmed exploitable before the fix. Rather than guess at every expression,
// this pins the specific columns a user controls: if one appears inside a
// template literal without esc(), the test fails.
// ---------------------------------------------------------------------------
test('user-supplied fields are escaped wherever they are interpolated', () => {
  // Columns whose value originates from a form, not from the app.
  const USER_FIELDS = [
    'customer_name', 'contact_number', 'ingredient_name', 'ingredient_type_name',
    'unit_of_measure', 'table_location', 'table_number', 'fullName',
  ];
  const dir = new URL('../public/js', import.meta.url);
  const offenders = [];

  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = read(`public/js/${f}`);
    for (const field of USER_FIELDS) {
      // any `${ ...field }` that does not pass through esc()/escapeHtml()
      const re = new RegExp(`\\$\\{([^}]*\\b${field}\\b[^}]*)\\}`, 'g');
      for (const m of src.matchAll(re)) {
        const expr = m[1];
        if (/esc\(|escapeHtml\(/.test(expr)) continue;
        // Only HTML sinks matter. confirm()/alert()/textContent render plain
        // text, so an unescaped value there is not an injection vector.
        const line = src.slice(0, m.index).split('\n').pop() + src.slice(m.index).split('\n')[0];
        if (/confirm\(|alert\(|textContent|console\.|\.value\b/.test(line)) continue;
        offenders.push(`${f}: \${${expr}}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `unescaped user input: ${offenders.join(', ')}`);
});

// ---------------------------------------------------------------------------
// 5. Leave types must map both ways.
//
// The UI offers Vacation/Sick/Emergency/Personal; AMDB's enum is
// 'Sick Leave','Vacation Leave','Emergency Leave','Other'. Without an explicit
// map every request collapsed to "Other" — no error, just wrong data.
// ---------------------------------------------------------------------------
test('every UI leave type maps to a distinct AMDB enum value', () => {
  const db = read('server/db.js');
  const uiTypes = read('server/attendance.js')
    .match(/const LEAVE_TYPES = \[([^\]]+)\]/)[1]
    .split(',').map((s) => s.trim().replace(/'/g, ''));

  const mapped = new Set();
  for (const t of uiTypes) {
    const m = db.match(new RegExp(`${t}:\\s*'([^']+)'`));
    assert.ok(m, `LEAVE_TYPE_TO_AMDB has no entry for "${t}" — it would collapse to Other`);
    mapped.add(m[1]);
  }
  assert.equal(mapped.size, uiTypes.length,
    'two UI leave types map to the same AMDB value, so they cannot round-trip');
});

// ---------------------------------------------------------------------------
// 6. decimalNumbers must stay on.
//
// MySQL returns DECIMAL as strings. With it off, "6.00" + 1e-9 >= "10.00" is a
// lexicographic compare that reports a partially received purchase order as
// fully Completed, locking out the remaining stock.
// ---------------------------------------------------------------------------
test('the pool returns DECIMAL as numbers', () => {
  assert.match(read('server/db.js'), /decimalNumbers:\s*true/,
    'without decimalNumbers, quantity comparisons compare strings');
});

// ---------------------------------------------------------------------------
// 7. The session time zone must be pinned.
//
// NOW()/CURDATE() follow the server zone. On a UTC host a 07:00 Manila sale is
// stored as 23:00 the previous day, putting every daily total on the wrong date.
// ---------------------------------------------------------------------------
test('the session time zone is pinned per connection', () => {
  assert.match(read('server/db.js'), /SET time_zone/,
    'without SET time_zone, daily totals shift with the host time zone');
});
