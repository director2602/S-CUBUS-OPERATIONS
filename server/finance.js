// Purchases, vouchers, petty cash and stock posting.
const { tx, q, one } = require('./db');
const { bad, forbidden, audit, nextNumber, getSettings, isFinance, isMgmt } = require('./lib');

const MODES = {
  petty_cash: 'Petty cash',
  cash: 'Cash',
  upi: 'UPI',
  bank_transfer: 'Bank transfer (NEFT / RTGS / IMPS)',
  cheque: 'Cheque',
  card: 'Card',
  credit: 'Credit (pay vendor later)'
};
const VOUCHER_TYPES = {
  PCV: 'Petty Cash Voucher',
  CPV: 'Cash Payment Voucher',
  BPV: 'Bank Payment Voucher',
  CCV: 'Card Payment Voucher',
  JV: 'Purchase Journal Voucher (credit)',
  PCR: 'Petty Cash Receipt (top-up)'
};
function voucherTypeFor(mode) {
  return { petty_cash: 'PCV', cash: 'CPV', upi: 'BPV', bank_transfer: 'BPV', cheque: 'BPV', card: 'CCV', credit: 'JV' }[mode];
}

function validateModeDetails(mode, d) {
  d = d || {};
  if (!MODES[mode]) throw bad('Choose a valid payment mode.');
  if (mode === 'upi' && !d.reference) throw bad('Enter the UPI transaction reference.');
  if (mode === 'bank_transfer' && !d.reference) throw bad('Enter the UTR / transaction reference.');
  if (mode === 'cheque' && !d.cheque_no) throw bad('Enter the cheque number.');
  if (mode === 'card' && d.card_last4 && !/^\d{4}$/.test(d.card_last4)) throw bad('Card: enter only the last 4 digits.');
  const clean = {};
  ['reference', 'bank', 'cheque_no', 'cheque_date', 'card_last4', 'paid_by', 'upi_id', 'due_date'].forEach((k) => {
    if (d[k] !== undefined && d[k] !== '') clean[k] = String(d[k]).slice(0, 120);
  });
  return clean;
}

function computeLines(lines) {
  if (!Array.isArray(lines) || !lines.length) throw bad('Add at least one line.');
  let subtotal = 0; let gst = 0;
  const out = lines.map((l) => {
    const qty = Number(l.qty) || 0;
    const rate = Number(l.rate) || 0;
    const gstRate = Number(l.gst_rate) || 0;
    if (qty <= 0) throw bad('Each line needs a quantity above zero.');
    if (rate < 0) throw bad('Rate cannot be negative.');
    if (!l.item_id && !(l.description || '').trim()) throw bad('Each line needs an item or a description.');
    const amount = Math.round(qty * rate * 100) / 100;
    const g = Math.round(amount * gstRate) / 100;
    subtotal += amount; gst += g;
    return { item_id: l.item_id ? Number(l.item_id) : null, description: (l.description || '').trim(), qty, unit: l.unit || null, rate, gst_rate: gstRate, amount };
  });
  subtotal = Math.round(subtotal * 100) / 100; gst = Math.round(gst * 100) / 100;
  return { lines: out, subtotal, gst, total: Math.round((subtotal + gst) * 100) / 100 };
}

async function canApproveAmount(user, amount) {
  if (isFinance(user)) return true;
  if (user.role === 'manager') {
    const s = await getSettings();
    return amount <= Number(s.manager_approval_limit || 0);
  }
  return false;
}

async function pettyBalance(h, branchId) {
  const r = await (h || { one }).one('SELECT COALESCE(SUM(amount),0) AS bal FROM petty_cash WHERE branch_id = $1', [branchId]);
  return Number(r.bal);
}

async function moveStock(h, { item_id, branch_id, qty, type, ref_type, ref_id, issued_to, remarks, user_id }) {
  await h.q(`INSERT INTO stock (item_id, branch_id, qty) VALUES ($1,$2,$3)
    ON CONFLICT (item_id, branch_id) DO UPDATE SET qty = stock.qty + EXCLUDED.qty`, [item_id, branch_id, qty]);
  await h.q(`INSERT INTO stock_movements (item_id, branch_id, qty, type, ref_type, ref_id, issued_to, remarks, created_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [item_id, branch_id, qty, type, ref_type || null, ref_id || null, issued_to || null, remarks || null, user_id]);
}

async function stockOf(h, itemId, branchId) {
  const r = await h.one('SELECT qty FROM stock WHERE item_id=$1 AND branch_id=$2', [itemId, branchId]);
  return r ? Number(r.qty) : 0;
}

// ---------- Purchases ----------
async function createPurchase(user, body, branchId) {
  const { lines, subtotal, gst, total } = computeLines(body.lines);
  const mode = body.payment_mode;
  const details = validateModeDetails(mode, body.mode_details);
  if (!branchId) throw bad('Choose a branch.');
  if (!body.vendor_id && !(body.vendor_name || '').trim()) throw bad('Choose a vendor or type the shop / payee name.');
  const date = body.date || new Date().toISOString().slice(0, 10);
  return tx(async (h) => {
    if (mode === 'petty_cash') {
      const bal = await pettyBalance(h, branchId);
      if (bal < total) throw bad(`Petty cash balance is ₹${bal.toLocaleString('en-IN')} — not enough for ₹${total.toLocaleString('en-IN')}. Ask accounts for a top-up or choose another payment mode.`);
    }
    const purchaseNo = await nextNumber(h, 'PUR', date);
    const p = await h.one(`INSERT INTO purchases (purchase_no, branch_id, date, kind, vendor_id, vendor_name, category_id, description,
      subtotal, gst_amount, total, payment_mode, mode_details, status, bill_no, bill_date, attachment_id, update_stock, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'submitted',$14,$15,$16,$17,$18) RETURNING *`,
    [purchaseNo, branchId, date, body.kind === 'expense' ? 'expense' : 'purchase', body.vendor_id || null, (body.vendor_name || '').trim() || null,
      body.category_id || null, body.description || null, subtotal, gst, total, mode, details, body.bill_no || null, body.bill_date || null,
      body.attachment_id || null, body.update_stock !== false, user.id]);
    for (const l of lines) {
      await h.q('INSERT INTO purchase_lines (purchase_id, item_id, description, qty, unit, rate, gst_rate, amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [p.id, l.item_id, l.description, l.qty, l.unit, l.rate, l.gst_rate, l.amount]);
    }
    const v = await createPurchaseVoucher(h, user, p);
    await audit(h, 'purchase', p.id, 'created', user.id, { total, mode, voucher: v.voucher_no });
    if (body.approve_now && await canApproveAmount(user, total)) {
      await applyApproval(h, user, p.id);
    }
    return p.id;
  });
}

async function createPurchaseVoucher(h, user, p) {
  const type = voucherTypeFor(p.payment_mode);
  const no = await nextNumber(h, type, p.date);
  const vendor = p.vendor_id ? await h.one('SELECT name FROM vendors WHERE id=$1', [p.vendor_id]) : null;
  return h.one(`INSERT INTO vouchers (voucher_no, type, purpose, branch_id, date, purchase_id, vendor_id, payee, amount, payment_mode, mode_details, narration, attachment_id, created_by)
    VALUES ($1,$2,'purchase',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
  [no, type, p.branch_id, p.date, p.id, p.vendor_id, vendor ? vendor.name : p.vendor_name, p.total, p.payment_mode, p.mode_details,
    p.description || `Purchase ${p.purchase_no}`, p.attachment_id, user.id]);
}

async function applyApproval(h, user, purchaseId) {
  const p = await h.one('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [purchaseId]);
  if (!p) throw bad('Purchase not found.');
  if (p.status !== 'submitted') throw bad(`This purchase is already ${p.status}.`);
  if (!(await canApproveAmount(user, p.total))) throw forbidden('This amount is above your approval limit.');
  const v = await h.one("SELECT * FROM vouchers WHERE purchase_id=$1 AND purpose='purchase' AND status='pending'", [p.id]);
  await applyEffects(h, user, p, v);
  await h.q("UPDATE purchases SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1", [p.id, user.id]);
  if (v) await h.q("UPDATE vouchers SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1", [v.id, user.id]);
  await audit(h, 'purchase', p.id, 'approved', user.id, { total: p.total });
}

async function applyEffects(h, user, p, v) {
  if (p.payment_mode === 'petty_cash') {
    const bal = await pettyBalance(h, p.branch_id);
    if (bal < p.total) throw bad(`Petty cash balance is ₹${bal.toLocaleString('en-IN')}, not enough to approve ₹${p.total.toLocaleString('en-IN')}.`);
    await h.q("INSERT INTO petty_cash (branch_id, date, amount, type, voucher_id, narration, created_by) VALUES ($1,$2,$3,'expense',$4,$5,$6)",
      [p.branch_id, p.date, -p.total, v ? v.id : null, `${p.purchase_no} ${p.vendor_name || ''}`.trim(), user.id]);
  }
  if (p.payment_mode !== 'credit') {
    await h.q("UPDATE purchases SET amount_paid=total, payment_status='paid' WHERE id=$1", [p.id]);
  } else {
    await h.q("UPDATE purchases SET payment_status='unpaid' WHERE id=$1", [p.id]);
  }
  if (p.update_stock) {
    const lines = await h.q('SELECT * FROM purchase_lines WHERE purchase_id=$1 AND item_id IS NOT NULL', [p.id]);
    for (const l of lines) {
      await moveStock(h, { item_id: l.item_id, branch_id: p.branch_id, qty: l.qty, type: 'purchase', ref_type: 'purchase', ref_id: p.id, remarks: p.purchase_no, user_id: user.id });
    }
  }
}

async function reverseEffects(h, user, p, reason) {
  const paidVouchers = await h.one("SELECT COUNT(*)::int AS n FROM vouchers WHERE purchase_id=$1 AND purpose='payment' AND status='approved'", [p.id]);
  if (paidVouchers.n > 0) throw bad('Payments have been recorded against this purchase. Cancel those payment vouchers first.');
  if (p.payment_mode === 'petty_cash') {
    await h.q("INSERT INTO petty_cash (branch_id, date, amount, type, narration, created_by) VALUES ($1, CURRENT_DATE, $2, 'adjustment', $3, $4)",
      [p.branch_id, p.total, `Reversal of ${p.purchase_no}: ${reason || ''}`.trim(), user.id]);
  }
  if (p.update_stock) {
    const moved = await h.q("SELECT item_id, SUM(qty) AS qty FROM stock_movements WHERE ref_type='purchase' AND ref_id=$1 GROUP BY item_id", [p.id]);
    for (const m of moved) {
      if (Number(m.qty) !== 0) {
        await moveStock(h, { item_id: m.item_id, branch_id: p.branch_id, qty: -Number(m.qty), type: 'adjustment', ref_type: 'purchase', ref_id: p.id, remarks: `Reversal ${p.purchase_no}`, user_id: user.id });
      }
    }
  }
  await h.q("UPDATE purchases SET amount_paid=0, payment_status='unpaid' WHERE id=$1", [p.id]);
}

async function approvePurchase(user, id) {
  return tx((h) => applyApproval(h, user, id));
}

async function rejectPurchase(user, id, reason) {
  if (!reason) throw bad('Give a reason for rejecting.');
  return tx(async (h) => {
    const p = await h.one('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [id]);
    if (!p) throw bad('Not found.');
    if (p.status !== 'submitted') throw bad(`This purchase is already ${p.status}.`);
    if (!(await canApproveAmount(user, p.total))) throw forbidden('This amount is above your approval limit.');
    await h.q("UPDATE purchases SET status='rejected', reject_reason=$2, approved_by=$3, approved_at=now() WHERE id=$1", [id, reason, user.id]);
    await h.q("UPDATE vouchers SET status='rejected', reject_reason=$2, approved_by=$3, approved_at=now() WHERE purchase_id=$1 AND status='pending'", [id, reason, user.id]);
    await audit(h, 'purchase', id, 'rejected', user.id, null, reason);
  });
}

async function cancelPurchase(user, id, reason) {
  if (!isMgmt(user) && user.role !== 'accounts') throw forbidden();
  if (!reason) throw bad('Give a reason for cancelling.');
  return tx(async (h) => {
    const p = await h.one('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [id]);
    if (!p) throw bad('Not found.');
    if (p.status === 'cancelled') throw bad('Already cancelled.');
    if (p.status === 'approved') await reverseEffects(h, user, p, reason);
    await h.q("UPDATE purchases SET status='cancelled', reject_reason=$2, updated_by=$3, updated_at=now() WHERE id=$1", [id, reason, user.id]);
    await h.q("UPDATE vouchers SET status='cancelled', reject_reason=$2 WHERE purchase_id=$1 AND status IN ('pending','approved')", [id, reason]);
    await audit(h, 'purchase', id, 'cancelled', user.id, null, reason);
  });
}

// Edit: submitted purchases by creator or approver; approved ones only by owner/admin/accounts with a reason (reverse + re-post).
async function updatePurchase(user, id, body, reason) {
  return tx(async (h) => {
    const p = await h.one('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [id]);
    if (!p) throw bad('Not found.');
    if (['rejected', 'cancelled'].includes(p.status)) throw bad(`A ${p.status} purchase cannot be edited. Create a new one.`);
    const wasApproved = p.status === 'approved';
    if (wasApproved && !isFinance(user)) throw forbidden('Only Owner, Admin or Accounts can edit an approved purchase.');
    if (!wasApproved && p.created_by !== user.id && !isFinance(user) && user.role !== 'manager') throw forbidden();
    if (wasApproved && !reason) throw bad('Give a reason for editing an approved purchase.');
    const { lines, subtotal, gst, total } = computeLines(body.lines);
    const mode = body.payment_mode || p.payment_mode;
    const details = validateModeDetails(mode, body.mode_details);
    const before = { ...p, lines: await h.q('SELECT * FROM purchase_lines WHERE purchase_id=$1', [id]) };
    if (wasApproved) await reverseEffects(h, user, p, reason);
    await h.q(`UPDATE purchases SET date=$2, kind=$3, vendor_id=$4, vendor_name=$5, category_id=$6, description=$7, subtotal=$8, gst_amount=$9, total=$10,
      payment_mode=$11, mode_details=$12, bill_no=$13, bill_date=$14, attachment_id=COALESCE($15, attachment_id), update_stock=$16, updated_by=$17, updated_at=now()
      WHERE id=$1`, [id, body.date || p.date, body.kind === 'expense' ? 'expense' : 'purchase', body.vendor_id || null, (body.vendor_name || '').trim() || null,
      body.category_id || null, body.description || null, subtotal, gst, total, mode, details, body.bill_no || null, body.bill_date || null,
      body.attachment_id || null, body.update_stock !== false, user.id]);
    await h.q('DELETE FROM purchase_lines WHERE purchase_id=$1', [id]);
    for (const l of lines) {
      await h.q('INSERT INTO purchase_lines (purchase_id, item_id, description, qty, unit, rate, gst_rate, amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [id, l.item_id, l.description, l.qty, l.unit, l.rate, l.gst_rate, l.amount]);
    }
    const np = await h.one('SELECT * FROM purchases WHERE id=$1', [id]);
    // Voucher: if mode type changed, cancel old voucher and issue a new number; else update amount/details.
    const oldV = await h.one("SELECT * FROM vouchers WHERE purchase_id=$1 AND purpose='purchase' AND status IN ('pending','approved') ORDER BY id DESC LIMIT 1", [id]);
    let v = oldV;
    if (!oldV || oldV.type !== voucherTypeFor(mode)) {
      if (oldV) await h.q("UPDATE vouchers SET status='cancelled', reject_reason=$2 WHERE id=$1", [oldV.id, 'Replaced after payment mode change']);
      v = await createPurchaseVoucher(h, user, np);
      if (wasApproved) await h.q("UPDATE vouchers SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1", [v.id, user.id]);
    } else {
      const vendor = np.vendor_id ? await h.one('SELECT name FROM vendors WHERE id=$1', [np.vendor_id]) : null;
      await h.q('UPDATE vouchers SET amount=$2, payment_mode=$3, mode_details=$4, date=$5, vendor_id=$6, payee=$7, narration=$8, attachment_id=$9 WHERE id=$1',
        [oldV.id, total, mode, details, np.date, np.vendor_id, vendor ? vendor.name : np.vendor_name, np.description || `Purchase ${np.purchase_no}`, np.attachment_id]);
      v = await h.one('SELECT * FROM vouchers WHERE id=$1', [oldV.id]);
    }
    if (wasApproved) await applyEffects(h, user, np, v);
    await audit(h, 'purchase', id, 'edited', user.id, { before, after: body }, reason);
  });
}

// ---------- Payments against credit purchases ----------
async function recordPayment(user, purchaseId, body) {
  if (!isFinance(user) && user.role !== 'manager') throw forbidden();
  const amount = Number(body.amount);
  if (!(amount > 0)) throw bad('Enter the amount paid.');
  const mode = body.payment_mode;
  if (mode === 'credit') throw bad('Choose how the vendor is being paid.');
  const details = validateModeDetails(mode, body.mode_details);
  return tx(async (h) => {
    const p = await h.one('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [purchaseId]);
    if (!p || p.status !== 'approved') throw bad('Payments can be recorded only on approved purchases.');
    const pending = await h.one("SELECT COALESCE(SUM(amount),0) AS s FROM vouchers WHERE purchase_id=$1 AND purpose='payment' AND status='pending'", [p.id]);
    const outstanding = p.total - p.amount_paid - Number(pending.s);
    if (amount > outstanding + 0.001) throw bad(`Outstanding (after pending payments) is ₹${outstanding.toLocaleString('en-IN')}.`);
    const type = voucherTypeFor(mode);
    const date = body.date || new Date().toISOString().slice(0, 10);
    const no = await nextNumber(h, type, date);
    const vendor = p.vendor_id ? await h.one('SELECT name FROM vendors WHERE id=$1', [p.vendor_id]) : null;
    const v = await h.one(`INSERT INTO vouchers (voucher_no, type, purpose, branch_id, date, purchase_id, vendor_id, payee, amount, payment_mode, mode_details, narration, attachment_id, created_by)
      VALUES ($1,$2,'payment',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [no, type, p.branch_id, date, p.id, p.vendor_id, vendor ? vendor.name : p.vendor_name, amount, mode, details,
      body.narration || `Payment against ${p.purchase_no}${p.bill_no ? ' / bill ' + p.bill_no : ''}`, body.attachment_id || null, user.id]);
    await audit(h, 'voucher', v.id, 'created', user.id, { amount, mode, purchase: p.purchase_no });
    if (body.approve_now && await canApproveAmount(user, amount)) await approveVoucherTx(h, user, v.id);
    return v.id;
  });
}

// ---------- Petty cash top-up ----------
async function pettyTopup(user, branchId, body) {
  if (!isFinance(user)) throw forbidden('Only Owner, Admin or Accounts can top up petty cash.');
  const amount = Number(body.amount);
  if (!(amount > 0)) throw bad('Enter the top-up amount.');
  const mode = body.payment_mode || 'cash';
  if (mode === 'petty_cash' || mode === 'credit') throw bad('Top-up must come from cash, bank, UPI or cheque.');
  const details = validateModeDetails(mode, body.mode_details);
  const date = body.date || new Date().toISOString().slice(0, 10);
  return tx(async (h) => {
    const no = await nextNumber(h, 'PCR', date);
    const v = await h.one(`INSERT INTO vouchers (voucher_no, type, purpose, branch_id, date, payee, amount, payment_mode, mode_details, narration, created_by)
      VALUES ($1,'PCR','petty_topup',$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [no, branchId, date, body.payee || 'Petty cash custodian', amount, mode, details, body.narration || 'Petty cash top-up', user.id]);
    await approveVoucherTx(h, user, v.id);
    return v.id;
  });
}

async function approveVoucherTx(h, user, id) {
  const v = await h.one('SELECT * FROM vouchers WHERE id=$1 FOR UPDATE', [id]);
  if (!v) throw bad('Voucher not found.');
  if (v.status !== 'pending') throw bad(`Voucher is already ${v.status}.`);
  if (v.purpose === 'purchase') return applyApproval(h, user, v.purchase_id);
  if (!(await canApproveAmount(user, v.amount))) throw forbidden('This amount is above your approval limit.');
  if (v.purpose === 'payment') {
    const p = await h.one('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [v.purchase_id]);
    if (v.payment_mode === 'petty_cash') {
      const bal = await pettyBalance(h, v.branch_id);
      if (bal < v.amount) throw bad('Not enough petty cash balance.');
      await h.q("INSERT INTO petty_cash (branch_id, date, amount, type, voucher_id, narration, created_by) VALUES ($1,$2,$3,'expense',$4,$5,$6)",
        [v.branch_id, v.date, -v.amount, v.id, v.narration, user.id]);
    }
    const paid = Number(p.amount_paid) + Number(v.amount);
    await h.q('UPDATE purchases SET amount_paid=$2, payment_status=$3 WHERE id=$1', [p.id, paid, paid + 0.001 >= p.total ? 'paid' : 'partial']);
  }
  if (v.purpose === 'petty_topup') {
    await h.q("INSERT INTO petty_cash (branch_id, date, amount, type, voucher_id, narration, created_by) VALUES ($1,$2,$3,'topup',$4,$5,$6)",
      [v.branch_id, v.date, v.amount, v.id, v.narration, user.id]);
  }
  await h.q("UPDATE vouchers SET status='approved', approved_by=$2, approved_at=now() WHERE id=$1", [id, user.id]);
  await audit(h, 'voucher', id, 'approved', user.id, { amount: v.amount });
}

async function approveVoucher(user, id) { return tx((h) => approveVoucherTx(h, user, id)); }

async function rejectVoucher(user, id, reason) {
  if (!reason) throw bad('Give a reason.');
  const v = await one('SELECT * FROM vouchers WHERE id=$1', [id]);
  if (!v) throw bad('Not found.');
  if (v.purpose === 'purchase') return rejectPurchase(user, v.purchase_id, reason);
  if (v.status !== 'pending') throw bad(`Voucher is already ${v.status}.`);
  if (!(await canApproveAmount(user, v.amount))) throw forbidden();
  await q("UPDATE vouchers SET status='rejected', reject_reason=$2, approved_by=$3, approved_at=now() WHERE id=$1", [id, reason, user.id]);
  await audit(null, 'voucher', id, 'rejected', user.id, null, reason);
}

// Cancel an approved payment / top-up voucher (reverses its effect).
async function cancelVoucher(user, id, reason) {
  if (!isFinance(user)) throw forbidden();
  if (!reason) throw bad('Give a reason.');
  return tx(async (h) => {
    const v = await h.one('SELECT * FROM vouchers WHERE id=$1 FOR UPDATE', [id]);
    if (!v) throw bad('Not found.');
    if (v.purpose === 'purchase') throw bad('Cancel the purchase itself to cancel its voucher.');
    if (v.status === 'approved') {
      if (v.purpose === 'payment') {
        const p = await h.one('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [v.purchase_id]);
        const paid = Math.max(0, Number(p.amount_paid) - Number(v.amount));
        await h.q('UPDATE purchases SET amount_paid=$2, payment_status=$3 WHERE id=$1', [p.id, paid, paid <= 0 ? 'unpaid' : 'partial']);
        if (v.payment_mode === 'petty_cash') {
          await h.q("INSERT INTO petty_cash (branch_id, date, amount, type, narration, created_by) VALUES ($1, CURRENT_DATE, $2, 'adjustment', $3, $4)",
            [v.branch_id, v.amount, `Reversal of ${v.voucher_no}`, user.id]);
        }
      }
      if (v.purpose === 'petty_topup') {
        await h.q("INSERT INTO petty_cash (branch_id, date, amount, type, narration, created_by) VALUES ($1, CURRENT_DATE, $2, 'adjustment', $3, $4)",
          [v.branch_id, -v.amount, `Reversal of ${v.voucher_no}`, user.id]);
      }
    }
    await h.q("UPDATE vouchers SET status='cancelled', reject_reason=$2 WHERE id=$1", [id, reason]);
    await audit(h, 'voucher', id, 'cancelled', user.id, null, reason);
  });
}

module.exports = {
  MODES, VOUCHER_TYPES, voucherTypeFor, computeLines, createPurchase, approvePurchase, rejectPurchase, cancelPurchase, updatePurchase,
  recordPayment, pettyTopup, approveVoucher, rejectVoucher, cancelVoucher, pettyBalance, moveStock, stockOf, canApproveAmount
};
