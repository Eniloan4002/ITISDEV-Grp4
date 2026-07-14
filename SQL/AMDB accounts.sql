USE AMDB;

-- ---------------------------------------------------------
-- Login seed script for AM Restaurant RMIS
-- Creates 4 login accounts and maps them to roles.
--
-- IMPORTANT:
-- password_hash must be in the app format: "salt:hash" from Node scrypt.
-- Replace the 4 values below before running.
-- ---------------------------------------------------------

-- 1) Ensure roles exist
INSERT IGNORE INTO roles (role_name, role_description) VALUES
('Admin', 'Full access to all system modules'),
('Manager', 'Manages restaurant operations'),
('Cashier', 'Handles POS transactions and payments'),
('Staff', 'Standard staff access');

-- 2) Put your scrypt hashes here (salt:hash)
SET @admin_hash   = 'cb2fee87546eda95ca2de1fd3d490fdc:b4d3df8b276a7faa97228ed2b0b6506142de6d512f51cd2ab3ab8a95478b6aa8d83530005d749dfcff282a4e9c43e2bf7a5e37c9c8133236ad065c457309314e';
SET @manager_hash = 'ad2a6b250fbb06c7a064437b39508c38:8a0c1932982b248b7337d4d66929f9401325605d25c174024c97a0e14ae58332bab3bfe290957d1a151a3ec4e941eace57f50a56a4cd706680ecde1a59087413';
SET @cashier_hash = '1429bb5d07af257538aee4d53336fab5:cbf6076453d80ad84aff99eacfca6561e38a422501cc05901c16d7b4011eb7fa727e6e28bbc1cdc5863b90df112e03a516f242c1ab7b52406b1cd2297a02da04';
SET @staff_hash   = '47a91ac873e27748229396d794d75e40:5a8c55516de137a029a7791dd04d06efbd00e6b4d2ba78a00d2578407514b16205920056707e7954ce4fc462bd2d385f9670ab7f5f46cf976e692b38c5678dfa';

-- 3) Upsert accounts
INSERT INTO accounts
(username, email, password_hash, first_name, last_name, phone_number, is_active)
VALUES
('admin',   'admin@amrestaurant.local',   @admin_hash,   'Default', 'Admin',   '', TRUE),
('manager', 'manager@amrestaurant.local', @manager_hash, 'Store',   'Manager', '', TRUE),
('cashier', 'cashier@amrestaurant.local', @cashier_hash, 'Main',    'Cashier', '', TRUE),
('staff',   'staff@amrestaurant.local',   @staff_hash,   'Kitchen', 'Staff',   '', TRUE)
ON DUPLICATE KEY UPDATE
password_hash = VALUES(password_hash),
first_name    = VALUES(first_name),
last_name     = VALUES(last_name),
phone_number  = VALUES(phone_number),
is_active     = TRUE,
updated_at    = CURRENT_TIMESTAMP;

-- 4) Map each account to exactly one role (idempotent)
INSERT IGNORE INTO account_roles (account_id, role_id)
SELECT a.account_id, r.role_id
FROM accounts a
JOIN roles r ON r.role_name = 'Admin'
WHERE a.email = 'admin@amrestaurant.local';

INSERT IGNORE INTO account_roles (account_id, role_id)
SELECT a.account_id, r.role_id
FROM accounts a
JOIN roles r ON r.role_name = 'Manager'
WHERE a.email = 'manager@amrestaurant.local';

INSERT IGNORE INTO account_roles (account_id, role_id)
SELECT a.account_id, r.role_id
FROM accounts a
JOIN roles r ON r.role_name = 'Cashier'
WHERE a.email = 'cashier@amrestaurant.local';

INSERT IGNORE INTO account_roles (account_id, role_id)
SELECT a.account_id, r.role_id
FROM accounts a
JOIN roles r ON r.role_name = 'Staff'
WHERE a.email = 'staff@amrestaurant.local';

-- 5) Verify
SELECT
  a.account_id,
  a.email,
  CONCAT(a.first_name, ' ', a.last_name) AS full_name,
  r.role_name
FROM accounts a
LEFT JOIN account_roles ar ON ar.account_id = a.account_id
LEFT JOIN roles r ON r.role_id = ar.role_id
WHERE a.email IN (
  'admin@amrestaurant.local',
  'manager@amrestaurant.local',
  'cashier@amrestaurant.local',
  'staff@amrestaurant.local'
)
ORDER BY a.email;