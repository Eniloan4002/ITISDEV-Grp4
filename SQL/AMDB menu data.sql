USE AMDB;

-- ---------------------------------------------------------------------------
-- Menu seed data (categories + items) for the POS / Sales & Billing module.
--
-- WHY THIS FILE EXISTS:
--   pos_transaction_items.menu_item_id is NOT NULL and references menu_items,
--   so the POS cannot record a single sale line until a menu exists. The
--   creation script builds the tables but seeds no menu.
--
-- SOURCE OF THE DATA:
--   Category names and dish names are taken from the public landing page
--   (public/index.html: "Breakfast Silogs", "Rice Meals & Trays",
--   "Signature Drinks", plus the gallery alt text) and the dish photos in
--   public/images/.
--
--   *** SELLING PRICES ARE PLACEHOLDERS. ***
--   No price list exists anywhere in the repo, so the figures below were
--   chosen to be plausible for a Philippine casual-dining restaurant. Replace
--   them with AM Restaurant's real prices before using any sales figure as
--   coursework output — every total, VAT amount and dashboard KPI is derived
--   from these numbers.
--
-- Safe to re-run: INSERT IGNORE + name-based lookups mean a second run is a
-- no-op rather than a duplicate.
-- ---------------------------------------------------------------------------

INSERT IGNORE INTO menu_categories (category_name, is_active) VALUES
('Breakfast Silogs', TRUE),
('Rice Meals & Trays', TRUE),
('Signature Drinks', TRUE);

-- --- Breakfast Silogs ------------------------------------------------------
INSERT IGNORE INTO menu_items (menu_category_id, item_name, item_description, selling_price, is_available)
SELECT c.menu_category_id, x.item_name, x.item_description, x.selling_price, TRUE
FROM menu_categories c
JOIN (
  SELECT 'Bacon Silog'            AS item_name, 'Crispy bacon with garlic rice and egg'              AS item_description, 165.00 AS selling_price
  UNION ALL SELECT 'Chorizo Silog',        'Sweet chorizo with garlic rice and egg',            170.00
  UNION ALL SELECT 'Hungarian Silog',      'Hungarian sausage with garlic rice and egg',        195.00
  UNION ALL SELECT 'Bangus Silog',         'Boneless bangus with garlic rice and egg',          185.00
  UNION ALL SELECT 'Corned Beef Silog',    'Sauteed corned beef with garlic rice and egg',      175.00
  UNION ALL SELECT 'Inasal Skewers Silog', 'Grilled chicken inasal skewers with garlic rice',   190.00
  UNION ALL SELECT 'Salmon Belly Silog',   'Pan-seared salmon belly with garlic rice and egg',  245.00
  UNION ALL SELECT 'Kanto Chicken Silog',  'House fried chicken with garlic rice and egg',      180.00
  UNION ALL SELECT 'Beef Tapa Silog',      'Sweet-cured beef tapa with garlic rice and egg',    195.00
) x
WHERE c.category_name = 'Breakfast Silogs';

-- --- Rice Meals & Trays ----------------------------------------------------
INSERT IGNORE INTO menu_items (menu_category_id, item_name, item_description, selling_price, is_available)
SELECT c.menu_category_id, x.item_name, x.item_description, x.selling_price, TRUE
FROM menu_categories c
JOIN (
  SELECT 'Beef with String Beans' AS item_name, 'Beef sauteed with string beans, served with rice' AS item_description, 210.00 AS selling_price
  UNION ALL SELECT 'Pork Sisig Rice Meal',  'Sizzling pork sisig with rice',                    215.00
  UNION ALL SELECT 'Chicken Adobo Rice Meal','House chicken adobo with rice',                   195.00
  UNION ALL SELECT 'Party Tray - Small',    'Good for 6-8 pax',                                1250.00
  UNION ALL SELECT 'Party Tray - Large',    'Good for 12-15 pax',                              2200.00
) x
WHERE c.category_name = 'Rice Meals & Trays';

-- --- Signature Drinks ------------------------------------------------------
INSERT IGNORE INTO menu_items (menu_category_id, item_name, item_description, selling_price, is_available)
SELECT c.menu_category_id, x.item_name, x.item_description, x.selling_price, TRUE
FROM menu_categories c
JOIN (
  SELECT 'Sea Salt Latte'    AS item_name, 'House sea salt cream latte'  AS item_description, 145.00 AS selling_price
  UNION ALL SELECT 'Cocoa Latte',       'House cocoa latte',                    140.00
  UNION ALL SELECT 'Honey Cream Latte', 'House honey cream latte',              150.00
  UNION ALL SELECT 'Iced Americano',    'Double shot over ice',                 120.00
  UNION ALL SELECT 'Bottled Water',     '500ml',                                 35.00
) x
WHERE c.category_name = 'Signature Drinks';
