const express = require('express');
const { q, one, tx } = require('../db');
const { ah, bad, forbidden, branchFilter, userBranch, isMgmt, isFinance, isReviewer, FIELD_ROLES, audit, today, nowIST } = require('../lib');
const { moveStock, stockOf } = require('../finance');

const r = express.Router();
const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'time', 'datetime', 'select', 'multiselect', 'checkbox', 'yesno', 'currency', 'phone', 'email',
  'file', 'image', 'signature', 'user', 'vehicle', 'asset', 'item', 'checklist'];

// ---------- Register definitions ----------
r.get('/registers', ah(async (req, res) => {
  const rows = await q("SELECT * FROM register_defs WHERE status<>'deleted' ORDER BY sort, name");
  res.json(rows);
}));
r.get('/registers/:key', ah(async (req, res) => {
  const d = await one('SELECT * FROM register_defs WHERE key=$1 OR id::text=$1', [req.params.key]);
  if (!d) throw bad('Register not found.');
  res.json(d);
}));

function cleanFields(fields) {
  if (!Array.isArray(fields) || !fields.length) throw bad('Add at least one field.');
  const seen = new Set();
  return fields.map((f, i) => {
    const label = String(f.label || '').trim();
    if (!label) throw bad(`Field ${i + 1} needs a label.`);
    if (!FIELD_TYPES.includes(f.type)) throw bad(`Field "${label}" has an unknown type.`);
    let key = String(f.key || label).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'field_' + i;
    while (seen.has(key)) key += '_2';
    seen.add(key);
    const out = { key, label, type: f.type, required: !!f.required };
    if (['select', 'multiselect', 'checklist'].includes(f.type)) {
      const opts = (Array.isArray(f.options) ? f.options : String(f.options || '').split(',')).map((s) => String(s).trim()).filter(Boolean);
      if (!opts.length) throw bad(`Field "${label}" needs options.`);
      out.options = opts;
    }
    ['showIf', 'defaultNow', 'maxLength', 'default', 'hi'].forEach((k) => { if (f[k] !== undefined && f[k] !== null && f[k] !== '') out[k] = f[k]; });
    return out;
  });
}

r.post('/registers', ah(async (req, res) => {
  if (!isMgmt(req.user)) throw forbidden('Only Owner/Admin can create registers.');
  const b = req.body || {};
  if (!String(b.name || '').trim()) throw bad('Register name is required.');
  const fields = cleanFields(b.fields);
  let key = String(b.name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40);
  if (await one('SELECT id FROM register_defs WHERE key=$1', [key])) key += '_' + Date.now().toString(36).slice(-4);
  const row = await one(`INSERT INTO register_defs (key, name, description, department, responsible_role, frequency, deadline, fields, important, branch_id, status, sort)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,200) RETURNING *`,
  [key, b.name.trim(), b.description || null, b.department || null, b.responsible_role || null, b.frequency || 'as_needed', b.deadline || null,
    JSON.stringify(fields), !!b.important, b.branch_id || null, b.status || 'active']);
  await audit(null, 'register_def', row.id, 'created', req.user.id, { name: row.name });
  res.json(row);
}));
r.put('/registers/:id', ah(async (req, res) => {
  if (!isMgmt(req.user)) throw forbidden('Only Owner/Admin can change registers.');
  const b = req.body || {};
  const before = await one('SELECT * FROM register_defs WHERE id=$1', [req.params.id]);
  if (!before) throw bad('Not found.');
  const fields = b.fields ? cleanFields(b.fields) : before.fields;
  const row = await one(`UPDATE register_defs SET name=$2, description=$3, department=$4, responsible_role=$5, frequency=$6, deadline=$7, fields=$8, important=$9, branch_id=$10, status=$11, sort=$12
    WHERE id=$1 RETURNING *`, [before.id, b.name || before.name, b.description ?? before.description, b.department ?? before.department,
    b.responsible_role ?? before.responsible_role, b.frequency || before.frequency, b.deadline === undefined ? before.deadline : (b.deadline || null),
    JSON.stringify(fields), b.important === undefined ? before.important : !!b.important, b.branch_id === undefined ? before.branch_id : (b.branch_id || null),
    b.status || before.status, b.sort === undefined ? before.sort : Number(b.sort)]);
  await audit(null, 'register_def', row.id, 'edited', req.user.id, { before: before.fields, after: fields });
  res.json(row);
}));

// ---------- Register entries ----------
function validateData(def, data) {
  const out = {};
  for (const f of def.fields) {
    const visible = !f.showIf || (f.showIf.equals !== undefined ? data[f.showIf.field] === f.showIf.equals : (f.showIf.in || []).includes(data[f.showIf.field]));
    let v = data[f.key];
    if (!visible) continue;
    if (f.type === 'checklist') {
      v = v && typeof v === 'object' ? v : {};
      const res = {};
      for (const opt of f.options || []) {
        const it = v[opt] || {};
        const st = it.status || '';
        if (f.required && !st) throw bad(`"${f.label}": mark every check (${opt}).`);
        if (st === 'Not Completed' && !String(it.remark || '').trim()) throw bad(`"${opt}" was not completed — add a remark.`);
        if (st) res[opt] = { status: st, remark: it.remark || '' };
      }
      if (Object.keys(res).length) out[f.key] = res;
      continue;
    }
    const empty = v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length);
    if (empty) {
      if (f.required) throw bad(`"${f.label}" is required.`);
      continue;
    }
    if (['number', 'currency'].includes(f.type)) { v = Number(v); if (Number.isNaN(v)) throw bad(`"${f.label}" must be a number.`); }
    if (f.type === 'phone' && !/^[+\d][\d\s-]{6,15}$/.test(String(v))) throw bad(`"${f.label}" is not a valid phone number.`);
    if (f.type === 'email' && !/^\S+@\S+\.\S+$/.test(String(v))) throw bad(`"${f.label}" is not a valid email.`);
    if (f.maxLength && String(v).length > f.maxLength) throw bad(`"${f.label}" allows at most ${f.maxLength} characters.`);
    if (f.type === 'select' && f.options && !f.options.includes(v)) throw bad(`"${f.label}": choose from the list.`);
    out[f.key] = typeof v === 'string' ? v.slice(0, 4000) : v;
  }
  return out;
}

async function syncInventory(h, def, entry, user) {
  if (def.key !== 'inward_outward') return;
  const d = entry.data;
  const want = d.item && (d.update_inventory === 'Yes' || d.update_inventory === true) ? (d.direction === 'Outward' ? -1 : 1) * Number(d.quantity || 0) : 0;
  const prev = await h.q("SELECT item_id, SUM(qty) AS qty FROM stock_movements WHERE ref_type='register_entry' AND ref_id=$1 GROUP BY item_id", [entry.id]);
  for (const m of prev) {
    if (Number(m.qty) !== 0 && (!d.item || Number(d.item) !== m.item_id || want === 0)) {
      await moveStock(h, { item_id: m.item_id, branch_id: entry.branch_id, qty: -Number(m.qty), type: 'adjustment', ref_type: 'register_entry', ref_id: entry.id, remarks: 'Inward/outward entry changed', user_id: user.id });
    }
  }
  if (want !== 0) {
    const cur = prev.find((m) => m.item_id === Number(d.item));
    const diff = want - (cur ? Number(cur.qty) : 0);
    if (diff !== 0) {
      await moveStock(h, { item_id: Number(d.item), branch_id: entry.branch_id, qty: diff, type: d.direction === 'Outward' ? 'outward' : 'inward', ref_type: 'register_entry', ref_id: entry.id, issued_to: d.receiver || null, remarks: `Gate ${d.direction}${d.gate_pass_number ? ' GP ' + d.gate_pass_number : ''}`, user_id: user.id });
    }
  }
}

r.get('/entries', ah(async (req, res) => {
  const p = [];
  let where = 'WHERE 1=1' + branchFilter(req, 'e', p);
  if (req.query.register) { p.push(req.query.register); where += ` AND (d.key=$${p.length} OR d.id::text=$${p.length})`; }
  if (req.query.status) { p.push(req.query.status); where += ` AND e.status=$${p.length}`; }
  if (req.query.from) { p.push(req.query.from); where += ` AND e.entry_date >= $${p.length}`; }
  if (req.query.to) { p.push(req.query.to); where += ` AND e.entry_date <= $${p.length}`; }
  if (req.query.mine || FIELD_ROLES.includes(req.user.role)) { p.push(req.user.id); where += ` AND e.created_by=$${p.length}`; }
  if (req.query.open_visitors) where += " AND d.key='visitor' AND COALESCE(e.data->>'exit_time','')=''";
  if (req.query.q) { p.push('%' + req.query.q + '%'); where += ` AND e.data::text ILIKE $${p.length}`; }
  // Field filters: f_<fieldkey>=value matches the stored answer exactly (e.g. f_purpose=Admission enquiry)
  Object.keys(req.query).filter((k) => /^f_[a-z0-9_]{1,40}$/.test(k) && req.query[k] !== '').forEach((k) => {
    p.push(k.slice(2)); p.push(String(req.query[k]));
    where += ` AND e.data->>$${p.length - 1} = $${p.length}`;
  });
  // Any admission-related visit (purpose or details mention admission / enquiry)
  if (req.query.enquiry) where += " AND (COALESCE(e.data->>'purpose','') ILIKE '%admission%' OR COALESCE(e.data->>'purpose_details','') ILIKE '%admission%')";
  res.json(await q(`SELECT e.*, d.key AS register_key, d.name AS register_name, b.name AS branch, u.name AS created_by_name, vu.name AS verified_by_name,
      (SELECT COUNT(*)::int FROM register_history hh WHERE hh.entry_id=e.id) AS edits
    FROM register_entries e JOIN register_defs d ON d.id=e.register_id LEFT JOIN branches b ON b.id=e.branch_id
    LEFT JOIN users u ON u.id=e.created_by LEFT JOIN users vu ON vu.id=e.verified_by ${where} ORDER BY e.entry_date DESC, e.id DESC LIMIT ${Math.min(Number(req.query.limit) || 300, 2000)}`, p));
}));

r.get('/entries/:id', ah(async (req, res) => {
  const e = await one(`SELECT e.*, d.key AS register_key, d.name AS register_name, d.fields, d.important, b.name AS branch, u.name AS created_by_name,
      up.name AS updated_by_name, vu.name AS verified_by_name
    FROM register_entries e JOIN register_defs d ON d.id=e.register_id LEFT JOIN branches b ON b.id=e.branch_id LEFT JOIN users u ON u.id=e.created_by
    LEFT JOIN users up ON up.id=e.updated_by LEFT JOIN users vu ON vu.id=e.verified_by WHERE e.id=$1`, [req.params.id]);
  if (!e) throw bad('Not found.');
  if (!isFinance(req.user) && e.branch_id !== req.user.branch_id) throw forbidden();
  if (!isReviewer(req.user) && e.created_by !== req.user.id && FIELD_ROLES.includes(req.user.role)) throw forbidden();
  e.history = await q('SELECT h.*, u.name AS edited_by_name FROM register_history h LEFT JOIN users u ON u.id=h.edited_by WHERE entry_id=$1 ORDER BY edited_at DESC', [e.id]);
  res.json(e);
}));

r.post('/entries', ah(async (req, res) => {
  const b = req.body || {};
  const def = await one("SELECT * FROM register_defs WHERE (key=$1 OR id::text=$1) AND status='active'", [String(b.register)]);
  if (!def) throw bad('Register not found or inactive.');
  const data = validateData(def, b.data || {});
  const branchId = userBranch(req, b.branch_id);
  if (!branchId) throw bad('Your account has no branch. Ask the admin to set one.');
  const id = await tx(async (h) => {
    const e = await h.one('INSERT INTO register_entries (register_id, branch_id, entry_date, data, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [def.id, branchId, b.entry_date || today(), JSON.stringify(data), req.user.id]);
    await syncInventory(h, def, e, req.user);
    await audit(h, 'register_entry', e.id, 'created', req.user.id, { register: def.key });
    return e.id;
  });
  res.json({ id });
}));

r.put('/entries/:id', ah(async (req, res) => {
  const b = req.body || {};
  const reason = String(b.reason || '').trim();
  if (!reason) throw bad('Give a reason for this edit. Every change is recorded.');
  await tx(async (h) => {
    const e = await h.one('SELECT * FROM register_entries WHERE id=$1 FOR UPDATE', [req.params.id]);
    if (!e) throw bad('Not found.');
    const def = await h.one('SELECT * FROM register_defs WHERE id=$1', [e.register_id]);
    const own = e.created_by === req.user.id;
    if (!own && !isReviewer(req.user)) throw forbidden();
    if (!isFinance(req.user) && e.branch_id !== req.user.branch_id) throw forbidden();
    if (own && !isReviewer(req.user) && e.status === 'verified') throw forbidden('This entry is verified. Ask the admin to make changes.');
    const data = validateData(def, Object.assign({}, e.data, b.data || {}));
    await h.q('INSERT INTO register_history (entry_id, old_data, new_data, reason, edited_by) VALUES ($1,$2,$3,$4,$5)', [e.id, JSON.stringify(e.data), JSON.stringify(data), reason, req.user.id]);
    const newStatus = e.status === 'returned' && own ? 'submitted' : e.status;
    await h.q('UPDATE register_entries SET data=$2, entry_date=COALESCE($3, entry_date), updated_by=$4, updated_at=now(), status=$5 WHERE id=$1',
      [e.id, JSON.stringify(data), b.entry_date || null, req.user.id, newStatus]);
    await syncInventory(h, def, Object.assign({}, e, { data }), req.user);
  });
  res.json({ ok: true });
}));

// Visitor check-out / key return quick actions
r.post('/entries/:id/checkout', ah(async (req, res) => {
  const e = await one('SELECT e.*, d.key FROM register_entries e JOIN register_defs d ON d.id=e.register_id WHERE e.id=$1', [req.params.id]);
  if (!e) throw bad('Not found.');
  if (!isFinance(req.user) && e.branch_id !== req.user.branch_id) throw forbidden();
  const field = e.key === 'visitor' ? 'exit_time' : (e.key === 'key' ? 'returned_at' : (e.key === 'equipment_handover' ? 'return_time' : null));
  if (!field) throw bad('Not supported for this register.');
  const data = Object.assign({}, e.data, { [field]: nowIST() });
  if (e.key === 'key') data.key_status = 'Available';
  await q('INSERT INTO register_history (entry_id, old_data, new_data, reason, edited_by) VALUES ($1,$2,$3,$4,$5)', [e.id, JSON.stringify(e.data), JSON.stringify(data), e.key === 'visitor' ? 'Checked out' : 'Returned', req.user.id]);
  await q('UPDATE register_entries SET data=$2, updated_by=$3, updated_at=now() WHERE id=$1', [e.id, JSON.stringify(data), req.user.id]);
  res.json({ ok: true });
}));

r.post('/entries/:id/status', ah(async (req, res) => {
  if (!isReviewer(req.user)) throw forbidden('Only managers and admins can review registers.');
  const { status, note } = req.body || {};
  if (!['reviewed', 'verified', 'returned', 'submitted'].includes(status)) throw bad('Invalid status.');
  if (status === 'returned' && !note) throw bad('Say what needs correcting.');
  const e = await one('SELECT * FROM register_entries WHERE id=$1', [req.params.id]);
  if (!e) throw bad('Not found.');
  if (!isFinance(req.user) && e.branch_id !== req.user.branch_id) throw forbidden();
  await q(`UPDATE register_entries SET status=$2, review_note=$3, verified_by=CASE WHEN $2 IN ('verified','reviewed') THEN $4 ELSE verified_by END,
    verified_at=CASE WHEN $2 IN ('verified','reviewed') THEN now() ELSE verified_at END WHERE id=$1`, [e.id, status, note || null, req.user.id]);
  await audit(null, 'register_entry', e.id, status, req.user.id, null, note);
  res.json({ ok: true });
}));

r.post('/entries/bulk-status', ah(async (req, res) => {
  if (!isReviewer(req.user)) throw forbidden();
  const { ids, status } = req.body || {};
  if (!['reviewed', 'verified'].includes(status) || !Array.isArray(ids)) throw bad('Invalid.');
  const p = [ids.map(Number), status, req.user.id];
  let extra = '';
  if (!isFinance(req.user)) { p.push(req.user.branch_id); extra = ' AND branch_id=$4'; }
  await q(`UPDATE register_entries SET status=$2, verified_by=$3, verified_at=now() WHERE id = ANY($1)${extra}`, p);
  res.json({ ok: true });
}));

// Quick issue report (photo-first / free text / voice)
function parseIssue(text) {
  const t = String(text || '').trim();
  const locRe = /\b((?:class\s?room|classroom|room|washroom|toilet|lab|office|pantry|reception|corridor|store|library|hall|floor|staff room|waiting area)\s*[-#]?\s*\w{0,4})/i;
  const m = locRe.exec(t);
  const location = m ? m[1].replace(/\s+/g, ' ').trim().replace(/^\w/, (c) => c.toUpperCase()) : '';
  let issue = t.split(/[.!\n]/)[0];
  if (location) issue = issue.replace(new RegExp('\\s*(in|at|of)?\\s*' + m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), '');
  issue = issue.replace(/\s+(and|which)\s+(needs|need|requires).*$/i, '').trim();
  const urgent = /(urgent|fire|spark|shock|leak|flood|broken glass|danger|smoke)/i.test(t);
  return { issue: (issue || t).slice(0, 120).replace(/^\w/, (c) => c.toUpperCase()), location, description: t, priority: urgent ? 'High' : 'Medium' };
}
r.post('/quick-issue/parse', ah(async (req, res) => res.json(parseIssue((req.body || {}).text))));
r.post('/quick-issue', ah(async (req, res) => {
  const b = req.body || {};
  if (!String(b.text || '').trim() && !b.photo) throw bad('Describe the issue or add a photo.');
  const def = await one("SELECT * FROM register_defs WHERE key='maintenance'");
  const parsed = parseIssue(b.text || 'Issue reported with photo');
  const data = { issue: b.issue || parsed.issue, location: b.location || parsed.location, priority: b.priority || parsed.priority, description: parsed.description, issue_status: 'Open' };
  if (b.photo) data.photo = b.photo;
  const branchId = userBranch(req, b.branch_id);
  const e = await one('INSERT INTO register_entries (register_id, branch_id, entry_date, data, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [def.id, branchId, today(), JSON.stringify(data), req.user.id]);
  res.json({ id: e.id, data });
}));

// ---------- Inventory ----------
r.get('/inventory/stock', ah(async (req, res) => {
  const p = [];
  const bf = branchFilter(req, 's', p);
  const rows = await q(`SELECT i.id, i.name, i.sku, i.category, i.unit, i.min_stock, i.rate, s.branch_id, b.name AS branch, COALESCE(s.qty,0) AS qty
    FROM items i JOIN stock s ON s.item_id=i.id LEFT JOIN branches b ON b.id=s.branch_id WHERE i.active ${bf} ORDER BY i.name, b.name`, p);
  const items = await q('SELECT id, name, sku, category, unit, min_stock, rate FROM items WHERE active ORDER BY name');
  res.json({ rows, items });
}));
r.get('/inventory/movements', ah(async (req, res) => {
  const p = [];
  let where = 'WHERE 1=1' + branchFilter(req, 'm', p);
  if (req.query.item_id) { p.push(req.query.item_id); where += ` AND m.item_id=$${p.length}`; }
  if (req.query.type) { p.push(req.query.type); where += ` AND m.type=$${p.length}`; }
  if (req.query.from) { p.push(req.query.from); where += ` AND m.created_at >= $${p.length}`; }
  if (req.query.to) { p.push(req.query.to); where += ` AND m.created_at < ($${p.length}::date + 1)`; }
  res.json(await q(`SELECT m.*, i.name AS item, i.unit, b.name AS branch, u.name AS created_by_name FROM stock_movements m JOIN items i ON i.id=m.item_id
    LEFT JOIN branches b ON b.id=m.branch_id LEFT JOIN users u ON u.id=m.created_by ${where} ORDER BY m.created_at DESC LIMIT 500`, p));
}));
r.post('/inventory/move', ah(async (req, res) => {
  const b = req.body || {};
  const types = { issue: -1, return: 1, adjustment: 0, loss: -1, damage: -1, opening: 1 };
  if (!(b.type in types)) throw bad('Choose a movement type.');
  if (!['issue', 'return'].includes(b.type) && !(isFinance(req.user) || req.user.role === 'manager')) throw forbidden('Only managers can adjust stock.');
  const qty = Number(b.qty);
  if (!qty || (b.type !== 'adjustment' && qty < 0)) throw bad('Enter a quantity.');
  const branchId = userBranch(req, b.branch_id);
  const signed = b.type === 'adjustment' ? qty : types[b.type] * Math.abs(qty);
  await tx(async (h) => {
    const cur = await stockOf(h, Number(b.item_id), branchId);
    if (cur + signed < 0) throw bad(`Only ${cur} in stock at this branch.`);
    await moveStock(h, { item_id: Number(b.item_id), branch_id: branchId, qty: signed, type: b.type, ref_type: 'manual', issued_to: b.issued_to, remarks: b.remarks, user_id: req.user.id });
  });
  res.json({ ok: true });
}));

// ---------- Tasks ----------
r.get('/tasks', ah(async (req, res) => {
  const p = [];
  let where = 'WHERE 1=1' + branchFilter(req, 't', p);
  if (FIELD_ROLES.includes(req.user.role) || req.query.mine) { p.push(req.user.id); where += ` AND (t.assigned_to=$${p.length} OR t.requested_by=$${p.length})`; }
  if (req.query.status) { p.push(req.query.status); where += ` AND t.status=$${p.length}`; }
  if (req.query.overdue) where += " AND t.status IN ('pending','in_progress') AND t.due_date < CURRENT_DATE";
  res.json(await q(`SELECT t.*, a.name AS assigned_to_name, rq.name AS requested_by_name, b.name AS branch FROM tasks t LEFT JOIN users a ON a.id=t.assigned_to
    LEFT JOIN users rq ON rq.id=t.requested_by LEFT JOIN branches b ON b.id=t.branch_id ${where}
    ORDER BY CASE t.status WHEN 'in_progress' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END, CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.due_date NULLS LAST, t.id DESC LIMIT 500`, p));
}));
r.post('/tasks', ah(async (req, res) => {
  const b = req.body || {};
  if (!String(b.title || '').trim()) throw bad('Task title is required.');
  const assigned = FIELD_ROLES.includes(req.user.role) ? req.user.id : (b.assigned_to || null);
  const row = await one(`INSERT INTO tasks (title, description, category, branch_id, assigned_to, requested_by, priority, status, due_date, remarks, attachment_id)
    VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9,$10) RETURNING id`, [b.title.trim(), b.description || null, b.category || null, userBranch(req, b.branch_id),
    assigned, req.user.id, b.priority || 'normal', b.due_date || null, b.remarks || null, b.attachment_id || null]);
  await audit(null, 'task', row.id, 'created', req.user.id, { title: b.title });
  res.json(row);
}));
r.put('/tasks/:id', ah(async (req, res) => {
  const b = req.body || {};
  const t = await one('SELECT * FROM tasks WHERE id=$1', [req.params.id]);
  if (!t) throw bad('Not found.');
  const involved = t.assigned_to === req.user.id || t.requested_by === req.user.id;
  if (!involved && !isReviewer(req.user)) throw forbidden();
  const status = b.status || t.status;
  const started = status === 'in_progress' && !t.started_at ? 'now()' : 'started_at';
  const done = status === 'done' && t.status !== 'done' ? 'now()' : (status === 'done' ? 'completed_at' : 'NULL');
  const canEditAll = isReviewer(req.user) || t.requested_by === req.user.id;
  await q(`UPDATE tasks SET title=$2, description=$3, category=$4, assigned_to=$5, priority=$6, status=$7, due_date=$8, remarks=$9, attachment_id=COALESCE($10, attachment_id),
    started_at=${started}, completed_at=${done} WHERE id=$1`, [t.id,
    canEditAll ? (b.title || t.title) : t.title, canEditAll ? (b.description ?? t.description) : t.description, canEditAll ? (b.category ?? t.category) : t.category,
    canEditAll ? (b.assigned_to === undefined ? t.assigned_to : (b.assigned_to || null)) : t.assigned_to, canEditAll ? (b.priority || t.priority) : t.priority,
    status, canEditAll ? (b.due_date === undefined ? t.due_date : (b.due_date || null)) : t.due_date, b.remarks ?? t.remarks, b.attachment_id || null]);
  await audit(null, 'task', t.id, 'edited', req.user.id, { status });
  res.json({ ok: true });
}));

// ---------- Documents / compliance ----------
r.get('/documents', ah(async (req, res) => {
  if (!isReviewer(req.user)) throw forbidden();
  const p = [];
  let where = 'WHERE 1=1';
  if (!isFinance(req.user)) { p.push(req.user.branch_id); where += ` AND (d.branch_id=$${p.length} OR d.branch_id IS NULL)`; }
  if (req.query.expiring) { p.push(Number(req.query.expiring)); where += ` AND d.expires_on IS NOT NULL AND d.expires_on <= CURRENT_DATE + $${p.length}::int`; }
  res.json(await q(`SELECT d.*, b.name AS branch, v.name AS vendor, f.name AS file_name, (d.expires_on - CURRENT_DATE) AS days_left FROM documents d
    LEFT JOIN branches b ON b.id=d.branch_id LEFT JOIN vendors v ON v.id=d.vendor_id LEFT JOIN files f ON f.id=d.file_id ${where} ORDER BY d.expires_on NULLS LAST, d.title`, p));
}));
const DOC_FIELDS = ['title', 'doc_type', 'branch_id', 'number', 'vendor_id', 'issued_on', 'expires_on', 'file_id', 'notes'];
r.post('/documents', ah(async (req, res) => {
  if (!isReviewer(req.user)) throw forbidden();
  const b = req.body || {};
  if (!b.title) throw bad('Title is required.');
  const row = await one(`INSERT INTO documents (${DOC_FIELDS.join(',')}, created_by) VALUES (${DOC_FIELDS.map((_, i) => '$' + (i + 1)).join(',')}, $10) RETURNING id`,
    [...DOC_FIELDS.map((f) => (b[f] === '' ? null : b[f] ?? null)), req.user.id]);
  await audit(null, 'document', row.id, 'created', req.user.id, { title: b.title });
  res.json(row);
}));
r.put('/documents/:id', ah(async (req, res) => {
  if (!isReviewer(req.user)) throw forbidden();
  const b = req.body || {};
  await q(`UPDATE documents SET ${DOC_FIELDS.map((f, i) => `${f}=$${i + 2}`).join(',')} WHERE id=$1`, [req.params.id, ...DOC_FIELDS.map((f) => (b[f] === '' ? null : b[f] ?? null))]);
  await audit(null, 'document', Number(req.params.id), 'edited', req.user.id, b);
  res.json({ ok: true });
}));

module.exports = r;
