import { html, raw, api, post, put, route, page, state, can, chart, PALETTE, moneyTick, inr, inrShort, fdate, fdateShort, fdt, badge, icon, on, go, toast, err, modal, promptReason, confirmBox, opts, formData, todayStr, addDays, cap, loadLookups } from '../core.js';
import { uploadFile } from '../forms.js';

let META = null;
const meta = async () => (META = META || await api('/finance/meta'));
const MODE_HELP = {
  petty_cash: 'Paid from branch petty cash', cash: 'Cash from office / accounts', upi: 'GPay, PhonePe, Paytm…', bank_transfer: 'NEFT / RTGS / IMPS',
  cheque: 'Company cheque', card: 'Company debit / credit card', credit: 'Vendor bill, pay later'
};

export function amountInWords(n) {
  n = Math.round(Number(n) * 100) / 100;
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
  const two = (x) => (x < 20 ? a[x] : b[Math.floor(x / 10)] + (x % 10 ? ' ' + a[x % 10] : ''));
  const three = (x) => (x >= 100 ? a[Math.floor(x / 100)] + ' Hundred' + (x % 100 ? ' ' + two(x % 100) : '') : two(x));
  let r = Math.floor(n); const p = Math.round((n - r) * 100);
  if (r === 0 && !p) return 'Zero Rupees Only';
  const parts = [];
  const cr = Math.floor(r / 1e7); r %= 1e7; const lk = Math.floor(r / 1e5); r %= 1e5; const th = Math.floor(r / 1e3); r %= 1e3;
  if (cr) parts.push(three(cr) + ' Crore'); if (lk) parts.push(two(lk) + ' Lakh'); if (th) parts.push(two(th) + ' Thousand'); if (r) parts.push(three(r));
  return `Rupees ${parts.join(' ')}${p ? ' and ' + two(p) + ' Paise' : ''} Only`;
}

function modeDetailsFields(mode, d = {}) {
  const f = (name, label, type = 'text', extra = '') => html`<div class="fld"><label for="md_${name}">${label}</label><input id="md_${name}" type="${type}" name="md_${name}" value="${d[name] || ''}" ${raw(extra)}></div>`;
  switch (mode) {
    case 'upi': return html`${f('reference', 'UPI transaction ref. *')}${f('upi_id', 'Paid to UPI ID')}${f('paid_by', 'Paid by')}`;
    case 'bank_transfer': return html`${f('reference', 'UTR / transaction ref. *')}${f('bank', 'From bank')}`;
    case 'cheque': return html`${f('cheque_no', 'Cheque number *')}${f('cheque_date', 'Cheque date', 'date')}${f('bank', 'Bank')}`;
    case 'card': return html`${f('card_last4', 'Card last 4 digits', 'text', 'maxlength="4" inputmode="numeric" pattern="[0-9]{4}"')}${f('reference', 'Transaction ref.')}${f('paid_by', 'Card holder')}`;
    case 'credit': return html`${f('due_date', 'Payment due date', 'date')}`;
    case 'cash': return html`${f('paid_by', 'Paid by')}`;
    default: return '';
  }
}
const readModeDetails = (root) => { const o = {}; root.querySelectorAll('[name^="md_"]').forEach((i) => { if (i.value) o[i.name.slice(3)] = i.value; }); return o; };
const modeLabel = (m) => (META && META.modes[m]) || cap(m);

// ---------------- Purchase form ----------------
async function purchaseForm(existing) {
  await meta();
  const L = await loadLookups();
  const p = existing || { date: todayStr(), kind: can.field() || state.me.role === 'staff' ? 'expense' : 'purchase', payment_mode: can.field() ? 'petty_cash' : 'upi', lines: [{ qty: 1, rate: '', gst_rate: 0 }], branch_id: state.me.branch_id, mode_details: {}, update_stock: true };
  const petty = await api('/petty-cash').catch(() => []);
  const modes = can.field() || state.me.role === 'staff' ? ['petty_cash', 'cash', 'upi', 'card'] : Object.keys(META.modes);
  const canApprove = can.finance() || state.me.role === 'manager';
  const lineRow = (l, i) => html`<tr data-line>
    <td style="min-width:200px"><select name="item_id" aria-label="Item" data-itemsel style="margin-bottom:4px">${opts(L.items, l.item_id, { blank: '— Stock item (optional) —' })}</select><input type="text" name="description" placeholder="Description of item / service" value="${l.description || ''}" aria-label="Description"></td>
    <td style="width:90px"><input type="number" step="any" name="qty" value="${l.qty ?? 1}" aria-label="Quantity" inputmode="decimal"></td>
    <td style="width:80px"><input type="text" name="unit" value="${l.unit || ''}" aria-label="Unit" placeholder="pcs"></td>
    <td style="width:110px"><input type="number" step="any" name="rate" value="${l.rate ?? ''}" aria-label="Rate" inputmode="decimal"></td>
    <td style="width:90px"><select name="gst_rate" aria-label="GST %">${opts([0, 5, 12, 18, 28], l.gst_rate || 0)}</select></td>
    <td class="r num" style="width:110px" data-amt>—</td>
    <td style="width:40px"><button type="button" class="btn sm" data-rmline aria-label="Remove line ${i + 1}">✕</button></td></tr>`;
  page(existing ? 'Edit purchase' : 'New purchase', html`
    <div class="pagehead"><div><div class="eyebrow">${existing ? existing.purchase_no : 'Creates a voucher automatically'}</div><h1>${existing ? 'Edit purchase / expense' : 'New purchase / expense'}</h1></div></div>
    ${existing && existing.status === 'approved' ? html`<div class="callout pend">This purchase is already approved. Saving will reverse and re-post stock, petty cash and payment entries, and the change is recorded with your reason.</div>` : ''}
    <form id="pf" class="card ${p.kind === 'purchase' ? '' : 'kind-expense'}" style="display:flex;flex-direction:column;gap:18px" novalidate>
      <div class="form">
        ${can.allBranches() || state.me.role === 'manager' ? html`<div class="fld"><label for="pb">Branch</label><select id="pb" name="branch_id">${opts(L.branches, p.branch_id)}</select></div>` : ''}
        <div class="fld"><label for="pdt">Date</label><input id="pdt" type="date" name="date" value="${p.date}"></div>
        <div class="fld"><div class="lab">Type</div><div class="yn"><label><input type="radio" name="kind" value="purchase" ${p.kind === 'purchase' ? raw('checked') : ''}><span>Items (adds to stock)</span></label><label><input type="radio" name="kind" value="expense" ${p.kind !== 'purchase' ? raw('checked') : ''}><span>Expense / service</span></label></div></div>
        <div class="fld"><label for="pv">Vendor</label><select id="pv" name="vendor_id">${opts(L.vendors, p.vendor_id, { blank: '— Shop / payee not in list —' })}</select></div>
        <div class="fld ${p.vendor_id ? 'hidden' : ''}" data-vname><label for="pvn">Shop / payee name</label><input id="pvn" type="text" name="vendor_name" value="${p.vendor_name || ''}" placeholder="e.g. Local stationery shop"></div>
        <div class="fld"><label for="pc">Expense category</label><select id="pc" name="category_id">${opts(L.categories, p.category_id, { blank: '— Select —' })}</select></div>
        <div class="fld full"><label for="pd">Purpose / description</label><input id="pd" type="text" name="description" value="${p.description || ''}" placeholder="e.g. Stationery for test series"></div>
      </div>
      <div><h3 style="margin-bottom:8px">Items / lines</h3><div style="overflow-x:auto"><table class="lines"><thead><tr><th>Item / description</th><th>Qty</th><th>Unit</th><th>Rate ₹</th><th>GST %</th><th class="r">Amount</th><th></th></tr></thead><tbody id="lines">${p.lines.map(lineRow)}</tbody></table></div>
        <div style="display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-top:8px"><button type="button" class="btn sm" data-addline>${icon('plus')} Add line</button>
        <div class="totals"><div>Subtotal <b class="num" id="tSub">₹0</b></div><div>GST <b class="num" id="tGst">₹0</b></div><div class="big" id="tTot">₹0</div></div></div>
        <label class="chk" data-stockopt><input type="checkbox" name="update_stock" ${p.update_stock !== false ? raw('checked') : ''}> Add item quantities to stock when approved</label>
      </div>
      <div><h3 style="margin-bottom:8px">How was it paid?</h3>
        <div class="modebox" role="radiogroup" aria-label="Payment mode">${modes.map((m) => html`<label><input type="radio" name="payment_mode" value="${m}" ${p.payment_mode === m ? raw('checked') : ''}><b>${META.modes[m].replace(/ \(.*\)/, '')}</b><span>${MODE_HELP[m]}</span></label>`)}</div>
        <div id="pettyInfo" class="small" style="margin-top:8px"></div>
        <div class="form" id="modeFields" style="margin-top:12px">${modeDetailsFields(p.payment_mode, p.mode_details)}</div>
      </div>
      <div class="form">
        <div class="fld"><label for="bn">Bill / invoice no.</label><input id="bn" type="text" name="bill_no" value="${p.bill_no || ''}"></div>
        <div class="fld"><label for="bd">Bill date</label><input id="bd" type="date" name="bill_date" value="${p.bill_date || ''}"></div>
        <div class="fld"><div class="lab">Bill / receipt photo</div><input type="hidden" name="attachment_id" value="${p.attachment_id || ''}"><div class="upl"><label class="btn sm">${icon('camera')} Photo / file<input type="file" class="sr" data-billup accept="image/*,application/pdf"></label><span id="billPrev">${p.attachment_id ? html`<a href="/api/files/${p.attachment_id}" target="_blank" rel="noopener">View bill</a>` : ''}</span></div></div>
      </div>
      ${existing && existing.status === 'approved' ? html`<div class="fld"><label for="er">Reason for editing <span class="req">*</span></label><input id="er" type="text" name="edit_reason"></div>` : ''}
      ${!existing && canApprove ? html`<label class="chk"><input type="checkbox" name="approve_now"> Approve immediately (within my approval limit${state.me.role === 'manager' ? ' of ' + inr(META.managerLimit) : ''})</label>` : ''}
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><a class="btn" href="${existing ? '#/purchase/' + existing.id : '#/purchases'}">Cancel</a><button class="btn pri lg" type="submit">${existing ? 'Save changes' : 'Submit & create voucher'}</button></div>
    </form>`);
  const form = document.getElementById('pf');
  const recalc = () => {
    let sub = 0; let gst = 0;
    form.querySelectorAll('[data-line]').forEach((tr) => {
      const q = Number(tr.querySelector('[name=qty]').value) || 0; const r = Number(tr.querySelector('[name=rate]').value) || 0; const g = Number(tr.querySelector('[name=gst_rate]').value) || 0;
      const a = q * r; sub += a; gst += a * g / 100; tr.querySelector('[data-amt]').textContent = inr(a, true);
    });
    document.getElementById('tSub').textContent = inr(sub, true); document.getElementById('tGst').textContent = inr(gst, true); document.getElementById('tTot').textContent = inr(sub + gst, true);
    const mode = (form.querySelector('[name=payment_mode]:checked') || {}).value;
    const bid = Number((form.querySelector('[name=branch_id]') || {}).value || state.me.branch_id);
    const pc = petty.find((x) => x.branch_id === bid);
    const info = document.getElementById('pettyInfo');
    if (mode === 'petty_cash' && pc) info.innerHTML = html`Petty cash balance at ${pc.branch}: <b class="num" style="color:${pc.balance < sub + gst ? 'var(--crit)' : 'var(--ok)'}">${inr(pc.balance)}</b>${pc.balance < sub + gst ? ' — not enough, ask accounts for a top-up' : ''}`.s;
    else info.innerHTML = '';
  };
  recalc();
  on('input', '#pf', recalc);
  on('change', '#pf [name=payment_mode]', (el) => { document.getElementById('modeFields').innerHTML = modeDetailsFields(el.value, {}).s; recalc(); });
  on('change', '#pf [name=vendor_id]', (el) => form.querySelector('[data-vname]').classList.toggle('hidden', !!el.value));
  on('change', '#pf [name=kind]', (el) => { form.classList.toggle('kind-expense', el.value !== 'purchase'); if (el.value !== 'purchase') form.querySelectorAll('[data-itemsel]').forEach((x) => { x.value = ''; }); });
  on('change', '#pf [data-itemsel]', (el) => {
    const it = L.items.find((x) => String(x.id) === el.value); if (!it) return;
    const tr = el.closest('tr'); tr.querySelector('[name=unit]').value = it.unit; if (!tr.querySelector('[name=rate]').value) tr.querySelector('[name=rate]').value = it.rate;
    if (!tr.querySelector('[name=description]').value) tr.querySelector('[name=description]').value = it.name; recalc();
  });
  on('click', '#pf [data-addline]', () => { document.getElementById('lines').insertAdjacentHTML('beforeend', lineRow({ qty: 1, gst_rate: 0 }, form.querySelectorAll('[data-line]').length).s); });
  on('click', '#pf [data-rmline]', (b) => { if (form.querySelectorAll('[data-line]').length > 1) { b.closest('tr').remove(); recalc(); } });
  on('change', '#pf [data-billup]', async (inp) => { const f = inp.files[0]; if (!f) return; document.getElementById('billPrev').textContent = 'Uploading…'; const up = await uploadFile(f); form.querySelector('[name=attachment_id]').value = up.id; document.getElementById('billPrev').innerHTML = `<a href="/api/files/${up.id}" target="_blank" rel="noopener">View bill</a>`; });
  function collect() {
    const f = formData(form);
    const isExp = f.kind !== 'purchase';
    const lines = [...form.querySelectorAll('[data-line]')].map((tr) => ({ item_id: isExp ? null : (tr.querySelector('[name=item_id]').value || null), description: tr.querySelector('[name=description]').value, qty: tr.querySelector('[name=qty]').value, unit: tr.querySelector('[name=unit]').value, rate: tr.querySelector('[name=rate]').value, gst_rate: tr.querySelector('[name=gst_rate]').value }));
    return { branch_id: f.branch_id, date: f.date, kind: f.kind, vendor_id: f.vendor_id || null, vendor_name: f.vendor_name, category_id: f.category_id || null, description: f.description,
      payment_mode: f.payment_mode, mode_details: readModeDetails(form), bill_no: f.bill_no, bill_date: f.bill_date || null, attachment_id: f.attachment_id || null,
      update_stock: f.update_stock !== false, approve_now: !!f.approve_now, edit_reason: f.edit_reason, lines };
  }
  on('submit', '#pf', async (f) => {
    const btn = f.querySelector('[type=submit]'); btn.disabled = true;
    try {
      const body = collect();
      if (existing) { await put('/purchases/' + existing.id, body); toast('Saved'); go('#/purchase/' + existing.id); } else { const r = await post('/purchases', body); toast('Submitted — voucher created'); go('#/purchase/' + r.id); }
    } catch (e) { err(e); } finally { btn.disabled = false; }
  });
}
route('/purchase/new', () => purchaseForm());
route('/purchase/:id/edit', async ({ id }) => { const p = await api('/purchases/' + id); purchaseForm(p); });

// ---------------- Purchase detail ----------------
route('/purchase/:id', async ({ id }) => {
  await meta();
  const p = await api('/purchases/' + id);
  const hist = can.review() ? await api(`/audit/purchase/${id}`).catch(() => []) : [];
  const outstanding = p.total - p.amount_paid;
  const pendPay = p.vouchers.filter((v) => v.purpose === 'payment' && v.status === 'pending').reduce((a, v) => a + v.amount, 0);
  page(p.purchase_no, html`
    <div class="pagehead"><div><div class="eyebrow">${p.kind === 'purchase' ? 'Purchase' : 'Expense'} · ${p.branch} · ${fdate(p.date)}</div><h1>${p.purchase_no}</h1>
      <div style="display:flex;gap:6px;margin-top:6px">${badge(p.status)}${p.status === 'approved' ? badge(p.payment_status) : ''}</div></div>
      <div class="actions">
        ${p.can_approve ? html`<button class="btn" data-rej>Reject</button><button class="btn ok" data-appr>${icon('check')} Approve ${inr(p.total)}</button>` : ''}
        ${p.status === 'approved' && outstanding - pendPay > 0.5 && (can.finance() || state.me.role === 'manager') ? html`<button class="btn pri" data-pay>Record payment</button>` : ''}
        ${['submitted', 'approved'].includes(p.status) && (p.status === 'submitted' || can.finance()) ? html`<a class="btn" href="#/purchase/${p.id}/edit">${icon('edit')} Edit</a>` : ''}
        ${can.finance() && !['cancelled', 'rejected'].includes(p.status) ? html`<button class="btn danger" data-cancel>Cancel</button>` : ''}
      </div></div>
    ${p.status === 'rejected' || p.status === 'cancelled' ? html`<div class="callout crit">${cap(p.status)}: ${p.reject_reason || ''}</div>` : ''}
    <div class="grid g2">
      <div class="card"><h2 style="margin-bottom:12px">Details</h2><dl class="kv">
        <dt>Vendor / payee</dt><dd>${p.vendor_id ? html`<a href="#/vendor/${p.vendor_id}">${p.vendor}</a>` : p.vendor || '—'}${p.vendor_gstin ? html` <span class="tiny muted">GSTIN ${p.vendor_gstin}</span>` : ''}</dd>
        <dt>Category</dt><dd>${p.category || '—'}</dd><dt>Description</dt><dd>${p.description || '—'}</dd>
        <dt>Payment mode</dt><dd>${modeLabel(p.payment_mode)}${Object.entries(p.mode_details || {}).map(([k, v]) => html`<div class="tiny muted">${cap(k)}: ${v}</div>`)}</dd>
        <dt>Bill no. / date</dt><dd>${p.bill_no || '—'} ${p.bill_date ? '· ' + fdate(p.bill_date) : ''}</dd>
        <dt>Bill</dt><dd>${p.attachment_id ? html`<a href="/api/files/${p.attachment_id}" target="_blank" rel="noopener">${p.attachment_name || 'View'}</a>` : '—'}</dd>
        <dt>Created by</dt><dd>${p.created_by_name} · ${fdt(p.created_at)}</dd>
        ${p.approved_by_name ? html`<dt>${p.status === 'rejected' ? 'Rejected' : 'Approved'} by</dt><dd>${p.approved_by_name} · ${fdt(p.approved_at)}</dd>` : ''}
        <dt>Total</dt><dd class="num" style="font-size:20px;font-weight:700">${inr(p.total, true)}</dd>
        ${p.status === 'approved' ? html`<dt>Paid / outstanding</dt><dd class="num">${inr(p.amount_paid, true)} / <b style="color:${outstanding > 0.5 ? 'var(--high)' : 'inherit'}">${inr(outstanding, true)}</b></dd>` : ''}
      </dl></div>
      <div class="card"><h2 style="margin-bottom:12px">Vouchers</h2>
        <ul class="att">${p.vouchers.map((v) => html`<li><span class="t"><a href="#/voucher/${v.id}" style="font-weight:600">${v.voucher_no}</a><br><span class="tiny muted">${META.voucherTypes[v.type]} · ${modeLabel(v.payment_mode)} · ${fdate(v.date)}</span></span>${badge(v.status)}<b class="num small">${inr(v.amount)}</b><a class="btn sm" href="#/voucher/${v.id}">${icon('print')}</a></li>`)}</ul>
        <div class="tiny muted" style="margin-top:8px">Every purchase creates a voucher automatically. Credit purchases get a journal voucher now and a payment voucher when paid.</div></div>
    </div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>Item / description</th><th class="r">Qty</th><th>Unit</th><th class="r">Rate</th><th class="r">GST %</th><th class="r">Amount</th></tr></thead><tbody>
      ${p.lines.map((l, i) => html`<tr><td>${i + 1}</td><td>${l.item_name ? html`<b>${l.item_name}</b> ` : ''}${l.description && l.description !== l.item_name ? l.description : ''}</td><td class="r num">${l.qty}</td><td>${l.unit || ''}</td><td class="r num">${inr(l.rate, true)}</td><td class="r num">${l.gst_rate}</td><td class="r num">${inr(l.amount, true)}</td></tr>`)}
      <tr><td colspan="6" class="r">Subtotal</td><td class="r num">${inr(p.subtotal, true)}</td></tr><tr><td colspan="6" class="r">GST</td><td class="r num">${inr(p.gst_amount, true)}</td></tr><tr><td colspan="6" class="r"><b>Total</b></td><td class="r num"><b>${inr(p.total, true)}</b></td></tr>
    </tbody></table></div>
    ${hist.length ? html`<div class="card"><h2 style="margin-bottom:10px">History</h2><ul class="att">${hist.map((h) => html`<li class="small"><span class="t"><b>${cap(h.action)}</b> by ${h.user_name}${h.reason ? html` — <i>${h.reason}</i>` : ''}</span><span class="tiny muted">${fdt(h.at)}</span></li>`)}</ul></div>` : ''}`);
  on('click', '[data-appr]', async () => { await post(`/purchases/${id}/approve`); toast('Approved and posted'); go(location.hash); });
  on('click', '[data-rej]', async () => { const r = await promptReason('Reject purchase', 'Reason', { danger: true, okLabel: 'Reject' }); if (r === null) return; await post(`/purchases/${id}/reject`, { reason: r }); toast('Rejected'); go(location.hash); });
  on('click', '[data-cancel]', async () => { const r = await promptReason('Cancel purchase', 'Reason (stock, petty cash and payments will be reversed)', { danger: true, okLabel: 'Cancel purchase' }); if (r === null) return; await post(`/purchases/${id}/cancel`, { reason: r }); toast('Cancelled'); go(location.hash); });
  on('click', '[data-pay]', () => paymentModal(p, outstanding - pendPay));
});

async function paymentModal(p, due) {
  const modes = Object.keys(META.modes).filter((m) => m !== 'credit');
  await modal(`Pay ${p.vendor || 'vendor'} — ${p.purchase_no}`, html`<div class="form" id="payf">
    <div class="fld"><label for="pa">Amount (outstanding ${inr(due, true)})</label><input id="pa" type="number" step="any" name="amount" value="${Math.round(due * 100) / 100}"></div>
    <div class="fld"><label for="pdx">Date</label><input id="pdx" type="date" name="date" value="${todayStr()}"></div>
    <div class="fld full"><div class="lab">Payment mode</div><div class="modebox">${modes.map((m, i) => html`<label><input type="radio" name="payment_mode" value="${m}" ${i === 3 ? raw('checked') : ''}><b>${META.modes[m].replace(/ \(.*\)/, '')}</b></label>`)}</div></div>
    <div class="form full" id="payModeF">${modeDetailsFields('bank_transfer')}</div>
    <div class="fld full"><label for="pn">Narration</label><input id="pn" type="text" name="narration" placeholder="Payment against bill ${p.bill_no || ''}"></div>
    ${can.finance() || state.me.role === 'manager' ? html`<label class="chk full"><input type="checkbox" name="approve_now" checked> Approve now (if within my limit)</label>` : ''}</div>`, {
    onMount: (ctx) => {
      ctx.el.addEventListener('change', (e) => { if (e.target.name === 'payment_mode') ctx.el.querySelector('#payModeF').innerHTML = modeDetailsFields(e.target.value).s; });
      ctx.onAction = async (a, el) => { if (a !== 'ok') return; const f = formData(el); const r = await post(`/purchases/${p.id}/payments`, { ...f, mode_details: readModeDetails(el) }); toast('Payment voucher created'); go('#/voucher/' + r.id); return true; };
    }
  });
}

// ---------------- Purchases list ----------------
route('/purchases', async (p, query) => {
  await meta();
  const qs = new URLSearchParams(query).toString();
  const rows = await api('/purchases?' + qs);
  const tot = rows.filter((r) => r.status === 'approved').reduce((a, r) => a + r.total, 0);
  page('Purchases', html`
    <div class="pagehead"><div><h1>${can.field() ? 'My purchases & errands' : 'Purchases & expenses'}</h1><div class="small muted">${rows.length} records · approved ${inr(tot)}</div></div>
      <div class="actions"><button class="btn" data-xl>Export Excel</button><a class="btn pri" href="#/purchase/new">${icon('plus')} New purchase</a></div></div>
    <form class="filters card tight" data-form="flt">
      <div class="fld"><label for="fq">Search</label><input id="fq" type="search" name="q" value="${query.q || ''}" placeholder="No., vendor, bill…"></div>
      <div class="fld"><label for="fs">Status</label><select id="fs" name="status">${opts(['submitted', 'approved', 'rejected', 'cancelled'].map((x) => ({ id: x, name: cap(x) })), query.status, { blank: 'All' })}</select></div>
      <div class="fld"><label for="fm">Payment mode</label><select id="fm" name="mode">${opts(Object.entries(META.modes).map(([k, v]) => ({ id: k, name: v })), query.mode, { blank: 'All' })}</select></div>
      <div class="fld"><label for="fps">Payment</label><select id="fps" name="payment_status">${opts([{ id: 'unpaid', name: 'Unpaid' }, { id: 'partial', name: 'Part paid' }, { id: 'paid', name: 'Paid' }], query.payment_status, { blank: 'All' })}</select></div>
      ${can.allBranches() ? html`<div class="fld"><label for="fb">Branch</label><select id="fb" name="branch_id">${opts(state.lookups.branches, query.branch_id, { blank: 'All' })}</select></div>` : ''}
      <div class="fld"><label for="ff">From</label><input id="ff" type="date" name="from" value="${query.from || ''}"></div><div class="fld"><label for="ft">To</label><input id="ft" type="date" name="to" value="${query.to || ''}"></div>
      <button class="btn" type="submit">Filter</button></form>
    <div class="tbl-wrap"><table class="tbl" id="ptbl"><thead><tr><th>Date</th><th>No.</th><th>Vendor / payee</th><th>Category</th><th>Mode</th><th>Voucher</th><th class="r">Total</th><th>Status</th><th>Payment</th>${can.allBranches() ? html`<th>Branch</th>` : ''}</tr></thead><tbody>
      ${rows.length ? rows.map((r) => html`<tr class="click" data-href="#/purchase/${r.id}"><td>${fdate(r.date)}</td><td><a href="#/purchase/${r.id}">${r.purchase_no}</a></td><td>${r.vendor || '—'}<div class="tiny muted">${r.description || ''}</div></td><td>${r.category || ''}</td><td>${modeLabel(r.payment_mode).replace(/ \(.*\)/, '')}</td><td class="tiny">${r.voucher_no || ''}</td><td class="r num">${inr(r.total)}</td><td>${badge(r.status)}</td><td>${r.status === 'approved' ? badge(r.payment_status) : ''}</td>${can.allBranches() ? html`<td>${r.branch}</td>` : ''}</tr>`) : html`<tr><td colspan="10" class="empty">No purchases found.</td></tr>`}
    </tbody></table></div>`);
  on('submit', '[data-form="flt"]', (f) => { const o = Object.fromEntries([...new FormData(f)].filter(([, v]) => v)); go('#/purchases?' + new URLSearchParams(o)); });
  on('click', 'tr[data-href]', (tr, ev) => { if (!ev.target.closest('a')) go(tr.dataset.href); });
  on('click', '[data-xl]', () => { const wb = window.XLSX.utils.table_to_book(document.getElementById('ptbl')); window.XLSX.writeFile(wb, `purchases-${todayStr()}.xlsx`); });
});

// ---------------- Vouchers ----------------
route('/vouchers', async (p, query) => {
  await meta();
  const rows = await api('/vouchers?' + new URLSearchParams(query));
  page('Vouchers', html`
    <div class="pagehead"><div><h1>Vouchers</h1><div class="small muted">Generated automatically for every purchase, payment and petty cash top-up</div></div>
      <div class="actions"><button class="btn" data-xl>Export Excel</button>${can.finance() ? html`<a class="btn" href="#/petty-cash">Petty cash top-up</a>` : ''}</div></div>
    <div class="legend small">${Object.entries(META.voucherTypes).map(([k, v]) => html`<span><b>${k}</b> ${v}</span>`)}</div>
    <form class="filters card tight" data-form="flt">
      <div class="fld"><label for="vq">Search</label><input id="vq" type="search" name="q" value="${query.q || ''}" placeholder="Voucher no., payee…"></div>
      <div class="fld"><label for="vt">Type</label><select id="vt" name="type">${opts(Object.keys(META.voucherTypes), query.type, { blank: 'All' })}</select></div>
      <div class="fld"><label for="vs">Status</label><select id="vs" name="status">${opts(['pending', 'approved', 'rejected', 'cancelled'], query.status, { blank: 'All' })}</select></div>
      <div class="fld"><label for="vm">Mode</label><select id="vm" name="mode">${opts(Object.entries(META.modes).map(([k, v]) => ({ id: k, name: v })), query.mode, { blank: 'All' })}</select></div>
      ${can.allBranches() ? html`<div class="fld"><label for="vb">Branch</label><select id="vb" name="branch_id">${opts(state.lookups.branches, query.branch_id, { blank: 'All' })}</select></div>` : ''}
      <div class="fld"><label for="vf">From</label><input id="vf" type="date" name="from" value="${query.from || ''}"></div><div class="fld"><label for="vto">To</label><input id="vto" type="date" name="to" value="${query.to || ''}"></div>
      <button class="btn" type="submit">Filter</button></form>
    <div class="tbl-wrap"><table class="tbl" id="vtbl"><thead><tr><th>Date</th><th>Voucher no.</th><th>Type</th><th>Payee</th><th>Mode</th><th>Narration</th><th class="r">Amount</th><th>Status</th></tr></thead><tbody>
      ${rows.length ? rows.map((v) => html`<tr class="click" data-href="#/voucher/${v.id}"><td>${fdate(v.date)}</td><td><a href="#/voucher/${v.id}">${v.voucher_no}</a></td><td>${v.type}</td><td>${v.payee || ''}</td><td>${modeLabel(v.payment_mode).replace(/ \(.*\)/, '')}</td><td class="small">${v.narration || ''}</td><td class="r num">${inr(v.amount)}</td><td>${badge(v.status)}</td></tr>`) : html`<tr><td colspan="8" class="empty">No vouchers.</td></tr>`}
    </tbody></table></div>`);
  on('submit', '[data-form="flt"]', (f) => { const o = Object.fromEntries([...new FormData(f)].filter(([, v]) => v)); go('#/vouchers?' + new URLSearchParams(o)); });
  on('click', 'tr[data-href]', (tr, ev) => { if (!ev.target.closest('a')) go(tr.dataset.href); });
  on('click', '[data-xl]', () => { const wb = window.XLSX.utils.table_to_book(document.getElementById('vtbl')); window.XLSX.writeFile(wb, `vouchers-${todayStr()}.xlsx`); });
});

route('/voucher/:id', async ({ id }) => {
  await meta();
  const v = await api('/vouchers/' + id);
  const stampColor = { approved: '#2E6B45', pending: '#7A5200', rejected: '#A61B1B', cancelled: '#A61B1B' }[v.status];
  page(v.voucher_no, html`
    <div class="pagehead noprint"><div><div class="eyebrow">${v.type_label}</div><h1>${v.voucher_no}</h1></div>
      <div class="actions">${v.purchase_id ? html`<a class="btn" href="#/purchase/${v.purchase_id}">Open purchase</a>` : ''}
        ${v.can_approve ? html`<button class="btn" data-rej>Reject</button><button class="btn ok" data-appr>${icon('check')} Approve</button>` : ''}
        ${can.finance() && v.purpose !== 'purchase' && ['pending', 'approved'].includes(v.status) ? html`<button class="btn danger" data-cancel>Cancel voucher</button>` : ''}
        <button class="btn pri" data-print>${icon('print')} Print / Save PDF</button></div></div>
    <div class="voucher">
      <div class="vh"><div><div style="font-size:20px;font-weight:700;color:#400C4D">${v.company_name}</div><div class="small">${v.branch}${v.branch_address ? ' · ' + v.branch_address : ''}</div></div>
        <div style="text-align:right"><div style="font-size:17px;font-weight:700;text-transform:uppercase">${v.type_label}</div><div class="num">${v.voucher_no}</div><div>Date: ${fdate(v.date)}</div></div></div>
      <table><tbody>
        <tr><th style="width:28%">${v.purpose === 'petty_topup' ? 'Received by' : 'Paid to'}</th><td>${v.payee || '—'}${v.vendor_gstin ? html` <span class="small">(GSTIN ${v.vendor_gstin})</span>` : ''}</td></tr>
        <tr><th>Amount</th><td><b class="num" style="font-size:18px">${inr(v.amount, true)}</b><div class="small">${amountInWords(v.amount)}</div></td></tr>
        <tr><th>Payment mode</th><td>${v.mode_label}${Object.entries(v.mode_details || {}).map(([k, x]) => html` · ${cap(k)}: <b>${x}</b>`)}</td></tr>
        ${v.purchase_no ? html`<tr><th>Against</th><td>${v.purchase_no}${v.bill_no ? ` · Bill ${v.bill_no}` : ''}${v.bill_date ? ` dated ${fdate(v.bill_date)}` : ''}${v.category ? ` · ${v.category}` : ''}</td></tr>` : ''}
        <tr><th>Narration</th><td>${v.narration || ''}</td></tr>
      </tbody></table>
      ${v.lines.length ? html`<table><thead><tr><th>#</th><th>Particulars</th><th>Qty</th><th>Rate</th><th>GST %</th><th>Amount</th></tr></thead><tbody>${v.lines.map((l, i) => html`<tr><td>${i + 1}</td><td>${l.item_name || l.description}</td><td>${l.qty} ${l.unit || ''}</td><td class="num">${inr(l.rate, true)}</td><td>${l.gst_rate}</td><td class="num">${inr(l.amount, true)}</td></tr>`)}</tbody></table>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px"><div class="small">Prepared by ${v.created_by_name} on ${fdt(v.created_at)}${v.approved_by_name ? html`<br>${v.status === 'approved' ? 'Approved' : cap(v.status)} by ${v.approved_by_name} on ${fdt(v.approved_at)}` : ''}${v.reject_reason ? html`<br>Reason: ${v.reject_reason}` : ''}</div>
        <span class="stamp" style="color:${stampColor};border-color:${stampColor}">${v.status.toUpperCase()}</span></div>
      ${v.attachment_id ? html`<div class="small noprint" style="margin-top:8px"><a href="/api/files/${v.attachment_id}" target="_blank" rel="noopener">View attached bill</a></div>` : ''}
      <div class="sigs"><div>Prepared by</div><div>Checked by</div><div>Approved by</div><div>Receiver's signature</div></div>
    </div>`);
  on('click', '[data-print]', () => window.print());
  on('click', '[data-appr]', async () => { await post(`/vouchers/${id}/approve`); toast('Approved'); go(location.hash); });
  on('click', '[data-rej]', async () => { const r = await promptReason('Reject voucher', 'Reason', { danger: true, okLabel: 'Reject' }); if (r === null) return; await post(`/vouchers/${id}/reject`, { reason: r }); go(location.hash); });
  on('click', '[data-cancel]', async () => { const r = await promptReason('Cancel voucher', 'Reason (its effect will be reversed)', { danger: true, okLabel: 'Cancel voucher' }); if (r === null) return; await post(`/vouchers/${id}/cancel`, { reason: r }); go(location.hash); });
});

// ---------------- Approvals ----------------
route('/approvals', async () => {
  await meta();
  const rows = await api('/approvals');
  page('Approvals', html`
    <div class="pagehead"><div><h1>Approvals</h1><div class="small muted">${rows.length} voucher(s) waiting · ${inr(rows.reduce((a, r) => a + r.amount, 0))}${state.me.role === 'manager' ? ` · your limit ${inr(META.managerLimit)}` : ''}</div></div>
      <div class="actions">${rows.some((r) => r.can_approve) ? html`<button class="btn ok" data-all>${icon('check')} Approve all I can</button>` : ''}</div></div>
    ${rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Voucher</th><th>Purpose</th><th>Payee</th><th>Mode</th><th>Raised by</th><th class="r">Amount</th><th></th></tr></thead><tbody>
      ${rows.map((v) => html`<tr><td>${fdate(v.date)}</td><td><a href="#/voucher/${v.id}">${v.voucher_no}</a>${v.purchase_no ? html`<div class="tiny"><a href="#/purchase/${v.purchase_id}">${v.purchase_no}</a></div>` : ''}</td><td>${cap(v.purpose)}</td><td>${v.payee || ''}<div class="tiny muted">${v.narration || ''}</div></td><td>${modeLabel(v.payment_mode).replace(/ \(.*\)/, '')}</td><td>${v.created_by_name}<div class="tiny muted">${v.branch}</div></td><td class="r num"><b>${inr(v.amount)}</b></td>
        <td style="white-space:nowrap">${v.can_approve ? html`<button class="btn sm" data-rej="${v.id}">Reject</button> <button class="btn sm ok" data-ap="${v.id}">Approve</button>` : html`<span class="tiny muted">Above your limit</span>`}</td></tr>`)}
    </tbody></table></div>` : html`<div class="card empty">Nothing waiting for approval.</div>`}`);
  on('click', '[data-ap]', async (b) => { b.disabled = true; await post(`/vouchers/${b.dataset.ap}/approve`); toast('Approved'); go(location.hash); });
  on('click', '[data-rej]', async (b) => { const r = await promptReason('Reject', 'Reason', { danger: true, okLabel: 'Reject' }); if (r === null) return; await post(`/vouchers/${b.dataset.rej}/reject`, { reason: r }); go(location.hash); });
  on('click', '[data-all]', async (b) => {
    if (!(await confirmBox('Approve all', 'Approve every voucher within your limit?'))) return; b.disabled = true;
    let ok = 0; for (const v of rows.filter((x) => x.can_approve)) { try { await post(`/vouchers/${v.id}/approve`); ok += 1; } catch (e) { err(new Error(`${v.voucher_no}: ${e.message}`)); } }
    toast(`${ok} approved`); go(location.hash);
  });
});

// ---------------- Petty cash ----------------
route('/petty-cash', async (p, query) => {
  await meta();
  const bals = await api('/petty-cash');
  const bid = Number(query.branch_id || (bals[0] && bals[0].branch_id));
  const from = query.from || addDays(todayStr(), -30); const to = query.to || todayStr();
  const book = can.review() ? await api(`/petty-cash/book?branch_id=${bid}&from=${from}&to=${to}`) : { rows: [], opening: 0, closing: 0 };
  page('Petty cash', html`
    <div class="pagehead"><div><h1>Petty cash</h1><div class="small muted">Spends are recorded by choosing "Petty cash" on a purchase. Each spend creates a Petty Cash Voucher (PCV).</div></div>
      <div class="actions"><a class="btn" href="#/purchase/new">${icon('plus')} Petty cash spend</a>${can.finance() ? html`<button class="btn pri" data-topup>Top up petty cash</button>` : ''}</div></div>
    <div class="kpis">${bals.map((b) => html`<a class="kpi" href="#/petty-cash?branch_id=${b.branch_id}" style="${b.branch_id === bid ? 'border-color:var(--brand)' : ''}"><span class="l">${b.branch}</span><span class="v" style="color:${b.balance < 3000 ? 'var(--high)' : 'inherit'}">${inr(b.balance)}</span><span class="n">Spent this month ${inr(b.spent_mtd)} · topped up ${inr(b.topups_mtd)}</span></a>`)}</div>
    ${can.review() ? html`<div class="card"><div class="card-h"><h2>Petty cash book — ${(bals.find((b) => b.branch_id === bid) || {}).branch || ''}</h2>
        <form class="filters" data-form="pb"><input type="hidden" name="branch_id" value="${bid}"><div class="fld"><label for="pf1">From</label><input id="pf1" type="date" name="from" value="${from}"></div><div class="fld"><label for="pt1">To</label><input id="pt1" type="date" name="to" value="${to}"></div><button class="btn" type="submit">Show</button><button class="btn" type="button" data-xl>Excel</button></form></div>
      <div class="chart-box sm" style="margin-bottom:12px"><canvas id="cPc" role="img" aria-label="Petty cash balance over time"></canvas></div>
      <div class="tbl-wrap"><table class="tbl" id="pctbl"><thead><tr><th>Date</th><th>Voucher</th><th>Particulars</th><th class="r">Receipt</th><th class="r">Payment</th><th class="r">Balance</th></tr></thead><tbody>
        <tr><td>${fdate(from)}</td><td></td><td><b>Opening balance</b></td><td></td><td></td><td class="r num"><b>${inr(book.opening, true)}</b></td></tr>
        ${book.rows.map((r) => html`<tr><td>${fdate(r.date)}</td><td>${r.vid ? html`<a href="#/voucher/${r.vid}">${r.voucher_no}</a>` : cap(r.type)}</td><td>${r.narration || ''}<div class="tiny muted">${r.created_by_name || ''}</div></td><td class="r num">${r.amount > 0 ? inr(r.amount, true) : ''}</td><td class="r num">${r.amount < 0 ? inr(-r.amount, true) : ''}</td><td class="r num">${inr(r.balance, true)}</td></tr>`)}
        <tr><td colspan="5" class="r"><b>Closing balance</b></td><td class="r num"><b>${inr(book.closing, true)}</b></td></tr></tbody></table></div></div>` : ''}`);
  on('submit', '[data-form="pb"]', (f) => go('#/petty-cash?' + new URLSearchParams(new FormData(f))));
  on('click', '[data-xl]', () => { const wb = window.XLSX.utils.table_to_book(document.getElementById('pctbl')); window.XLSX.writeFile(wb, `petty-cash-${from}-${to}.xlsx`); });
  if (book.rows.length) {
    chart('cPc', { type: 'line', data: { labels: book.rows.map((r) => fdateShort(r.date)), datasets: [{ label: 'Balance', data: book.rows.map((r) => r.balance), borderColor: PALETTE[2], backgroundColor: PALETTE[2] + '22', fill: true, stepped: true, pointRadius: 0, borderWidth: 2 }] },
      options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => inr(c.raw) } } }, scales: { y: { beginAtZero: true, ticks: moneyTick } } } });
  }
  on('click', '[data-topup]', async () => {
    const modes = ['cash', 'bank_transfer', 'upi', 'cheque'];
    await modal('Top up petty cash', html`<div class="form" id="tuf">
      <div class="fld"><label for="tb">Branch</label><select id="tb" name="branch_id">${opts(state.lookups.branches, bid)}</select></div>
      <div class="fld"><label for="ta">Amount ₹</label><input id="ta" type="number" name="amount" step="any"></div>
      <div class="fld"><label for="tdt">Date</label><input id="tdt" type="date" name="date" value="${todayStr()}"></div>
      <div class="fld"><label for="tp">Handed to (custodian)</label><input id="tp" type="text" name="payee"></div>
      <div class="fld full"><div class="lab">Source</div><div class="modebox">${modes.map((m, i) => html`<label><input type="radio" name="payment_mode" value="${m}" ${i === 0 ? raw('checked') : ''}><b>${META.modes[m].replace(/ \(.*\)/, '')}</b></label>`)}</div></div>
      <div class="form full" id="tuMode">${modeDetailsFields('cash')}</div>
      <div class="fld full"><label for="tn">Narration</label><input id="tn" type="text" name="narration" value="Petty cash top-up"></div></div>`, {
      onMount: (ctx) => {
        ctx.el.addEventListener('change', (e) => { if (e.target.name === 'payment_mode') ctx.el.querySelector('#tuMode').innerHTML = modeDetailsFields(e.target.value).s; });
        ctx.onAction = async (a, el) => { if (a !== 'ok') return; const f = formData(el); const r = await post('/petty-cash/topup', { ...f, mode_details: readModeDetails(el) }); toast('Topped up — receipt voucher created'); go('#/voucher/' + r.id); return true; };
      }
    });
  });
});

// ---------------- Vendors ----------------
async function vendorModal(v) {
  v = v || { active: true };
  return modal(v.id ? 'Edit vendor' : 'Add vendor', html`<div class="form">
    <div class="fld"><label for="vn">Name *</label><input id="vn" name="name" type="text" value="${v.name || ''}"></div>
    <div class="fld"><label for="vc">Category</label><input id="vc" name="category" type="text" list="dlcat" value="${v.category || ''}"><datalist id="dlcat">${state.lookups.categories.map((c) => html`<option value="${c.name}">`)}</datalist></div>
    <div class="fld"><label for="vp">Phone</label><input id="vp" name="phone" type="tel" value="${v.phone || ''}"></div>
    <div class="fld"><label for="ve">Email</label><input id="ve" name="email" type="email" value="${v.email || ''}"></div>
    <div class="fld"><label for="vg">GSTIN</label><input id="vg" name="gstin" type="text" value="${v.gstin || ''}"></div>
    <div class="fld"><label for="va">Address</label><input id="va" name="address" type="text" value="${v.address || ''}"></div>
    ${can.finance() ? html`<div class="fld full"><label for="vbk">Bank details (visible to Owner/Admin/Accounts only)</label><input id="vbk" name="bank_details" type="text" value="${v.bank_details || ''}"></div>` : ''}
    <label class="chk"><input type="checkbox" name="active" ${v.active ? raw('checked') : ''}> Active</label></div>`, {
    onMount: (ctx) => { ctx.onAction = async (a, el) => { if (a !== 'ok') return; const f = formData(el); if (v.id) await put('/vendors/' + v.id, f); else await post('/vendors', f); await loadLookups(true); toast('Saved'); return true; }; }
  });
}
route('/vendors', async () => {
  const rows = await api('/vendors');
  page('Vendors', html`<div class="pagehead"><h1>Vendors</h1><div class="actions"><button class="btn pri" data-add>${icon('plus')} Add vendor</button></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Category</th><th>Phone</th><th>GSTIN</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map((v) => html`<tr><td><a href="#/vendor/${v.id}"><b>${v.name}</b></a></td><td>${v.category || ''}</td><td>${v.phone || ''}</td><td>${v.gstin || ''}</td><td>${v.active ? badge('approved', 'Active') : badge('cancelled', 'Inactive')}</td><td><button class="btn sm" data-ed="${v.id}">${icon('edit')} Edit</button></td></tr>`)}</tbody></table></div>`);
  on('click', '[data-add]', async () => { if (await vendorModal()) go(location.hash); });
  on('click', '[data-ed]', async (b) => { if (await vendorModal(rows.find((r) => r.id === Number(b.dataset.ed)))) go(location.hash); });
});
route('/vendor/:id', async ({ id }) => {
  await meta();
  const d = await api(`/vendors/${id}/ledger`);
  const v = d.vendor;
  page(v.name, html`<div class="pagehead"><div><div class="eyebrow">Vendor history</div><h1>${v.name}</h1><div class="small muted">${[v.category, v.phone, v.gstin && 'GSTIN ' + v.gstin, v.address].filter(Boolean).join(' · ')}</div></div><div class="actions"><button class="btn" data-ed>${icon('edit')} Edit</button><a class="btn pri" href="#/purchase/new">${icon('plus')} New purchase</a></div></div>
    <div class="kpis"><div class="kpi"><span class="l">Total purchased</span><span class="v">${inr(d.totals.purchased)}</span></div><div class="kpi"><span class="l">Paid</span><span class="v">${inr(d.totals.paid)}</span></div><div class="kpi"><span class="l">Outstanding</span><span class="v" style="color:${d.totals.outstanding > 0 ? 'var(--high)' : 'inherit'}">${inr(d.totals.outstanding)}</span></div><div class="kpi"><span class="l">Bills</span><span class="v">${d.purchases.length}</span></div></div>
    ${v.bank_details ? html`<div class="callout info small">Bank: ${v.bank_details}</div>` : ''}
    <div class="grid g2"><div class="card"><h2 style="margin-bottom:10px">Purchases</h2><div class="tbl-wrap" style="border:0"><table class="tbl"><thead><tr><th>Date</th><th>No.</th><th>Bill</th><th class="r">Total</th><th class="r">Paid</th><th>Status</th></tr></thead><tbody>
      ${d.purchases.map((p) => html`<tr><td>${fdate(p.date)}</td><td><a href="#/purchase/${p.id}">${p.purchase_no}</a></td><td>${p.bill_no || ''}</td><td class="r num">${inr(p.total)}</td><td class="r num">${inr(p.amount_paid)}</td><td>${badge(p.status === 'approved' ? p.payment_status : p.status)}</td></tr>`)}</tbody></table></div></div>
    <div class="card"><h2 style="margin-bottom:10px">Vouchers</h2><ul class="att">${d.vouchers.map((x) => html`<li class="small"><span class="t"><a href="#/voucher/${x.id}">${x.voucher_no}</a> · ${cap(x.purpose)} · ${fdate(x.date)}</span>${badge(x.status)}<b class="num">${inr(x.amount)}</b></li>`)}</ul>
      ${d.documents.length ? html`<h3 style="margin:12px 0 6px">Contracts & documents</h3><ul class="att">${d.documents.map((x) => html`<li class="small"><span class="t">${x.title}</span><span class="tiny muted">${x.expires_on ? 'expires ' + fdate(x.expires_on) : ''}</span></li>`)}</ul>` : ''}</div></div>`);
  on('click', '[data-ed]', async () => { if (await vendorModal(v)) go(location.hash); });
});
