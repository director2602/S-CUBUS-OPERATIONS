const express = require('express');
const { q, one } = require('../db');
const { ah, bad, forbidden, branchFilter, userBranch, isFinance, isReviewer, FIELD_ROLES, getSettings } = require('../lib');
const F = require('../finance');

const r = express.Router();

r.get('/finance/meta', ah(async (req, res) => {
  const s = await getSettings();
  res.json({ modes: F.MODES, voucherTypes: F.VOUCHER_TYPES, managerLimit: Number(s.manager_approval_limit || 0) });
}));

// ---------- Purchases ----------
r.get('/purchases', ah(async (req, res) => {
  const p = [];
  let where = 'WHERE 1=1' + branchFilter(req, 'p', p);
  if (FIELD_ROLES.includes(req.user.role) || req.user.role === 'staff') { p.push(req.user.id); where += ` AND p.created_by=$${p.length}`; }
  if (req.query.status) { p.push(req.query.status); where += ` AND p.status=$${p.length}`; }
  if (req.query.mode) { p.push(req.query.mode); where += ` AND p.payment_mode=$${p.length}`; }
  if (req.query.payment_status) { p.push(req.query.payment_status); where += ` AND p.payment_status=$${p.length} AND p.status='approved'`; }
  if (req.query.vendor_id) { p.push(req.query.vendor_id); where += ` AND p.vendor_id=$${p.length}`; }
  if (req.query.from) { p.push(req.query.from); where += ` AND p.date >= $${p.length}`; }
  if (req.query.to) { p.push(req.query.to); where += ` AND p.date <= $${p.length}`; }
  if (req.query.q) { p.push('%' + req.query.q + '%'); where += ` AND (p.purchase_no ILIKE $${p.length} OR p.description ILIKE $${p.length} OR v.name ILIKE $${p.length} OR p.vendor_name ILIKE $${p.length} OR p.bill_no ILIKE $${p.length})`; }
  res.json(await q(`SELECT p.*, COALESCE(v.name, p.vendor_name) AS vendor, b.name AS branch, c.name AS category, u.name AS created_by_name,
      (SELECT voucher_no FROM vouchers WHERE purchase_id=p.id AND purpose='purchase' AND status<>'cancelled' ORDER BY id DESC LIMIT 1) AS voucher_no
    FROM purchases p LEFT JOIN vendors v ON v.id=p.vendor_id LEFT JOIN branches b ON b.id=p.branch_id
    LEFT JOIN expense_categories c ON c.id=p.category_id LEFT JOIN users u ON u.id=p.created_by
    ${where} ORDER BY p.date DESC, p.id DESC LIMIT 500`, p));
}));

r.get('/purchases/:id', ah(async (req, res) => {
  const p = await one(`SELECT p.*, COALESCE(v.name, p.vendor_name) AS vendor, v.gstin AS vendor_gstin, b.name AS branch, c.name AS category,
      u.name AS created_by_name, a.name AS approved_by_name, f.name AS attachment_name
    FROM purchases p LEFT JOIN vendors v ON v.id=p.vendor_id LEFT JOIN branches b ON b.id=p.branch_id LEFT JOIN expense_categories c ON c.id=p.category_id
    LEFT JOIN users u ON u.id=p.created_by LEFT JOIN users a ON a.id=p.approved_by LEFT JOIN files f ON f.id=p.attachment_id WHERE p.id=$1`, [req.params.id]);
  if (!p) throw bad('Not found.');
  if (!isFinance(req.user) && p.branch_id !== req.user.branch_id) throw forbidden();
  if ((FIELD_ROLES.includes(req.user.role) || req.user.role === 'staff') && p.created_by !== req.user.id) throw forbidden();
  p.lines = await q('SELECT l.*, i.name AS item_name FROM purchase_lines l LEFT JOIN items i ON i.id=l.item_id WHERE purchase_id=$1 ORDER BY l.id', [p.id]);
  p.vouchers = await q('SELECT v.*, u.name AS created_by_name, a.name AS approved_by_name FROM vouchers v LEFT JOIN users u ON u.id=v.created_by LEFT JOIN users a ON a.id=v.approved_by WHERE purchase_id=$1 ORDER BY id', [p.id]);
  p.can_approve = p.status === 'submitted' && await F.canApproveAmount(req.user, p.total);
  res.json(p);
}));

r.post('/purchases', ah(async (req, res) => {
  const b = req.body || {};
  const id = await F.createPurchase(req.user, b, userBranch(req, b.branch_id));
  res.json({ id });
}));
r.put('/purchases/:id', ah(async (req, res) => {
  await F.updatePurchase(req.user, Number(req.params.id), req.body || {}, (req.body || {}).edit_reason);
  res.json({ ok: true });
}));
r.post('/purchases/:id/approve', ah(async (req, res) => { await F.approvePurchase(req.user, Number(req.params.id)); res.json({ ok: true }); }));
r.post('/purchases/:id/reject', ah(async (req, res) => { await F.rejectPurchase(req.user, Number(req.params.id), (req.body || {}).reason); res.json({ ok: true }); }));
r.post('/purchases/:id/cancel', ah(async (req, res) => { await F.cancelPurchase(req.user, Number(req.params.id), (req.body || {}).reason); res.json({ ok: true }); }));
r.post('/purchases/:id/payments', ah(async (req, res) => { const id = await F.recordPayment(req.user, Number(req.params.id), req.body || {}); res.json({ id }); }));

// ---------- Vouchers ----------
r.get('/vouchers', ah(async (req, res) => {
  if (!isReviewer(req.user)) throw forbidden();
  const p = [];
  let where = 'WHERE 1=1' + branchFilter(req, 'v', p);
  ['status', 'type', 'purpose'].forEach((k) => { if (req.query[k]) { p.push(req.query[k]); where += ` AND v.${k}=$${p.length}`; } });
  if (req.query.mode) { p.push(req.query.mode); where += ` AND v.payment_mode=$${p.length}`; }
  if (req.query.from) { p.push(req.query.from); where += ` AND v.date >= $${p.length}`; }
  if (req.query.to) { p.push(req.query.to); where += ` AND v.date <= $${p.length}`; }
  if (req.query.q) { p.push('%' + req.query.q + '%'); where += ` AND (v.voucher_no ILIKE $${p.length} OR v.payee ILIKE $${p.length} OR v.narration ILIKE $${p.length})`; }
  res.json(await q(`SELECT v.*, b.name AS branch, pu.purchase_no, u.name AS created_by_name FROM vouchers v LEFT JOIN branches b ON b.id=v.branch_id
    LEFT JOIN purchases pu ON pu.id=v.purchase_id LEFT JOIN users u ON u.id=v.created_by ${where} ORDER BY v.date DESC, v.id DESC LIMIT 500`, p));
}));

r.get('/vouchers/:id', ah(async (req, res) => {
  const v = await one(`SELECT v.*, b.name AS branch, b.address AS branch_address, pu.purchase_no, pu.bill_no, pu.bill_date, pu.total AS purchase_total,
      pu.created_by AS purchase_created_by, ven.gstin AS vendor_gstin, ven.address AS vendor_address,
      u.name AS created_by_name, a.name AS approved_by_name, c.name AS category
    FROM vouchers v LEFT JOIN branches b ON b.id=v.branch_id LEFT JOIN purchases pu ON pu.id=v.purchase_id LEFT JOIN vendors ven ON ven.id=v.vendor_id
    LEFT JOIN users u ON u.id=v.created_by LEFT JOIN users a ON a.id=v.approved_by LEFT JOIN expense_categories c ON c.id=pu.category_id WHERE v.id=$1`, [req.params.id]);
  if (!v) throw bad('Not found.');
  if (!isFinance(req.user) && v.branch_id !== req.user.branch_id) throw forbidden();
  if (!isReviewer(req.user) && v.created_by !== req.user.id && v.purchase_created_by !== req.user.id) throw forbidden();
  v.lines = v.purchase_id && v.purpose === 'purchase' ? await q('SELECT l.*, i.name AS item_name FROM purchase_lines l LEFT JOIN items i ON i.id=l.item_id WHERE purchase_id=$1 ORDER BY l.id', [v.purchase_id]) : [];
  const s = await getSettings();
  v.company_name = s.company_name;
  v.type_label = F.VOUCHER_TYPES[v.type];
  v.mode_label = F.MODES[v.payment_mode];
  v.can_approve = v.status === 'pending' && await F.canApproveAmount(req.user, v.amount);
  res.json(v);
}));
r.post('/vouchers/:id/approve', ah(async (req, res) => { await F.approveVoucher(req.user, Number(req.params.id)); res.json({ ok: true }); }));
r.post('/vouchers/:id/reject', ah(async (req, res) => { await F.rejectVoucher(req.user, Number(req.params.id), (req.body || {}).reason); res.json({ ok: true }); }));
r.post('/vouchers/:id/cancel', ah(async (req, res) => { await F.cancelVoucher(req.user, Number(req.params.id), (req.body || {}).reason); res.json({ ok: true }); }));

// ---------- Petty cash ----------
r.get('/petty-cash', ah(async (req, res) => {
  if (!isReviewer(req.user) && req.user.role !== 'office_boy') throw forbidden();
  const branches = isFinance(req.user) ? await q('SELECT id, name FROM branches WHERE active ORDER BY id') : await q('SELECT id, name FROM branches WHERE id=$1', [req.user.branch_id]);
  const s = await getSettings();
  const out = [];
  for (const b of branches) {
    const bal = await F.pettyBalance(null, b.id);
    const m = await one(`SELECT COALESCE(SUM(-amount) FILTER (WHERE type='expense'),0) AS spent, COALESCE(SUM(amount) FILTER (WHERE type='topup'),0) AS topups
      FROM petty_cash WHERE branch_id=$1 AND date >= date_trunc('month', CURRENT_DATE)`, [b.id]);
    out.push({ branch_id: b.id, branch: b.name, balance: bal, spent_mtd: Number(m.spent), topups_mtd: Number(m.topups), float: Number((s.petty_cash_float || {})[b.id] || s.petty_cash_default_float || 0) });
  }
  res.json(out);
}));
r.get('/petty-cash/book', ah(async (req, res) => {
  if (!isReviewer(req.user)) throw forbidden();
  const branchId = Number(req.query.branch_id || req.user.branch_id);
  if (!isFinance(req.user) && branchId !== req.user.branch_id) throw forbidden();
  const p = [branchId];
  let where = 'WHERE pc.branch_id=$1';
  if (req.query.from) { p.push(req.query.from); where += ` AND pc.date >= $${p.length}`; }
  if (req.query.to) { p.push(req.query.to); where += ` AND pc.date <= $${p.length}`; }
  const opening = req.query.from ? Number((await one('SELECT COALESCE(SUM(amount),0) AS s FROM petty_cash WHERE branch_id=$1 AND date < $2', [branchId, req.query.from])).s) : 0;
  const rows = await q(`SELECT pc.*, v.voucher_no, v.id AS vid, u.name AS created_by_name FROM petty_cash pc LEFT JOIN vouchers v ON v.id=pc.voucher_id
    LEFT JOIN users u ON u.id=pc.created_by ${where} ORDER BY pc.date, pc.id`, p);
  let bal = opening;
  rows.forEach((x) => { bal += Number(x.amount); x.balance = Math.round(bal * 100) / 100; });
  res.json({ opening, rows, closing: bal });
}));
r.post('/petty-cash/topup', ah(async (req, res) => {
  const b = req.body || {};
  if (!b.branch_id) throw bad('Choose a branch.');
  const id = await F.pettyTopup(req.user, Number(b.branch_id), b);
  res.json({ id });
}));

// ---------- Approvals queue ----------
r.get('/approvals', ah(async (req, res) => {
  if (!isReviewer(req.user)) throw forbidden();
  const p = [];
  const bf = branchFilter(req, 'v', p);
  const vouchers = await q(`SELECT v.*, b.name AS branch, pu.purchase_no, u.name AS created_by_name FROM vouchers v LEFT JOIN branches b ON b.id=v.branch_id
    LEFT JOIN purchases pu ON pu.id=v.purchase_id LEFT JOIN users u ON u.id=v.created_by WHERE v.status='pending' ${bf} ORDER BY v.created_at`, p);
  for (const v of vouchers) v.can_approve = await F.canApproveAmount(req.user, v.amount);
  res.json(vouchers);
}));

// ---------- Vendor ledger ----------
r.get('/vendors/:id/ledger', ah(async (req, res) => {
  if (!isReviewer(req.user)) throw forbidden();
  const vendor = await one('SELECT * FROM vendors WHERE id=$1', [req.params.id]);
  if (!vendor) throw bad('Not found.');
  const purchases = await q(`SELECT p.id, p.purchase_no, p.date, p.bill_no, p.total, p.amount_paid, p.payment_status, p.payment_mode, p.status, b.name AS branch
    FROM purchases p LEFT JOIN branches b ON b.id=p.branch_id WHERE vendor_id=$1 ORDER BY date DESC`, [vendor.id]);
  const vouchers = await q("SELECT id, voucher_no, type, purpose, date, amount, payment_mode, status FROM vouchers WHERE vendor_id=$1 ORDER BY date DESC", [vendor.id]);
  const docs = await q('SELECT id, title, doc_type, expires_on FROM documents WHERE vendor_id=$1', [vendor.id]);
  const approved = purchases.filter((x) => x.status === 'approved');
  res.json({
    vendor, purchases, vouchers, documents: docs,
    totals: {
      purchased: approved.reduce((a, x) => a + x.total, 0),
      paid: approved.reduce((a, x) => a + x.amount_paid, 0),
      outstanding: approved.reduce((a, x) => a + (x.total - x.amount_paid), 0)
    }
  });
}));

module.exports = r;
