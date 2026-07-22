const mysql = require('mysql2/promise');
require('dotenv').config();

async function seedTables() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || '127.0.0.1',
    port: process.env.DB_PORT || 3307,
    user: process.env.DB_USER || 'student1',
    password: process.env.DB_PASSWORD || 'Dlsu1234!',
    database: process.env.DB_NAME || 'AMDB',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  try {
    const connection = await pool.getConnection();
    
    const sql = `
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
    `;

    const result = await connection.query(sql);
    console.log(`✓ Inserted ${result[0].affectedRows} restaurant tables`);
    
    connection.release();
    await pool.end();
  } catch (err) {
    console.error('✗ Error seeding tables:', err.message);
    process.exit(1);
  }
}

seedTables().then(() => {
  console.log('✓ Database seeding complete');
  process.exit(0);
});
