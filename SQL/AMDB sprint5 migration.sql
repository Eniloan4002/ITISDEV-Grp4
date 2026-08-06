USE AMDB;

-- ---------------------------------------------------------------------------
-- Migration for SI-15, SI-18, SI-24, SI-25 and SI-26/SI-27.
--
-- Additive only: every column is nullable, so existing rows stay readable and
-- keep whatever their original columns held. Safe to re-run — each ALTER is
-- guarded by an information_schema check, because MySQL before 8.0.29 has no
-- "ADD COLUMN IF NOT EXISTS".
--
-- Run this as an admin account, like the other SQL/ scripts. The application
-- account needs only DML at runtime (see .env.example).
-- ---------------------------------------------------------------------------

DROP PROCEDURE IF EXISTS add_column_if_missing;
DELIMITER //
CREATE PROCEDURE add_column_if_missing(
  IN tbl VARCHAR(64), IN col VARCHAR(64), IN ddl VARCHAR(255))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND COLUMN_NAME = col
  ) THEN
    SET @s = CONCAT('ALTER TABLE `', tbl, '` ADD COLUMN `', col, '` ', ddl);
    PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

-- --- SI-15 Supplier Records ------------------------------------------------
-- `address` stays the physical address; billing is tracked separately.
CALL add_column_if_missing('suppliers', 'billing_address',        'VARCHAR(255) NULL');
CALL add_column_if_missing('suppliers', 'tax_identification_no',  'VARCHAR(50) NULL');

-- --- SI-18 Refund Processing -----------------------------------------------
-- `approved_by` already exists and is populated on approval only. These record
-- the reviewer for BOTH approval and rejection, plus the decision note.
CALL add_column_if_missing('refunds', 'reviewed_by',   'INT NULL');
CALL add_column_if_missing('refunds', 'reviewed_at',   'DATETIME NULL');
CALL add_column_if_missing('refunds', 'review_notes',  'VARCHAR(255) NULL');

-- --- SI-25 Inventory Reports (physical count) ------------------------------
-- A physical count stores both sides explicitly so the archive can show the
-- discrepancy; quantity_change alone cannot reconstruct them.
CALL add_column_if_missing('stock_adjustments', 'system_quantity', 'DECIMAL(10,2) NULL');
CALL add_column_if_missing('stock_adjustments', 'actual_quantity', 'DECIMAL(10,2) NULL');

-- --- SI-26 / SI-27 tables --------------------------------------------------
-- These were created at runtime by server/db.js init(), which needs CREATE
-- privilege the app account is not meant to have. Defined here instead; the
-- runtime fallback remains but will now find them already present.
CREATE TABLE IF NOT EXISTS employee_performance_reports (
  report_id INT PRIMARY KEY AUTO_INCREMENT,
  employee_name VARCHAR(100) NOT NULL,
  role_name VARCHAR(50) NOT NULL,
  reporting_period VARCHAR(50) NOT NULL,
  orders_served INT NOT NULL DEFAULT 0,
  sales_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  punctuality VARCHAR(50) NOT NULL DEFAULT 'N/A',
  notes TEXT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES accounts(account_id)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_log_id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT NOT NULL,
  user_email VARCHAR(100) NULL,
  action_type VARCHAR(100) NOT NULL,
  target_table VARCHAR(100) NOT NULL DEFAULT 'system',
  details TEXT NULL,
  ip_address VARCHAR(45) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES accounts(account_id)
    ON UPDATE CASCADE ON DELETE RESTRICT
);

-- Indexes for the filters SI-17 and SI-24 run server-side.
DROP PROCEDURE IF EXISTS add_index_if_missing;
DELIMITER //
CREATE PROCEDURE add_index_if_missing(
  IN tbl VARCHAR(64), IN idx VARCHAR(64), IN cols VARCHAR(255))
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = tbl AND INDEX_NAME = idx
  ) THEN
    SET @s = CONCAT('CREATE INDEX `', idx, '` ON `', tbl, '` (', cols, ')');
    PREPARE stmt FROM @s; EXECUTE stmt; DEALLOCATE PREPARE stmt;
  END IF;
END //
DELIMITER ;

CALL add_index_if_missing('pos_transactions', 'idx_pos_datetime', 'transaction_datetime');
CALL add_index_if_missing('pos_transactions', 'idx_pos_no',       'transaction_no');
CALL add_index_if_missing('refunds',          'idx_refund_status','refund_status');
CALL add_index_if_missing('stock_alerts',     'idx_alert_open',   'ingredient_id, alert_status');

DROP PROCEDURE IF EXISTS add_column_if_missing;
DROP PROCEDURE IF EXISTS add_index_if_missing;
