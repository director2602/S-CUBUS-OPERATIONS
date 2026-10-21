// Store: Modules (books), T-shirts & uniforms, Housekeeping & other supplies.
// Every transaction (receipt / issue / transfer / damaged / return) posts to stock via stock_movements.
const express = require('express');
const { q, one, tx } = require('../db');
const { ah, bad, forbidden, isMgmt, isFinance, isReviewer, seesAll, FIELD_ROLES, userBranch, audit, getSettings, today } = require('../lib');
const { moveStock, stockOf } = require('../finance');
const DEFAULTS = require('../store-config');

const r = express.Router();
const KINDS = ['module', 'apparel', 'supply'];
const TXN_KINDS = ['receipt', 'issue', 'transfer', 'damaged', 'return'];
const clean = (v) => (v === undefined || v === null ? '' : String(v).trim());
const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v));

async function config() {
  const s = await getSettings();
  return s.store_config || DEFAULTS;
}
function scopeBranch(req, wanted) {
  if (seesAll(req.user)) return wanted && wanted !== 'all' ? Number(wanted) : null;
  return req.user.branch_id;
}

// ---------- item identity ----------
function moduleName(b) {
  const m = clean(b.module_no);
  const mod = /^m(odule)?[\s\-.]?/i.test(m) ? m : `Module ${m}`;
  return `${b.course} · Class ${b.class_level} · ${b.subject} · ${mod}${b.language && b.language !== 'English' ? ' (' + b.language + ')' : ''} · ${b.session}`;
}
function apparelName(b) {
  return [b.garment, b.size, b.audience, b.gender && b.gender !== 'Unisex' ? b.gender : '', b.colour].filter(Boolean).join(' · ');
}
async function findOrCreateItem(h, kind, b, user) {
  if (b.item_id) {
    const it = await h.one('SELECT * FROM items WHERE id=$1', [Number(b.item_id)]);
    if (!it) throw bad('Item not found.');
    return it;
  }
  const cfg = await config();
  if (kind === 'module') {
    ['course', 'class_level', 'subject', 'module_no'].forEach((k) => { if (!clean(b[k])) throw bad(`Fill ${k.replace('_level', '').replace('_', ' ')} / ${({ course: 'course chuniye', class_level: 'class chuniye', subject: 'subject chuniye', module_no: 'module number likhiye' })[k]}.`); });
    const session = clean(b.session) || cfg.session;
    const lang = clean(b.language) || 'English';
    let it = await h.one(`SELECT * FROM items WHERE item_kind='module' AND course=$1 AND class_level=$2 AND subject=$3 AND lower(module_no)=lower($4) AND session=$5 AND COALESCE(language,'English')=$6`,
      [b.course, b.class_level, b.subject, clean(b.module_no), session, lang]);
    if (!it) {
      it = await h.one(`INSERT INTO items (name, category, unit, min_stock, rate, item_kind, is_module, course, class_level, subject, module_no, session, language, title, edition)
        VALUES ($1,'Study module','pcs',$2,$3,'module',TRUE,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [moduleName({ ...b, session, language: lang }), num(b.min_stock), num(b.rate), b.course, b.class_level, b.subject, clean(b.module_no), session, lang, clean(b.title) || null, clean(b.edition) || null]);
      await audit(h, 'item', it.id, 'created', user.id, { name: it.name });
    }
    return it;
  }
  if (kind === 'apparel') {
    ['garment', 'size', 'audience'].forEach((k) => { if (!clean(b[k])) throw bad(`Fill ${k} / ${({ garment: 'kapde ka type chuniye', size: 'size chuniye', audience: 'kiske liye hai chuniye' })[k]}.`); });
    const gender = clean(b.gender) || 'Unisex';
    let it = await h.one(`SELECT * FROM items WHERE item_kind='apparel' AND garment=$1 AND size=$2 AND audience=$3 AND COALESCE(gender,'Unisex')=$4 AND lower(COALESCE(colour,''))=lower($5)`,
      [b.garment, b.size, b.audience, gender, clean(b.colour)]);
    if (!it) {
      it = await h.one(`INSERT INTO items (name, category, unit, min_stock, rate, item_kind, garment, size, audience, gender, colour)
        VALUES ($1,'Uniforms & T-shirts','pcs',$2,$3,'apparel',$4,$5,$6,$7,$8) RETURNING *`,
      [apparelName({ ...b, gender }), num(b.min_stock), num(b.rate), b.garment, b.size, b.audience, gender, clean(b.colour) || null]);
      await audit(h, 'item', it.id, 'created', user.id, { name: it.name });
    }
    return it;
  }
  // supply
  if (!clean(b.category)) throw bad('Choose a category / category chuniye.');
  if (!clean(b.name)) throw bad('Type the item name / saaman ka naam likhiye.');
  let it = await h.one(`SELECT * FROM items WHERE item_kind='supply' AND category=$1 AND lower(name)=lower($2) AND lower(COALESCE(spec,''))=lower($3)`,
    [b.category, clean(b.name), clean(b.spec)]);
  if (!it) {
    it = await h.one(`INSERT INTO items (name, category, unit, min_stock, rate, item_kind, spec) VALUES ($1,$2,$3,$4,$5,'supply',$6) RETURNING *`,
      [clean(b.name), b.category, clean(b.unit) || 'pcs', num(b.min_stock), num(b.rate), clean(b.spec) || null]);
    await audit(h, 'item', it.id, 'created', user.id, { name: it.name });
  } else if (b.min_stock !== undefined && b.min_stock !== '') {
    await h.q('UPDATE items SET min_stock=$2 WHERE id=$1', [it.id, num(b.min_stock)]);
  }
  return it;
}

// ---------- stock posting ----------
function desiredMoves(t) {
  if (t.status !== 'active') return [];
  const qty = Number(t.qty);
  switch (t.kind) {
    case 'receipt': return [{ branch: t.branch_id, qty: qty - Number(t.damaged_qty || 0), type: 'inward' }];
    case 'issue': return [{ branch: t.branch_id, qty: -qty, type: 'issue' }];
    case 'transfer': return [{ branch: t.branch_id, qty: -qty, type: 'transfer_out' }, { branch: t.to_branch_id, qty, type: 'transfer_in' }];
    case 'damaged': return [{ branch: t.branch_id, qty: -qty, type: 'damage' }];
    case 'return': return [{ branch: t.branch_id, qty, type: 'return' }];
    default: return [];
  }
}
async function syncStock(h, t, user) {
  const existing = await h.q("SELECT branch_id, SUM(qty) AS qty FROM stock_movements WHERE ref_type='store_txn' AND ref_id=$1 GROUP BY branch_id", [t.id]);
  const want = desiredMoves(t);
  const keys = new Set([...existing.map((e) => e.branch_id), ...want.map((w) => w.branch)]);
  const label = t.kind === 'issue' ? (t.issued_to || t.department || '') : (t.kind === 'transfer' ? 'Branch transfer' : (t.source_name || t.source || ''));
  for (const b of keys) {
    const have = Number((existing.find((e) => e.branch_id === b) || {}).qty || 0);
    const w = want.find((x) => x.branch === b);
    const diff = (w ? w.qty : 0) - have;
    if (Math.abs(diff) < 1e-9) continue;
    const cur = await stockOf(h, t.item_id, b);
    if (cur + diff < -1e-9) {
      const br = await h.one('SELECT name FROM branches WHERE id=$1', [b]);
      throw bad(`Only ${cur} in stock at ${br ? br.name : 'this branch'} / stock mein sirf ${cur} hai.`);
    }
    await moveStock(h, { item_id: t.item_id, branch_id: b, qty: diff, type: w ? w.type : 'adjustment', ref_type: 'store_txn', ref_id: t.id, issued_to: label || null, remarks: `Store ${t.kind}${t.challan_no ? ' · challan ' + t.challan_no : ''}`, user_id: user.id });
  }
}

// ---------- config ----------
r.get('/store/config', ah(async (req, res) => res.json(await config())));
r.put('/store/config', ah(async (req, res) => {
  if (!isMgmt(req.user)) throw forbidden('Only Owner/Admin can change the store set-up.');
  const b = req.body || {};
  if (!b.module || !b.apparel || !b.supply) throw bad('Incomplete set-up.');
  await q("INSERT INTO settings (key, value) VALUES ('store_config',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [JSON.stringify(b)]);
  await audit(null, 'settings', null, 'store_config', req.user.id, null);
  res.json(b);
}));

// ---------- items with aggregates ----------
r.get('/store/items', ah(async (req, res) => {
  const kind = KINDS.includes(req.query.kind) ? req.query.kind : 'module';
  const bid = scopeBranch(req, req.query.branch_id);
  const p = [kind, bid];
  let where = "WHERE i.item_kind=$1 AND i.active";
  const add = (col, v) => { if (v) { p.push(v); where += ` AND i.${col}=$${p.length}`; } };
  add('course', req.query.course); add('class_level', req.query.class_level); add('subject', req.query.subject); add('session', req.query.session);
  add('garment', req.query.garment); add('size', req.query.size); add('audience', req.query.audience); add('category', req.query.category);
  if (req.query.module_no) { p.push(req.query.module_no); where += ` AND lower(i.module_no)=lower($${p.length})`; }
  if (req.query.q) { p.push('%' + req.query.q + '%'); where += ` AND (i.name ILIKE $${p.length} OR COALESCE(i.title,'') ILIKE $${p.length} OR COALESCE(i.spec,'') ILIKE $${p.length})`; }
  const rows = await q(`SELECT i.*,
      COALESCE((SELECT SUM(qty) FROM stock s WHERE s.item_id=i.id AND ($2::int IS NULL OR s.branch_id=$2)),0) AS in_hand,
      COALESCE((SELECT SUM(t.qty) FROM module_txns t WHERE t.item_id=i.id AND t.kind='receipt' AND t.status='active' AND ($2::int IS NULL OR t.branch_id=$2)),0) AS received,
      COALESCE((SELECT SUM(t.damaged_qty) FROM module_txns t WHERE t.item_id=i.id AND t.kind='receipt' AND t.status='active' AND ($2::int IS NULL OR t.branch_id=$2)),0)
        + COALESCE((SELECT SUM(t.qty) FROM module_txns t WHERE t.item_id=i.id AND t.kind='damaged' AND t.status='active' AND ($2::int IS NULL OR t.branch_id=$2)),0) AS damaged,
      COALESCE((SELECT SUM(t.qty) FROM module_txns t WHERE t.item_id=i.id AND t.kind='issue' AND t.status='active' AND ($2::int IS NULL OR t.branch_id=$2)),0) AS issued,
      COALESCE((SELECT SUM(t.qty) FROM module_txns t WHERE t.item_id=i.id AND t.kind='return' AND t.status='active' AND ($2::int IS NULL OR t.branch_id=$2)),0) AS returned,
      (SELECT MAX(t.date) FROM module_txns t WHERE t.item_id=i.id AND t.kind='receipt' AND t.status='active' AND ($2::int IS NULL OR t.branch_id=$2)) AS last_received,
      (SELECT MAX(t.date) FROM module_txns t WHERE t.item_id=i.id AND t.kind='issue' AND t.status='active' AND ($2::int IS NULL OR t.branch_id=$2)) AS last_issued
    FROM items i ${where}
    ORDER BY i.course NULLS LAST, i.class_level NULLS LAST, i.subject NULLS LAST, i.module_no NULLS LAST, i.garment NULLS LAST, i.audience NULLS LAST, i.size NULLS LAST, i.category NULLS LAST, i.name`, p);
  // pending for modules = matching batch strength - issued to those batches
  if (kind === 'module' && rows.length) {
    const batches = await q('SELECT * FROM batches WHERE active AND ($1::int IS NULL OR branch_id=$1)', [bid]);
    const given = await q(`SELECT item_id, batch_id, SUM(qty) AS qty FROM module_txns WHERE kind='issue' AND status='active' AND batch_id IS NOT NULL AND ($1::int IS NULL OR branch_id=$1) GROUP BY 1,2`, [bid]);
    rows.forEach((it) => {
      const bs = batches.filter((b) => b.course === it.course && (!b.class_level || b.class_level === it.class_level) && (!b.session || b.session === it.session));
      it.students = bs.reduce((a, b) => a + b.students, 0);
      it.pending = bs.reduce((a, b) => { const g = given.find((x) => x.item_id === it.id && x.batch_id === b.id); return a + Math.max(0, b.students - Number(g ? g.qty : 0)); }, 0);
      it.batches = bs.length;
    });
  }
  if (kind === 'apparel' && rows.length) {
    const batches = await q('SELECT * FROM batches WHERE active AND ($1::int IS NULL OR branch_id=$1)', [bid]);
    const given = await q(`SELECT i.garment, t.batch_id, SUM(t.qty) AS qty FROM module_txns t JOIN items i ON i.id=t.item_id WHERE i.item_kind='apparel' AND i.audience='Students'
      AND t.kind='issue' AND t.status='active' AND t.batch_id IS NOT NULL AND ($1::int IS NULL OR t.branch_id=$1) GROUP BY 1,2`, [bid]);
    const garments = [...new Set(rows.filter((x) => x.audience === 'Students').map((x) => x.garment))];
    const pend = {};
    garments.forEach((g) => { pend[g] = batches.reduce((a, b) => { const gv = given.find((x) => x.garment === g && x.batch_id === b.id); return a + Math.max(0, b.students - Number(gv ? gv.qty : 0)); }, 0); });
    res.json({ rows, studentPendingByGarment: pend, totalStudents: batches.reduce((a, b) => a + b.students, 0) });
    return;
  }
  res.json({ rows });
}));

r.get('/store/items/:id', ah(async (req, res) => {
  const it = await one('SELECT * FROM items WHERE id=$1', [req.params.id]);
  if (!it) throw bad('Not found.');
  const bid = scopeBranch(req, req.query.branch_id);
  const stock = await q('SELECT s.branch_id, b.name AS branch, s.qty FROM stock s JOIN branches b ON b.id=s.branch_id WHERE s.item_id=$1 AND ($2::int IS NULL OR s.branch_id=$2) ORDER BY b.id', [it.id, bid]);
  const txns = await q(`SELECT t.*, b.name AS branch, tb.name AS to_branch, ba.name AS batch, u.name AS created_by_name FROM module_txns t
    JOIN branches b ON b.id=t.branch_id LEFT JOIN branches tb ON tb.id=t.to_branch_id LEFT JOIN batches ba ON ba.id=t.batch_id LEFT JOIN users u ON u.id=t.created_by
    WHERE t.item_id=$1 AND ($2::int IS NULL OR t.branch_id=$2 OR t.to_branch_id=$2) ORDER BY t.date DESC, t.id DESC`, [it.id, bid]);
  let batches = [];
  if (it.item_kind === 'module' || (it.item_kind === 'apparel' && it.audience === 'Students')) {
    batches = await q(`SELECT ba.*, br.name AS branch, COALESCE((SELECT SUM(t.qty) FROM module_txns t WHERE t.batch_id=ba.id AND t.item_id=$1 AND t.kind='issue' AND t.status='active'),0) AS given
      FROM batches ba JOIN branches br ON br.id=ba.branch_id WHERE ba.active AND ($2::int IS NULL OR ba.branch_id=$2)
      AND ($3::text IS NULL OR ba.course=$3) AND ($4::text IS NULL OR ba.class_level IS NULL OR ba.class_level=$4) ORDER BY br.id, ba.name`,
    [it.id, bid, it.item_kind === 'module' ? it.course : null, it.item_kind === 'module' ? it.class_level : null]);
  }
  res.json({ item: it, stock, txns, batches });
}));

r.put('/store/items/:id', ah(async (req, res) => {
  if (!(isFinance(req.user) || req.user.role === 'manager')) throw forbidden();
  const b = req.body || {};
  const it = await one('SELECT * FROM items WHERE id=$1', [req.params.id]);
  if (!it) throw bad('Not found.');
  await q('UPDATE items SET min_stock=$2, rate=$3, title=$4, edition=$5, spec=$6, unit=COALESCE($7, unit), active=$8 WHERE id=$1',
    [it.id, num(b.min_stock ?? it.min_stock), num(b.rate ?? it.rate), b.title ?? it.title, b.edition ?? it.edition, b.spec ?? it.spec, clean(b.unit) || null, b.active === undefined ? it.active : !!b.active]);
  await audit(null, 'item', it.id, 'edited', req.user.id, b);
  res.json({ ok: true });
}));

// ---------- transactions ----------
function canTransact(u) { return u && !['guard', 'driver'].includes(u.role); }

r.post('/store/txns', ah(async (req, res) => {
  if (!canTransact(req.user)) throw forbidden();
  const b = req.body || {};
  const kind = b.kind;
  if (!TXN_KINDS.includes(kind)) throw bad('Invalid entry type.');
  const itemKind = KINDS.includes(b.item_kind) ? b.item_kind : 'module';
  const qty = Number(b.qty);
  if (!(qty > 0)) throw bad('Enter quantity / sankhya likhiye.');
  const damaged = num(b.damaged_qty);
  if (damaged < 0 || damaged > qty) throw bad('Damaged copies cannot be more than received / kharab saaman mili hui sankhya se zyada nahi ho sakta.');
  const branchId = userBranch(req, b.branch_id);
  if (!branchId) throw bad('Choose a branch / branch chuniye.');
  if (kind === 'transfer') {
    if (!b.to_branch_id || Number(b.to_branch_id) === branchId) throw bad('Choose a different branch to send to / doosri branch chuniye.');
    if (!(isFinance(req.user) || req.user.role === 'manager')) throw forbidden('Only managers can transfer between branches.');
  }
  if (kind === 'issue' && !b.batch_id && !clean(b.issued_to) && !clean(b.department)) throw bad('Say who received it — batch, student, staff or department / kisko diya, yeh batayein.');
  const id = await tx(async (h) => {
    const it = await findOrCreateItem(h, itemKind, b, req.user);
    if (b.min_stock !== undefined && b.min_stock !== '' && it.item_kind !== 'supply') await h.q('UPDATE items SET min_stock=$2 WHERE id=$1', [it.id, num(b.min_stock)]);
    const t = await h.one(`INSERT INTO module_txns (kind, item_id, branch_id, to_branch_id, batch_id, date, qty, damaged_qty, source, source_name, challan_no, received_by,
        students, remarks, file_id, issued_to, issued_to_type, department, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
    [kind, it.id, branchId, b.to_branch_id || null, b.batch_id || null, b.date || today(), qty, kind === 'receipt' ? damaged : 0, clean(b.source) || null, clean(b.source_name) || null,
      clean(b.challan_no) || null, clean(b.received_by) || null, clean(b.students) || null, clean(b.remarks) || null, b.file_id || null, clean(b.issued_to) || null,
      clean(b.issued_to_type) || null, clean(b.department) || null, req.user.id]);
    await syncStock(h, t, req.user);
    await audit(h, 'store_txn', t.id, 'created', req.user.id, { kind, item: it.name, qty });
    return t.id;
  });
  res.json({ id });
}));

r.get('/store/txns', ah(async (req, res) => {
  const bid = scopeBranch(req, req.query.branch_id);
  const p = [bid];
  let where = 'WHERE ($1::int IS NULL OR t.branch_id=$1 OR t.to_branch_id=$1)';
  const add = (sql, v) => { if (v) { p.push(v); where += sql.replace('?', '$' + p.length); } };
  add(' AND i.item_kind=?', req.query.item_kind); add(' AND t.kind=?', req.query.kind); add(' AND t.item_id=?', req.query.item_id);
  add(' AND t.date>=?', req.query.from); add(' AND t.date<=?', req.query.to); add(' AND t.batch_id=?', req.query.batch_id);
  if (req.query.q) { p.push('%' + req.query.q + '%'); where += ` AND (i.name ILIKE $${p.length} OR COALESCE(t.students,'') ILIKE $${p.length} OR COALESCE(t.issued_to,'') ILIKE $${p.length} OR COALESCE(t.challan_no,'') ILIKE $${p.length} OR COALESCE(t.remarks,'') ILIKE $${p.length})`; }
  if (FIELD_ROLES.includes(req.user.role)) { p.push(req.user.id); where += ` AND t.created_by=$${p.length}`; }
  res.json(await q(`SELECT t.*, i.name AS item, i.item_kind, i.unit, b.name AS branch, tb.name AS to_branch, ba.name AS batch, u.name AS created_by_name, up.name AS updated_by_name
    FROM module_txns t JOIN items i ON i.id=t.item_id JOIN branches b ON b.id=t.branch_id LEFT JOIN branches tb ON tb.id=t.to_branch_id LEFT JOIN batches ba ON ba.id=t.batch_id
    LEFT JOIN users u ON u.id=t.created_by LEFT JOIN users up ON up.id=t.updated_by ${where} ORDER BY t.date DESC, t.id DESC LIMIT ${Math.min(Number(req.query.limit) || 500, 3000)}`, p));
}));

const EDITABLE = ['date', 'qty', 'damaged_qty', 'source', 'source_name', 'challan_no', 'received_by', 'students', 'remarks', 'file_id', 'issued_to', 'issued_to_type', 'department', 'batch_id', 'to_branch_id'];
r.put('/store/txns/:id', ah(async (req, res) => {
  const b = req.body || {};
  const reason = clean(b.reason);
  if (!reason) throw bad('Give a reason for this edit / badlav ka kaaran likhiye.');
  await tx(async (h) => {
    const t = await h.one('SELECT * FROM module_txns WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!t) throw bad('Not found.');
    if (t.status !== 'active') throw bad('This entry is cancelled.');
    if (t.created_by !== req.user.id && !isReviewer(req.user)) throw forbidden();
    if (!seesAll(req.user) && t.branch_id !== req.user.branch_id) throw forbidden();
    const next = { ...t };
    EDITABLE.forEach((k) => { if (b[k] !== undefined) next[k] = b[k] === '' ? null : b[k]; });
    next.qty = Number(next.qty); next.damaged_qty = Number(next.damaged_qty || 0);
    if (!(next.qty > 0)) throw bad('Quantity must be above zero.');
    if (next.damaged_qty > next.qty) throw bad('Damaged cannot exceed quantity.');
    await h.q(`UPDATE module_txns SET ${EDITABLE.map((k, i) => `${k}=$${i + 2}`).join(',')}, updated_by=$${EDITABLE.length + 2}, updated_at=now() WHERE id=$1`,
      [t.id, ...EDITABLE.map((k) => next[k]), req.user.id]);
    await syncStock(h, next, req.user);
    await audit(h, 'store_txn', t.id, 'edited', req.user.id, { before: t, after: b }, reason);
  });
  res.json({ ok: true });
}));

r.post('/store/txns/:id/cancel', ah(async (req, res) => {
  const reason = clean((req.body || {}).reason);
  if (!reason) throw bad('Give a reason / kaaran likhiye.');
  await tx(async (h) => {
    const t = await h.one('SELECT * FROM module_txns WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!t) throw bad('Not found.');
    if (t.status !== 'active') throw bad('Already cancelled.');
    const sameDayOwn = t.created_by === req.user.id && (await h.one('SELECT created_at::date = CURRENT_DATE AS d FROM module_txns WHERE id=$1', [t.id])).d;
    if (!isReviewer(req.user) && !sameDayOwn) throw forbidden('Ask your manager to cancel this entry.');
    const next = { ...t, status: 'cancelled' };
    await syncStock(h, next, req.user);
    await h.q("UPDATE module_txns SET status='cancelled', cancel_reason=$2, updated_by=$3, updated_at=now() WHERE id=$1", [t.id, reason, req.user.id]);
    await audit(h, 'store_txn', t.id, 'cancelled', req.user.id, null, reason);
  });
  res.json({ ok: true });
}));

// ---------- module grid (Course → Class → Subject × Module no.) ----------
r.get('/store/grid', ah(async (req, res) => {
  const bid = scopeBranch(req, req.query.branch_id);
  const cfg = await config();
  const course = req.query.course || cfg.module.courses[0].name;
  const session = req.query.session || cfg.session;
  const rows = await q(`SELECT i.id, i.class_level, i.subject, i.module_no, i.min_stock,
      COALESCE((SELECT SUM(qty) FROM stock s WHERE s.item_id=i.id AND ($3::int IS NULL OR s.branch_id=$3)),0) AS in_hand,
      COALESCE((SELECT SUM(t.qty) FROM module_txns t WHERE t.item_id=i.id AND t.kind='receipt' AND t.status='active' AND ($3::int IS NULL OR t.branch_id=$3)),0) AS received,
      COALESCE((SELECT SUM(t.qty) FROM module_txns t WHERE t.item_id=i.id AND t.kind='issue' AND t.status='active' AND ($3::int IS NULL OR t.branch_id=$3)),0) AS issued
    FROM items i WHERE i.item_kind='module' AND i.active AND i.course=$1 AND i.session=$2 ORDER BY i.class_level, i.subject, i.module_no`, [course, session, bid]);
  const batches = await q('SELECT * FROM batches WHERE active AND course=$1 AND (session IS NULL OR session=$2) AND ($3::int IS NULL OR branch_id=$3)', [course, session, bid]);
  const given = await q(`SELECT t.item_id, t.batch_id, SUM(t.qty) AS qty FROM module_txns t WHERE t.kind='issue' AND t.status='active' AND t.batch_id IS NOT NULL GROUP BY 1,2`);
  rows.forEach((it) => {
    const bs = batches.filter((b) => !b.class_level || b.class_level === it.class_level);
    it.students = bs.reduce((a, b) => a + b.students, 0);
    it.pending = bs.reduce((a, b) => { const g = given.find((x) => x.item_id === it.id && x.batch_id === b.id); return a + Math.max(0, b.students - Number(g ? g.qty : 0)); }, 0);
  });
  res.json({ course, session, rows });
}));

// ---------- batches ----------
r.get('/batches', ah(async (req, res) => {
  const bid = scopeBranch(req, req.query.branch_id);
  res.json(await q(`SELECT ba.*, br.name AS branch FROM batches ba JOIN branches br ON br.id=ba.branch_id WHERE ($1::int IS NULL OR ba.branch_id=$1) ORDER BY ba.active DESC, br.id, ba.course, ba.class_level, ba.name`, [bid]));
}));
const BF = ['branch_id', 'name', 'course', 'class_level', 'session', 'language', 'students', 'active'];
r.post('/batches', ah(async (req, res) => {
  if (!isReviewer(req.user) && req.user.role !== 'staff') throw forbidden();
  const b = req.body || {};
  if (!clean(b.name) || !clean(b.course)) throw bad('Batch name and course are required / batch ka naam aur course zaroori hai.');
  const branchId = userBranch(req, b.branch_id);
  const row = await one(`INSERT INTO batches (branch_id, name, course, class_level, session, language, students, active) VALUES ($1,$2,$3,$4,$5,$6,$7,TRUE) RETURNING id`,
    [branchId, clean(b.name), b.course, clean(b.class_level) || null, clean(b.session) || (await config()).session, clean(b.language) || null, Math.max(0, parseInt(b.students, 10) || 0)]);
  await audit(null, 'batch', row.id, 'created', req.user.id, b);
  res.json(row);
}));
r.put('/batches/:id', ah(async (req, res) => {
  if (!isReviewer(req.user) && req.user.role !== 'staff') throw forbidden();
  const b = req.body || {};
  const cur = await one('SELECT * FROM batches WHERE id=$1', [req.params.id]);
  if (!cur) throw bad('Not found.');
  const v = BF.map((k) => (b[k] === undefined ? cur[k] : (k === 'students' ? Math.max(0, parseInt(b[k], 10) || 0) : (k === 'active' ? !!b[k] : (b[k] === '' ? null : b[k])))));
  await q(`UPDATE batches SET ${BF.map((k, i) => `${k}=$${i + 2}`).join(',')} WHERE id=$1`, [cur.id, ...v]);
  await audit(null, 'batch', cur.id, 'edited', req.user.id, b);
  res.json({ ok: true });
}));

// ---------- student / person lookup ----------
r.get('/store/lookup', ah(async (req, res) => {
  const term = clean(req.query.q);
  if (term.length < 2) return res.json([]);
  const bid = scopeBranch(req, req.query.branch_id);
  res.json(await q(`SELECT t.id, t.date, t.qty, t.kind, t.issued_to, t.issued_to_type, t.department, t.students, i.name AS item, i.item_kind, ba.name AS batch, b.name AS branch
    FROM module_txns t JOIN items i ON i.id=t.item_id JOIN branches b ON b.id=t.branch_id LEFT JOIN batches ba ON ba.id=t.batch_id
    WHERE t.status='active' AND t.kind='issue' AND (COALESCE(t.students,'') ILIKE $1 OR COALESCE(t.issued_to,'') ILIKE $1) AND ($2::int IS NULL OR t.branch_id=$2)
    ORDER BY t.date DESC LIMIT 200`, ['%' + term + '%', bid]));
}));

// ---------- summary for the store home ----------
r.get('/store/summary', ah(async (req, res) => {
  const bid = scopeBranch(req, req.query.branch_id);
  const rows = await q(`SELECT i.item_kind, COUNT(DISTINCT i.id)::int AS items,
      COALESCE(SUM((SELECT SUM(qty) FROM stock s WHERE s.item_id=i.id AND ($1::int IS NULL OR s.branch_id=$1))),0) AS in_hand,
      COUNT(*) FILTER (WHERE i.min_stock>0 AND COALESCE((SELECT SUM(qty) FROM stock s WHERE s.item_id=i.id AND ($1::int IS NULL OR s.branch_id=$1)),0) < i.min_stock)::int AS low
    FROM items i WHERE i.active AND i.item_kind IN ('module','apparel','supply') GROUP BY 1`, [bid]);
  const month = await q(`SELECT i.item_kind, t.kind, SUM(t.qty) AS qty FROM module_txns t JOIN items i ON i.id=t.item_id
    WHERE t.status='active' AND t.date >= date_trunc('month', CURRENT_DATE) AND ($1::int IS NULL OR t.branch_id=$1) GROUP BY 1,2`, [bid]);
  res.json({ rows, month });
}));

module.exports = r;
