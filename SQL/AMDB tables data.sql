USE AMDB;

-- Insert restaurant tables for testing
INSERT IGNORE INTO restaurant_tables (table_number, seating_capacity, table_location, table_status, is_active) VALUES
('T1', 2, 'Window', 'Available', TRUE),
('T2', 2, 'Window', 'Available', TRUE),
('T3', 4, 'Main Floor', 'Available', TRUE),
('T4', 4, 'Main Floor', 'Available', TRUE),
('T5', 4, 'Main Floor', 'Available', TRUE),
('T6', 6, 'Center', 'Available', TRUE),
('T7', 6, 'Center', 'Available', TRUE),
('T8', 8, 'Private Corner', 'Available', TRUE),
('T9', 2, 'Bar Counter', 'Available', TRUE),
('T10', 4, 'Outdoor', 'Available', TRUE);
