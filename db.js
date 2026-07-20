const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'store.db'));

// Enable WAL mode for better concurrency
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    price REAL NOT NULL,
    description TEXT,
    image TEXT,
    stock INTEGER DEFAULT 0,
    category TEXT
  );

  CREATE TABLE IF NOT EXISTS cart_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
    UNIQUE(user_id, product_id)
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    total REAL NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    price REAL NOT NULL,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
    FOREIGN KEY (product_id) REFERENCES products(id)
  );
`);

// Seed products if empty
const count = db.prepare('SELECT COUNT(*) as count FROM products').get();
if (count.count === 0) {
  const insertProduct = db.prepare(
    'INSERT INTO products (name, price, description, image, stock, category) VALUES (?, ?, ?, ?, ?, ?)'
  );

  const products = [
    ['Classic Tee', 29.99, 'A comfortable cotton t-shirt for everyday wear.', '👕', 100, 'Clothing'],
    ['Denim Jacket', 89.99, 'Stylish denim jacket, perfect for layering.', '🧥', 50, 'Clothing'],
    ['Running Shoes', 119.99, 'Lightweight running shoes with superior cushioning.', '👟', 30, 'Footwear'],
    ['Leather Watch', 199.99, 'Elegant leather strap watch with minimalist design.', '⌚', 20, 'Accessories'],
    ['Canvas Backpack', 49.99, 'Durable canvas backpack with laptop compartment.', '🎒', 45, 'Accessories'],
    ['Wireless Earbuds', 79.99, 'True wireless earbuds with noise cancellation.', '🎧', 60, 'Electronics'],
    ['Stainless Steel Bottle', 24.99, 'Insulated water bottle, keeps drinks cold for 24hrs.', '🍶', 80, 'Accessories'],
    ['Sunglasses UV400', 39.99, 'Polarized sunglasses with UV400 protection.', '🕶️', 40, 'Accessories'],
    ['Fitness Tracker', 149.99, 'Smart fitness tracker with heart rate monitor.', '⌚', 25, 'Electronics'],
    ['Desk Plant', 19.99, 'Low-maintenance succulent in a ceramic pot.', '🪴', 70, 'Home'],
    ['Graphic Hoodie', 59.99, 'Warm fleece-lined hoodie with urban graphic print.', '🧥', 55, 'Clothing'],
    ['Mechanical Keyboard', 129.99, 'RGB mechanical keyboard with blue switches.', '⌨️', 35, 'Electronics'],
  ];

  const insertMany = db.transaction(() => {
    for (const p of products) {
      insertProduct.run(...p);
    }
  });
  insertMany();
}

module.exports = db;
