USE AMDB;

-- -------------------------
-- Starter seed data
-- -------------------------

INSERT IGNORE INTO roles (role_name, role_description) VALUES
('Admin', 'Full access to all system modules'),
('Manager', 'Manages restaurant operations, inventory, reports, shifts, and approvals'),
('Cashier', 'Handles POS transactions, payments, and basic sales history'),
('Staff', 'Uses attendance, assigned shifts, leave requests, and table operations');

INSERT IGNORE INTO permissions (permission_code, permission_description) VALUES
('MANAGE_USERS', 'Create and manage user accounts'),
('MANAGE_INVENTORY', 'Manage ingredients, stock adjustments, stock alerts, and purchase orders'),
('MANAGE_SUPPLIERS', 'Create and update supplier records'),
('USE_POS', 'Create POS transactions and payments'),
('PROCESS_REFUNDS', 'Process and approve refunds'),
('VIEW_REPORTS', 'View sales history and ERP dashboard reports'),
('MANAGE_SHIFTS', 'Create and update staff shift schedules'),
('MANAGE_ATTENDANCE', 'Track staff attendance'),
('MANAGE_LEAVES', 'Review and approve leave requests'),
('MANAGE_TABLES', 'Manage table reservations and availability');

INSERT IGNORE INTO ingredient_type (ingredient_type_name) VALUES
('Meat'),
('Seafood'),
('Vegetable'),
('Fruit'),
('Dairy'),
('Dry Goods'),
('Condiment'),
('Beverage'),
('Packaging'),
('Other');