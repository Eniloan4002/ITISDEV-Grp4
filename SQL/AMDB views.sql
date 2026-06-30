USE AMDB;

-- -------------------------
-- Dashboard / Report Views
-- -------------------------

CREATE OR REPLACE VIEW v_inventory_status AS
SELECT
    i.ingredient_id,
    i.ingredient_name,
    it.ingredient_type_name,
    i.unit_of_measure,
    inv.current_quantity,
    i.reorder_level,
    CASE
        WHEN inv.current_quantity <= 0 THEN 'Out of Stock'
        WHEN inv.current_quantity <= i.reorder_level THEN 'Low Stock'
        ELSE 'Normal'
    END AS stock_status
FROM ingredients i
LEFT JOIN ingredient_type it ON i.ingredient_type_id = it.ingredient_type_id
LEFT JOIN ingredient_inventory inv ON i.ingredient_id = inv.ingredient_id;

CREATE OR REPLACE VIEW v_open_stock_alerts AS
SELECT
    sa.stock_alert_id,
    i.ingredient_name,
    sa.alert_type,
    sa.alert_message,
    sa.triggered_at,
    sa.alert_status
FROM stock_alerts sa
JOIN ingredients i ON sa.ingredient_id = i.ingredient_id
WHERE sa.alert_status = 'Open';

CREATE OR REPLACE VIEW v_sales_history AS
SELECT
    pt.transaction_id,
    pt.transaction_no,
    pt.transaction_datetime,
    CONCAT(a.first_name, ' ', a.last_name) AS cashier_name,
    c.customer_name,
    pt.subtotal_amount,
    pt.discount_amount,
    pt.tax_amount,
    pt.total_amount,
    pt.transaction_status
FROM pos_transactions pt
JOIN accounts a ON pt.cashier_id = a.account_id
LEFT JOIN customers c ON pt.customer_id = c.customer_id;

CREATE OR REPLACE VIEW v_daily_sales AS
SELECT
    DATE(transaction_datetime) AS sales_date,
    COUNT(*) AS transaction_count,
    SUM(total_amount) AS total_sales
FROM pos_transactions
WHERE transaction_status IN ('Completed', 'Partially Refunded')
GROUP BY DATE(transaction_datetime);

CREATE OR REPLACE VIEW v_table_availability AS
SELECT
    table_id,
    table_number,
    seating_capacity,
    table_location,
    table_status
FROM restaurant_tables
WHERE is_active = TRUE;

CREATE OR REPLACE VIEW v_attendance_today AS
SELECT
    al.attendance_id,
    al.account_id,
    CONCAT(a.first_name, ' ', a.last_name) AS staff_name,
    al.time_in,
    al.time_out,
    al.attendance_status
FROM attendance_logs al
JOIN accounts a ON al.account_id = a.account_id
WHERE DATE(al.time_in) = CURDATE();

CREATE OR REPLACE VIEW v_erp_dashboard_summary AS
SELECT 'today_sales' AS metric_name, COALESCE(SUM(total_amount), 0) AS metric_value
FROM pos_transactions
WHERE DATE(transaction_datetime) = CURDATE()
  AND transaction_status IN ('Completed', 'Partially Refunded')
UNION ALL
SELECT 'open_stock_alerts', COUNT(*)
FROM stock_alerts
WHERE alert_status = 'Open'
UNION ALL
SELECT 'pending_purchase_orders', COUNT(*)
FROM purchase_orders
WHERE order_status = 'Pending'
UNION ALL
SELECT 'pending_leave_requests', COUNT(*)
FROM leave_requests
WHERE request_status = 'Pending'
UNION ALL
SELECT 'active_reservations_today', COUNT(*)
FROM reservations
WHERE DATE(reservation_start) = CURDATE()
  AND reservation_status IN ('Pending', 'Confirmed', 'Seated');