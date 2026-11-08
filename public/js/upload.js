// Excel / CSV upload everywhere: template download, preview (dry run), add-only import, error report.
import { html, raw, api, post, modal, toast, err, route, page, on, go, fdt, todayStr, state, afterRender, loadLookups } from './core.js';

let KINDS = null;
async function kinds(force) {
  if (!KINDS || force) KINDS = await api('/import/kinds');
  return KINDS;
}
const fileSafe = (t) => String(t || 'upload').replace(/[^A-Za-z0-9 _&-]+/g, ' ').trim().replace(/\s+/g, '-').toLowerCase();
const UP_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21V9M7 14l5-5 5 5M4 3h16"/></svg>';

// Which upload types belong to the screen the user is on
function kindsForRoute(path, query) {
  let m;
  if ((m = /^\/registers\/([^/]+)$/.exec(path)) || (m = /^\/registers\/([^/]+)\/new$/.exec(path))) return [`register:${m[1]}`];
  if (path === '/store') {
    const t = query.tab || 'modules';
    const map = { modules: 'module', apparel: 'apparel', supplies: 'supply' };
    if (map[t]) return [`store:${map[t]}:receipt`, `store:${map[t]}:issue`];
    if (t === 'batches') return ['batches'];
    if (t === 'history') return ['store:module:receipt', 'store:module:issue', 'store:apparel:receipt', 'store:apparel:issue', 'store:supply:receipt', 'store:supply:issue'];
    return [];
  }
  if (path === '/store/entry') {
    const k = query.kind || 'module'; const t = query.type === 'issue' ? 'issue' : 'receipt';
    return [`store:${k}:${t}`];
  }
  const fixed = {
    '/vendors': ['vendors'], '/admin/items': ['items', 'stock'], '/inventory': ['stock', 'items'], '/admin/branches': ['branches'], '/admin/categories': ['categories'],
    '/admin/users': ['users'], '/documents': ['documents'], '/tasks': ['tasks'], '/purchases': ['purchases'], '/purchase/new': ['purchases'], '/vouchers': ['purchases'],
    '/petty-cash': ['petty_topup', 'purchases']
  };
  return fixed[path] || [];
}

async function addUploadButton(path, query) {
  const root = document.getElementById('content');
  if (!root || root.querySelector('[data-upbtn]') || path === '/import') return;
  const want = kindsForRoute(path, query);
  if (!want.length) return;
  let list;
  try { list = await kinds(); } catch (e) { return; }
  let avail = want.filter((k) => list.some((x) => x.kind === k));
  if (!avail.length && want[0].startsWith('register:')) { list = await kinds(true); avail = want.filter((k) => list.some((x) => x.kind === k)); }
  if (!avail.length || root !== document.getElementById('content')) return;
  const ph = root.querySelector('.pagehead'); if (!ph || ph.querySelector('[data-upbtn]')) return;
  let act = ph.querySelector(':scope > .actions');
  if (!act) { act = document.createElement('div'); act.className = 'actions'; ph.appendChild(act); }
  const b = document.createElement('button'); b.type = 'button'; b.className = 'btn'; b.dataset.upbtn = avail.join(',');
  b.title = 'Upload many records at once from an Excel or CSV file';
  b.innerHTML = `${UP_ICON} Upload Excel / CSV`;
  const xl = act.querySelector('[data-xlpage]');
  act.insertBefore(b, xl ? xl.nextSibling : act.firstChild);
}
afterRender.push(addUploadButton);
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-upbtn]'); if (b) openUpload(b.dataset.upbtn.split(','));
  const t = ev.target.closest('[data-uptemplate]'); if (t) downloadTemplate(t.dataset.uptemplate).catch(err);
});

// ---------- template ----------
async function downloadTemplate(kind) {
  const r = await fetch('/api/import/template/' + encodeURIComponent(kind), { credentials: 'same-origin' });
  if (!r.ok) { let m = 'Could not make the template.'; try { m = (await r.json()).error || m; } catch (e) { /* ignore */ } throw new Error(m); }
  const blob = await r.blob();
  const name = ((r.headers.get('Content-Disposition') || '').match(/filename="([^"]+)"/) || [])[1] || 'template.xlsx';
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  toast('Template downloaded — fill it and upload it');
}

// ---------- file parsing ----------
const p2 = (n) => String(n).padStart(2, '0');
function cellVal(v) {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return '';
    if (v.getFullYear() < 1901) return `${p2(v.getHours())}:${p2(v.getMinutes())}`;
    const d = `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())}`;
    return v.getHours() || v.getMinutes() ? `${d} ${p2(v.getHours())}:${p2(v.getMinutes())}` : d;
  }
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return v == null ? '' : String(v);
}
async function readFile(file) {
  const X = window.XLSX; if (!X) throw new Error('Excel library is still loading — try again in a moment.');
  const isCsv = /\.(csv|txt|tsv)$/i.test(file.name);
  const buf = await file.arrayBuffer();
  let wb;
  if (isCsv) {
    let text = new TextDecoder('utf-8').decode(buf).replace(/^﻿/, '');
    wb = X.read(text, { type: 'string', raw: true });
  } else wb = X.read(buf, { type: 'array', cellDates: true });
  const name = wb.SheetNames.find((n) => ['data', 'bills'].includes(n.toLowerCase())) || wb.SheetNames.find((n) => !/^(help|read me)$/i.test(n)) || wb.SheetNames[0];
  const ws = wb.Sheets[name];
  const json = X.utils.sheet_to_json(ws, { defval: '', raw: true });
  const rows = json.map((r) => {
    const o = {}; Object.keys(r).forEach((k) => { if (!/^__EMPTY/.test(k)) o[String(k).trim()] = cellVal(r[k]).trim(); });
    o.__row = (r.__rowNum__ ?? 0) + 1;
    return o;
  }).filter((o) => Object.keys(o).some((k) => k !== '__row' && o[k] !== ''));
  return { rows, sheet: name };
}

// ---------- upload modal ----------
const STATUS = { ok: ['Ready', 'ok'], imported: ['Added', 'ok'], duplicate: ['Skipped — already there', 'pend'], error: ['Needs fixing', 'crit'] };
function resultTable(results) {
  const order = { error: 0, duplicate: 1, ok: 2, imported: 2 };
  const list = [...results].sort((a, b) => order[a.status] - order[b.status] || a.row - b.row).slice(0, 400);
  return html`<div class="tbl-wrap" style="max-height:340px;overflow:auto"><table class="tbl"><thead><tr><th class="r">Row</th><th>Status</th><th>Record</th><th>Message</th></tr></thead><tbody>
    ${list.map((r) => html`<tr><td class="r">${r.row}</td><td><span class="bd ${STATUS[r.status][1]}">${STATUS[r.status][0]}</span></td><td>${r.summary || ''}</td><td class="small">${r.message || ''}</td></tr>`)}
  </tbody></table></div>${results.length > 400 ? html`<p class="muted tiny">Showing 400 of ${results.length} rows — download the report for all.</p>` : ''}`;
}
function sumLine(s) {
  return html`<div class="kpis" style="margin:10px 0">
    <div class="kpi"><div class="l">Rows read</div><div class="v">${s.total}</div></div>
    <div class="kpi"><div class="l">${s.imported ? 'Added' : 'Ready to add'}</div><div class="v" style="color:var(--ok,#1C7C7D)">${s.imported || s.ok}</div></div>
    <div class="kpi"><div class="l">Skipped (already there)</div><div class="v">${s.duplicate}</div></div>
    <div class="kpi"><div class="l">Need fixing</div><div class="v" style="color:${s.error ? '#B3261E' : 'inherit'}">${s.error}</div></div></div>`;
}
const merge = (a, b) => ({ total: a.total + b.total, ok: a.ok + b.ok, imported: a.imported + b.imported, duplicate: a.duplicate + b.duplicate, error: a.error + b.error });
const ZERO = { total: 0, ok: 0, imported: 0, duplicate: 0, error: 0 };

async function runChunks(kind, rows, { dry, filename, chunk, onProgress }) {
  let sum = { ...ZERO }; let results = []; let unknown = []; let logId = null;
  for (let i = 0; i < rows.length; i += chunk) {
    const part = rows.slice(i, i + chunk);
    const r = await post('/import/' + encodeURIComponent(kind), { rows: part, dry_run: dry, filename, log_id: logId });
    if (!dry) logId = r.log_id || logId;
    sum = merge(sum, r.summary); results = results.concat(r.results); unknown = r.unknown_columns || unknown;
    if (onProgress) onProgress(Math.min(rows.length, i + chunk), rows.length);
  }
  return { summary: sum, results, unknown, logId };
}

function downloadReport(k, rows, results, filename) {
  const X = window.XLSX; if (!X) return;
  const byRow = new Map(results.map((r) => [r.row, r]));
  const out = rows.map((r) => { const res = byRow.get(r.__row) || {}; const { __row, ...rest } = r; return { 'Row in file': __row, Result: res.status ? STATUS[res.status][0] : 'Blank row', Message: res.message || '', ...rest }; });
  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, X.utils.json_to_sheet(out), 'Upload report');
  const errs = rows.filter((r) => (byRow.get(r.__row) || {}).status === 'error').map((r) => { const { __row, ...rest } = r; return rest; });
  if (errs.length) X.utils.book_append_sheet(wb, X.utils.json_to_sheet(errs), 'Data');
  X.writeFile(wb, `upload-report-${fileSafe(k.label)}-${todayStr()}.xlsx`);
}

export async function openUpload(kindList) {
  let all;
  try { all = await kinds(); } catch (e) { return err(e); }
  const avail = all.filter((k) => kindList.includes(k.kind));
  if (!avail.length) return toast('You do not have permission to upload here.', true);
  let st = { kind: avail[0].kind, file: null, rows: null, preview: null };
  const K = () => all.find((x) => x.kind === st.kind);
  const body = html`<div id="upbox">
    ${avail.length > 1 ? html`<div class="fld"><label for="upk">What are you uploading?</label><select id="upk">${avail.map((k) => html`<option value="${k.kind}">${k.label}</option>`)}</select></div>` : html`<p><b>${avail[0].label}</b></p>`}
    <div class="callout info" style="margin:8px 0">
      <b>Step 1.</b> Download the template, fill one record per row. <span class="muted">Template download karke har line mein ek record bhariye.</span><br>
      <button type="button" class="btn sm" data-x="tpl" style="margin-top:6px">⬇ Download template</button>
      <span class="muted tiny" id="upcols"></span>
    </div>
    <div class="fld"><label for="upf">Step 2. Choose the filled Excel (.xlsx) or CSV file <span class="hi">Bhari hui Excel / CSV file chuniye</span></label>
      <input id="upf" type="file" accept=".xlsx,.xls,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"></div>
    <p class="muted tiny">Uploads only <b>add</b> new records — nothing already saved is changed or deleted. Exact repeats are skipped automatically. You will see a preview before anything is saved.</p>
    <div id="upres"></div>
  </div>`;
  const actions = html`<button type="button" class="btn" data-x="close">Close</button><button type="button" class="btn pri" data-x="import" id="upgo" disabled>Import</button>`;
  return modal('Upload Excel / CSV', body, {
    wide: true, actions,
    onMount: (ctx) => {
      const el = ctx.el; const res = el.querySelector('#upres'); const goBtn = el.querySelector('#upgo');
      const showCols = () => { const k = K(); el.querySelector('#upcols').textContent = ' Columns: ' + k.columns.map((c) => c.label + (c.required ? '*' : '')).join(', '); };
      showCols();
      const reset = () => { st.preview = null; goBtn.disabled = true; goBtn.textContent = 'Import'; res.innerHTML = ''; };
      const preview = async () => {
        if (!st.rows) return;
        reset();
        const k = K();
        if (!st.rows.length) { res.innerHTML = html`<div class="callout crit">No data rows found in “${st.file.name}”.</div>`.s; return; }
        if (st.rows.length > k.maxRows * 5) { res.innerHTML = html`<div class="callout crit">This file has ${st.rows.length} rows. Please upload at most ${k.maxRows * 5} rows at a time.</div>`.s; return; }
        if (k.kind === 'purchases' && st.rows.length > k.maxRows) { res.innerHTML = html`<div class="callout crit">Purchases: upload at most ${k.maxRows} rows at a time.</div>`.s; return; }
        res.innerHTML = '<div class="empty">Checking every row… / har line jaanch rahe hain…</div>';
        try {
          const chunk = k.kind === 'purchases' ? k.maxRows : 500;
          const p = await runChunks(k.kind, st.rows, { dry: true, filename: st.file.name, chunk });
          st.preview = p;
          const ready = p.summary.ok;
          res.innerHTML = html`<h3 style="margin-top:12px">Preview — nothing saved yet</h3>${sumLine(p.summary)}
            ${p.unknown.length ? html`<div class="callout pend small">${p.unknown.length > 10 ? `${p.unknown.length} extra columns in the file are not needed and will be ignored (e.g. ${p.unknown.slice(0, 5).join(', ')}…).` : `These columns are not used and will be ignored: ${p.unknown.join(', ')}`}</div>` : ''}
            ${p.summary.error ? html`<div class="callout crit small">${p.summary.error} row(s) have mistakes. You can import the ${ready} correct row(s) now and fix the rest later — <button type="button" class="btn sm" data-x="report">⬇ Download rows to fix</button></div>` : ''}
            ${resultTable(p.results)}`.s;
          goBtn.disabled = !ready; goBtn.textContent = ready ? `Import ${ready} row${ready === 1 ? '' : 's'}` : 'Nothing to import';
        } catch (e) { res.innerHTML = html`<div class="callout crit">${e.message}</div>`.s; }
      };
      const sel = el.querySelector('#upk'); if (sel) sel.addEventListener('change', () => { st.kind = sel.value; showCols(); preview(); });
      el.querySelector('#upf').addEventListener('change', async (ev) => {
        const f = ev.target.files[0]; if (!f) return;
        reset(); st.file = f; st.rows = null;
        if (f.size > 8 * 1024 * 1024) { res.innerHTML = '<div class="callout crit">File is too large (max 8 MB). Split it into smaller files.</div>'; return; }
        try { const r = await readFile(f); st.rows = r.rows; } catch (e) { res.innerHTML = html`<div class="callout crit">Could not read this file: ${e.message}</div>`.s; return; }
        preview();
      });
      ctx.onAction = async (a) => {
        const k = K();
        if (a === 'tpl') { await downloadTemplate(k.kind); return undefined; }
        if (a === 'report') { downloadReport(k, st.rows, (st.done || st.preview).results, st.file.name); return undefined; }
        if (a === 'import') {
          if (!st.preview || !st.preview.summary.ok) return undefined;
          goBtn.textContent = 'Importing…';
          const chunk = k.kind === 'purchases' ? k.maxRows : 200;
          res.innerHTML = '<div class="callout">Saving… <progress id="upprog" max="100" value="0" style="width:60%"></progress> <span id="uppct"></span></div>';
          const done = await runChunks(k.kind, st.rows, { dry: false, filename: st.file.name, chunk, onProgress: (n, t) => { const pr = el.querySelector('#upprog'); if (pr) pr.value = Math.round((n / t) * 100); const pc = el.querySelector('#uppct'); if (pc) pc.textContent = `${n} / ${t}`; } });
          st.done = done;
          res.innerHTML = html`<div class="callout ok"><b>${done.summary.imported} record(s) added.</b> ${done.summary.duplicate ? `${done.summary.duplicate} skipped (already there). ` : ''}${done.summary.error ? `${done.summary.error} need fixing.` : ''}</div>
            ${sumLine(done.summary)}
            <button type="button" class="btn sm" data-x="report">⬇ Download upload report</button>
            ${resultTable(done.results)}`.s;
          goBtn.disabled = true; goBtn.textContent = 'Done';
          el.querySelector('#upf').value = ''; st.preview = null;
          if (done.summary.imported) { ctx.changed = true; toast(`${done.summary.imported} record(s) added`); loadLookups(true).catch(() => {}); }
          return undefined;
        }
        return undefined;
      };
      // refresh the screen behind when closing after a successful import
      const obs = new MutationObserver(() => { if (!document.body.contains(el)) { obs.disconnect(); if (ctx.changed) go(location.hash); } });
      obs.observe(document.body, { childList: true });
    }
  });
}

// ---------- Import Centre ----------
route('/import', async () => {
  const [list, log] = await Promise.all([kinds(true), api('/import/log')]);
  const groups = [...new Set(list.map((k) => k.group))];
  page('Upload Excel / CSV', html`<div class="pagehead"><div><div class="eyebrow">Operations</div><h1>Upload Excel / CSV</h1>
      <p class="muted">Add many records at once — registers, store entries, purchases, masters. Uploads only add new records; existing data is never changed. <span class="hi">Ek saath bahut saara data jodiye — purana data nahi badlega.</span></p></div></div>
    <div class="callout info small"><b>How it works:</b> 1) Download the template for what you want to add · 2) Fill one record per row (Excel or save as CSV) · 3) Upload — you see a row-by-row preview with mistakes highlighted · 4) Import the correct rows. Repeats of records already in the system are skipped.</div>
    ${groups.map((g) => html`<section class="card"><h2>${g}</h2><div class="tbl-wrap" style="border:0"><table class="tbl"><thead><tr><th>Upload type</th><th>Columns</th><th></th></tr></thead><tbody>
      ${list.filter((k) => k.group === g).map((k) => html`<tr><td><b>${k.label}</b></td><td class="small muted">${k.columns.map((c) => c.label + (c.required ? '*' : '')).join(', ')}</td>
        <td class="r" style="white-space:nowrap"><button type="button" class="btn sm" data-uptemplate="${k.kind}">⬇ Template</button> <button type="button" class="btn sm pri" data-upbtn="${k.kind}">${raw(UP_ICON)} Upload</button></td></tr>`)}
    </tbody></table></div></section>`)}
    <section class="card"><h2>Upload history</h2>${log.length ? html`<div class="tbl-wrap" style="border:0"><table class="tbl"><thead><tr><th>When</th><th>What</th><th>File</th><th>By</th><th class="r">Rows</th><th class="r">Added</th><th class="r">Skipped</th><th class="r">Errors</th></tr></thead><tbody>
      ${log.map((l) => html`<tr><td>${fdt(l.created_at)}</td><td>${l.label}</td><td class="small">${l.filename || ''}</td><td>${l.created_by_name || ''}</td><td class="r">${l.rows_total}</td><td class="r">${l.rows_imported}</td><td class="r">${l.rows_skipped}</td><td class="r">${l.rows_failed}</td></tr>`)}
    </tbody></table></div>` : html`<div class="empty">No uploads yet.</div>`}</section>`);
});
export { downloadTemplate };
