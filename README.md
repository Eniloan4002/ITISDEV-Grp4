# ITISDEV-Grp4 — AM Restaurant RMIS

Restaurant Management Information System for AM Restaurant (ITISDEV S12, Group 4).
This repo holds the **Sprint 1 MVP**: the public landing page plus the full
identity / user-management slice.

## Tech stack

Deliberately minimal and **zero-dependency** — no `npm install` needed:

- **Runtime:** Node.js 22+ (developed on Node 24).
- **Server:** a single vanilla `http` server (`server/index.js`). No Express.
- **Persistence:** Node's built-in `node:sqlite` (`server/db.js`), file DB at `data/rmis.db`.
- **Passwords:** built-in `crypto` scrypt hashing (`server/password.js`).
- **Sessions:** in-memory cookie sessions (restart forces re-login; user data persists).
- **Frontend:** static HTML/CSS/JS in `public/` (one shared stylesheet).

## Run

```bash
npm start        # node server/index.js  -> http://localhost:3000
npm run dev      # node --watch server/index.js (auto-restart)
```

On first boot a **default admin** is seeded so role-based access can be demoed:

```
email:    admin@amrestaurant.local
password: admin1234        (change after first login)
```

The SQLite file `data/rmis.db` is git-ignored; delete it to reset all data.

## Sprint 1 features & endpoints

| Story | Feature | Pages | API |
|-------|---------|-------|-----|
| SI-6  | Registration (Create User) | `register.html` (Admin-only) | `POST /api/register` |
| SI-7  | Login / sessions | `login.html`, `dashboard.html` | `POST /api/login`, `POST /api/logout`, `GET /api/me` |
| SI-8  | Password Reset | `forgot-password.html`, `reset-password.html` | `POST /api/password-reset/request`, `POST /api/password-reset/confirm` |
| SI-9  | Profile Management | `profile.html` | `GET /api/profile`, `POST /api/profile` |
| SI-10 | Roles & Permissions (RBAC) | `403.html`, `admin-settings.html` | enforced server-side on protected pages |

Roles: **Admin, Manager, Cashier, Staff**.

### Notes / MVP scope

- Password reset has no real email provider — the reset link is printed to the
  server console **and** shown on-screen after a request (by design, for the MVP).
- The 15-minute account-lockout from the SI-7 acceptance criteria is intentionally
  out of MVP scope.
- The original Jira board (`removelater/`) still marks SI-6…SI-10 as "To Do";
  update it to reflect this delivery.

## Layout

```
server/
  index.js      # http server: routing, handlers, sessions, RBAC gate
  db.js         # node:sqlite schema + query helpers
  password.js   # scrypt hash + verify
public/         # landing page, auth pages, dashboard, profile, css, js, images
data/           # rmis.db (git-ignored) lives here
docs/           # sprint1-mvp-plan.md
```
