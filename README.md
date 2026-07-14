# ITISDEV-Grp4 — AM Restaurant RMIS

Restaurant Management Information System for AM Restaurant (ITISDEV S12, Group 4).
This repo holds the **Sprint 1 MVP**: the public landing page plus the full
identity / user-management slice.

## Tech stack

Deliberately minimal and lightweight:

- **Runtime:** Node.js 22+ (developed on Node 24).
- **Server:** a single vanilla `http` server (`server/index.js`). No Express.
- **Persistence:** MySQL (AMDB schema under `SQL/`) via `mysql2` (`server/db.js`).
- **Passwords:** built-in `crypto` scrypt hashing (`server/password.js`).
- **Sessions:** in-memory cookie sessions (restart forces re-login; user data persists).
- **Frontend:** static HTML/CSS/JS in `public/` (one shared stylesheet).

## Run

```bash
npm install
npm start        # node server/index.js  -> http://localhost:3000
npm run dev      # node --watch server/index.js (auto-restart)
```

Set database environment variables as needed (defaults shown):

1. Copy `.env.example` to `.env`
2. Edit values for your SQL server

```bash
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=AMDB
```

On first boot a **default admin** is seeded so role-based access can be demoed:

```
email:    admin@amrestaurant.local
password: admin1234        (change after first login)
```

Make sure the AMDB schema is created first by running:

1. `SQL/AMDB creation script.sql`
2. `SQL/AMDB starter data.sql`
3. `SQL/AMDB views.sql` (optional, for report views)

## Sprint 1 features & endpoints

Page URLs are clean (no `.html`); the files live in `public/pages/` and the
server resolves `/login` → `public/pages/login.html`, etc.

| Story | Feature | Page URLs | API |
|-------|---------|-----------|-----|
| SI-6  | Registration (Create User) | `/register` (Admin-only) | `POST /api/register` |
| SI-7  | Login / sessions | `/login`, `/dashboard` | `POST /api/login`, `POST /api/logout`, `GET /api/me` |
| SI-8  | Password Reset | `/forgot-password`, `/reset-password` | `POST /api/password-reset/request`, `POST /api/password-reset/confirm` |
| SI-9  | Profile Management | `/profile` | `GET /api/profile`, `POST /api/profile` |
| SI-10 | Roles & Permissions (RBAC) | `/403`, `/admin-settings` | enforced server-side on protected pages |
| S2    | Ingredient Inventory | `/inventory` | `GET /api/inventory` |

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
  db.js         # MySQL (AMDB) query helpers via mysql2
  password.js   # scrypt hash + verify
public/
  index.html    # public landing page (served at /)
  pages/        # all other HTML, served at clean URLs (/login, /register, ...)
  css/          # styles.css (shared app pages) + landing.css (landing page)
  js/           # one script per page
  images/       # photos + logo
docs/           # sprint1-mvp-plan.md
```
