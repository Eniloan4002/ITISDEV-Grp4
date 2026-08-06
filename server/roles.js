// Canonical role sets — the single place that answers "who may do what".
//
// These lived as nine separate constants across the routers (ALL_ROLES twice,
// MANAGER_ROLES three times, plus SALES_ROLES, INVENTORY_ROLES, AUDIT_ROLES,
// REPORT_ROLES, ROLES). Duplication there is how the dashboard came to offer
// Cashiers a Table Availability link the server refused.
//
// Still to unify (deliberately out of scope here, they need a schema change):
//   - PROTECTED_PAGES / ROLE_PAGES in server/index.js  — page-level gate
//   - MODULES[].roles in public/js/rmis-modules.js      — tile visibility
// Both should eventually derive from the `permissions` / `role_permissions`
// tables, which AMDB seeds but no code reads.

const ALL = ['Admin', 'Manager', 'Cashier', 'Staff'];

module.exports = {
  // every valid role, and the set any signed-in employee belongs to
  ALL,
  ALL_ROLES: ALL,

  // management actions: approvals, adjustments, voids, purchase orders
  MANAGER: ['Admin', 'Manager'],

  // module-specific sets
  INVENTORY: ['Admin', 'Manager', 'Staff'],   // view stock, receive/consume
  SALES: ['Admin', 'Manager', 'Cashier'],     // create / settle / view bills
  REPORTS: ['Admin', 'Manager'],              // employee performance reports
  AUDIT: ['Admin'],                           // audit trail is admin-only
  ADMIN: ['Admin'],                           // user & role management
};
