CREATE DATABASE IF NOT EXISTS AMDB;
USE AMDB;

-- =========================================================
-- AM Restaurant MIS Database Schema
-- Covers Sprint 1 to Sprint 4 requirements
-- MySQL version
-- =========================================================

-- -------------------------
-- Sprint 1: Accounts / RBAC
-- -------------------------

CREATE TABLE IF NOT EXISTS roles (
    role_id INT PRIMARY KEY AUTO_INCREMENT,
    role_name VARCHAR(30) NOT NULL UNIQUE,
    role_description VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS permissions (
    permission_id INT PRIMARY KEY AUTO_INCREMENT,
    permission_code VARCHAR(80) NOT NULL UNIQUE,
    permission_description VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INT NOT NULL,
    permission_id INT NOT NULL,
    PRIMARY KEY (role_id, permission_id),
    FOREIGN KEY (role_id) REFERENCES roles(role_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (permission_id) REFERENCES permissions(permission_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS accounts (
    account_id INT PRIMARY KEY AUTO_INCREMENT,
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(100) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    phone_number VARCHAR(20),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS account_roles (
    account_id INT NOT NULL,
    role_id INT NOT NULL,
    PRIMARY KEY (account_id, role_id),
    FOREIGN KEY (account_id) REFERENCES accounts(account_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(role_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_id INT PRIMARY KEY AUTO_INCREMENT,
    account_id INT NOT NULL,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at DATETIME NOT NULL,
    used_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(account_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

-- ---------------------------------------------
-- Sprint 2: Ingredient Inventory / ERP Dashboard
-- ---------------------------------------------

CREATE TABLE IF NOT EXISTS ingredient_type (
    ingredient_type_id INT PRIMARY KEY AUTO_INCREMENT,
    ingredient_type_name VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS ingredients (
    ingredient_id INT PRIMARY KEY AUTO_INCREMENT,
    ingredient_name VARCHAR(255) NOT NULL UNIQUE,
    ingredient_type_id INT,
    unit_of_measure VARCHAR(30) NOT NULL DEFAULT 'pcs',
    reorder_level DECIMAL(10,2) NOT NULL DEFAULT 0,
    max_stock_level DECIMAL(10,2),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (ingredient_type_id) REFERENCES ingredient_type(ingredient_type_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS ingredient_inventory (
    ingredient_id INT PRIMARY KEY,
    current_quantity DECIMAL(10,2) NOT NULL DEFAULT 0,
    last_updated DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(ingredient_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS stock_alerts (
    stock_alert_id INT PRIMARY KEY AUTO_INCREMENT,
    ingredient_id INT NOT NULL,
    alert_type ENUM('Low Stock', 'Out of Stock', 'Overstock', 'Expiring Soon') NOT NULL,
    alert_message VARCHAR(255),
    alert_status ENUM('Open', 'Resolved', 'Dismissed') NOT NULL DEFAULT 'Open',
    triggered_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at DATETIME NULL,
    resolved_by INT NULL,
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(ingredient_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (resolved_by) REFERENCES accounts(account_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
    stock_adjustment_id INT PRIMARY KEY AUTO_INCREMENT,
    ingredient_id INT NOT NULL,
    adjusted_by INT NOT NULL,
    adjustment_type ENUM('Stock In', 'Stock Out', 'Waste', 'Correction') NOT NULL,
    quantity_change DECIMAL(10,2) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    adjusted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(ingredient_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (adjusted_by) REFERENCES accounts(account_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS stock_movements (
    stock_movement_id INT PRIMARY KEY AUTO_INCREMENT,
    ingredient_id INT NOT NULL,
    movement_type ENUM('Purchase Received', 'Manual Adjustment', 'POS Usage', 'Waste', 'Return') NOT NULL,
    quantity_change DECIMAL(10,2) NOT NULL,
    reference_table VARCHAR(50),
    reference_id INT,
    created_by INT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes VARCHAR(255),
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(ingredient_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES accounts(account_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS suppliers (
    supplier_id INT PRIMARY KEY AUTO_INCREMENT,
    supplier_name VARCHAR(100) NOT NULL UNIQUE,
    contact_person VARCHAR(100),
    email VARCHAR(100),
    phone_number VARCHAR(20),
    address VARCHAR(255),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS supplier_ingredients (
    supplier_id INT NOT NULL,
    ingredient_id INT NOT NULL,
    supplier_price DECIMAL(10,2),
    PRIMARY KEY (supplier_id, ingredient_id),
    FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(ingredient_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS purchase_orders (
    purchase_order_id INT PRIMARY KEY AUTO_INCREMENT,
    supplier_id INT NOT NULL,
    created_by INT NOT NULL,
    order_date DATE NOT NULL,
    expected_delivery_date DATE,
    received_date DATE,
    order_status ENUM('Draft', 'Pending', 'Received', 'Cancelled') NOT NULL DEFAULT 'Draft',
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    remarks VARCHAR(255),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (supplier_id) REFERENCES suppliers(supplier_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (created_by) REFERENCES accounts(account_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS purchase_order_items (
    purchase_order_item_id INT PRIMARY KEY AUTO_INCREMENT,
    purchase_order_id INT NOT NULL,
    ingredient_id INT NOT NULL,
    quantity_ordered DECIMAL(10,2) NOT NULL,
    quantity_received DECIMAL(10,2) NOT NULL DEFAULT 0,
    unit_cost DECIMAL(10,2) NOT NULL,
    line_total DECIMAL(12,2) NOT NULL DEFAULT 0,
    FOREIGN KEY (purchase_order_id) REFERENCES purchase_orders(purchase_order_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(ingredient_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- ----------------------------------------------
-- Sprint 3: POS Transactions / Sales / Refunds
-- ----------------------------------------------

CREATE TABLE IF NOT EXISTS menu_categories (
    menu_category_id INT PRIMARY KEY AUTO_INCREMENT,
    category_name VARCHAR(80) NOT NULL UNIQUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS menu_items (
    menu_item_id INT PRIMARY KEY AUTO_INCREMENT,
    menu_category_id INT,
    item_name VARCHAR(100) NOT NULL UNIQUE,
    item_description VARCHAR(255),
    selling_price DECIMAL(10,2) NOT NULL,
    is_available BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (menu_category_id) REFERENCES menu_categories(menu_category_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS menu_item_ingredients (
    menu_item_id INT NOT NULL,
    ingredient_id INT NOT NULL,
    quantity_required DECIMAL(10,2) NOT NULL,
    PRIMARY KEY (menu_item_id, ingredient_id),
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(menu_item_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (ingredient_id) REFERENCES ingredients(ingredient_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS customers (
    customer_id INT PRIMARY KEY AUTO_INCREMENT,
    customer_name VARCHAR(100),
    phone_number VARCHAR(20),
    email VARCHAR(100),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pos_transactions (
    transaction_id INT PRIMARY KEY AUTO_INCREMENT,
    transaction_no VARCHAR(40) NOT NULL UNIQUE,
    cashier_id INT NOT NULL,
    customer_id INT NULL,
    transaction_datetime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    subtotal_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    discount_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    tax_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    transaction_status ENUM('Completed', 'Voided', 'Refunded', 'Partially Refunded') NOT NULL DEFAULT 'Completed',
    notes VARCHAR(255),
    FOREIGN KEY (cashier_id) REFERENCES accounts(account_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS pos_transaction_items (
    transaction_item_id INT PRIMARY KEY AUTO_INCREMENT,
    transaction_id INT NOT NULL,
    menu_item_id INT NOT NULL,
    quantity INT NOT NULL,
    unit_price DECIMAL(10,2) NOT NULL,
    line_total DECIMAL(12,2) NOT NULL,
    FOREIGN KEY (transaction_id) REFERENCES pos_transactions(transaction_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (menu_item_id) REFERENCES menu_items(menu_item_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS payments (
    payment_id INT PRIMARY KEY AUTO_INCREMENT,
    transaction_id INT NOT NULL,
    payment_method ENUM('Cash', 'Card', 'GCash', 'Maya', 'Other') NOT NULL,
    amount_paid DECIMAL(12,2) NOT NULL,
    reference_no VARCHAR(100),
    paid_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transaction_id) REFERENCES pos_transactions(transaction_id)
        ON UPDATE CASCADE ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS refunds (
    refund_id INT PRIMARY KEY AUTO_INCREMENT,
    transaction_id INT NOT NULL,
    processed_by INT NOT NULL,
    approved_by INT NULL,
    refund_datetime DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    refund_amount DECIMAL(12,2) NOT NULL,
    refund_method ENUM('Cash', 'Card', 'GCash', 'Maya', 'Other') NOT NULL,
    refund_reason VARCHAR(255) NOT NULL,
    refund_status ENUM('Pending', 'Approved', 'Rejected', 'Completed') NOT NULL DEFAULT 'Pending',
    FOREIGN KEY (transaction_id) REFERENCES pos_transactions(transaction_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (processed_by) REFERENCES accounts(account_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    FOREIGN KEY (approved_by) REFERENCES accounts(account_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS refund_items (
    refund_item_id INT PRIMARY KEY AUTO_INCREMENT,
    refund_id INT NOT NULL,
    transaction_item_id INT NOT NULL,
    quantity_refunded INT NOT NULL,
    refund_line_amount DECIMAL(12,2) NOT NULL,
    FOREIGN KEY (refund_id) REFERENCES refunds(refund_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (transaction_item_id) REFERENCES pos_transaction_items(transaction_item_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

-- -----------------------------------------------------
-- Sprint 4: Attendance / Shifts / Leaves / Reservations
-- -----------------------------------------------------

CREATE TABLE IF NOT EXISTS shifts (
    shift_id INT PRIMARY KEY AUTO_INCREMENT,
    account_id INT NOT NULL,
    shift_start DATETIME NOT NULL,
    shift_end DATETIME NOT NULL,
    shift_status ENUM('Scheduled', 'Completed', 'Cancelled') NOT NULL DEFAULT 'Scheduled',
    created_by INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(account_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES accounts(account_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS attendance_logs (
    attendance_id INT PRIMARY KEY AUTO_INCREMENT,
    account_id INT NOT NULL,
    shift_id INT NULL,
    time_in DATETIME NOT NULL,
    time_out DATETIME NULL,
    attendance_status ENUM('Present', 'Late', 'Absent', 'On Leave') NOT NULL DEFAULT 'Present',
    notes VARCHAR(255),
    FOREIGN KEY (account_id) REFERENCES accounts(account_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (shift_id) REFERENCES shifts(shift_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS leave_requests (
    leave_request_id INT PRIMARY KEY AUTO_INCREMENT,
    account_id INT NOT NULL,
    leave_type ENUM('Sick Leave', 'Vacation Leave', 'Emergency Leave', 'Other') NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    reason VARCHAR(255),
    request_status ENUM('Pending', 'Approved', 'Rejected', 'Cancelled') NOT NULL DEFAULT 'Pending',
    reviewed_by INT NULL,
    reviewed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(account_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (reviewed_by) REFERENCES accounts(account_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS restaurant_tables (
    table_id INT PRIMARY KEY AUTO_INCREMENT,
    table_number VARCHAR(20) NOT NULL UNIQUE,
    seating_capacity INT NOT NULL,
    table_location VARCHAR(80),
    table_status ENUM('Available', 'Occupied', 'Reserved', 'Maintenance') NOT NULL DEFAULT 'Available',
    is_active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS reservations (
    reservation_id INT PRIMARY KEY AUTO_INCREMENT,
    customer_id INT NULL,
    customer_name VARCHAR(100) NOT NULL,
    contact_number VARCHAR(20) NOT NULL,
    table_id INT NULL,
    party_size INT NOT NULL,
    reservation_start DATETIME NOT NULL,
    reservation_end DATETIME NOT NULL,
    reservation_status ENUM('Pending', 'Confirmed', 'Seated', 'Completed', 'Cancelled', 'No Show') NOT NULL DEFAULT 'Pending',
    created_by INT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes VARCHAR(255),
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    FOREIGN KEY (table_id) REFERENCES restaurant_tables(table_id)
        ON UPDATE CASCADE ON DELETE SET NULL,
    FOREIGN KEY (created_by) REFERENCES accounts(account_id)
        ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS table_status_logs (
    table_status_log_id INT PRIMARY KEY AUTO_INCREMENT,
    table_id INT NOT NULL,
    old_status ENUM('Available', 'Occupied', 'Reserved', 'Maintenance'),
    new_status ENUM('Available', 'Occupied', 'Reserved', 'Maintenance') NOT NULL,
    changed_by INT,
    changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes VARCHAR(255),
    FOREIGN KEY (table_id) REFERENCES restaurant_tables(table_id)
        ON UPDATE CASCADE ON DELETE CASCADE,
    FOREIGN KEY (changed_by) REFERENCES accounts(account_id)
        ON UPDATE CASCADE ON DELETE SET NULL
);