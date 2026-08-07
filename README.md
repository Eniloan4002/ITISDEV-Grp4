# ITISDEV-Grp4 - AM Restaurant RMIS

Restaurant Management Information System for AM Restaurant (ITISDEV S12, Group 4).
A public landing page plus a role-gated back office covering identity, inventory
and procurement, point of sale, attendance and manpower, and reservations.

## Tech stack

Deliberately minimal and lightweight:

- **Runtime:** Node.js 22+ (developed on Node 24).
- **Server:** a single vanilla `http` server (`server/index.js`), with per-module
  routers chained off it. No Express.
- **Persistence:** MySQL (AMDB schema under `SQL/`) via `mysql2` (`server/db.js`).
- **Passwords:** built-in `crypto` scrypt hashing (`server/password.js`).
- **Sessions:** in-memory cookie sessions (restart forces re-login; user data persists).
- **Frontend:** static HTML/CSS/JS in `public/`. No build step, no framework.

## Run

**1. Create the database.** Run these against your MySQL server, in order —
the first creates `AMDB` itself:

| # | File | Contents |
|---|------|----------|
| 1 | `SQL/AMDB creation script.sql` | 31 tables (required) |
| 2 | `SQL/AMDB starter data.sql`    | roles, permissions, ingredient types (required) |
| 3 | `SQL/AMDB accounts.sql`        | sample staff accounts |
| 4 | `SQL/AMDB ingredients.sql`     | sample ingredients + stock levels |
| 5 | `SQL/AMDB tables data.sql`     | dining tables |
| 6 | `SQL/AMDB views.sql`           | 7 reporting views |
| 7 | `SQL/AMDB menu data.sql`       | menu categories + items — **see the warning in that file** |

All are safe to re-run (`INSERT IGNORE` / `CREATE TABLE IF NOT EXISTS`).

**2. Configure.** Copy `.env.example` to `.env` and edit for your server.
`.env` is gitignored, so every developer makes their own:

```bash
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=AMDB
DB_TIMEZONE=+08:00   # pins NOW()/CURDATE(); see .env.example
```

**3. Start.**

```bash
npm install
npm start        # -> http://localhost:3000
npm run dev      # same, with --watch auto-restart
```

## Signing in

`server/index.js` re-seeds a **default admin** on every boot, so this account
always works:

| Email | Password | Role |
|-------|----------|------|
| `admin@amrestaurant.local` | `admin1234` | Admin |

`SQL/AMDB accounts.sql` also seeds `manager@`, `cashier@` and `staff@`, but with
scrypt hashes whose plaintext is **not recorded anywhere in this repo** — so after
a fresh database load you cannot sign in as those three. To give all four a known
password:

```bash
npm run seed:demo-passwords              # sets all four to admin1234
npm run seed:demo-passwords -- s3cretpw  # or your own (min 8 chars)
```

| Email | Role |
|-------|------|
| `admin@amrestaurant.local` | Admin |
| `manager@amrestaurant.local` | Manager |
| `cashier@amrestaurant.local` | Cashier |
| `staff@amrestaurant.local` | Staff |

Development convenience only — it overwrites whatever passwords those accounts
have. Change the admin password after first login on anything that matters.

## Features & endpoints

Page URLs are clean (no `.html`); files live in `public/pages/` and the server
resolves `/login` → `public/pages/login.html`, etc. Roles are enforced
**server-side** in `PROTECTED_PAGES` (`server/index.js`) — the nav only hides
links, it is not the gate.

### Identity & access

| Story | Feature | Page | API |
|-------|---------|------|-----|
| SI-6  | Registration (Create User) | `/register` (Admin) | `POST /api/register` |
| SI-7  | Login / sessions | `/login`, `/dashboard` | `POST /api/login`, `POST /api/logout`, `GET /api/me` |
| SI-8  | Password reset | `/forgot-password`, `/reset-password` | `POST /api/password-reset/request`, `POST /api/password-reset/confirm` |
| SI-9  | Profile management | `/profile` | `GET`/`POST /api/profile` |
| SI-10 | Roles & permissions | `/admin-settings` (Admin), `/403` | `GET/PATCH/DELETE /api/admin/users` |

### Inventory & procurement

| Feature | Page | Roles | API |
|---------|------|-------|-----|
| Ingredient inventory | `/inventory` | Admin, Manager, Staff | `GET/POST /api/inventory`, `/api/ingredients` |
| Stock alerts | `/stock-alerts` | Admin, Manager, Staff | `GET /api/alerts` |
| Stock adjustment | `/stock-adjustment` | Admin, Manager | `POST /api/ingredients/:id/adjustments` |
| Purchase orders | `/purchase-orders` | Admin, Manager | `GET/POST /api/purchase-orders`, `POST /api/purchase-orders/:id/receive` |
| Suppliers | `/supplier` | Admin, Manager | `GET/POST /api/suppliers` |

### Sales & billing

| Feature | Page | Roles | API |
|---------|------|-------|-----|
| POS bills, VAT, payments | `/sales` | Admin, Manager, Cashier | `GET/POST /api/sales`, `POST /api/sales/:id/settle`, `POST /api/sales/:id/void`, `GET /api/sales/menu` |

Bills follow **Open → Paid → Void**. AMDB's `transaction_status` has no "Open"
state, so it is derived from the `payments` table: voided → Void, a payment row
present → Paid, otherwise → Open.

### Attendance & manpower

| Feature | Page | Roles | API |
|---------|------|-------|-----|
| Time clock | `/attendance` | all | `GET /api/attendance`, `POST /api/attendance/time-in`, `POST /api/attendance/time-out` |
| Shift schedules | `/schedules` | all | `GET/POST/PATCH/DELETE /api/shifts` |
| Leave requests | `/leave-requests` | all | `GET/POST /api/leave`, `PATCH /api/leave/:id` |

### Reservations & reporting

| Feature | Page | Roles | API |
|---------|------|-------|-----|
| Table reservations | `/reservations` | Admin, Manager, Staff | `GET /api/tables`, `POST /api/reservations` |
| Table availability | `/table-availability` | Admin, Manager, Staff | `GET /api/tables` |
| Dashboard KPIs | `/dashboard` | all | `GET /api/dashboard/summary` |
| Sales history | `/sales-history` | Admin, Manager, Cashier | `GET /api/sales-history`, `GET /api/sales-history/:id` |
| Refunds | `/refunds` | Admin, Manager, Cashier | `GET/POST /api/refunds`, `POST /api/refunds/:id/{approve,reject}` |
| Sales dashboard | `/sales-dashboard` | Admin, Manager | `GET /api/sales-dashboard` |
| Inventory reports | `/inventory-report` | Admin, Manager | `GET /api/inventory-report`, `POST /api/inventory-report/:id/count` |

## What each role sees

Roles are **Admin, Manager, Cashier, Staff**. The home screen groups module tiles
by umbrella category and draws only what the signed-in role may open; a category
with nothing visible is omitted rather than shown empty. The tile list is shaped
by `public/js/rmis-modules.js`, but `PROTECTED_PAGES` in `server/index.js` is the
real gate — typing a URL you lack the role for returns 403 regardless.

### Admin — 19 tiles, all six categories

| Category | Modules |
|----------|---------|
| Inventory & Procurement | Ingredient Inventory, Stock Alerts, Stock Adjustment, Purchase Orders, Supplier & Commissary, Inventory Reports |
| Sales & Billing | Sales & Billing, Sales History, Refunds, Sales Dashboard |
| Attendance & Manpower | Attendance, Shift Schedules, Leave Requests |
| Reservations & Tables | Reservations & Tables, Table Availability |
| Reporting & Audit | Employee Performance, **Audit Logs** |
| Administration | Create User Account, Admin Settings |

### Manager — 16 tiles, five categories

Everything the Admin sees **except Audit Logs** (Admin-only) and the whole
**Administration** section.

### Cashier — 6 tiles, two categories

| Category | Modules |
|----------|---------|
| Sales & Billing | Sales & Billing, Sales History, Refunds |
| Attendance & Manpower | Attendance, Shift Schedules, Leave Requests |

Cashiers may raise a refund request but cannot approve one, and cannot reach the
Sales Dashboard or Inventory Reports.

### Staff — 7 tiles, three categories

| Category | Modules |
|----------|---------|
| Inventory & Procurement | Ingredient Inventory, Stock Alerts |
| Attendance & Manpower | Attendance, Shift Schedules, Leave Requests |
| Reservations & Tables | Reservations & Tables, Table Availability |

Staff can view stock and alerts but not adjust stock, raise purchase orders, use
the POS, or see any reporting screen.

## Known scope limits

- Password reset has no email provider — the reset link is printed to the server
  console **and** shown on-screen after a request (by design, for the MVP).
- Login is throttled: five failed attempts per email and address inside a
  15-minute window trigger a 15-minute lock (SI-7). Note that
  `docs/sprint1-mvp-plan.md` originally descoped this from the MVP.
- A partially received purchase order displays as **Sent**. AMDB's `order_status`
  enum has no partial state.
- **`SQL/AMDB menu data.sql` contains placeholder prices.** No price list exists in
  this repo, so every sales total, VAT figure and dashboard KPI derives from invented
  numbers. Replace them before using any figure as output. Note that
  `docs/superpowers/specs/2026-07-24-sprint3-sprint5-backlogs-design.md` requires
  reading the real menu from the production database instead of seeding one.
- **Approved refunds restore no stock yet.** Restoration reads
  `menu_item_ingredients`, which is empty, so an approved refund reports zero
  ingredient movements. The code is correct and starts working once recipes
  exist; checkout deliberately does not deplete stock either, for the same reason.

## Deploying against a shared/VM database

The runtime account needs only DML:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON AMDB.* TO 'amdb_app'@'%';
```

The `SQL/` scripts are a one-time setup task and need elevated rights
(`CREATE DATABASE`, `CREATE TABLE`, `CREATE VIEW`, `REFERENCES`, `DROP`). Run them
as an admin account, not the app user. Views are declared `SQL SECURITY INVOKER`
so they are not bound to the account that created them. See `.env.example` for
the full notes.

## Layout

```
server/
  index.js      # http server: static files, auth, sessions, RBAC gate, route chaining
  db.js         # MySQL (AMDB) query helpers via mysql2
  password.js   # scrypt hash + verify
  rmis.js       # inventory, stock alerts/adjustments, purchase orders, suppliers
  sales.js      # POS bills, payments, menu
  attendance.js # time logs, shifts, leave requests
  dashboard.js  # role-aware KPI summary
  admin.js      # user & role management (SI-10)
public/
  index.html    # public landing page (served at /)
  pages/        # all other HTML, served at clean URLs (/login, /sales, ...)
  css/          # landing.css (landing) · styles.css (auth pages) · dashboard.css (app shell)
  js/           # one script per page + rmis-modules.js / rmis-ui.js shared runtime
  images/       # photos + logo
SQL/            # AMDB schema, migration, seed data, and reporting views
scripts/        # set-demo-passwords.js (dev convenience)
tests/          # contract tests — `npm test`, no database required
docs/           # sprint plans and backlog designs
```
