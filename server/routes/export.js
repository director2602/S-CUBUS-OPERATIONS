// Read-only full data export (Owner / Admin / Accounts). Returns one array of rows per sheet.
// Nothing is written or changed. Passwords and stored file contents are never included.
const express = require('express');
const { q } = require('../db');
const { ah, forbidden, isFinance, audit } = require('../lib');

const r = express.Router();

function flatValue(f, v, files) {
  if (v === undefined || v === null || v === '') return '';
  if (f && f.type === 'checklist' && typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}: ${x.status}${x.remark ? ' (' + x.remark + ')' : ''}`).join('; ');
  if (f && ['file', 'image', 'signature'].includes(f.type)) return files ? `${files}/api/files/${v}` : `file #${v}`;
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

r.get('/export/all', ah(async (req, res) => {
  if (!isFinance(req.user)) throw forbidden('Only Owner, Admin or Accounts can download all data.');
  const base = `${req.protocol}://${req.get('host')}`;
  const sheets = {};
  sheets.Branches = await q('SELECT id, name, code, address, active, created_at FROM branches ORDER BY id');
  sheets.Users = await q(`SELECT u.id, u.name, u.email AS login, u.phone, u.role, u.designation, b.name AS branch, u.active, u.created_at
    FROM users u LEFT JOIN branches b ON b.id=u.branch_id ORDER BY u.id`);
  sheets.Vendors = await q('SELECT id, name, category, gstin, phone, email, address, bank_details, active, created_at FROM vendors ORDER BY name');
  sheets['Expense categories'] = await q('SELECT id, name, active FROM expense_categories ORDER BY name');
  sheets.Items = await q(`SELECT id, item_kind AS kind, name, category, unit, min_stock, rate, course, class_level, subject, module_no, session, language, title, edition,
    garment, size, audience, gender, colour, spec, active, created_at FROM items ORDER BY item_kind, name`);
  sheets['Stock by branch'] = await q(`SELECT i.name AS item, i.item_kind AS kind, i.category, i.unit, b.name AS branch, s.qty, i.min_stock,
    CASE WHEN i.min_stock > 0 AND s.qty < i.min_stock THEN 'LOW' ELSE '' END AS alert FROM stock s JOIN items i ON i.id=s.item_id JOIN branches b ON b.id=s.branch_id ORDER BY i.name, b.id`);
  sheets['Stock movements'] = await q(`SELECT m.id, m.created_at, b.name AS branch, i.name AS item, m.type, m.qty, i.unit, m.issued_to, m.remarks, m.ref_type, m.ref_id, u.name AS by
    FROM stock_movements m JOIN items i ON i.id=m.item_id LEFT JOIN branches b ON b.id=m.branch_id LEFT JOIN users u ON u.id=m.created_by ORDER BY m.created_at`);
  sheets.Purchases = await q(`SELECT p.id, p.purchase_no, p.date, b.name AS branch, p.kind, COALESCE(v.name, p.vendor_name) AS vendor, c.name AS category, p.description,
    p.subtotal, p.gst_amount, p.total, p.payment_mode, p.mode_details::text AS payment_details, p.amount_paid, p.payment_status, p.status, p.bill_no, p.bill_date,
    p.reject_reason, u.name AS created_by, p.created_at, a.name AS approved_by, p.approved_at
    FROM purchases p LEFT JOIN vendors v ON v.id=p.vendor_id LEFT JOIN branches b ON b.id=p.branch_id LEFT JOIN expense_categories c ON c.id=p.category_id
    LEFT JOIN users u ON u.id=p.created_by LEFT JOIN users a ON a.id=p.approved_by ORDER BY p.date, p.id`);
  sheets['Purchase lines'] = await q(`SELECT p.purchase_no, l.id AS line_id, i.name AS item, l.description, l.qty, l.unit, l.rate, l.gst_rate, l.amount
    FROM purchase_lines l JOIN purchases p ON p.id=l.purchase_id LEFT JOIN items i ON i.id=l.item_id ORDER BY p.id, l.id`);
  sheets.Vouchers = await q(`SELECT v.id, v.voucher_no, v.type, v.purpose, v.date, b.name AS branch, pu.purchase_no, v.payee, v.amount, v.payment_mode, v.mode_details::text AS payment_details,
    v.narration, v.status, v.reject_reason, u.name AS created_by, v.created_at, a.name AS approved_by, v.approved_at
    FROM vouchers v LEFT JOIN branches b ON b.id=v.branch_id LEFT JOIN purchases pu ON pu.id=v.purchase_id LEFT JOIN users u ON u.id=v.created_by LEFT JOIN users a ON a.id=v.approved_by ORDER BY v.date, v.id`);
  sheets['Petty cash book'] = await q(`SELECT pc.id, pc.date, b.name AS branch, pc.type, v.voucher_no, pc.narration, pc.amount,
    SUM(pc.amount) OVER (PARTITION BY pc.branch_id ORDER BY pc.date, pc.id) AS running_balance, u.name AS by
    FROM petty_cash pc LEFT JOIN branches b ON b.id=pc.branch_id LEFT JOIN vouchers v ON v.id=pc.voucher_id LEFT JOIN users u ON u.id=pc.created_by ORDER BY b.id, pc.date, pc.id`);

  // One sheet per register, every field as its own column
  const defs = await q('SELECT * FROM register_defs ORDER BY sort, name');
  for (const d of defs) {
    const ents = await q(`SELECT e.id, e.entry_date, b.name AS branch, e.status, e.data, e.review_note, u.name AS created_by, e.created_at, up.name AS updated_by, e.updated_at,
        vu.name AS verified_by, e.verified_at, (SELECT COUNT(*)::int FROM register_history h WHERE h.entry_id=e.id) AS edits
      FROM register_entries e LEFT JOIN branches b ON b.id=e.branch_id LEFT JOIN users u ON u.id=e.created_by LEFT JOIN users up ON up.id=e.updated_by
      LEFT JOIN users vu ON vu.id=e.verified_by WHERE e.register_id=$1 ORDER BY e.entry_date, e.id`, [d.id]);
    if (!ents.length) continue;
    const extraKeys = [...new Set(ents.flatMap((e) => Object.keys(e.data || {})))].filter((k) => !d.fields.some((f) => f.key === k));
    sheets[d.name] = ents.map((e) => {
      const row = { 'Entry ID': e.id, Date: e.entry_date, Branch: e.branch, Status: e.status };
      d.fields.forEach((f) => { row[f.label] = flatValue(f, (e.data || {})[f.key], base); });
      extraKeys.forEach((k) => { row[k] = flatValue(null, e.data[k], base); });
      Object.assign(row, { 'Review note': e.review_note || '', 'Entered by': e.created_by, 'Entered at': e.created_at, 'Last edited by': e.updated_by || '', 'Last edited at': e.updated_at || '',
        'Verified by': e.verified_by || '', 'Verified at': e.verified_at || '', Edits: e.edits });
      return row;
    });
  }
  sheets['Register edit history'] = await q(`SELECT h.entry_id, d.name AS register, h.edited_at, u.name AS edited_by, h.reason, h.old_data::text AS original, h.new_data::text AS edited
    FROM register_history h JOIN register_entries e ON e.id=h.entry_id JOIN register_defs d ON d.id=e.register_id LEFT JOIN users u ON u.id=h.edited_by ORDER BY h.edited_at`);
  sheets.Tasks = await q(`SELECT t.id, t.title, t.description, t.category, b.name AS branch, a.name AS assigned_to, rq.name AS requested_by, t.priority, t.status, t.due_date,
    t.created_at, t.started_at, t.completed_at, t.remarks FROM tasks t LEFT JOIN branches b ON b.id=t.branch_id LEFT JOIN users a ON a.id=t.assigned_to LEFT JOIN users rq ON rq.id=t.requested_by ORDER BY t.id`);
  sheets['Documents & licences'] = await q(`SELECT d.id, d.title, d.doc_type, b.name AS branch, d.number, v.name AS vendor, d.issued_on, d.expires_on, (d.expires_on - CURRENT_DATE) AS days_left, d.notes, d.created_at
    FROM documents d LEFT JOIN branches b ON b.id=d.branch_id LEFT JOIN vendors v ON v.id=d.vendor_id ORDER BY d.expires_on NULLS LAST`);
  sheets.Batches = await q(`SELECT ba.id, ba.name, b.name AS branch, ba.course, ba.class_level, ba.session, ba.language, ba.students, ba.active FROM batches ba LEFT JOIN branches b ON b.id=ba.branch_id ORDER BY ba.id`);
  sheets['Store entries'] = await q(`SELECT t.id, t.date, t.kind AS entry, i.item_kind AS store_section, i.name AS item, t.qty, t.damaged_qty, b.name AS branch, tb.name AS to_branch, ba.name AS batch,
    t.issued_to, t.department, t.students, t.source, t.source_name, t.challan_no, t.received_by, t.remarks, t.status, t.cancel_reason, u.name AS created_by, t.created_at, up.name AS edited_by, t.updated_at
    FROM module_txns t JOIN items i ON i.id=t.item_id JOIN branches b ON b.id=t.branch_id LEFT JOIN branches tb ON tb.id=t.to_branch_id LEFT JOIN batches ba ON ba.id=t.batch_id
    LEFT JOIN users u ON u.id=t.created_by LEFT JOIN users up ON up.id=t.updated_by ORDER BY t.date, t.id`);
  sheets['Audit trail'] = await q(`SELECT a.at, a.entity, a.entity_id, a.action, a.reason, u.name AS by FROM audit_log a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.at DESC LIMIT 20000`);
  await audit(null, 'system', null, 'export-all', req.user.id, { sheets: Object.keys(sheets).length });
  res.json({ generated_at: new Date().toISOString(), sheets });
}));

module.exports = r;
