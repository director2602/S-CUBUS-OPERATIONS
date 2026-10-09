const express = require('express');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const { q, one } = require('../db');
const { ah, bad, forbidden, isMgmt, isFinance, isReviewer, audit, ROLES, sign, getSettings } = require('../lib');

const r = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 6 * 1024 * 1024 } });

// ---------- Auth ----------
r.post('/auth/login', ah(async (req, res) => {
  const { email, password } = req.body || {};
  const u = await one('SELECT * FROM users WHERE lower(email)=lower($1) OR phone=$1', [String(email || '').trim()]);
  if (!u || !u.active || !(await bcrypt.compare(String(password || ''), u.password_hash))) throw bad('Wrong email/phone or password.');
  res.cookie('sid', sign(u), { httpOnly: true, sameSite: 'lax', secure: req.secure || req.headers['x-forwarded-proto'] === 'https', maxAge: 30 * 864e5 });
  res.json({ ok: true });
}));
r.post('/auth/logout', (req, res) => { res.clearCookie('sid'); res.json({ ok: true }); });

module.exports.publicRouter = r;

// ---------- Authenticated master data ----------
const m = express.Router();

m.get('/me', ah(async (req, res) => {
  const s = await getSettings();
  res.json({ user: req.user, roles: ROLES, settings: { company_name: s.company_name, manager_approval_limit: s.manager_approval_limit } });
}));

m.post('/me/password', ah(async (req, res) => {
  const { current, next } = req.body || {};
  const u = await one('SELECT * FROM users WHERE id=$1', [req.user.id]);
  if (!(await bcrypt.compare(String(current || ''), u.password_hash))) throw bad('Current password is wrong.');
  if (!next || String(next).length < 6) throw bad('New password must be at least 6 characters.');
  await q('UPDATE users SET password_hash=$2 WHERE id=$1', [u.id, await bcrypt.hash(String(next), 10)]);
  res.json({ ok: true });
}));

// Lookups used by forms (any signed-in user)
m.get('/lookups', ah(async (req, res) => {
  const [branches, vendors, items, categories, users] = await Promise.all([
    q('SELECT id, name, code FROM branches WHERE active ORDER BY id'),
    q('SELECT id, name, category FROM vendors WHERE active ORDER BY name'),
    q('SELECT i.id, i.name, i.unit, i.rate, i.category, i.min_stock FROM items i WHERE active ORDER BY name'),
    q('SELECT id, name FROM expense_categories WHERE active ORDER BY name'),
    q('SELECT id, name, role, branch_id FROM users WHERE active ORDER BY name')
  ]);
  res.json({ branches, vendors, items, categories, users, roles: ROLES });
}));

// Generic CRUD for simple masters
const MASTERS = {
  branches: { table: 'branches', fields: ['name', 'code', 'address', 'active'], write: isMgmt, order: 'id' },
  vendors: { table: 'vendors', fields: ['name', 'category', 'gstin', 'phone', 'email', 'address', 'bank_details', 'active'], write: (u) => isFinance(u) || u.role === 'manager', read: isReviewer, order: 'name' },
  items: { table: 'items', fields: ['name', 'sku', 'category', 'unit', 'min_stock', 'rate', 'active'], write: (u) => isFinance(u) || u.role === 'manager', order: 'name' },
  categories: { table: 'expense_categories', fields: ['name', 'active'], write: isFinance, order: 'name' }
};

Object.entries(MASTERS).forEach(([name, cfg]) => {
  m.get('/' + name, ah(async (req, res) => {
    if (cfg.read && !cfg.read(req.user)) throw forbidden();
    res.json(await q(`SELECT * FROM ${cfg.table} ORDER BY ${cfg.order}`));
  }));
  m.post('/' + name, ah(async (req, res) => {
    if (!cfg.write(req.user)) throw forbidden();
    const b = req.body || {};
    if (!String(b.name || '').trim()) throw bad('Name is required.');
    const cols = cfg.fields.filter((f) => b[f] !== undefined);
    const row = await one(`INSERT INTO ${cfg.table} (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, cols.map((c) => (b[c] === '' ? null : b[c])));
    await audit(null, name, row.id, 'created', req.user.id, b);
    res.json(row);
  }));
  m.put('/' + name + '/:id', ah(async (req, res) => {
    if (!cfg.write(req.user)) throw forbidden();
    const b = req.body || {};
    const cols = cfg.fields.filter((f) => b[f] !== undefined);
    if (!cols.length) throw bad('Nothing to update.');
    const before = await one(`SELECT * FROM ${cfg.table} WHERE id=$1`, [req.params.id]);
    const row = await one(`UPDATE ${cfg.table} SET ${cols.map((c, i) => `${c}=$${i + 2}`).join(',')} WHERE id=$1 RETURNING *`, [req.params.id, ...cols.map((c) => (b[c] === '' ? null : b[c]))]);
    await audit(null, name, row.id, 'edited', req.user.id, { before, after: b });
    res.json(row);
  }));
});

// Users
m.get('/users', ah(async (req, res) => {
  if (!isReviewer(req.user)) throw forbidden();
  res.json(await q('SELECT u.id, u.name, u.email, u.phone, u.role, u.designation, u.branch_id, u.active, b.name AS branch_name FROM users u LEFT JOIN branches b ON b.id=u.branch_id ORDER BY u.name'));
}));
m.post('/users', ah(async (req, res) => {
  if (!isMgmt(req.user)) throw forbidden();
  const b = req.body || {};
  if (!b.name || !b.email) throw bad('Name and email/login are required.');
  if (!ROLES[b.role]) throw bad('Choose a role.');
  if (b.role === 'owner' && req.user.role !== 'owner') throw forbidden('Only the owner can create another owner.');
  if (!b.password || String(b.password).length < 6) throw bad('Password must be at least 6 characters.');
  const exists = await one('SELECT id FROM users WHERE lower(email)=lower($1)', [b.email]);
  if (exists) throw bad('A user with this email/login already exists.');
  const row = await one('INSERT INTO users (name, email, phone, role, designation, branch_id, password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
    [b.name, b.email.trim(), b.phone || null, b.role, b.designation || null, b.branch_id || null, await bcrypt.hash(String(b.password), 10)]);
  await audit(null, 'user', row.id, 'created', req.user.id, { name: b.name, role: b.role });
  res.json(row);
}));
m.put('/users/:id', ah(async (req, res) => {
  if (!isMgmt(req.user)) throw forbidden();
  const b = req.body || {};
  const target = await one('SELECT * FROM users WHERE id=$1', [req.params.id]);
  if (!target) throw bad('Not found.');
  if ((target.role === 'owner' || b.role === 'owner') && req.user.role !== 'owner') throw forbidden('Only the owner can change an owner account.');
  if (b.role && !ROLES[b.role]) throw bad('Invalid role.');
  await q('UPDATE users SET name=COALESCE($2,name), email=COALESCE($3,email), phone=$4, role=COALESCE($5,role), designation=$6, branch_id=$7, active=COALESCE($8,active) WHERE id=$1',
    [req.params.id, b.name || null, b.email || null, b.phone || null, b.role || null, b.designation || null, b.branch_id || null, b.active === undefined ? null : !!b.active]);
  if (b.password) {
    if (String(b.password).length < 6) throw bad('Password must be at least 6 characters.');
    await q('UPDATE users SET password_hash=$2 WHERE id=$1', [req.params.id, await bcrypt.hash(String(b.password), 10)]);
  }
  await audit(null, 'user', target.id, 'edited', req.user.id, { role: b.role, active: b.active });
  res.json({ ok: true });
}));

// Settings
m.get('/settings', ah(async (req, res) => { res.json(await getSettings()); }));
m.put('/settings', ah(async (req, res) => {
  if (!isMgmt(req.user)) throw forbidden();
  const b = req.body || {};
  for (const [k, v] of Object.entries(b)) {
    await q('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value', [k, JSON.stringify(v)]);
  }
  await audit(null, 'settings', null, 'edited', req.user.id, b);
  res.json(await getSettings());
}));

// Files
m.post('/files', upload.single('file'), ah(async (req, res) => {
  if (!req.file) throw bad('No file received.');
  const row = await one('INSERT INTO files (name, mime, size, data, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, mime, size',
    [req.file.originalname, req.file.mimetype, req.file.size, req.file.buffer, req.user.id]);
  res.json(row);
}));
m.post('/files/dataurl', ah(async (req, res) => {
  const { dataUrl, name } = req.body || {};
  const mt = /^data:([^;]+);base64,(.+)$/.exec(dataUrl || '');
  if (!mt) throw bad('Invalid image.');
  const buf = Buffer.from(mt[2], 'base64');
  if (buf.length > 6 * 1024 * 1024) throw bad('File too large.');
  const row = await one('INSERT INTO files (name, mime, size, data, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id, name, mime, size',
    [name || 'signature.png', mt[1], buf.length, buf, req.user.id]);
  res.json(row);
}));
m.get('/files/:id', ah(async (req, res) => {
  const f = await one('SELECT * FROM files WHERE id=$1', [req.params.id]);
  if (!f) return res.status(404).end();
  res.setHeader('Content-Type', f.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(f.name)}"`);
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.end(f.data);
}));

// Audit trail for any record
m.get('/audit/:entity/:id', ah(async (req, res) => {
  if (!isReviewer(req.user)) throw forbidden();
  res.json(await q('SELECT a.*, u.name AS user_name FROM audit_log a LEFT JOIN users u ON u.id=a.user_id WHERE entity=$1 AND entity_id=$2 ORDER BY at DESC', [req.params.entity, req.params.id]));
}));

// Reset operational data (keeps masters, users, registers definitions)
m.post('/admin/reset-data', ah(async (req, res) => {
  if (req.user.role !== 'owner') throw forbidden('Only the owner can do this.');
  if ((req.body || {}).confirm !== 'DELETE ALL DATA') throw bad('Type DELETE ALL DATA to confirm.');
  await q(`TRUNCATE petty_cash, vouchers, purchase_lines, purchases, stock_movements, stock, register_history, register_entries, tasks, documents, counters RESTART IDENTITY CASCADE`);
  await audit(null, 'system', null, 'reset-data', req.user.id, null);
  res.json({ ok: true });
}));

module.exports.router = m;
