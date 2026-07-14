USE AMDB;

-- ---------------------------------------------------------
-- Sample ingredient master data + inventory quantities
-- Idempotent: safe to run multiple times
-- ---------------------------------------------------------

-- Ensure common ingredient types exist
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

-- Ingredients
INSERT INTO ingredients
(ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
SELECT 'Chicken Breast', it.ingredient_type_id, 'kg', 8, 40, TRUE
FROM ingredient_type it WHERE it.ingredient_type_name = 'Meat'
ON DUPLICATE KEY UPDATE
ingredient_type_id = VALUES(ingredient_type_id),
unit_of_measure = VALUES(unit_of_measure),
reorder_level = VALUES(reorder_level),
max_stock_level = VALUES(max_stock_level),
is_active = TRUE;

INSERT INTO ingredients
(ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
SELECT 'Ground Pork', it.ingredient_type_id, 'kg', 6, 30, TRUE
FROM ingredient_type it WHERE it.ingredient_type_name = 'Meat'
ON DUPLICATE KEY UPDATE ingredient_type_id=VALUES(ingredient_type_id), unit_of_measure=VALUES(unit_of_measure), reorder_level=VALUES(reorder_level), max_stock_level=VALUES(max_stock_level), is_active=TRUE;

INSERT INTO ingredients
(ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
SELECT 'Boneless Bangus', it.ingredient_type_id, 'kg', 5, 25, TRUE
FROM ingredient_type it WHERE it.ingredient_type_name = 'Seafood'
ON DUPLICATE KEY UPDATE ingredient_type_id=VALUES(ingredient_type_id), unit_of_measure=VALUES(unit_of_measure), reorder_level=VALUES(reorder_level), max_stock_level=VALUES(max_stock_level), is_active=TRUE;

INSERT INTO ingredients
(ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
SELECT 'Bacon', it.ingredient_type_id, 'kg', 4, 20, TRUE
FROM ingredient_type it WHERE it.ingredient_type_name = 'Meat'
ON DUPLICATE KEY UPDATE ingredient_type_id=VALUES(ingredient_type_id), unit_of_measure=VALUES(unit_of_measure), reorder_level=VALUES(reorder_level), max_stock_level=VALUES(max_stock_level), is_active=TRUE;

INSERT INTO ingredients
(ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
SELECT 'Eggs', it.ingredient_type_id, 'tray', 6, 35, TRUE
FROM ingredient_type it WHERE it.ingredient_type_name = 'Dairy'
ON DUPLICATE KEY UPDATE ingredient_type_id=VALUES(ingredient_type_id), unit_of_measure=VALUES(unit_of_measure), reorder_level=VALUES(reorder_level), max_stock_level=VALUES(max_stock_level), is_active=TRUE;

INSERT INTO ingredients
(ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
SELECT 'Garlic Rice (Cooked)', it.ingredient_type_id, 'kg', 10, 50, TRUE
FROM ingredient_type it WHERE it.ingredient_type_name = 'Dry Goods'
ON DUPLICATE KEY UPDATE ingredient_type_id=VALUES(ingredient_type_id), unit_of_measure=VALUES(unit_of_measure), reorder_level=VALUES(reorder_level), max_stock_level=VALUES(max_stock_level), is_active=TRUE;

INSERT INTO ingredients
(ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
SELECT 'White Rice', it.ingredient_type_id, 'kg', 20, 100, TRUE
FROM ingredient_type it WHERE it.ingredient_type_name = 'Dry Goods'
ON DUPLICATE KEY UPDATE ingredient_type_id=VALUES(ingredient_type_id), unit_of_measure=VALUES(unit_of_measure), reorder_level=VALUES(reorder_level), max_stock_level=VALUES(max_stock_level), is_active=TRUE;

INSERT INTO ingredients
(ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
SELECT 'Soy Sauce', it.ingredient_type_id, 'L', 3, 15, TRUE
FROM ingredient_type it WHERE it.ingredient_type_name = 'Condiment'
ON DUPLICATE KEY UPDATE ingredient_type_id=VALUES(ingredient_type_id), unit_of_measure=VALUES(unit_of_measure), reorder_level=VALUES(reorder_level), max_stock_level=VALUES(max_stock_level), is_active=TRUE;

INSERT INTO ingredients
(ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
SELECT 'Vinegar', it.ingredient_type_id, 'L', 2, 12, TRUE
FROM ingredient_type it WHERE it.ingredient_type_name = 'Condiment'
ON DUPLICATE KEY UPDATE ingredient_type_id=VALUES(ingredient_type_id), unit_of_measure=VALUES(unit_of_measure), reorder_level=VALUES(reorder_level), max_stock_level=VALUES(max_stock_level), is_active=TRUE;

INSERT INTO ingredients
(ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
SELECT 'Onion', it.ingredient_type_id, 'kg', 5, 25, TRUE
FROM ingredient_type it WHERE it.ingredient_type_name = 'Vegetable'
ON DUPLICATE KEY UPDATE ingredient_type_id=VALUES(ingredient_type_id), unit_of_measure=VALUES(unit_of_measure), reorder_level=VALUES(reorder_level), max_stock_level=VALUES(max_stock_level), is_active=TRUE;

INSERT INTO ingredients
(ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
SELECT 'Garlic', it.ingredient_type_id, 'kg', 3, 15, TRUE
FROM ingredient_type it WHERE it.ingredient_type_name = 'Vegetable'
ON DUPLICATE KEY UPDATE ingredient_type_id=VALUES(ingredient_type_id), unit_of_measure=VALUES(unit_of_measure), reorder_level=VALUES(reorder_level), max_stock_level=VALUES(max_stock_level), is_active=TRUE;

INSERT INTO ingredients
(ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
SELECT 'Tomato', it.ingredient_type_id, 'kg', 4, 18, TRUE
FROM ingredient_type it WHERE it.ingredient_type_name = 'Vegetable'
ON DUPLICATE KEY UPDATE ingredient_type_id=VALUES(ingredient_type_id), unit_of_measure=VALUES(unit_of_measure), reorder_level=VALUES(reorder_level), max_stock_level=VALUES(max_stock_level), is_active=TRUE;

INSERT INTO ingredients
(ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
SELECT 'Calamansi', it.ingredient_type_id, 'kg', 2, 10, TRUE
FROM ingredient_type it WHERE it.ingredient_type_name = 'Fruit'
ON DUPLICATE KEY UPDATE ingredient_type_id=VALUES(ingredient_type_id), unit_of_measure=VALUES(unit_of_measure), reorder_level=VALUES(reorder_level), max_stock_level=VALUES(max_stock_level), is_active=TRUE;

INSERT INTO ingredients
(ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
SELECT 'Brown Sugar', it.ingredient_type_id, 'kg', 3, 14, TRUE
FROM ingredient_type it WHERE it.ingredient_type_name = 'Dry Goods'
ON DUPLICATE KEY UPDATE ingredient_type_id=VALUES(ingredient_type_id), unit_of_measure=VALUES(unit_of_measure), reorder_level=VALUES(reorder_level), max_stock_level=VALUES(max_stock_level), is_active=TRUE;

INSERT INTO ingredients
(ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
SELECT 'Sea Salt', it.ingredient_type_id, 'kg', 2, 10, TRUE
FROM ingredient_type it WHERE it.ingredient_type_name = 'Condiment'
ON DUPLICATE KEY UPDATE ingredient_type_id=VALUES(ingredient_type_id), unit_of_measure=VALUES(unit_of_measure), reorder_level=VALUES(reorder_level), max_stock_level=VALUES(max_stock_level), is_active=TRUE;

INSERT INTO ingredients
(ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
SELECT 'Fresh Milk', it.ingredient_type_id, 'L', 4, 20, TRUE
FROM ingredient_type it WHERE it.ingredient_type_name = 'Dairy'
ON DUPLICATE KEY UPDATE ingredient_type_id=VALUES(ingredient_type_id), unit_of_measure=VALUES(unit_of_measure), reorder_level=VALUES(reorder_level), max_stock_level=VALUES(max_stock_level), is_active=TRUE;

INSERT INTO ingredients
(ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
SELECT 'Coffee Beans', it.ingredient_type_id, 'kg', 2, 12, TRUE
FROM ingredient_type it WHERE it.ingredient_type_name = 'Beverage'
ON DUPLICATE KEY UPDATE ingredient_type_id=VALUES(ingredient_type_id), unit_of_measure=VALUES(unit_of_measure), reorder_level=VALUES(reorder_level), max_stock_level=VALUES(max_stock_level), is_active=TRUE;

INSERT INTO ingredients
(ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
SELECT 'Cocoa Powder', it.ingredient_type_id, 'kg', 2, 10, TRUE
FROM ingredient_type it WHERE it.ingredient_type_name = 'Beverage'
ON DUPLICATE KEY UPDATE ingredient_type_id=VALUES(ingredient_type_id), unit_of_measure=VALUES(unit_of_measure), reorder_level=VALUES(reorder_level), max_stock_level=VALUES(max_stock_level), is_active=TRUE;

INSERT INTO ingredients
(ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
SELECT 'Honey Syrup', it.ingredient_type_id, 'L', 1, 8, TRUE
FROM ingredient_type it WHERE it.ingredient_type_name = 'Beverage'
ON DUPLICATE KEY UPDATE ingredient_type_id=VALUES(ingredient_type_id), unit_of_measure=VALUES(unit_of_measure), reorder_level=VALUES(reorder_level), max_stock_level=VALUES(max_stock_level), is_active=TRUE;

INSERT INTO ingredients
(ingredient_name, ingredient_type_id, unit_of_measure, reorder_level, max_stock_level, is_active)
SELECT 'Takeout Box', it.ingredient_type_id, 'pcs', 200, 1000, TRUE
FROM ingredient_type it WHERE it.ingredient_type_name = 'Packaging'
ON DUPLICATE KEY UPDATE ingredient_type_id=VALUES(ingredient_type_id), unit_of_measure=VALUES(unit_of_measure), reorder_level=VALUES(reorder_level), max_stock_level=VALUES(max_stock_level), is_active=TRUE;

-- Inventory quantities
INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
SELECT ingredient_id, 24.00 FROM ingredients WHERE ingredient_name = 'Chicken Breast'
ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity);

INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
SELECT ingredient_id, 18.00 FROM ingredients WHERE ingredient_name = 'Ground Pork'
ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity);

INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
SELECT ingredient_id, 11.00 FROM ingredients WHERE ingredient_name = 'Boneless Bangus'
ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity);

INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
SELECT ingredient_id, 8.00 FROM ingredients WHERE ingredient_name = 'Bacon'
ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity);

INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
SELECT ingredient_id, 15.00 FROM ingredients WHERE ingredient_name = 'Eggs'
ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity);

INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
SELECT ingredient_id, 35.00 FROM ingredients WHERE ingredient_name = 'Garlic Rice (Cooked)'
ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity);

INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
SELECT ingredient_id, 70.00 FROM ingredients WHERE ingredient_name = 'White Rice'
ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity);

INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
SELECT ingredient_id, 6.00 FROM ingredients WHERE ingredient_name = 'Soy Sauce'
ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity);

INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
SELECT ingredient_id, 4.00 FROM ingredients WHERE ingredient_name = 'Vinegar'
ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity);

INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
SELECT ingredient_id, 9.00 FROM ingredients WHERE ingredient_name = 'Onion'
ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity);

INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
SELECT ingredient_id, 5.00 FROM ingredients WHERE ingredient_name = 'Garlic'
ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity);

INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
SELECT ingredient_id, 7.00 FROM ingredients WHERE ingredient_name = 'Tomato'
ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity);

INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
SELECT ingredient_id, 3.00 FROM ingredients WHERE ingredient_name = 'Calamansi'
ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity);

INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
SELECT ingredient_id, 5.00 FROM ingredients WHERE ingredient_name = 'Brown Sugar'
ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity);

INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
SELECT ingredient_id, 2.00 FROM ingredients WHERE ingredient_name = 'Sea Salt'
ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity);

INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
SELECT ingredient_id, 8.00 FROM ingredients WHERE ingredient_name = 'Fresh Milk'
ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity);

INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
SELECT ingredient_id, 3.00 FROM ingredients WHERE ingredient_name = 'Coffee Beans'
ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity);

INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
SELECT ingredient_id, 2.00 FROM ingredients WHERE ingredient_name = 'Cocoa Powder'
ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity);

INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
SELECT ingredient_id, 1.00 FROM ingredients WHERE ingredient_name = 'Honey Syrup'
ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity);

INSERT INTO ingredient_inventory (ingredient_id, current_quantity)
SELECT ingredient_id, 420.00 FROM ingredients WHERE ingredient_name = 'Takeout Box'
ON DUPLICATE KEY UPDATE current_quantity = VALUES(current_quantity);

-- Quick verification
SELECT
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
LEFT JOIN ingredient_inventory inv ON i.ingredient_id = inv.ingredient_id
ORDER BY i.ingredient_name;