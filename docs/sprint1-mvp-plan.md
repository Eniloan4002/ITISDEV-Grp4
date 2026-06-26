# Sprint 1 MVP Completion Plan — AM Restaurant RMIS (ITISDEV Grp4)

**Goal:** Finish every Sprint 1 Jira module at its **barest but functional and working** state (MVP, not polished).
**Sprint 1 scope:** SI-6 Registration · SI-7 Login · SI-8 Password Reset · SI-9 Profile Management · SI-10 Role & Permissions.

**Decisions locked for this plan (chosen by the user):**
1. **Persistence:** real file DB via Node's built-in `node:sqlite` (no `npm install`). Replaces the volatile in-memory `accounts` array.
2. **Password reset delivery:** generate a real token; print the reset URL to the server console **and** show it on-page after request (no mail provider needed).
3. **Security depth:** hash passwords (built-in `scrypt`), enforce role-based access with a 403 page. **Skip** the 15-min lockout timer.

**Stack reality (verified, do not assume otherwise):** single-file vanilla Node `http` server at `server/index.js` (155 lines), **zero dependencies**, CommonJS (`require`/`module.exports`), flat `public/` frontend with one shared stylesheet `public/css/styles.css`. There is **no Express, no ORM, no controllers/routes/services folders, no config.js**. Plan adds a tiny `server/db.js` and keeps everything else in `index.js` to preserve the minimal architecture.

---

## Phase 0 — Documentation Discovery (READ FIRST, do not skip)

### 0.1 Source-of-truth acceptance criteria (Jira screenshots)
The only authoritative scope lives in `removelater/` (preserve these — folder name implies temporary):
- `removelater/jira1.png` — Sprint 1 board: SI-6…SI-10, all marked TO DO, 29 pts.
- `removelater/jira1.1.png` — **SI-6 Registration** AC.
- `removelater/jira1.2.png` — **SI-7 Login** AC.
- `removelater/jira1.3.png` — **SI-8 Password Reset** AC.
- `removelater/jira1.4.png` — **SI-9 Profile Management** AC.
- `removelater/jira1.5.png` — **SI-10 Role & Permissions** AC.

**AC summary (verbatim intent, condensed):**
- **SI-6:** Admin creates account with unique email + full name + temp password + role → save + welcome email. Reject duplicate/invalid email with a clear message.
- **SI-7:** Staff logs in with correct email+password → authenticate, redirect to role dashboard. Wrong creds → generic "Invalid email or password". (Lockout = out of MVP scope by decision.)
- **SI-8:** "Forgot Password" → submit email → time-sensitive reset link (1h expiry) if email exists. Valid link → set new password (≥8 chars, alphanumeric) → invalidate link → login works.
- **SI-9:** Logged-in staff views "My Profile", edits display name + contact number → validate, save, success message. Role and identifiers are **read-only**.
- **SI-10:** Admin assigns role from {Admin, Manager, Cashier, Staff} → permission set mapped. Restricted role hitting an unauthorized page (via URL or UI) → block, hide nav, show **403 Unauthorized**.

### 0.2 Allowed APIs (verified, cite these — do NOT invent others)

**`node:sqlite` (built into Node 22+/24, no install):**
```js
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync('/abs/path/to/data/rmis.db');
db.exec(`CREATE TABLE IF NOT EXISTS ... `);          // run raw SQL
const stmt = db.prepare('INSERT INTO users (a,b) VALUES (?, ?)');
const info = stmt.run(valA, valB);                    // info.lastInsertRowid (BigInt — wrap Number())
const row  = db.prepare('SELECT * FROM users WHERE email = ?').get(email);  // one row or undefined
const rows = db.prepare('SELECT * FROM users').all();                       // array
```
- Use **positional `?` params** (named params were the source of a past breakage — avoid).
- `lastInsertRowid` is a **BigInt** — wrap with `Number(...)` before using.

**`node:crypto` password hashing (scrypt, built-in):**
```js
const crypto = require('crypto');
// hash:
const salt = crypto.randomBytes(16).toString('hex');
const hash = crypto.scryptSync(password, salt, 64).toString('hex');
const stored = `${salt}:${hash}`;               // store this one string
// verify:
const [salt, key] = stored.split(':');
const calc = crypto.scryptSync(attempt, salt, 64).toString('hex');
const ok = crypto.timingSafeEqual(Buffer.from(key, 'hex'), Buffer.from(calc, 'hex'));
```

**Reset / session tokens:** `crypto.randomBytes(32).toString('hex')`.

**Cookies (no library):** set via `res.setHeader('Set-Cookie', 'sid=<token>; HttpOnly; Path=/; Max-Age=86400')`; read by parsing `req.headers.cookie` (`'sid=abc; foo=bar'.split('; ')`).

### 0.3 Exact code patterns to COPY (from current `server/index.js`)
- **Add a route:** insert an `if (req.method === ... && req.url === ...)` before the static fallback at `server/index.js:141-150`.
- **Request handler shape:** copy `handleRegister` body-buffering pattern at `server/index.js:52-94` (`req.on('data')` / `req.on('end')` / `JSON.parse` in try-catch).
- **JSON reply helper:** `sendJson(res, status, body)` at `server/index.js:46-49` — reuse, do not reinvent.
- **Validation shape:** `validate()` returns `{ field: message }` map at `server/index.js:27-44`; frontend keys off this exact shape.
- **Frontend fetch:** copy `public/js/register.js:37-71` (fetch → `res.ok` → `showMessage`/`form.reset()` vs `showFieldErrors(data.errors)`). Helpers `clearErrors`/`showFieldErrors`/`showMessage` live in the same file.
- **HTML form markup:** copy `public/register.html:19-57` field pattern: `.field` > `<label for>` + input + `<span class="field-error" id="error-<name>">`; page-level `#form-message`; `<link rel="stylesheet" href="/css/styles.css">`; trailing `<script src="/js/...">`.
- **Login page already matches this structure** (`public/login.html`) but is unwired (`action="#"`, no script).

### 0.4 Anti-patterns to AVOID
- ❌ Do not add Express, better-sqlite3, bcrypt, or any npm dependency (better-sqlite3 already failed to build here; the project is deliberately zero-dep).
- ❌ Do not use **named** SQLite params — positional `?` only.
- ❌ Do not store plaintext passwords once Phase 2 lands.
- ❌ Do not invent `db.query()`, `db.run()` on the DatabaseSync object — runs go through `prepare(...).run(...)`/`.get(...)`/`.all(...)` or `db.exec(...)` for DDL.
- ❌ Do not build the 15-min lockout, real SMTP, React, or any Sprint 2–4 module (Inventory, Sales, Attendance, etc.).

---

## Phase 1 — Persistence foundation + migrate Registration (SI-6)

**What to implement (copy, don't redesign):**
1. Create `server/db.js`:
   - `const { DatabaseSync } = require('node:sqlite');`
   - Resolve DB path to the existing empty `data/` dir: `path.join(__dirname, '..', 'data', 'rmis.db')`.
   - On load, `db.exec` the schema (idempotent `CREATE TABLE IF NOT EXISTS`):
     ```sql
     CREATE TABLE IF NOT EXISTS users (
       id INTEGER PRIMARY KEY AUTOINCREMENT,
       full_name TEXT NOT NULL,
       email TEXT NOT NULL UNIQUE,
       password_hash TEXT NOT NULL,
       role TEXT NOT NULL,
       contact_number TEXT DEFAULT '',
       created_at TEXT NOT NULL
     );
     CREATE TABLE IF NOT EXISTS password_resets (
       token TEXT PRIMARY KEY,
       user_id INTEGER NOT NULL,
       expires_at INTEGER NOT NULL,
       used INTEGER NOT NULL DEFAULT 0
     );
     ```
   - Export small helpers: `findUserByEmail(email)`, `findUserById(id)`, `createUser({fullName,email,passwordHash,role})`, `updateProfile(id,{fullName,contactNumber})`, `updatePassword(id, passwordHash)`, plus reset helpers `createReset(token,userId,expiresAt)`, `getReset(token)`, `markResetUsed(token)`. Each is a one-line `prepare(...).get/run/all`.
   - `module.exports = { db, findUserByEmail, ... }`.
2. In `server/index.js`: `const dbApi = require('./db');` Replace the in-memory `accounts` array (`:21-22`) and its `.some()`/`.push()` calls (`:72`, `:80-85`) with `dbApi.findUserByEmail(email)` and `dbApi.createUser(...)`. Keep the validate/duplicate/email-stub logic identical otherwise.
3. Add `.gitignore` entry for `data/*.db` (so the DB file isn't committed). Confirm `data/` stays tracked (add `data/.gitkeep` if needed).

**Note:** password still plaintext at end of Phase 1 — Phase 2 fixes it. (Keep change sets small/reviewable.)

**Verification checklist:**
- [ ] `npm start` boots with no error; `data/rmis.db` is created.
- [ ] `curl -s -X POST localhost:3000/api/register -H 'Content-Type: application/json' -d '{"fullName":"Test User","email":"t@a.com","password":"pass1234","role":"Staff"}'` → 201.
- [ ] Same email again → 409 "Email already registered."
- [ ] Restart server, register again with same email → still 409 (proves persistence).
- [ ] `node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('data/rmis.db');console.log(d.prepare('select email,role from users').all())"` shows the row.

**Anti-pattern guards:** positional `?` params only; `Number(lastInsertRowid)`; no npm installs.

---

## Phase 2 — Password hashing (scrypt) for SI-6 + prep for SI-7

**What to implement:**
1. Add a tiny `server/password.js` (or a section in `db.js`) exporting `hashPassword(plain)` and `verifyPassword(plain, stored)` using the **exact scrypt snippet from Phase 0.2**.
2. In `handleRegister`: replace `password: data.password` with `passwordHash: hashPassword(data.password)` before `createUser`.
3. Leave the validation rule (≥8 chars) as-is.

**Verification checklist:**
- [ ] Register a new user; inspect DB: `password_hash` is a `salt:hash` hex string, **not** the plaintext.
- [ ] `verifyPassword('pass1234', stored)` returns `true`; `verifyPassword('wrong', stored)` returns `false`.

**Anti-pattern guards:** no bcrypt/argon npm libs; use built-in `crypto.scryptSync` + `timingSafeEqual`.

---

## Phase 3 — Login + sessions (SI-7)

**What to implement:**
1. **Session store:** module-level `const sessions = new Map();` in `index.js` (in-memory sessions are acceptable MVP — restart just forces re-login; user data persists in SQLite). Shape: `token -> { userId, email, role }`.
2. **`POST /api/login`** handler (copy the body-buffer pattern from `handleRegister`):
   - Validate presence of email+password.
   - `const user = dbApi.findUserByEmail(email)`. If missing **or** `verifyPassword` fails → `sendJson(res, 401, { message: 'Invalid email or password.' })` (generic, per AC).
   - On success: `token = randomBytes(32).hex`; `sessions.set(token, {...})`; `res.setHeader('Set-Cookie', 'sid=<token>; HttpOnly; Path=/; Max-Age=86400')`; reply `200 { redirect: '/dashboard.html', role }`.
3. **`POST /api/logout`**: read `sid` cookie, `sessions.delete(token)`, clear cookie, `200`.
4. **Helper `getSession(req)`**: parse `sid` from `req.headers.cookie`, return `sessions.get(token)` or `null`. (Used by Phases 4–5.)
5. **Wire `public/login.html`:** add field-error spans + `#form-message` to match register markup if missing; create `public/js/login.js` by copying `register.js` and pointing fetch at `/api/login`; on `res.ok` do `window.location = data.redirect`.
6. **Create `public/dashboard.html`:** barest role-aware landing page. On load, fetch `/api/me` (add a `GET /api/me` returning `getSession` data or 401) and render the user's name + role + role-appropriate module links (reuse `modules.html` link list). If 401 → redirect to `/login.html`.

**Verification checklist:**
- [ ] Register a user, then log in via the page → redirected to `/dashboard.html` showing their name/role.
- [ ] Wrong password → "Invalid email or password." and no redirect.
- [ ] `GET /api/me` without cookie → 401.
- [ ] Logout → `/api/me` returns 401 again.

**Anti-pattern guards:** no JWT libs; generic error message only (don't reveal whether email exists); no lockout logic.

---

## Phase 4 — Role & Permissions / RBAC (SI-10)

**What to implement:**
1. **Permission map** (top of `index.js`): `const ROLE_PAGES = { Admin: ['*'], Manager: [...], Cashier: [...], Staff: [...] };` mapping role → allowed page paths/module keys. Keep it tiny — enough to demo block vs allow.
2. **Protected pages:** designate at least the **Create User (registration)** page and one **admin-only** stub as Admin-only. In `serveStatic` (or a pre-check before it), if the requested path is in a protected set, call `getSession(req)`; if no session → redirect to `/login.html`; if session role not allowed → serve **`public/403.html`** with `res.writeHead(403)`.
3. **Create `public/403.html`:** barebones "403 — Unauthorized Access" page (shared stylesheet).
4. **Hide nav elements:** in `dashboard.html`'s render step, only show links the role is allowed (drive from the same `ROLE_PAGES` via `/api/me` role).
5. **Role dropdown source of truth:** ensure `register.html` role `<select>` options are exactly `Admin, Manager, Cashier, Staff` (matches AC + DB).

**Verification checklist:**
- [ ] Log in as `Staff`, hit the Admin-only page URL directly → 403 page (status 403).
- [ ] Log in as `Admin`, same URL → page loads.
- [ ] Dashboard for `Cashier` hides Admin links; `Admin` sees all.
- [ ] No session + protected URL → redirect to login.

**Anti-pattern guards:** RBAC enforced **server-side** (hiding nav alone is not enough — the AC requires blocking direct-URL access); don't trust a client-sent role.

---

## Phase 5 — Profile Management (SI-9)

**What to implement:**
1. **`GET /api/profile`**: require session (`getSession`); return `{ fullName, email, role, contactNumber }` from `findUserById`.
2. **`POST /api/profile`**: require session; accept only `fullName` (display name) + `contactNumber`; validate (non-empty name; contact number basic format/length); `dbApi.updateProfile(session.userId, {...})`; reply `200 { message: 'Profile updated.' }`. **Ignore/reject** any `role` or `email` in the body (read-only per AC).
3. **Create `public/profile.html`** (copy register form markup): editable `fullName` + `contactNumber` inputs; **read-only** (disabled) `email` and `role` fields. `#form-message` for success/errors.
4. **Create `public/js/profile.js`** (copy `register.js`): on load `GET /api/profile` to populate fields; on submit `POST /api/profile`; show success message on `res.ok`.
5. Add a "My Profile" link on `dashboard.html`.

**Verification checklist:**
- [ ] Logged-in user opens `/profile.html` → sees current name/contact, with email+role greyed out/read-only.
- [ ] Change contact number + name, Save → success message; reload page shows new values (persisted).
- [ ] Attempt `POST /api/profile` with `{role:'Admin'}` in body → role unchanged in DB.
- [ ] `/api/profile` without session → 401.

**Anti-pattern guards:** role/email never writable server-side regardless of payload.

---

## Phase 6 — Password Reset (SI-8)

**What to implement (delivery = on-screen + console, per decision):**
1. **`POST /api/password-reset/request`**: accept `email`. Always reply `200` with a generic message (don't reveal existence). If the email **does** exist: `token = randomBytes(32).hex`; `expiresAt = <now+1h>` (pass current time in via `Date.now()` at request handling — server runtime, fine here); `dbApi.createReset(token, user.id, expiresAt)`; build `link = '/reset-password.html?token=' + token`; `console.log('[reset] ' + fullURL)` **and** include `resetLink` in the JSON response so the page can show it.
2. **`POST /api/password-reset/confirm`**: accept `token` + `newPassword`. Look up via `getReset(token)`; reject if missing, `used`, or `expires_at < now` → `400 { message: 'Reset link is invalid or expired.' }`. Validate password (≥8 chars, alphanumeric per AC). On success: `updatePassword(user_id, hashPassword(newPassword))`; `markResetUsed(token)`; reply `200 { message: 'Password updated. You can now log in.' }`.
3. **Frontend:**
   - Create `public/forgot-password.html` + `public/js/forgot-password.js`: email field → POST request → show returned `resetLink` as a clickable link + success text.
   - Create `public/reset-password.html` + `public/js/reset-password.js`: read `token` from `location.search`; new-password field → POST confirm → on success show message + link to `/login.html`.
   - Add a **"Forgot Password?"** link on `login.html` pointing to `/forgot-password.html`.

**Verification checklist:**
- [ ] Request reset for a real email → response + server console both show a reset link with a token.
- [ ] Open the link, set a new password → success; old password no longer logs in, new one does.
- [ ] Reusing the same link → "invalid or expired".
- [ ] Request reset for a non-existent email → still generic 200, no link leaked.
- [ ] (Optional) Manually expire a token in DB → confirm rejected.

**Anti-pattern guards:** no real SMTP; token single-use + time-checked server-side; generic response for unknown emails.

---

## Phase 7 — Final Verification & Cleanup

1. **End-to-end smoke (one pass):** register (Admin) → login → dashboard → create a Staff user → logout → login as Staff → profile edit → forgot/reset password → login with new password → hit Admin URL as Staff → 403.
2. **Anti-pattern grep checks:**
   - [ ] `grep -rn "password: data.password" server/` → no plaintext stores remain.
   - [ ] `grep -rn "accounts" server/` → in-memory array fully removed.
   - [ ] `grep -rni "express\|better-sqlite3\|bcrypt\|jsonwebtoken" server/ package.json` → none (still zero-dep aside from built-ins).
   - [ ] `grep -rn "action=\"#\"" public/` → login form is wired, none remain.
3. **AC re-check:** open each screenshot in `removelater/jira1.1.png`…`jira1.5.png` and tick each scenario against the smoke test above.
4. **Routes inventory:** confirm `index.js` registers `/api/register`, `/api/login`, `/api/logout`, `/api/me`, `/api/profile` (GET+POST), `/api/password-reset/request`, `/api/password-reset/confirm`, plus RBAC-gated static serving.
5. **Run check:** `npm start` clean boot; `npm run dev` (`--watch`) still works.
6. **Docs:** update `README.md` (currently a 2-line placeholder) with how to run + the Sprint 1 feature list and their endpoints. Note Jira board still says "TO DO" — update the board / mark SI-6…SI-10 done out-of-band.

---

## Build order & dependencies
```
Phase 1 (DB) ─► Phase 2 (hash) ─► Phase 3 (login/session) ─► Phase 4 (RBAC) ─┐
                                                    └► Phase 5 (profile) ◄────┤ (needs session)
                                                       Phase 6 (reset) ◄──────┘ (needs hash+DB)
Phase 7 (verify) last.
```
Each phase is self-contained and leaves the app runnable. Suggested commits: one per phase.

## New/changed files at a glance
- **New backend:** `server/db.js`, `server/password.js` (or fold into db.js).
- **Changed backend:** `server/index.js` (routes, sessions, RBAC, handlers).
- **New pages:** `dashboard.html`, `profile.html`, `forgot-password.html`, `reset-password.html`, `403.html`.
- **New JS:** `login.js`, `profile.js`, `forgot-password.js`, `reset-password.js`.
- **Changed:** `login.html` (wire up + forgot link), `register.html` (role options), `.gitignore` (`data/*.db`), `README.md`.
- **Untouched:** `index.html`/`landingPage.html` (landing — done), `styles.css` (reuse), `public/images/`.

## Out of scope (do NOT build now)
15-min account lockout · real email/SMTP · React · MySQL/Supabase · Sprint 2–4 modules (Inventory, Sales/Billing, Attendance, Supplier, Reservations, Analytics).
