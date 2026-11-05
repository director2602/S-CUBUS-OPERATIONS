// Excel / CSV upload. ADD-ONLY: every import creates new records through the same rules as the screens.
// Existing records are never updated or deleted; exact duplicates are detected and skipped.
const express = require('express');
const bcrypt = require('bcryptjs');
const { q, one, tx } = require('../db');
const { ah, bad, forbidden, isMgmt, isFinance, isReviewer, seesAll, FIELD_ROLES, ROLES, audit, today } = require('../lib');
const F = require('../finance');
const ops = require('./ops');
const store = require('./store');

const r = express.Router();
const MAX_ROWS = 2000;

// ---------- value parsing ----------
const norm = (s) => String(s ?? '').toLowerCase().replace(/\*/g, '').replace(/[^a-z0-9%]+/g, ' ').trim();
const blank = (v) => v === undefined || v === null || String(v).trim() === '';
const str = (v) => (blank(v) ? '' : String(v).trim());
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, '0');
function validYmd(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
function parseDate(v, label = 'Date') {
  if (blank(v)) return null;
  const s = String(v).trim();
  let m;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) { const [y, mo, d] = [+m[1], +m[2], +m[3]]; if (validYmd(y, mo, d)) return `${y}-${pad(mo)}-${pad(d)}`; }
  if ((m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})(?:\s|$)/.exec(s))) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3]; const [d, mo] = [+m[1], +m[2]];
    if (validYmd(y, mo, d)) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  if ((m = /^(\d{1,2})[\s\-]+([a-z]{3,9})[\s\-,]+(\d{2,4})/i.exec(s))) {
    const mo = MONTHS[m[2].toLowerCase().slice(0, m[2].toLowerCase().startsWith('sept') ? 4 : 3)]; const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    if (mo && validYmd(y, mo, +m[1])) return `${y}-${pad(mo)}-${pad(+m[1])}`;
  }
  if ((m = /^([a-z]{3,9})[\s\-]+(\d{1,2}),?[\s\-]+(\d{4})/i.exec(s))) {
    const mo = MONTHS[m[1].toLowerCase().slice(0, 3)]; if (mo && validYmd(+m[3], mo, +m[2])) return `${m[3]}-${pad(mo)}-${pad(+m[2])}`;
  }
  if (/^\d{4,5}(\.\d+)?$/.test(s) && +s > 20000 && +s < 80000) {
    const dt = new Date(Date.UTC(1899, 11, 30) + Math.floor(+s) * 864e5); return dt.toISOString().slice(0, 10);
  }
  throw bad(`${label}: “${s}” is not a date. Use DD/MM/YYYY, e.g. 24/10/2026.`);
}
function parseTime(v, label = 'Time') {
  if (blank(v)) return null;
  const s = String(v).trim();
  let m;
  if ((m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*(am|pm)?$/i.exec(s))) {
    let h = +m[1]; const mi = +m[2]; const ap = (m[3] || '').toLowerCase();
    if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0;
    if (h < 24 && mi < 60) return `${pad(h)}:${pad(mi)}`;
  }
  if ((m = /^(\d{1,2})\s*(am|pm)$/i.exec(s))) { let h = +m[1]; if (m[2].toLowerCase() === 'pm' && h < 12) h += 12; if (m[2].toLowerCase() === 'am' && h === 12) h = 0; return `${pad(h)}:00`; }
  if (/^0?\.\d+$/.test(s)) { const mins = Math.round(+s * 1440); return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`; }
  throw bad(`${label}: “${s}” is not a time. Use HH:MM, e.g. 14:30 or 2:30 PM.`);
}
function parseDateTime(v, label, fallbackDate) {
  if (blank(v)) return null;
  const s = String(v).trim();
  if (/^\d{1,2}:\d{2}/.test(s) || /^\d{1,2}\s*(am|pm)$/i.test(s)) { if (!fallbackDate) throw bad(`${label}: add the date too.`); return `${fallbackDate}T${parseTime(s, label)}`; }
  if (/^\d{4,5}\.\d+$/.test(s)) { const n = +s; const d = parseDate(String(Math.floor(n)), label); const mins = Math.round((n % 1) * 1440); return `${d}T${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`; }
  const parts = s.replace('T', ' ').split(/\s+/);
  const timeIdx = parts.findIndex((p) => /\d{1,2}:\d{2}/.test(p));
  const datePart = timeIdx > 0 ? parts.slice(0, timeIdx).join(' ') : (timeIdx === -1 ? s : '');
  const timePart = timeIdx >= 0 ? parts.slice(timeIdx).join(' ') : '';
  const d = parseDate(datePart || fallbackDate, label);
  const t = timePart ? parseTime(timePart, label) : '00:00';
  return `${d}T${t}`;
}
function parseNum(v, label, { min = null } = {}) {
  if (blank(v)) return null;
  const n = Number(String(v).replace(/[₹,\s]/g, ''));
  if (Number.isNaN(n)) throw bad(`${label}: “${v}” is not a number.`);
  if (min !== null && n < min) throw bad(`${label} cannot be less than ${min}.`);
  return n;
}
function matchOption(v, options, label) {
  if (blank(v)) return '';
  const s = norm(v);
  const exact = options.find((o) => norm(o) === s);
  if (exact) return exact;
  const starts = options.filter((o) => norm(o).startsWith(s) || s.startsWith(norm(o)));
  if (starts.length === 1) return starts[0];
  throw bad(`${label}: “${v}” is not allowed. Use one of: ${options.join(', ')}.`);
}
function yesNo(v, label) {
  if (blank(v)) return '';
  const s = norm(v);
  if (['y', 'yes', 'true', '1', 'haan', 'ha', 'done', 'ok'].includes(s)) return 'Yes';
  if (['n', 'no', 'false', '0', 'nahi', 'na'].includes(s)) return 'No';
  throw bad(`${label}: write Yes or No.`);
}
function parseChecklist(v, options, label) {
  if (blank(v)) return {};
  const s = String(v).trim();
  const out = {};
  if (/^(all\s*)?(ok|done|completed|yes|haan|✓)$/i.test(s)) { options.forEach((o) => { out[o] = { status: 'Completed', remark: '' }; }); return out; }
  s.split(/[;\n|]+/).map((x) => x.trim()).filter(Boolean).forEach((part) => {
    const m = /^(.*?)[:=]\s*(.*)$/.exec(part);
    if (!m) throw bad(`${label}: write each check as “Item: Done” or “Item: Not done - reason”, separated by “;”.`);
    const name = matchOption(m[1], options, `${label} item`);
    const rest = m[2].trim();
    const [stRaw, ...rem] = rest.split(/\s+-\s+|\s*\(\s*/);
    const st = norm(stRaw);
    const status = ['done', 'completed', 'yes', 'ok', 'haan', 'y', '✓'].includes(st) ? 'Completed'
      : ['na', 'n a', 'not applicable', 'lagu nahi'].includes(st) ? 'Not Applicable'
        : ['no', 'not done', 'not completed', 'nahi', 'n', 'x', '✗'].includes(st) ? 'Not Completed' : null;
    if (!status) throw bad(`${label}: “${stRaw}” — use Done, Not done or NA.`);
    out[name] = { status, remark: rem.join(' ').replace(/\)\s*$/, '').trim() };
  });
  return out;
}

// ---------- shared context ----------
async function loadCtx(user) {
  const [branches, items, users, vendors, categories, batches] = await Promise.all([
    q('SELECT id, name, code FROM branches WHERE active ORDER BY id'), q('SELECT * FROM items WHERE active'),
    q('SELECT id, name, email, phone FROM users WHERE active'), q('SELECT id, name FROM vendors'), q('SELECT id, name FROM expense_categories WHERE active'),
    q('SELECT * FROM batches WHERE active')
  ]);
  return { user, branches, items, users, vendors, categories, batches, cfg: await store.storeConfig() };
}
function branchFrom(ctx, v) {
  const u = ctx.user;
  let b;
  if (blank(v)) b = ctx.branches.find((x) => x.id === u.branch_id) || ctx.branches[0];
  else {
    const s = norm(v);
    b = ctx.branches.find((x) => norm(x.name) === s || norm(x.code) === s) || ctx.branches.find((x) => norm(x.name).startsWith(s));
    if (!b) throw bad(`Branch “${v}” not found. Use one of: ${ctx.branches.map((x) => x.name).join(', ')}.`);
  }
  if (!b) throw bad('No branch set up yet.');
  if (!seesAll(u) && u.role !== 'manager' && b.id !== u.branch_id) throw bad('You can only upload records for your own branch.');
  if (u.role === 'manager' && !seesAll(u) && b.id !== u.branch_id) throw bad('You can only upload records for your own branch.');
  return b.id;
}
const C = (key, label, extra = {}) => Object.assign({ key, label }, extra);
const BRANCH = C('branch', 'Branch', { help: 'Branch name or code. Blank = your branch.', example: 'Main Branch' });
const DATE = C('date', 'Date', { type: 'date', help: 'DD/MM/YYYY. Blank = today.', example: '24/10/2026' });

// ---------- import kinds ----------
async function registerKinds() {
  const defs = await q("SELECT * FROM register_defs WHERE status='active' ORDER BY sort, name");
  return defs.map((def) => {
    const fields = def.fields.filter((f) => !['file', 'image', 'signature'].includes(f.type));
    const help = (f) => ({ number: 'Number', currency: 'Amount in ₹', date: 'DD/MM/YYYY', time: 'HH:MM (24h) or 2:30 PM', datetime: 'DD/MM/YYYY HH:MM', phone: '10-digit mobile', email: 'Email address', yesno: 'Yes or No', checkbox: 'Yes or No',
      item: 'Exact item name from Items / Store', multiselect: 'Values separated by commas', checklist: 'Write “All done”, or “Item: Done; Item: Not done - reason; Item: NA”', user: 'Person’s name' }[f.type] || 'Text');
    return {
      kind: `register:${def.key}`, group: 'Registers', label: def.name,
      can: () => true,
      columns: [C('entry_date', 'Date', { type: 'date', help: 'Register date, DD/MM/YYYY. Blank = date of the first date-time field, else today.', example: '24/10/2026' }), BRANCH,
        ...fields.map((f) => C(f.key, f.label, { required: !!f.required && !f.showIf, options: f.type === 'checklist' ? null : f.options, help: help(f) + (f.showIf ? ` (only when ${f.showIf.field.replace(/_/g, ' ')} is ${f.showIf.equals || (f.showIf.in || []).join('/')})` : '') + (f.options && f.type !== 'checklist' ? '' : ''),
          checklistItems: f.type === 'checklist' ? f.options : undefined, example: f.options && f.type === 'select' ? f.options[0] : (f.type === 'datetime' ? '24/10/2026 10:30' : f.type === 'date' ? '24/10/2026' : f.type === 'time' ? '10:30' : f.type === 'checklist' ? 'All done' : f.type === 'yesno' ? 'Yes' : f.type === 'number' || f.type === 'currency' ? '1' : f.type === 'phone' ? '9811122233' : '') }))],
      async validate(get, ctx) {
        const branch_id = branchFrom(ctx, get('branch'));
        let entryDate = parseDate(get('entry_date'), 'Date');
        const firstDt = fields.find((f) => f.type === 'datetime' && !blank(get(f.key)));
        if (!entryDate && firstDt) entryDate = parseDateTime(get(firstDt.key), firstDt.label).slice(0, 10);
        entryDate = entryDate || today();
        const data = {};
        for (const f of fields) {
          const v = get(f.key);
          if (blank(v)) {
            if (f.type === 'datetime' && f.required && !f.showIf) data[f.key] = `${entryDate}T00:00`;
            continue;
          }
          switch (f.type) {
            case 'number': case 'currency': data[f.key] = parseNum(v, f.label); break;
            case 'date': data[f.key] = parseDate(v, f.label); break;
            case 'time': data[f.key] = parseTime(v, f.label); break;
            case 'datetime': data[f.key] = parseDateTime(v, f.label, entryDate); break;
            case 'select': data[f.key] = matchOption(v, f.options, f.label); break;
            case 'multiselect': data[f.key] = String(v).split(/[,;]/).map((x) => x.trim()).filter(Boolean).map((x) => matchOption(x, f.options, f.label)); break;
            case 'yesno': data[f.key] = yesNo(v, f.label); break;
            case 'checkbox': data[f.key] = yesNo(v, f.label) === 'Yes'; break;
            case 'checklist': data[f.key] = parseChecklist(v, f.options, f.label); break;
            case 'item': {
              const it = ctx.items.find((x) => norm(x.name) === norm(v));
              if (!it) throw bad(`${f.label}: item “${v}” not found.`);
              data[f.key] = it.id; break;
            }
            case 'vehicle': data[f.key] = String(v).toUpperCase().replace(/\s+/g, ''); break;
            case 'phone': data[f.key] = String(v).replace(/\.0$/, '').trim(); break;
            default: data[f.key] = String(v).trim();
          }
        }
        const clean = ops.validateData(def, data);
        const dup = await one('SELECT id FROM register_entries WHERE register_id=$1 AND branch_id=$2 AND entry_date=$3 AND data=$4::jsonb LIMIT 1', [def.id, branch_id, entryDate, JSON.stringify(clean)]);
        return { branch_id, entry_date: entryDate, data: clean, __dup: dup ? `Same entry already exists (#${dup.id})` : null, __summary: Object.values(clean).filter((x) => typeof x === 'string').slice(0, 3).join(' · ') };
      },
      async insert(n, ctx) {
        return tx(async (h) => {
          const e = await h.one('INSERT INTO register_entries (register_id, branch_id, entry_date, data, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *', [def.id, n.branch_id, n.entry_date, JSON.stringify(n.data), ctx.user.id]);
          await ops.syncInventory(h, def, e, ctx.user);
          await audit(h, 'register_entry', e.id, 'imported', ctx.user.id, { register: def.key });
          return e.id;
        });
      }
    };
  });
}

function storeKinds() {
  const out = [];
  const canStore = (u) => !['guard', 'driver'].includes(u.role);
  const idCols = {
    module: (rec) => [C('course', 'Course', { required: true, help: 'Foundation, NEET or IIT-JEE (as set in Store → Setup)', example: 'NEET' }), C('class_level', 'Class', { required: true, example: '11th' }),
      C('subject', 'Subject', { required: true, example: 'Physics' }), C('module_no', 'Module no', { required: true, example: '3' }), C('session', 'Session', { help: 'Blank = current session', example: '2026-27' }),
      C('language', 'Language / medium', { help: 'Blank = English', example: 'English' }), ...(rec ? [C('title', 'Module title', { example: 'Kinematics' }), C('edition', 'Edition', {})] : [])],
    apparel: () => [C('garment', 'Garment', { required: true, example: 'T-shirt' }), C('size', 'Size', { required: true, example: 'M' }), C('audience', 'For whom', { required: true, help: 'Students, Teachers or Non-academic staff', example: 'Students' }),
      C('gender', 'Gender', { help: 'Blank = Unisex', example: 'Unisex' }), C('colour', 'Colour', { example: 'Navy blue' })],
    supply: (rec) => [C('category', 'Category', { required: true, example: 'Housekeeping & cleaning' }), C('name', 'Item name', { required: true, example: 'Phenyl (5 L can)' }),
      ...(rec ? [C('unit', 'Unit', { help: 'pcs, can, bottle, kg, litre, ream…', example: 'can' })] : []), C('spec', 'Brand / specification', { example: 'Lizol' })]
  };
  const label = { module: 'Modules (books)', apparel: 'T-shirts & uniforms', supply: 'Housekeeping & supplies' };
  for (const ik of ['module', 'apparel', 'supply']) {
    for (const tk of ['receipt', 'issue']) {
      const rec = tk === 'receipt';
      out.push({
        kind: `store:${ik}:${tk}`, group: 'Store', label: `${label[ik]} — ${rec ? 'received' : 'given out'}`, can: canStore,
        columns: [DATE, BRANCH, ...idCols[ik](rec), C('qty', rec ? 'Quantity received' : 'Quantity given', { required: true, example: rec ? '50' : '10' }),
          ...(rec ? [C('damaged_qty', 'Damaged / short', { example: '0' }), C('source', 'Source', { example: ik === 'supply' ? 'Vendor purchase' : 'Head office' }), C('source_name', 'Supplier / sender name'),
            C('challan_no', 'Challan / bill no'), C('received_by', 'Received by'), C('min_stock', 'Min stock alert', { example: '10' }), C('remarks', 'Remarks')]
            : [C('issued_to_type', 'Given to type', { help: 'Batch, Student, Staff or Department (blank = worked out from the next columns)', example: ik === 'supply' ? 'Department' : 'Batch' }),
              C('batch', 'Batch name', { help: 'Exact batch name from Store → Batches', example: ik === 'module' ? 'NEET-11 Morning A' : '' }), C('issued_to', 'Given to (name / Saathi ID)'),
              C('department', 'Department / area', { example: ik === 'supply' ? 'Washrooms' : '' }), C('students', 'Saathi IDs / student names'), C('remarks', 'Remarks')])],
        async validate(get, ctx) {
          const c = ctx.cfg;
          const b = { kind: tk, item_kind: ik, branch_id: branchFrom(ctx, get('branch')), date: parseDate(get('date'), 'Date') || today(), qty: parseNum(get('qty'), 'Quantity', { min: 0 }) };
          if (!(b.qty > 0)) throw bad('Quantity is required and must be above 0.');
          if (ik === 'module') {
            b.course = matchOption(get('course'), c.module.courses.map((x) => x.name), 'Course');
            if (!b.course) throw bad('Course is required.');
            const co = c.module.courses.find((x) => x.name === b.course);
            b.class_level = matchOption(get('class_level'), co.classes, 'Class'); b.subject = matchOption(get('subject'), co.subjects, 'Subject');
            b.module_no = str(get('module_no')).replace(/^(module|mod|m)[\s\-.]*/i, '');
            if (!b.class_level || !b.subject || !b.module_no) throw bad('Class, Subject and Module no are required.');
            b.session = str(get('session')) || c.session; b.language = matchOption(get('language'), c.module.languages, 'Language') || 'English';
            if (rec) { b.title = str(get('title')); b.edition = str(get('edition')); }
          } else if (ik === 'apparel') {
            b.garment = matchOption(get('garment'), c.apparel.garments, 'Garment'); b.size = matchOption(get('size'), c.apparel.sizes, 'Size');
            b.audience = matchOption(get('audience'), c.apparel.audiences, 'For whom'); b.gender = matchOption(get('gender'), c.apparel.genders, 'Gender') || 'Unisex'; b.colour = str(get('colour'));
            if (!b.garment || !b.size || !b.audience) throw bad('Garment, Size and For whom are required.');
          } else {
            b.category = matchOption(get('category'), Object.keys(c.supply.categories), 'Category'); b.name = str(get('name')); b.spec = str(get('spec'));
            if (!b.category || !b.name) throw bad('Category and Item name are required.');
            if (rec) { const sug = (c.supply.categories[b.category] || []).find((x) => norm(x.name) === norm(b.name)); b.unit = str(get('unit')) || (sug ? sug.unit : 'pcs'); if (sug) b.name = sug.name; }
          }
          // find the existing item (required for issues)
          const it = ik === 'module' ? ctx.items.find((x) => x.item_kind === 'module' && x.course === b.course && x.class_level === b.class_level && x.subject === b.subject && norm(x.module_no) === norm(b.module_no) && x.session === b.session && (x.language || 'English') === b.language)
            : ik === 'apparel' ? ctx.items.find((x) => x.item_kind === 'apparel' && x.garment === b.garment && x.size === b.size && x.audience === b.audience && (x.gender || 'Unisex') === b.gender && norm(x.colour) === norm(b.colour))
              : ctx.items.find((x) => x.item_kind === 'supply' && x.category === b.category && norm(x.name) === norm(b.name) && norm(x.spec) === norm(b.spec));
          if (rec) {
            b.damaged_qty = parseNum(get('damaged_qty'), 'Damaged') || 0;
            if (b.damaged_qty > b.qty) throw bad('Damaged cannot be more than quantity received.');
            b.source = str(get('source')); b.source_name = str(get('source_name')); b.challan_no = str(get('challan_no')); b.received_by = str(get('received_by')) || ctx.user.name;
            const ms = parseNum(get('min_stock'), 'Min stock'); if (ms !== null) b.min_stock = ms;
            b.remarks = str(get('remarks'));
          } else {
            if (!it) throw bad('This item has no stock record yet — upload / enter its receipt first.');
            b.item_id = it.id;
            const bn = str(get('batch'));
            if (bn) { const ba = ctx.batches.find((x) => norm(x.name) === norm(bn) && x.branch_id === b.branch_id); if (!ba) throw bad(`Batch “${bn}” not found at this branch.`); b.batch_id = ba.id; }
            b.issued_to = str(get('issued_to')); b.department = str(get('department')); b.students = str(get('students')); b.remarks = str(get('remarks'));
            const t = norm(get('issued_to_type'));
            b.issued_to_type = t ? matchOption(t, ['batch', 'student', 'staff', 'department'], 'Given to type') : (b.batch_id ? 'batch' : b.department ? 'department' : 'student');
            if (!b.batch_id && !b.issued_to && !b.department) throw bad('Say who received it: Batch name, Given to, or Department / area.');
          }
          let dup = null;
          if (it) {
            dup = rec ? await one("SELECT id FROM module_txns WHERE kind='receipt' AND status='active' AND item_id=$1 AND branch_id=$2 AND date=$3 AND qty=$4 AND COALESCE(challan_no,'')=$5 LIMIT 1", [it.id, b.branch_id, b.date, b.qty, b.challan_no || ''])
              : await one("SELECT id FROM module_txns WHERE kind='issue' AND status='active' AND item_id=$1 AND branch_id=$2 AND date=$3 AND qty=$4 AND COALESCE(batch_id,0)=$5 AND COALESCE(issued_to,'')=$6 AND COALESCE(department,'')=$7 LIMIT 1",
                [it.id, b.branch_id, b.date, b.qty, b.batch_id || 0, b.issued_to || '', b.department || '']);
          }
          return { ...b, __dup: dup ? `Same entry already recorded (#${dup.id})` : null, __summary: `${it ? it.name : (b.name || [b.course, b.class_level, b.subject, 'M-' + b.module_no].filter(Boolean).join(' '))} × ${b.qty}` };
        },
        async insert(n, ctx) {
          const { __dup, __summary, ...body } = n; body._via = 'import';
          const id = await store.createStoreTxn(ctx.user, body);
          if (rec) ctx.items = await q('SELECT * FROM items WHERE active'); // so later "given out" rows in the same file find new items
          return id;
        }
      });
    }
  }
  return out;
}

const PAY = { 'petty cash': 'petty_cash', petty: 'petty_cash', cash: 'cash', upi: 'upi', gpay: 'upi', phonepe: 'upi', paytm: 'upi', 'bank transfer': 'bank_transfer', neft: 'bank_transfer', rtgs: 'bank_transfer', imps: 'bank_transfer', bank: 'bank_transfer', cheque: 'cheque', check: 'cheque', card: 'card', 'debit card': 'card', 'credit card': 'card', credit: 'credit', 'pay later': 'credit' };
function payMode(v) {
  const s = norm(v);
  if (!s) throw bad('Payment mode is required (Petty cash, Cash, UPI, Bank transfer, Cheque, Card or Credit).');
  const k = Object.keys(PAY).find((x) => s === x) || Object.keys(PAY).find((x) => s.startsWith(x));
  if (!k) throw bad(`Payment mode “${v}” — use Petty cash, Cash, UPI, Bank transfer, Cheque, Card or Credit.`);
  return PAY[k];
}

function masterKinds() {
  const fin = (u) => isFinance(u) || u.role === 'manager';
  return [
    { kind: 'purchases', group: 'Money', label: 'Purchases & bills (Zoho Books “Bills” format — creates vouchers)', can: (u) => !['guard', 'driver'].includes(u.role), maxRows: 1000,
      // Column names follow the Zoho Books Bills export, so that export can be uploaded as it is. Older template headings still work (aliases).
      columns: [C('date', 'Bill Date', { type: 'date', required: true, aliases: ['Date'], example: '13/01/2026' }), C('due_date', 'Due Date', { type: 'date', aliases: ['Due date (credit)'] }),
        C('bill_id', 'Bill ID', { help: 'Zoho Bill ID. Rows with the same Bill ID become ONE purchase with several lines', example: '' }),
        C('bill_no', 'Bill Number', { aliases: ['Bill / invoice no'], help: 'Without a Bill ID, rows with the same date, vendor and bill number become one purchase', example: 'GST/25-26/01/093' }),
        C('vendor', 'Vendor Name', { required: true, aliases: ['Vendor / shop', 'Vendor'], help: 'New vendors are added to Vendors automatically', example: 'Pepper Design' }),
        C('gstin', 'GST Identification Number (GSTIN)', { aliases: ['GSTIN'], help: 'Saved on the vendor when the vendor is new', example: '06AVOPS1832R1ZR' }),
        BRANCH,
        C('category', 'Account', { aliases: ['Expense category', 'Category'], help: 'Expense head. New heads are added to Expense categories automatically', example: 'Advertising And Marketing' }),
        C('item', 'Item Name', { aliases: ['Stock item (optional)', 'Item'], help: 'If it matches a stock item exactly, stock goes up on approval', example: 'Logo Design Modification' }),
        C('line', 'Description', { aliases: ['Line description'], example: '' }), C('hsn', 'HSN/SAC', { example: '998361' }),
        C('qty', 'Quantity', { required: true, example: '1' }), C('unit', 'Usage unit', { aliases: ['Unit'], example: 'nos' }),
        C('rate', 'Rate', { required: true, example: '3500' }),
        C('gst_rate', 'Tax Percentage', { aliases: ['GST %', 'GST'], help: '0, 5, 12, 18 or 28. Blank = taken from IGST / CGST+SGST Rate % columns, else 0', example: '18' }),
        C('igst_rate', 'IGST Rate %', {}), C('cgst_rate', 'CGST Rate %', {}), C('sgst_rate', 'SGST Rate %', {}),
        C('inclusive', 'Is Inclusive Tax', { help: 'true if Rate already includes GST', example: 'false' }),
        C('description', 'Vendor Notes', { aliases: ['Purpose / description', 'Purpose'], example: 'Charges for logo modification' }),
        C('bill_status', 'Bill Status', { help: 'Paid, Partially Paid, Open, Overdue, Draft or Void. Void / Draft bills are skipped', example: 'Paid' }),
        C('tds_amount', 'TDS Amount', { help: 'TDS deducted on the bill (once per bill). Added as a “Less: TDS” line so the total matches the amount payable', example: '0' }), C('tds_name', 'TDS Name', {}),
        C('adjustment', 'Adjustment', { help: 'Bill-level adjustment (+ / −), once per bill', example: '0' }), C('adjustment_label', 'Adjustment Description', {}),
        C('zoho_total', 'Total', { help: 'Bill total — used only to cross-check', example: '4130' }), C('balance', 'Balance', { help: 'Amount still unpaid. Paid part is recorded as a payment voucher', example: '0' }),
        C('payment_mode', 'Payment Mode', { aliases: ['Payment mode'], help: 'Petty cash, Cash, UPI, Bank transfer, Cheque, Card or Credit. Blank = Credit (vendor bill); paid part from Bill Status / Balance is recorded as a bank payment', example: '' }),
        C('reference', 'Payment Reference', { aliases: ['UPI / UTR reference', 'Reference'], example: '' }), C('cheque_no', 'Cheque Number', { aliases: ['Cheque no'] }), C('bank', 'Bank'), C('card_last4', 'Card last 4'),
        C('approve_now', 'Approve Now', { aliases: ['Approve now'], help: 'Yes / No (only within your approval limit). Blank = Yes when Bill Status is filled, else No', example: 'Yes' })],
      groupKey: (n) => (n.bill_id ? `id|${n.bill_id}` : n.bill_no ? `${n.date}|${n.branch_id}|${norm(n.vendor_name)}|${norm(n.bill_no)}|${n.payment_mode}` : null),
      async validate(get, ctx) {
        const n = { date: parseDate(get('date'), 'Bill Date'), branch_id: branchFrom(ctx, get('branch')) };
        if (!n.date) throw bad('Bill Date is required.');
        n.bill_id = str(get('bill_id')).replace(/\.0$/, ''); n.bill_no = str(get('bill_no')).replace(/\.0$/, '');
        n.bill_status = norm(get('bill_status'));
        const vn = str(get('vendor')); if (!vn) throw bad('Vendor Name is required.');
        const v = ctx.vendors.find((x) => norm(x.name) === norm(vn));
        n.vendor_id = v ? v.id : null; n.vendor_name = vn; n.gstin = str(get('gstin')).toUpperCase();
        const cn = str(get('category'));
        if (cn) { const c = ctx.categories.find((x) => norm(x.name) === norm(cn)); n.category_id = c ? c.id : null; n.category_name = cn; }
        n.description = str(get('description'));
        const itn = str(get('item')); const item = itn ? ctx.items.find((x) => norm(x.name) === norm(itn)) : null;
        const qty = parseNum(get('qty'), 'Quantity', { min: 0 }); let rate = parseNum(get('rate'), 'Rate');
        if (!(qty > 0)) throw bad('Quantity must be above 0.'); if (rate === null) throw bad('Rate is required.');
        let gst = parseNum(get('gst_rate'), 'Tax Percentage');
        if (gst === null) { const ig = parseNum(get('igst_rate'), 'IGST Rate %') || 0; const cs = (parseNum(get('cgst_rate'), 'CGST Rate %') || 0) + (parseNum(get('sgst_rate'), 'SGST Rate %') || 0); gst = ig || cs || 0; }
        if (!(gst >= 0 && gst <= 40)) throw bad(`Tax Percentage ${gst} looks wrong.`);
        if (rate < 0 && item) throw bad('Rate cannot be negative for a stock item.');
        if (/^(true|yes|y|1)$/i.test(str(get('inclusive')))) rate = Math.round((rate / (1 + gst / 100)) * 100) / 100;
        const hsn = str(get('hsn')).replace(/\.0$/, ''); const ld = str(get('line'));
        const desc = [itn, ld && ld !== itn ? ld : '', hsn ? `HSN ${hsn}` : ''].filter(Boolean).join(' — ') || n.description || 'As per bill';
        n.line = { item_id: item ? item.id : null, description: desc.slice(0, 300), qty, unit: str(get('unit')) || (item ? item.unit : null), rate, gst_rate: gst, allow_negative: rate < 0 };
        n.tds = Math.abs(parseNum(get('tds_amount'), 'TDS Amount') || 0); n.tds_name = str(get('tds_name'));
        n.adjustment = parseNum(get('adjustment'), 'Adjustment') || 0; n.adjustment_label = str(get('adjustment_label'));
        n.kind = item ? 'purchase' : 'expense';
        const pm = str(get('payment_mode'));
        n.payment_mode = pm ? payMode(pm) : 'credit';
        n.mode_details = { reference: str(get('reference')), cheque_no: str(get('cheque_no')).replace(/\.0$/, ''), bank: str(get('bank')), card_last4: str(get('card_last4')).replace(/\.0$/, ''), due_date: parseDate(get('due_date'), 'Due Date') || '' };
        if (['upi', 'bank_transfer'].includes(n.payment_mode) && !n.mode_details.reference) throw bad('Payment Reference (UPI / UTR) is required for UPI and bank transfer.');
        if (n.payment_mode === 'cheque' && !n.mode_details.cheque_no) throw bad('Cheque Number is required for cheque payments.');
        n.zoho_total = parseNum(get('zoho_total'), 'Total'); n.balance = parseNum(get('balance'), 'Balance');
        const ap = str(get('approve_now'));
        n.approve_now = ap ? yesNo(ap, 'Approve Now') === 'Yes' : !!n.bill_status;
        const total = qty * rate * (1 + gst / 100);
        let skip = null;
        if (/^void/.test(n.bill_status)) skip = 'Void bill in Zoho — skipped';
        else if (/^draft/.test(n.bill_status)) skip = 'Draft bill in Zoho — skipped';
        const vend = [n.vendor_id || 0, n.vendor_name];
        const dup = skip ? null : (n.bill_no
          ? await one("SELECT id, purchase_no FROM purchases WHERE status<>'cancelled' AND date=$1 AND lower(COALESCE(bill_no,''))=lower($2) AND (vendor_id=$3 OR lower(COALESCE(vendor_name,''))=lower($4)) LIMIT 1", [n.date, n.bill_no, ...vend])
          : await one(`SELECT p.id, p.purchase_no FROM purchases p JOIN purchase_lines l ON l.purchase_id=p.id WHERE p.status<>'cancelled' AND p.date=$1 AND (p.vendor_id=$2 OR lower(COALESCE(p.vendor_name,''))=lower($3))
              AND l.qty=$4 AND l.rate=$5 LIMIT 1`, [n.date, ...vend, qty, rate]));
        const notes = [!v ? 'new vendor' : '', cn && !n.category_id ? 'new expense head' : ''].filter(Boolean);
        return { ...n, __dup: skip || (dup ? `Already recorded as ${dup.purchase_no}` : null),
          __summary: `${vn}${n.bill_no ? ' · ' + n.bill_no : ''} · ₹${Math.round(total).toLocaleString('en-IN')} · ${n.payment_mode.replace('_', ' ')}${notes.length ? ' (+ ' + notes.join(', + ') + ')' : ''}` };
      },
      async insertGroup(rows, ctx) {
        const f = rows[0];
        // add-only masters: create the vendor / expense head if they do not exist yet
        let vendorId = f.vendor_id;
        if (!vendorId) {
          const ex = await one('SELECT id FROM vendors WHERE lower(name)=lower($1)', [f.vendor_name]);
          vendorId = ex ? ex.id : (await one('INSERT INTO vendors (name, gstin) VALUES ($1,$2) RETURNING id', [f.vendor_name, f.gstin || null])).id;
          if (!ex) { ctx.vendors.push({ id: vendorId, name: f.vendor_name }); await audit(null, 'vendors', vendorId, 'imported', ctx.user.id, { via: 'purchase upload' }); }
        }
        let catId = f.category_id;
        if (!catId && f.category_name) {
          const ex = await one('SELECT id FROM expense_categories WHERE lower(name)=lower($1)', [f.category_name]);
          catId = ex ? ex.id : (await one('INSERT INTO expense_categories (name) VALUES ($1) RETURNING id', [f.category_name])).id;
          if (!ex) ctx.categories.push({ id: catId, name: f.category_name });
        }
        const lines = rows.map((x) => x.line);
        if (f.tds > 0.004) lines.push({ item_id: null, description: `Less: TDS deducted${f.tds_name ? ' — ' + f.tds_name : ''}`, qty: 1, rate: -f.tds, gst_rate: 0, allow_negative: true });
        if (Math.abs(f.adjustment) > 0.004) lines.push({ item_id: null, description: f.adjustment_label || 'Adjustment', qty: 1, rate: f.adjustment, gst_rate: 0, allow_negative: true });
        const descr = f.description || [...new Set(rows.map((x) => x.line.description.split(' — ')[0]))].join(', ').slice(0, 300);
        const body = { date: f.date, kind: rows.some((x) => x.kind === 'purchase') ? 'purchase' : 'expense', vendor_id: vendorId, category_id: catId, description: descr,
          payment_mode: f.payment_mode, mode_details: f.mode_details, bill_no: f.bill_no || f.bill_id || null, bill_date: f.date, lines, approve_now: f.approve_now, update_stock: true };
        const id = await F.createPurchase(ctx.user, body, f.branch_id, { fromUpload: true });
        const p = await one('SELECT purchase_no, total, status FROM purchases WHERE id=$1', [id]);
        const notes = [`${p.purchase_no}${rows.length > 1 ? ` (${rows.length} lines)` : ''}`];
        if (f.zoho_total !== null && Math.abs(f.zoho_total - p.total) > 1) notes.push(`check: total here ₹${p.total} vs file ₹${f.zoho_total}`);
        if (f.payment_mode === 'credit' && f.bill_status) {
          const billTotal = f.zoho_total !== null ? f.zoho_total : p.total;
          let paid = /^paid/.test(f.bill_status) || f.balance === 0 ? p.total : (f.balance !== null ? Math.max(0, Math.min(p.total, billTotal - f.balance)) : 0);
          if (paid > 0 && p.total - paid < 1) paid = p.total; // paisa-level GST rounding differences
          if (paid > 0.009) {
            if (p.status !== 'approved') notes.push('paid part not recorded — approve the bill, then record payment');
            else {
              try {
                await F.recordPayment(ctx.user, id, { amount: Math.round(paid * 100) / 100, payment_mode: 'bank_transfer', date: f.date, approve_now: true,
                  mode_details: { reference: `As per Zoho Books bill ${f.bill_id || f.bill_no || ''}`.trim() }, narration: `Paid as per Zoho Books — ${f.bill_no || f.bill_id || ''}` });
                notes.push(`payment ₹${Math.round(paid).toLocaleString('en-IN')} recorded`);
              } catch (e) { notes.push(`payment not recorded: ${e.message}`); }
            }
          }
        }
        return { id, note: notes.join(' · ') };
      } },
    { kind: 'petty_topup', group: 'Money', label: 'Petty cash top-ups', can: isFinance,
      columns: [DATE, C('branch', 'Branch', { required: true, example: 'Main Branch' }), C('amount', 'Amount', { required: true, example: '10000' }), C('mode', 'Source', { help: 'Cash, Bank transfer, UPI or Cheque', example: 'Cash' }),
        C('reference', 'UPI / UTR reference'), C('cheque_no', 'Cheque no'), C('payee', 'Handed to', { example: 'Reception' }), C('narration', 'Narration', { example: 'Petty cash top-up' })],
      async validate(get, ctx) {
        const n = { branch_id: branchFrom(ctx, get('branch')), date: parseDate(get('date'), 'Date') || today(), amount: parseNum(get('amount'), 'Amount', { min: 0 }) };
        if (!(n.amount > 0)) throw bad('Amount is required.');
        n.payment_mode = blank(get('mode')) ? 'cash' : payMode(get('mode'));
        if (['petty_cash', 'credit', 'card'].includes(n.payment_mode)) throw bad('Source must be Cash, Bank transfer, UPI or Cheque.');
        n.mode_details = { reference: str(get('reference')), cheque_no: str(get('cheque_no')) }; n.payee = str(get('payee')); n.narration = str(get('narration')) || 'Petty cash top-up';
        if (['upi', 'bank_transfer'].includes(n.payment_mode) && !n.mode_details.reference) throw bad('Reference is required for UPI / bank transfer.');
        if (n.payment_mode === 'cheque' && !n.mode_details.cheque_no) throw bad('Cheque no is required.');
        const dup = await one("SELECT voucher_no FROM vouchers WHERE purpose='petty_topup' AND status<>'cancelled' AND branch_id=$1 AND date=$2 AND amount=$3 LIMIT 1", [n.branch_id, n.date, n.amount]);
        return { ...n, __dup: dup ? `Already recorded as ${dup.voucher_no}` : null, __summary: `₹${n.amount.toLocaleString('en-IN')} → petty cash` };
      },
      insert: (n, ctx) => F.pettyTopup(ctx.user, n.branch_id, n) },
    { kind: 'batches', group: 'Store', label: 'Batches (with student count)', can: (u) => isReviewer(u) || u.role === 'staff',
      columns: [C('name', 'Batch name', { required: true, example: 'NEET-11 Morning A' }), BRANCH, C('course', 'Course', { required: true, example: 'NEET' }), C('class_level', 'Class', { example: '11th' }),
        C('session', 'Session', { example: '2026-27' }), C('language', 'Language / medium', { example: 'English' }), C('students', 'No. of students', { required: true, example: '40' })],
      async validate(get, ctx) {
        const c = ctx.cfg;
        const n = { name: str(get('name')), branch_id: branchFrom(ctx, get('branch')), course: matchOption(get('course'), c.module.courses.map((x) => x.name), 'Course') };
        if (!n.name || !n.course) throw bad('Batch name and Course are required.');
        const co = c.module.courses.find((x) => x.name === n.course);
        n.class_level = matchOption(get('class_level'), co.classes, 'Class') || null; n.session = str(get('session')) || c.session; n.language = str(get('language')) || null;
        n.students = Math.max(0, Math.round(parseNum(get('students'), 'No. of students') || 0));
        const dup = await one('SELECT id FROM batches WHERE lower(name)=lower($1) AND branch_id=$2 AND COALESCE(session,\'\')=$3', [n.name, n.branch_id, n.session]);
        return { ...n, __dup: dup ? 'Batch already exists — skipped (edit it on screen to change the count)' : null, __summary: `${n.name} · ${n.students} students` };
      },
      async insert(n, ctx) { const b = await one('INSERT INTO batches (branch_id, name, course, class_level, session, language, students) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [n.branch_id, n.name, n.course, n.class_level, n.session, n.language, n.students]); await audit(null, 'batch', b.id, 'imported', ctx.user.id, null); return b.id; } },
    { kind: 'vendors', group: 'Masters', label: 'Vendors', can: fin,
      columns: [C('name', 'Name', { required: true, example: 'Gupta Stationers' }), C('category', 'Category', { example: 'Stationery & printing' }), C('phone', 'Phone'), C('email', 'Email'), C('gstin', 'GSTIN'), C('address', 'Address'), C('bank_details', 'Bank details')],
      async validate(get) {
        const n = { name: str(get('name')), category: str(get('category')), phone: str(get('phone')).replace(/\.0$/, ''), email: str(get('email')), gstin: str(get('gstin')).toUpperCase(), address: str(get('address')), bank_details: str(get('bank_details')) };
        if (!n.name) throw bad('Name is required.');
        const dup = await one('SELECT id FROM vendors WHERE lower(name)=lower($1)', [n.name]);
        return { ...n, __dup: dup ? 'Vendor already exists — skipped' : null, __summary: n.name };
      },
      async insert(n, ctx) { const v = await one('INSERT INTO vendors (name, category, phone, email, gstin, address, bank_details) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [n.name, n.category || null, n.phone || null, n.email || null, n.gstin || null, n.address || null, n.bank_details || null]); await audit(null, 'vendors', v.id, 'imported', ctx.user.id, null); return v.id; } },
    { kind: 'items', group: 'Masters', label: 'General stock items', can: fin,
      columns: [C('name', 'Item name', { required: true, example: 'Whiteboard marker (black)' }), C('category', 'Category', { example: 'Stationery' }), C('unit', 'Unit', { example: 'pcs' }), C('sku', 'SKU / code'), C('min_stock', 'Min stock per branch', { example: '20' }), C('rate', 'Standard rate', { example: '35' })],
      async validate(get) {
        const n = { name: str(get('name')), category: str(get('category')), unit: str(get('unit')) || 'pcs', sku: str(get('sku')), min_stock: parseNum(get('min_stock'), 'Min stock', { min: 0 }) || 0, rate: parseNum(get('rate'), 'Rate', { min: 0 }) || 0 };
        if (!n.name) throw bad('Item name is required.');
        const dup = await one('SELECT id FROM items WHERE lower(name)=lower($1)', [n.name]);
        return { ...n, __dup: dup ? 'Item already exists — skipped' : null, __summary: n.name };
      },
      async insert(n, ctx) { const i = await one('INSERT INTO items (name, category, unit, sku, min_stock, rate) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id', [n.name, n.category || null, n.unit, n.sku || null, n.min_stock, n.rate]); await audit(null, 'items', i.id, 'imported', ctx.user.id, null); return i.id; } },
    { kind: 'stock', group: 'Masters', label: 'Stock — opening balance / adjustments', can: fin,
      columns: [C('item', 'Item name', { required: true, help: 'Exact item name (any item, module, uniform or supply)', example: 'Whiteboard marker (black)' }), BRANCH, C('qty', 'Quantity', { required: true, example: '40' }),
        C('type', 'Type', { help: 'Opening stock, Adjustment (+/-), Issue, Return, Loss or Damage. Blank = Opening stock', example: 'Opening stock' }), C('issued_to', 'Issued to'), C('remarks', 'Remarks')],
      async validate(get, ctx) {
        const nm = str(get('item')); const it = ctx.items.find((x) => norm(x.name) === norm(nm));
        if (!it) throw bad(`Item “${nm}” not found.`);
        const types = { 'opening stock': 'opening', opening: 'opening', adjustment: 'adjustment', issue: 'issue', return: 'return', loss: 'loss', damage: 'damage' };
        const t = blank(get('type')) ? 'opening' : types[norm(get('type'))];
        if (!t) throw bad('Type must be Opening stock, Adjustment, Issue, Return, Loss or Damage.');
        const qty = parseNum(get('qty'), 'Quantity'); if (!qty) throw bad('Quantity is required.');
        const signed = t === 'adjustment' ? qty : (['issue', 'loss', 'damage'].includes(t) ? -Math.abs(qty) : Math.abs(qty));
        const n = { item_id: it.id, branch_id: branchFrom(ctx, get('branch')), type: t, qty: signed, issued_to: str(get('issued_to')), remarks: str(get('remarks')) };
        const dup = await one("SELECT id FROM stock_movements WHERE ref_type='import' AND item_id=$1 AND branch_id=$2 AND type=$3 AND qty=$4 AND COALESCE(remarks,'')=$5 AND created_at::date=CURRENT_DATE LIMIT 1", [n.item_id, n.branch_id, t, signed, n.remarks]);
        return { ...n, __dup: dup ? 'Same stock line already uploaded today' : null, __summary: `${it.name} ${signed > 0 ? '+' : ''}${signed}` };
      },
      async insert(n, ctx) {
        return tx(async (h) => {
          const cur = await F.stockOf(h, n.item_id, n.branch_id);
          if (cur + n.qty < 0) throw bad(`Only ${cur} in stock.`);
          await F.moveStock(h, { item_id: n.item_id, branch_id: n.branch_id, qty: n.qty, type: n.type, ref_type: 'import', issued_to: n.issued_to || null, remarks: n.remarks || null, user_id: ctx.user.id });
          return n.item_id;
        });
      } },
    { kind: 'categories', group: 'Masters', label: 'Expense categories', can: isFinance,
      columns: [C('name', 'Name', { required: true, example: 'Lab consumables' })],
      async validate(get) { const n = { name: str(get('name')) }; if (!n.name) throw bad('Name is required.'); const dup = await one('SELECT id FROM expense_categories WHERE lower(name)=lower($1)', [n.name]); return { ...n, __dup: dup ? 'Already exists — skipped' : null, __summary: n.name }; },
      async insert(n) { return (await one('INSERT INTO expense_categories (name) VALUES ($1) RETURNING id', [n.name])).id; } },
    { kind: 'branches', group: 'Masters', label: 'Branches', can: isMgmt,
      columns: [C('name', 'Name', { required: true, example: 'Dwarka Sector 12' }), C('code', 'Code', { example: 'DWK' }), C('address', 'Address')],
      async validate(get) { const n = { name: str(get('name')), code: str(get('code')), address: str(get('address')) }; if (!n.name) throw bad('Name is required.'); const dup = await one('SELECT id FROM branches WHERE lower(name)=lower($1)', [n.name]); return { ...n, __dup: dup ? 'Already exists — skipped' : null, __summary: n.name }; },
      async insert(n, ctx) { const b = await one('INSERT INTO branches (name, code, address) VALUES ($1,$2,$3) RETURNING id', [n.name, n.code || null, n.address || null]); await audit(null, 'branches', b.id, 'imported', ctx.user.id, null); return b.id; } },
    { kind: 'users', group: 'Masters', label: 'Users / staff logins', can: isMgmt,
      columns: [C('name', 'Full name', { required: true, example: 'Ramesh Kumar' }), C('email', 'Login email / ID', { required: true, example: 'ramesh.guard@scubus.com' }), C('phone', 'Phone'),
        C('role', 'Role', { required: true, help: Object.values(ROLES).filter((x) => x !== 'Owner').join(', '), example: 'Guard / Security' }), C('designation', 'Designation'), BRANCH, C('password', 'Password', { required: true, help: 'At least 6 characters', example: 'Welcome@123' })],
      async validate(get, ctx) {
        const n = { name: str(get('name')), email: str(get('email')), phone: str(get('phone')).replace(/\.0$/, ''), designation: str(get('designation')), password: str(get('password')), branch_id: branchFrom(ctx, get('branch')) };
        if (!n.name || !n.email) throw bad('Full name and Login email / ID are required.');
        if (n.password.length < 6) throw bad('Password must be at least 6 characters.');
        const rs = norm(get('role')); const key = Object.keys(ROLES).find((k) => norm(k) === rs || norm(ROLES[k]) === rs || norm(ROLES[k]).startsWith(rs));
        if (!key) throw bad(`Role “${get('role')}” — use one of: ${Object.values(ROLES).filter((x) => x !== 'Owner').join(', ')}.`);
        if (key === 'owner') throw bad('Owner accounts cannot be created by upload.');
        n.role = key;
        const dup = await one('SELECT id FROM users WHERE lower(email)=lower($1) OR ($2<>\'\' AND phone=$2)', [n.email, n.phone]);
        return { ...n, __dup: dup ? 'Login / phone already in use — skipped' : null, __summary: `${n.name} · ${ROLES[key]}` };
      },
      async insert(n, ctx) { const u = await one('INSERT INTO users (name, email, phone, role, designation, branch_id, password_hash) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id', [n.name, n.email, n.phone || null, n.role, n.designation || null, n.branch_id, await bcrypt.hash(n.password, 10)]); await audit(null, 'user', u.id, 'imported', ctx.user.id, { role: n.role }); return u.id; } },
    { kind: 'documents', group: 'Operations', label: 'Documents & licences', can: isReviewer,
      columns: [C('title', 'Title', { required: true, example: 'Fire NOC' }), C('doc_type', 'Type', { help: 'Licence, Contract, Insurance, Certificate or Other document', example: 'Licence' }), C('number', 'Number'),
        C('branch', 'Branch', { help: 'Blank = company-wide' }), C('vendor', 'Vendor / issuer'), C('issued_on', 'Issued on', { type: 'date' }), C('expires_on', 'Expires on', { type: 'date', example: '31/03/2027' }), C('notes', 'Notes')],
      async validate(get, ctx) {
        const types = { licence: 'license', license: 'license', contract: 'contract', insurance: 'insurance', certificate: 'certificate', other: 'document', 'other document': 'document', document: 'document' };
        const n = { title: str(get('title')), doc_type: blank(get('doc_type')) ? 'document' : types[norm(get('doc_type'))], number: str(get('number')), branch_id: blank(get('branch')) ? null : branchFrom(ctx, get('branch')),
          issued_on: parseDate(get('issued_on'), 'Issued on'), expires_on: parseDate(get('expires_on'), 'Expires on'), notes: str(get('notes')) };
        if (!n.title) throw bad('Title is required.'); if (!n.doc_type) throw bad('Type must be Licence, Contract, Insurance, Certificate or Other document.');
        const vn = str(get('vendor')); if (vn) { const v = ctx.vendors.find((x) => norm(x.name) === norm(vn)); if (v) n.vendor_id = v.id; else n.notes = [n.notes, `Issuer: ${vn}`].filter(Boolean).join(' · '); }
        const dup = await one("SELECT id FROM documents WHERE lower(title)=lower($1) AND COALESCE(number,'')=$2 AND COALESCE(expires_on::text,'')=$3", [n.title, n.number, n.expires_on || '']);
        return { ...n, __dup: dup ? 'Already on file — skipped' : null, __summary: `${n.title}${n.expires_on ? ' · expires ' + n.expires_on : ''}` };
      },
      async insert(n, ctx) { const d = await one('INSERT INTO documents (title, doc_type, branch_id, number, vendor_id, issued_on, expires_on, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id', [n.title, n.doc_type, n.branch_id, n.number || null, n.vendor_id || null, n.issued_on, n.expires_on, n.notes || null, ctx.user.id]); await audit(null, 'document', d.id, 'imported', ctx.user.id, null); return d.id; } },
    { kind: 'tasks', group: 'Operations', label: 'Tasks', can: () => true,
      columns: [C('title', 'Task', { required: true, example: 'Collect documents from bank' }), C('description', 'Details'), C('category', 'Category', { example: 'Errand' }), BRANCH, C('assigned_to', 'Assign to', { help: 'Staff name as in Users', example: '' }),
        C('priority', 'Priority', { help: 'Low, Normal, High or Urgent', example: 'Normal' }), C('status', 'Status', { help: 'Pending, In progress or Done', example: 'Pending' }), C('due_date', 'Due date', { type: 'date', example: '30/10/2026' }), C('remarks', 'Remarks')],
      async validate(get, ctx) {
        const n = { title: str(get('title')), description: str(get('description')), category: str(get('category')), branch_id: branchFrom(ctx, get('branch')), remarks: str(get('remarks')), due_date: parseDate(get('due_date'), 'Due date') };
        if (!n.title) throw bad('Task is required.');
        n.priority = (matchOption(get('priority'), ['Low', 'Normal', 'High', 'Urgent'], 'Priority') || 'Normal').toLowerCase();
        n.status = { Pending: 'pending', 'In progress': 'in_progress', Done: 'done' }[matchOption(get('status'), ['Pending', 'In progress', 'Done'], 'Status') || 'Pending'];
        const an = str(get('assigned_to'));
        if (FIELD_ROLES.includes(ctx.user.role)) n.assigned_to = ctx.user.id;
        else if (an) { const u = ctx.users.find((x) => norm(x.name) === norm(an)) || ctx.users.find((x) => norm(x.name).startsWith(norm(an))); if (!u) throw bad(`Staff “${an}” not found in Users.`); n.assigned_to = u.id; }
        const dup = await one("SELECT id FROM tasks WHERE lower(title)=lower($1) AND COALESCE(due_date::text,'')=$2 AND COALESCE(assigned_to,0)=$3 AND COALESCE(branch_id,0)=$4 LIMIT 1", [n.title, n.due_date || '', n.assigned_to || 0, n.branch_id || 0]);
        return { ...n, __dup: dup ? 'Same task already exists — skipped' : null, __summary: n.title };
      },
      async insert(n, ctx) {
        const t = await one(`INSERT INTO tasks (title, description, category, branch_id, assigned_to, requested_by, priority, status, due_date, remarks, completed_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, CASE WHEN $8='done' THEN now() END) RETURNING id`, [n.title, n.description || null, n.category || null, n.branch_id, n.assigned_to || null, ctx.user.id, n.priority, n.status, n.due_date, n.remarks || null]);
        await audit(null, 'task', t.id, 'imported', ctx.user.id, null); return t.id;
      } }
  ];
}

async function allKinds() { return [...(await registerKinds()), ...storeKinds(), ...masterKinds()]; }
const publicKind = (k, user) => ({ kind: k.kind, group: k.group, label: k.label, maxRows: k.maxRows || MAX_ROWS, allowed: !!k.can(user),
  columns: k.columns.map((c) => ({ key: c.key, label: c.label, aliases: c.aliases || [], required: !!c.required, help: c.help || '', options: c.options || null, checklistItems: c.checklistItems || null, example: c.example || '' })) });

r.get('/import/kinds', ah(async (req, res) => { res.json((await allKinds()).map((k) => publicKind(k, req.user)).filter((k) => k.allowed)); }));

r.get('/import/log', ah(async (req, res) => {
  const p = []; let where = '';
  if (!isFinance(req.user)) { p.push(req.user.id); where = 'WHERE l.created_by=$1'; }
  res.json(await q(`SELECT l.id, l.kind, l.label, l.filename, l.rows_total, l.rows_imported, l.rows_skipped, l.rows_failed, l.errors, l.created_at, u.name AS created_by_name
    FROM import_log l LEFT JOIN users u ON u.id=l.created_by ${where} ORDER BY l.id DESC LIMIT 200`, p));
}));

r.post('/import/:kind', ah(async (req, res) => {
  const kinds = await allKinds();
  const def = kinds.find((k) => k.kind === req.params.kind);
  if (!def) throw bad('Unknown upload type.');
  if (!def.can(req.user)) throw forbidden('You do not have permission to upload this.');
  const b = req.body || {};
  const rows = Array.isArray(b.rows) ? b.rows : [];
  const maxRows = def.maxRows || MAX_ROWS;
  if (!rows.length) throw bad('The file has no data rows.');
  if (rows.length > maxRows) throw bad(`Too many rows (${rows.length}). Upload at most ${maxRows} at a time.`);
  const dry = !!b.dry_run;
  const ctx = await loadCtx(req.user);
  // header matching
  const headers = [...new Set(rows.flatMap((x) => Object.keys(x || {})))];
  const hmap = {};
  def.columns.forEach((c) => { const want = [c.label, c.key, ...(c.aliases || [])].map(norm); const h = headers.find((x) => want.includes(norm(x))); if (h) hmap[c.key] = h; });
  const missingRequired = def.columns.filter((c) => c.required && !hmap[c.key]).map((c) => c.label);
  if (missingRequired.length) throw bad(`Column(s) missing in the file: ${missingRequired.join(', ')}. Download the template to see the right headings.`);
  const unknown = headers.filter((h) => !Object.values(hmap).includes(h) && !/^__/.test(h));
  const offset = Number(b.row_offset) || 0;
  const results = [];
  const okRows = [];
  const ids = [];
  const seen = new Set();
  const immediate = !dry && !def.groupKey;
  for (let i = 0; i < rows.length; i += 1) {
    const raw = rows[i] || {};
    const rowNo = (Number(raw.__row) || (i + 2)) + offset;
    const get = (k) => (hmap[k] ? raw[hmap[k]] : undefined);
    if (def.columns.every((c) => blank(get(c.key)))) continue;
    try {
      const n = await def.validate(get, ctx);
      const sig = def.groupKey ? null : JSON.stringify(Object.fromEntries(Object.entries(n).filter(([k]) => !k.startsWith('__'))));
      if (n.__dup) results.push({ row: rowNo, status: 'duplicate', message: n.__dup, summary: n.__summary });
      else if (sig && seen.has(sig)) results.push({ row: rowNo, status: 'duplicate', message: 'Same as an earlier row in this file — skipped', summary: n.__summary });
      else {
        if (sig) seen.add(sig);
        const rr = { row: rowNo, status: 'ok', message: '', summary: n.__summary }; results.push(rr);
        if (immediate) {
          try { const id = await def.insert(n, ctx); ids.push(id); rr.status = 'imported'; rr.id = id; } catch (e) { rr.status = 'error'; rr.message = e.message; }
        } else okRows.push({ rr, n });
      }
    } catch (e) {
      results.push({ row: rowNo, status: 'error', message: e.message });
    }
  }
  if (!dry && def.groupKey) {
      const groups = new Map();
      okRows.forEach((o, idx) => { const k = def.groupKey(o.n) || `__row${idx}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(o); });
      for (const g of groups.values()) {
        try { const out = await def.insertGroup(g.map((o) => o.n), ctx); const id = out && out.id ? out.id : out; ids.push(id); g.forEach((o) => { o.rr.status = 'imported'; o.rr.id = id; o.rr.message = (out && out.note) || (g.length > 1 ? `${g.length} lines in one purchase` : ''); }); } catch (e) { g.forEach((o) => { o.rr.status = 'error'; o.rr.message = e.message; }); }
      }
  }
  const count = (s) => results.filter((x) => x.status === s).length;
  const summary = { total: results.length, ok: count('ok'), imported: count('imported'), duplicate: count('duplicate'), error: count('error') };
  let logId = b.log_id ? Number(b.log_id) : null;
  if (!dry) {
    const errs = results.filter((x) => x.status === 'error').slice(0, 200);
    if (logId) {
      await q(`UPDATE import_log SET rows_total=rows_total+$2, rows_imported=rows_imported+$3, rows_skipped=rows_skipped+$4, rows_failed=rows_failed+$5,
        created_ids=created_ids || $6::jsonb, errors=(errors || $7::jsonb) WHERE id=$1 AND created_by=$8`, [logId, summary.total, summary.imported, summary.duplicate, summary.error, JSON.stringify(ids), JSON.stringify(errs), req.user.id]);
    } else {
      const lg = await one(`INSERT INTO import_log (kind, label, filename, rows_total, rows_imported, rows_skipped, rows_failed, created_ids, errors, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [def.kind, def.label, String(b.filename || '').slice(0, 200), summary.total, summary.imported, summary.duplicate, summary.error, JSON.stringify(ids), JSON.stringify(errs), req.user.id]);
      logId = lg.id;
    }
  }
  res.json({ kind: def.kind, label: def.label, dry_run: dry, summary, results, unknown_columns: unknown, log_id: logId });
}));

module.exports = r;
