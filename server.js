const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./db');

const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.use(session({
  secret: 'ecommerce-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
}

// ========== PRODUCTS ==========
app.get('/api/products', (req, res) => {
  const { category, search } = req.query;
  let query = 'SELECT * FROM products';
  const params = [];
  if (search) { query += ' WHERE name LIKE ?'; params.push(`%${search}%`); }
  if (category) { query += search ? ' AND category = ?' : ' WHERE category = ?'; params.push(category); }
  query += ' ORDER BY id';
  res.json(db.prepare(query).all(...params));
});

app.get('/api/categories', (req, res) => {
  const cats = db.prepare('SELECT DISTINCT category FROM products ORDER BY category').all();
  res.json(cats.map(c => c.category));
});

app.get('/api/products/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

// ========== AUTH ==========
app.post('/api/auth/register', (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) return res.status(400).json({ error: 'All fields required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password min 6 chars' });
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    return res.status(400).json({ error: 'Email already registered' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const r = db.prepare('INSERT INTO users (email, password, name) VALUES (?, ?, ?)').run(email, hash, name);
  req.session.userId = r.lastInsertRowid;
  req.session.userName = name;
  res.json({ message: 'Registered', userId: r.lastInsertRowid, name });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  req.session.userId = user.id;
  req.session.userName = user.name;
  res.json({ message: 'Logged in', userId: user.id, name: user.name });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logged out' });
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session.userId) return res.json({ user: null });
  const u = db.prepare('SELECT id, email, name FROM users WHERE id = ?').get(req.session.userId);
  res.json({ user: u });
});

// ========== CART ==========
app.get('/api/cart', requireAuth, (req, res) => {
  const items = db.prepare(`
    SELECT ci.id, ci.quantity, p.id as product_id, p.name, p.price, p.image, p.stock
    FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.user_id = ?
  `).all(req.session.userId);
  res.json(items);
});

app.post('/api/cart', requireAuth, (req, res) => {
  const { productId, quantity } = req.body;
  if (!productId) return res.status(400).json({ error: 'Product ID required' });
  const p = db.prepare('SELECT * FROM products WHERE id = ?').get(productId);
  if (!p) return res.status(404).json({ error: 'Not found' });
  if (p.stock < (quantity || 1)) return res.status(400).json({ error: 'Out of stock' });

  const existing = db.prepare('SELECT * FROM cart_items WHERE user_id = ? AND product_id = ?').get(req.session.userId, productId);
  if (existing) {
    const nq = existing.quantity + (quantity || 1);
    if (nq > p.stock) return res.status(400).json({ error: 'Out of stock' });
    db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(nq, existing.id);
  } else {
    db.prepare('INSERT INTO cart_items (user_id, product_id, quantity) VALUES (?, ?, ?)').run(req.session.userId, productId, quantity || 1);
  }
  res.json({ message: 'Added to cart' });
});

app.put('/api/cart/:id', requireAuth, (req, res) => {
  const { quantity } = req.body;
  const item = db.prepare('SELECT * FROM cart_items WHERE id = ? AND user_id = ?').get(req.params.id, req.session.userId);
  if (!item) return res.status(404).json({ error: 'Not found' });
  if (quantity <= 0) {
    db.prepare('DELETE FROM cart_items WHERE id = ?').run(req.params.id);
    return res.json({ message: 'Removed' });
  }
  const p = db.prepare('SELECT stock FROM products WHERE id = ?').get(item.product_id);
  if (quantity > p.stock) return res.status(400).json({ error: 'Out of stock' });
  db.prepare('UPDATE cart_items SET quantity = ? WHERE id = ?').run(quantity, req.params.id);
  res.json({ message: 'Updated' });
});

app.delete('/api/cart/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM cart_items WHERE id = ? AND user_id = ?').run(req.params.id, req.session.userId);
  res.json({ message: 'Removed' });
});

// ========== ORDERS ==========
app.post('/api/orders', requireAuth, (req, res) => {
  const cartItems = db.prepare(`
    SELECT ci.id as cid, ci.quantity, p.id as pid, p.name, p.price, p.stock
    FROM cart_items ci JOIN products p ON ci.product_id = p.id WHERE ci.user_id = ?
  `).all(req.session.userId);

  if (cartItems.length === 0) return res.status(400).json({ error: 'Cart empty' });
  for (const it of cartItems) {
    if (it.quantity > it.stock) return res.status(400).json({ error: `Not enough stock for ${it.name}` });
  }

  const total = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);

  const placeOrder = db.transaction(() => {
    const ord = db.prepare('INSERT INTO orders (user_id, total, status) VALUES (?, ?, ?)').run(req.session.userId, total, 'completed');
    const ins = db.prepare('INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)');
    const upd = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?');
    for (const it of cartItems) {
      ins.run(ord.lastInsertRowid, it.pid, it.quantity, it.price);
      upd.run(it.quantity, it.pid);
    }
    db.prepare('DELETE FROM cart_items WHERE user_id = ?').run(req.session.userId);
    return ord;
  });

  const order = placeOrder();
  res.json({ message: 'Order placed', orderId: order.lastInsertRowid, total });
});

app.get('/api/orders', requireAuth, (req, res) => {
  const orders = db.prepare('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC').all(req.session.userId);
  const getItems = db.prepare('SELECT oi.*, p.name, p.image FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?');
  res.json(orders.map(o => ({ ...o, items: getItems.all(o.id) })));
});

// ========== FRONTEND SPA FALLBACK ==========
app.get(['/', '/products', '/cart', '/login', '/register', '/orders'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/product/:id', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`Store: http://localhost:${PORT}`));
