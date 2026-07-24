# Sprint 3 and Sprint 5 Backlogs Design

## Objective

Implement the four Sprint 3 work items and the two remaining `To Do` work
items in Sprint 5 as complete, role-protected modules in the AM Restaurant
RMIS:

- SI-15 Supplier Records
- SI-16 POS Transactions
- SI-17 Sales History
- SI-18 Refund Processing
- SI-24 Sales Dashboard
- SI-25 Inventory Reports

SI-26 Employee Performance Reports and SI-27 Audit Logs are not part of this
scope because Jira currently marks them `In Progress`.

## Project Constraints

- Preserve the existing vanilla Node.js HTTP server, static HTML/CSS/JavaScript
  frontend, MySQL persistence, cookie sessions, and role model.
- Do not migrate the application to Express or another framework.
- Do not create demonstration menu items or recipe mappings. The application
  must read the restaurant's existing menu and recipe records from the
  Proxmox-hosted MySQL database configured through environment variables.
- Do not overwrite existing menu, recipe, ingredient, supplier, transaction,
  or inventory records during startup.
- A POS checkout uses exactly one payment method: `Cash`, `Card`, `GCash`,
  `Maya`, or `Other`.
- Cashiers submit refunds for approval. Managers and Admins approve or reject
  them.
- Existing Sprint 1 through Sprint 4 behavior must remain compatible.

## Architecture

The new functionality will be a modular extension of the current server.
`server/index.js` remains the HTTP entry point and owns shared concerns such
as sessions, JSON responses, static serving, and page access. It delegates new
API paths to focused feature handlers.

Feature handlers will be grouped by business capability:

- suppliers
- POS and sales history
- refunds
- sales reporting
- inventory reporting

Database operations will live in focused data-access modules instead of making
the existing `server/db.js` substantially larger. Each data-access function
accepts the existing MySQL pool or a transaction connection. This supports
atomic database work and test injection without changing the production
connection model.

New pages will follow the existing clean URL and static asset structure:

- `/suppliers`
- `/pos`
- `/sales-history`
- `/refunds`
- `/sales-dashboard`
- `/inventory-reports`

The existing dashboard will expose only the links allowed for the authenticated
role. Server-side page and API authorization remains authoritative.

## Role Access

| Capability | Admin | Manager | Cashier | Staff |
|---|---:|---:|---:|---:|
| Supplier list/create/update | Yes | Yes | No | No |
| POS checkout | Yes | No | Yes | No |
| Sales history | Yes | Yes | Yes | No |
| Submit refund request | Yes | Yes | Yes | No |
| Approve/reject refunds | Yes | Yes | No | No |
| Sales dashboard | Yes | Yes | No | No |
| Inventory reports and physical counts | Yes | Yes | No | No |

Authorization is enforced for both pages and APIs. A user who knows an API URL
but lacks the required role receives `403`.

## SI-15 Supplier Records

The supplier page lists active suppliers and supports search by company name,
contact person, email, phone number, TIN/business ID, and address. Managers and
Admins can create a supplier or open an existing supplier for editing.

Required fields:

- company name
- primary contact person
- email
- phone number
- physical address
- billing address
- TIN/business ID

The server trims all text values, validates email format, and validates that
company name is unique case-insensitively. Updates may retain the current
company name but cannot conflict with another supplier. Validation failures
identify the affected field. Database uniqueness conflicts are converted to a
clear `409` response.

The existing `suppliers` table will gain nullable columns for
`billing_address` and `tax_identification_no`. Existing `address` remains the
physical address. Migration checks add missing columns without changing
existing rows. New records created through this module require all listed
fields even though migrated legacy rows may contain null values.

## SI-16 POS Transactions

The POS page loads available menu items and their categories from the live
database. If the menu is empty, the page shows a configuration message and
does not generate fallback data. If menu items lack recipe mappings, checkout
identifies those items and rejects the transaction because inventory cannot be
updated safely.

The cashier can:

- search or filter menu items
- add an item to the cart
- change quantities or remove items
- optionally associate basic customer information
- select exactly one payment method
- enter a payment reference for non-cash methods
- review calculated totals
- complete checkout

The browser displays estimates, but the server reloads menu prices and recipe
requirements and calculates all monetary values. Client-supplied prices,
totals, cashier IDs, and inventory values are ignored.

Menu `selling_price` is treated as the final selling price for this sprint.
Because Jira and the current database do not define a discount or tax rule,
`discount_amount` and `tax_amount` are recorded as zero and total equals
subtotal. Cash payments require an amount tendered greater than or equal to the
total and return change. Card, GCash, Maya, and Other payments record the exact
transaction total and require a payment reference.

Checkout runs in one MySQL transaction:

1. Validate the authenticated role and request shape.
2. Load and lock all selected menu items and their recipe mappings.
3. Aggregate required ingredient quantities across the cart.
4. Lock the corresponding inventory rows.
5. Reject unavailable menu items, missing recipes, invalid quantities, or
   insufficient inventory.
6. Generate a unique transaction number.
7. Insert the POS transaction and line items.
8. Insert one payment row using the selected method.
9. Snapshot per-unit ingredient consumption for every transaction line.
10. Deduct ingredient inventory.
11. Insert `POS Usage` stock movement rows that reference the transaction.
12. Create or resolve stock alerts based on the resulting quantities.
13. Commit and return a receipt payload.

Any failure rolls back every insert and stock change. The receipt contains the
transaction number, date/time, cashier, line items, subtotal, discount, tax,
total, payment method, payment reference when applicable, and cash change when
applicable. Printing uses the browser's print flow and does not require a
printer integration.

An additive `pos_transaction_ingredient_usage` table stores each transaction
item's ingredient ID and per-unit quantity consumed at checkout. Refunds use
this immutable snapshot rather than the current recipe, so later recipe edits
cannot restore the wrong quantities.

## SI-17 Sales History

Sales history is available to Cashiers, Managers, and Admins. The initial view
shows recent transactions and supports:

- exact or partial transaction-number search
- start and end dates
- cashier
- payment method
- transaction status

Every row displays transaction number, date and time, cashier name, total
amount, payment method, and transaction status. Opening a row loads the
transaction items, quantities, prices, totals, payment details, and existing
refund information.

Cashiers may view sales history but cannot approve refunds or access management
reports. Filtering is performed server-side using parameterized queries.

## SI-18 Refund Processing

A Cashier, Manager, or Admin can search for an eligible original transaction.
The result shows purchased items, original quantities, unit prices, payment
method, transaction date, prior refunded quantities, and remaining refundable
quantities.

The requester selects one or more items, enters refund quantities, and provides
a required reason. Refund quantities cannot exceed the remaining refundable
quantity. The default refund method matches the original payment method.

Cashier submissions create a `Pending` refund request. Manager and Admin
submissions also enter the same auditable workflow; an authorized Manager or
Admin must perform the explicit approval action. The approver cannot approve a
request that is already approved, rejected, or completed.

Approval runs in one MySQL transaction:

1. Lock the refund request, original transaction, original line items, and
   relevant inventory rows.
2. Recalculate remaining refundable quantities using completed refunds.
3. Reject stale or excessive quantities.
4. Mark the refund approved and record the approver.
5. Restore ingredients using the checkout-time ingredient-usage snapshot.
6. Add stock movements referencing the refund.
7. Create or resolve stock alerts based on the resulting quantities.
8. Mark the refund completed.
9. Set the original transaction to `Refunded` when all units are refunded, or
   `Partially Refunded` otherwise.
10. Commit.

Rejection records the reviewer and changes the request status to `Rejected`
without changing sales or inventory. Refund requests and decisions remain
visible in transaction details.

The `refunds` table will gain nullable `reviewed_by`, `reviewed_at`, and
`review_notes` columns. Both approval and rejection populate the reviewer and
review timestamp. Approval also populates the existing `approved_by` column.

## SI-24 Sales Dashboard

The dashboard is restricted to Managers and Admins. It uses completed and
partially refunded POS transactions and completed refunds to present:

- gross revenue before refunds
- net sales after completed refunds
- transaction count
- average order value
- top-selling menu items by quantity and revenue
- sales grouped by hour to identify peak sales hours

Available periods are current day, current week, current month, and a custom
inclusive date range. All cards and charts use the same normalized start and
end timestamps supplied by the server. Changing the period refreshes the
complete dashboard rather than mixing periods.

The dashboard uses simple HTML/CSS visualization components and does not add a
charting dependency unless the implementation proves that the existing stack
cannot present the required comparison clearly.

## SI-25 Inventory Reports

The report is restricted to Managers and Admins. It lists each active
ingredient with category, unit, current quantity, reorder threshold, maximum
stock level, supplier, expiry date, and stock status.

An item at or below its reorder level is highlighted in red and labeled
`Low Stock`; an item at zero is labeled `Out of Stock`. The report supports
search, category, supplier, and stock-status filters.

For a physical count, the user enters:

- actual quantity
- required reason or audit note

The server locks the inventory row, records the system quantity, calculates the
difference, updates live stock, inserts a `stock_adjustments` record, and
inserts a `Manual Adjustment` stock movement in one transaction. The response
contains the previous quantity, actual quantity, and discrepancy.

The report archive shows timestamp, ingredient, expected quantity, actual
quantity, discrepancy, reason, and user. Existing inventory transaction
behavior remains compatible.

The `stock_adjustments` table will gain nullable `system_quantity` and
`actual_quantity` columns so new physical-count audits store both values
explicitly. Existing adjustment rows remain readable and expose only the
information their original columns contain.

Every checkout, approved refund, inventory transaction, and physical-count
adjustment synchronizes `stock_alerts`: it opens or updates an `Out of Stock`
or `Low Stock` alert when a resulting quantity meets the threshold, and
resolves open quantity alerts when stock returns above the reorder level.

## API Shape

The implementation will use these resource-oriented JSON endpoints:

- `GET /api/suppliers`
- `POST /api/suppliers`
- `GET /api/suppliers/:id`
- `PUT /api/suppliers/:id`
- `GET /api/pos/menu`
- `POST /api/pos/checkout`
- `GET /api/sales`
- `GET /api/sales/:id`
- `POST /api/refunds`
- `GET /api/refunds/pending`
- `POST /api/refunds/:id/approve`
- `POST /api/refunds/:id/reject`
- `GET /api/reports/sales`
- `GET /api/reports/inventory`
- `GET /api/reports/inventory/adjustments`
- `POST /api/reports/inventory/:id/physical-count`

All successful mutations return the created or updated identifier plus a
concise message. Validation responses use `400`, authentication uses `401`,
authorization uses `403`, missing records use `404`, stale or conflicting
state uses `409`, and unexpected database failures use `500`.

## Security and Integrity

- SQL uses placeholders for every user-controlled value.
- Authentication and role checks run before data access.
- The server derives the acting account from the session.
- The server calculates prices, totals, refund amounts, and inventory changes.
- Checkout and refund approval use row locks and transactions.
- Duplicate mutation attempts are rejected using current database state.
- Date ranges are parsed and validated on the server.
- User-facing errors do not expose SQL or internal stack details.
- Full operational errors remain in server logs.

## Failure and Empty States

- An empty menu produces a clear message directing deployment operators to
  verify the live menu records.
- Missing recipe mappings prevent affected items from checkout and identify the
  configuration issue.
- Legacy completed transactions created before ingredient-usage snapshots
  exist remain visible in sales history but are not refundable through the new
  inventory-restoring workflow; the UI explains that they require a manual
  adjustment.
- Insufficient stock identifies the affected ingredient or menu item without
  committing a partial sale.
- Empty supplier, transaction, dashboard, or inventory results render useful
  empty states rather than broken tables.
- A database outage returns a stable error response and does not create partial
  records.
- A refund changed by another user returns a conflict and refreshes the request
  state.

## Testing Strategy

The project will adopt Node's built-in test runner through `npm test`, avoiding
an additional test framework.

Development follows red-green-refactor:

1. Add a focused failing test for one behavior.
2. Run it and confirm it fails because the behavior is missing.
3. Add the smallest production change that passes.
4. Run the focused test and then the complete suite.
5. Refactor only while the suite remains green.

Tests cover:

- supplier validation and uniqueness behavior
- cart and monetary calculations
- menu and recipe validation
- checkout transaction commit and rollback
- aggregated ingredient deduction
- sales-history filters and transaction detail
- refund eligibility and remaining quantities
- manager/admin approval and cashier denial
- inventory restoration and transaction status changes
- date-range normalization
- dashboard metric calculations
- low-stock classification
- physical-count discrepancies and audit records
- page and API role authorization
- safe JSON error responses

Database workflow tests use injected fake pool/connection objects so they can
verify query order, locks, commits, and rollbacks without accessing production
data. Pure calculation and validation functions are tested directly. Browser
smoke tests are performed against a configured database when the environment
can reach the restaurant server. If it cannot, the handoff includes exact
deployment verification steps for the Proxmox environment.

## Deployment Compatibility

The application continues to use `DB_HOST`, `DB_PORT`, `DB_USER`,
`DB_PASSWORD`, and `DB_NAME`. No Proxmox-specific network value or credential
is committed.

Schema changes are additive and idempotent. Operators must back up the
production database before deploying and run the reviewed migration against
the target AMDB database. The application does not automatically seed menu or
recipe data.

The migration contains only:

- `suppliers.billing_address`
- `suppliers.tax_identification_no`
- `refunds.reviewed_by`
- `refunds.reviewed_at`
- `refunds.review_notes`
- `stock_adjustments.system_quantity`
- `stock_adjustments.actual_quantity`
- the new `pos_transaction_ingredient_usage` table and its foreign keys

## Completion Criteria

The work is complete when:

- all six scoped Jira workflows are usable through role-protected pages
- checkout records a sale, one payment, line items, inventory deductions, and
  a printable receipt atomically
- sales history exposes the required transaction information and filters
- refund requests require explicit Manager/Admin approval and approved refunds
  restore stock atomically
- dashboard metrics respond consistently to supported date ranges
- inventory reports highlight low stock and archive physical-count
  discrepancies
- no menu or recipe seed records are added
- existing Sprint 1 through Sprint 4 features remain operational
- the full automated test suite and syntax checks pass
