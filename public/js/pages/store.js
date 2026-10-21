// Store: Modules (books), T-shirts & uniforms, Housekeeping & other supplies.
import { html, raw, api, post, put, route, page, state, can, chart, PALETTE, fdate, fdt, badge, icon, on, go, toast, err, modal, promptReason, opts, formData, todayStr, cap, esc } from '../core.js';
import { uploadFile } from '../forms.js';

let CFG = null;
const cfg = async (force) => (CFG = !CFG || force ? await api('/store/config') : CFG);
const KIND_LABEL = { module: 'Modules (books)', apparel: 'T-shirts & uniforms', supply: 'Housekeeping & supplies' };
const KIND_ICON = { module: 'file', apparel: 'person', supply: 'broom' };
const TXN_LABEL = { receipt: 'Received', issue: 'Given out', transfer: 'Transfer', damaged: 'Damaged / lost', return: 'Returned' };
const TXN_BADGE = { receipt: 'approved', issue: 'info', transfer: 'pending', damaged: 'rejected', return: 'reviewed' };
const n = (v) => Number(v || 0);
const fmt = (v) => (Number.isInteger(Number(v)) ? Number(v) : Number(v).toFixed(2));
const canTxn = () => !['guard', 'driver'].includes(state.me.role);
const branchSel = (name, sel, blank) => (can.allBranches() || state.me.role === 'manager'
  ? html`<div class="fld"><label for="${name}">Branch</label><select id="${name}" name="${name}">${opts(state.lookups.branches, sel || state.me.branch_id, blank ? { blank } : {})}</select></div>` : '');
const courseOf = (c, name) => c.module.courses.find((x) => x.name === name);

function tabs(cur) {
  const t = [['modules', 'Modules (books)'], ['apparel', 'T-shirts & uniforms'], ['supplies', 'Housekeeping & supplies'], ['batches', 'Batches'], ['history', 'History'], ['lookup', 'Student / staff lookup']];
  if (can.mgmt()) t.push(['setup', 'Setup']);
  return html`<nav class="tabs" aria-label="Store sections">${t.map(([k, l]) => html`<a href="#/store?tab=${k}" class="${cur === k ? 'on' : ''}">${l}</a>`)}</nav>`;
}
function head(sub) {
  return html`<div class="pagehead"><div><div class="eyebrow">Store · Saaman ka hisaab</div><h1>Modules, Uniforms & Supplies</h1>${sub ? html`<div class="small muted">${sub}</div>` : ''}</div>
    ${canTxn() ? html`<div class="actions"><a class="btn pri" href="#/store/entry?type=receipt">${icon('plus')} Receive stock</a><a class="btn" href="#/store/entry?type=issue">${icon('person')} Issue / give out</a>
      <a class="btn" href="#/store/entry?type=transfer">Transfer</a><a class="btn" href="#/store/entry?type=damaged">Damaged / return</a></div>` : ''}</div>`;
}
const stockCell = (it) => {
  const short = it.pending > 0 && n(it.in_hand) < n(it.pending);
  const low = it.min_stock > 0 && n(it.in_hand) < it.min_stock;
  return short ? 'crit' : (low ? 'pend' : 'ok');
};

// ================= Store home (tabs) =================
route('/store', async (p, query) => {
  const tab = query.tab || 'modules';
  const c = await cfg();
  if (tab === 'modules') return modulesTab(c, query);
  if (tab === 'apparel') return apparelTab(c, query);
  if (tab === 'supplies') return suppliesTab(c, query);
  if (tab === 'batches') return batchesTab(c, query);
  if (tab === 'history') return historyTab(c, query);
  if (tab === 'lookup') return lookupTab(c, query);
  if (tab === 'setup') return setupTab(c);
  return modulesTab(c, query);
});

function filterForm(fields, query, tab) {
  return html`<form class="filters card tight" data-form="sflt"><input type="hidden" name="tab" value="${tab}">${fields}
    ${can.allBranches() ? html`<div class="fld"><label for="fbr">Branch</label><select id="fbr" name="branch_id">${opts(state.lookups.branches, query.branch_id, { blank: 'All branches' })}</select></div>` : ''}
    <button class="btn" type="submit">Filter</button><a class="btn" href="#/store?tab=${tab}">Reset</a></form>`;
}
function bindFilters() {
  on('submit', '[data-form="sflt"]', (f) => { const o = Object.fromEntries([...new FormData(f)].filter(([, v]) => v)); go('#/store?' + new URLSearchParams(o)); });
}

// ---------- Modules ----------
async function modulesTab(c, query) {
  const course = query.course || '';
  const co = courseOf(c, course);
  const qs = new URLSearchParams({ kind: 'module', ...Object.fromEntries(['course', 'class_level', 'subject', 'module_no', 'session', 'branch_id', 'q'].filter((k) => query[k]).map((k) => [k, query[k]])) });
  const { rows } = await api('/store/items?' + qs);
  const gridCourse = course || c.module.courses[0].name;
  const grid = await api(`/store/grid?course=${encodeURIComponent(gridCourse)}&session=${encodeURIComponent(query.session || c.session)}${query.branch_id ? '&branch_id=' + query.branch_id : ''}`);
  const tot = (k) => rows.reduce((a, r) => a + n(r[k]), 0);
  const short = rows.filter((r) => r.pending > 0 && n(r.in_hand) < n(r.pending));
  const low = rows.filter((r) => r.min_stock > 0 && n(r.in_hand) < r.min_stock);
  const gRows = grid.rows.filter((r) => (!query.class_level || r.class_level === query.class_level) && (!query.subject || r.subject === query.subject));
  const classSub = [...new Set(gRows.map((r) => `${r.class_level}||${r.subject}`))];
  const mods = [...new Set(gRows.map((r) => r.module_no))].sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0) || String(a).localeCompare(String(b)));
  const subjects = co ? co.subjects : [...new Set(c.module.courses.flatMap((x) => x.subjects))];
  const classes = co ? co.classes : [...new Set(c.module.courses.flatMap((x) => x.classes))];
  page('Store — Modules', html`${head('Module = kitaab jo students ko di jaati hai. Course → Class → Subject → Module number.')}${tabs('modules')}
    ${filterForm(html`
      <div class="fld"><label for="fc">Course</label><select id="fc" name="course" data-dep>${opts(c.module.courses.map((x) => x.name), course, { blank: 'All courses' })}</select></div>
      <div class="fld"><label for="fcl">Class</label><select id="fcl" name="class_level">${opts(classes, query.class_level, { blank: 'All classes' })}</select></div>
      <div class="fld"><label for="fs">Subject</label><select id="fs" name="subject">${opts(subjects, query.subject, { blank: 'All subjects' })}</select></div>
      <div class="fld"><label for="fm">Module no.</label><input id="fm" type="text" name="module_no" value="${query.module_no || ''}" placeholder="e.g. 3"></div>
      <div class="fld"><label for="fse">Session</label><input id="fse" type="text" name="session" value="${query.session || ''}" placeholder="${c.session}"></div>`, query, 'modules')}
    <div class="kpis">
      <div class="kpi"><span class="l">Modules tracked</span><span class="v">${rows.length}</span><span class="n">Course · class · subject · module</span></div>
      <div class="kpi"><span class="l">Copies received</span><span class="v">${fmt(tot('received'))}</span><span class="n">${fmt(tot('damaged'))} damaged / short</span></div>
      <div class="kpi"><span class="l">Given to students</span><span class="v">${fmt(tot('issued'))}</span><span class="n">${fmt(tot('returned'))} returned</span></div>
      <div class="kpi"><span class="l">In hand</span><span class="v">${fmt(tot('in_hand'))}</span><span class="n ${low.length ? 'warn' : ''}">${low.length} below minimum</span></div>
      <div class="kpi"><span class="l">Still to give students</span><span class="v" style="color:${tot('pending') ? 'var(--high)' : 'inherit'}">${fmt(tot('pending'))}</span><span class="n ${short.length ? 'warn' : ''}">${short.length} module(s) short of stock</span></div>
    </div>
    ${short.length ? html`<div class="callout crit"><b>Not enough copies for students:</b> ${short.slice(0, 6).map((r) => `${r.class_level} ${r.subject} M-${r.module_no} (need ${fmt(r.pending)}, have ${fmt(r.in_hand)})`).join(' · ')}</div>` : ''}
    <div class="card"><div class="card-h"><div><h2>Module grid — ${gridCourse} · ${grid.session}</h2><div class="small muted">Each box: <b>in hand</b> / still to give. Red = not enough copies, amber = below minimum. Click a box for details.</div></div>
      <div class="seg">${c.module.courses.map((x) => html`<a class="btn sm ${x.name === gridCourse ? 'pri' : ''}" href="#/store?tab=modules&course=${encodeURIComponent(x.name)}">${x.name}</a>`)}</div></div>
      ${gRows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Class · Subject</th>${mods.map((m) => html`<th class="r">M-${m}</th>`)}</tr></thead><tbody>
        ${classSub.map((cs) => { const [cl, su] = cs.split('||'); return html`<tr><td><b>${cl}</b> · ${su}</td>${mods.map((m) => { const it = gRows.find((r) => r.class_level === cl && r.subject === su && r.module_no === m); if (!it) return html`<td class="r faint">—</td>`;
          const st = stockCell(it); return html`<td class="r"><a href="#/store/item/${it.id}" class="bd ${st}" style="text-decoration:none;font-size:13px" title="Received ${fmt(it.received)}, given ${fmt(it.issued)}">${fmt(it.in_hand)}${it.students ? ' / ' + fmt(it.pending) : ''}</a></td>`; })}</tr>`; })}
      </tbody></table></div>` : html`<div class="empty">No modules received yet for ${gridCourse}. <a href="#/store/entry?type=receipt&kind=module">Receive the first lot</a>.</div>`}
    </div>
    <div class="grid g2"><div class="card"><div class="card-h"><h2>By subject</h2></div><div class="chart-box"><canvas id="cSub" role="img" aria-label="Received, given and in hand by subject"></canvas></div></div>
      <div class="card"><div class="card-h"><h2>Stock vs students waiting</h2></div><div class="chart-box"><canvas id="cPend" role="img" aria-label="In hand versus pending"></canvas></div></div></div>
    ${itemTable(rows, 'module')}`);
  bindFilters(); bindXl(rows, 'modules');
  on('change', '[data-dep]', (s) => { const f = s.form; go('#/store?' + new URLSearchParams({ tab: 'modules', course: s.value, ...(f.branch_id && f.branch_id.value ? { branch_id: f.branch_id.value } : {}) })); });
  const subs = [...new Set(rows.map((r) => r.subject))];
  const sum = (s, k) => rows.filter((r) => r.subject === s).reduce((a, r) => a + n(r[k]), 0);
  chart('cSub', { type: 'bar', data: { labels: subs, datasets: [{ label: 'Received', data: subs.map((s) => sum(s, 'received')), backgroundColor: PALETTE[0], borderRadius: 3 }, { label: 'Given', data: subs.map((s) => sum(s, 'issued')), backgroundColor: PALETTE[2], borderRadius: 3 }, { label: 'In hand', data: subs.map((s) => sum(s, 'in_hand')), backgroundColor: '#C9B3D1', borderRadius: 3 }] }, options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } } });
  const top = rows.filter((r) => r.students).slice(0, 14);
  chart('cPend', { type: 'bar', data: { labels: top.map((r) => `${r.class_level} ${r.subject.slice(0, 4)} M-${r.module_no}`), datasets: [{ label: 'In hand', data: top.map((r) => n(r.in_hand)), backgroundColor: PALETTE[0], borderRadius: 3 }, { label: 'Still to give', data: top.map((r) => n(r.pending)), backgroundColor: PALETTE[1], borderRadius: 3 }] }, options: { indexAxis: 'y', plugins: { legend: { position: 'bottom' } }, scales: { x: { beginAtZero: true } } } });
}

function itemTable(rows, kind) {
  const cols = kind === 'module' ? [['Module', (r) => html`<a href="#/store/item/${r.id}"><b>${r.class_level} · ${r.subject} · M-${r.module_no}</b></a><div class="tiny muted">${r.course} · ${r.session}${r.language && r.language !== 'English' ? ' · ' + r.language : ''}${r.title ? ' · ' + r.title : ''}</div>`]]
    : kind === 'apparel' ? [['Item', (r) => html`<a href="#/store/item/${r.id}"><b>${r.garment}</b> · ${r.size}</a><div class="tiny muted">${r.audience}${r.gender && r.gender !== 'Unisex' ? ' · ' + r.gender : ''}${r.colour ? ' · ' + r.colour : ''}</div>`]]
      : [['Item', (r) => html`<a href="#/store/item/${r.id}"><b>${r.name}</b></a><div class="tiny muted">${r.category}${r.spec ? ' · ' + r.spec : ''}</div>`]];
  return html`<div class="card"><div class="card-h"><h2>All ${KIND_LABEL[kind].toLowerCase()}</h2><button class="btn sm" data-xl>Export Excel</button></div>
    <div class="tbl-wrap" style="border:0"><table class="tbl"><thead><tr>${cols.map(([h]) => html`<th>${h}</th>`)}<th class="r">Received</th><th class="r">Given</th><th class="r">Damaged</th><th class="r">In hand</th>${kind === 'module' ? html`<th class="r">To give</th>` : ''}<th class="r">Min</th><th>Last received</th><th></th></tr></thead><tbody>
    ${rows.length ? rows.map((r) => html`<tr>${cols.map(([, f]) => html`<td>${f(r)}</td>`)}<td class="r num">${fmt(r.received)}</td><td class="r num">${fmt(r.issued)}</td><td class="r num">${fmt(r.damaged)}</td>
      <td class="r num"><span class="bd ${stockCell(r)}">${fmt(r.in_hand)} ${r.unit || ''}</span></td>${kind === 'module' ? html`<td class="r num">${r.students ? fmt(r.pending) : html`<span class="faint" title="Add batches to see pending">—</span>`}</td>` : ''}<td class="r num">${fmt(r.min_stock)}</td><td class="small">${fdate(r.last_received)}</td>
      <td style="white-space:nowrap">${canTxn() ? html`<a class="btn sm" href="#/store/entry?type=receipt&item_id=${r.id}">+ Receive</a> <a class="btn sm" href="#/store/entry?type=issue&item_id=${r.id}">Give</a>` : ''}</td></tr>`) : html`<tr><td colspan="10" class="empty">Nothing yet. Use <b>Receive stock</b> to add the first entry.</td></tr>`}
    </tbody></table></div></div>`;
}
let XLROWS = [];
function bindXl(rows, name) {
  XLROWS = rows;
  on('click', '[data-xl]', () => {
    const data = XLROWS.map((r) => ({ Item: r.name, Category: r.category, Course: r.course || '', Class: r.class_level || '', Subject: r.subject || '', 'Module no': r.module_no || '', Session: r.session || '', Garment: r.garment || '', Size: r.size || '', 'For whom': r.audience || '', Colour: r.colour || '', Received: n(r.received), Given: n(r.issued), Damaged: n(r.damaged), Returned: n(r.returned), 'In hand': n(r.in_hand), 'Still to give': r.pending ?? '', 'Min stock': n(r.min_stock), 'Last received': r.last_received || '' }));
    const ws = window.XLSX.utils.json_to_sheet(data); const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, name); window.XLSX.writeFile(wb, `store-${name}-${todayStr()}.xlsx`);
  });
}

// ---------- Apparel ----------
async function apparelTab(c, query) {
  const qs = new URLSearchParams({ kind: 'apparel', ...Object.fromEntries(['garment', 'size', 'audience', 'branch_id'].filter((k) => query[k]).map((k) => [k, query[k]])) });
  const d = await api('/store/items?' + qs);
  const rows = d.rows;
  const tot = (k) => rows.reduce((a, r) => a + n(r[k]), 0);
  const sizes = c.apparel.sizes.filter((s) => rows.some((r) => r.size === s));
  const groups = [...new Set(rows.map((r) => [r.garment, r.audience, r.gender || 'Unisex', r.colour || ''].join('||')))];
  const byAud = (a) => rows.filter((r) => r.audience === a).reduce((x, r) => x + n(r.in_hand), 0);
  page('Store — Uniforms', html`${head('T-shirt / uniform ka stock size ke hisaab se. Students, Teachers, Non-academic staff.')}${tabs('apparel')}
    ${filterForm(html`
      <div class="fld"><label for="fg">Garment</label><select id="fg" name="garment">${opts(c.apparel.garments, query.garment, { blank: 'All' })}</select></div>
      <div class="fld"><label for="fa">For whom</label><select id="fa" name="audience">${opts(c.apparel.audiences, query.audience, { blank: 'All' })}</select></div>
      <div class="fld"><label for="fz">Size</label><select id="fz" name="size">${opts(c.apparel.sizes, query.size, { blank: 'All' })}</select></div>`, query, 'apparel')}
    <div class="kpis">
      <div class="kpi"><span class="l">Pieces in hand</span><span class="v">${fmt(tot('in_hand'))}</span><span class="n">${rows.length} garment-size combinations</span></div>
      ${c.apparel.audiences.map((a) => html`<div class="kpi"><span class="l">${a}</span><span class="v">${fmt(byAud(a))}</span><span class="n">in hand</span></div>`)}
      <div class="kpi"><span class="l">Given out</span><span class="v">${fmt(tot('issued'))}</span><span class="n">${fmt(tot('damaged'))} damaged</span></div>
    </div>
    ${Object.keys(d.studentPendingByGarment || {}).length ? html`<div class="callout info"><b>Students still to receive</b> (from batch strength ${d.totalStudents}): ${Object.entries(d.studentPendingByGarment).map(([g, v]) => `${g}: ${v}`).join(' · ')}</div>` : ''}
    <div class="card"><div class="card-h"><div><h2>Size chart — pieces in hand</h2><div class="small muted">Click a number to see details or give it out.</div></div></div>
      ${rows.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Garment · for whom · colour</th>${sizes.map((s) => html`<th class="r">${s}</th>`)}<th class="r">Total</th></tr></thead><tbody>
        ${groups.map((g) => { const [ga, au, ge, co] = g.split('||'); const its = rows.filter((r) => r.garment === ga && r.audience === au && (r.gender || 'Unisex') === ge && (r.colour || '') === co);
          return html`<tr><td><b>${ga}</b> · ${au}${ge !== 'Unisex' ? ' · ' + ge : ''}${co ? html` <span class="tiny muted">· ${co}</span>` : ''}</td>${sizes.map((s) => { const it = its.find((r) => r.size === s); return it ? html`<td class="r"><a class="bd ${stockCell(it)}" href="#/store/item/${it.id}" style="text-decoration:none;font-size:13px">${fmt(it.in_hand)}</a></td>` : html`<td class="r faint">—</td>`; })}
          <td class="r num"><b>${fmt(its.reduce((a, r) => a + n(r.in_hand), 0))}</b></td></tr>`; })}
      </tbody></table></div>` : html`<div class="empty">No T-shirts or uniforms received yet. <a href="#/store/entry?type=receipt&kind=apparel">Receive the first lot</a>.</div>`}</div>
    <div class="grid g2"><div class="card"><div class="card-h"><h2>In hand by size</h2></div><div class="chart-box"><canvas id="cSz" role="img" aria-label="Pieces in hand by size"></canvas></div></div>
      <div class="card"><div class="card-h"><h2>Given out by garment</h2></div><div class="chart-box"><canvas id="cGa" role="img" aria-label="Given out by garment"></canvas></div></div></div>
    ${itemTable(rows, 'apparel')}`);
  bindFilters(); bindXl(rows, 'uniforms');
  chart('cSz', { type: 'bar', data: { labels: sizes, datasets: c.apparel.audiences.map((a, i) => ({ label: a, data: sizes.map((s) => rows.filter((r) => r.size === s && r.audience === a).reduce((x, r) => x + n(r.in_hand), 0)), backgroundColor: PALETTE[i], borderRadius: 3 })) }, options: { plugins: { legend: { position: 'bottom' } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true } } } });
  const gs = [...new Set(rows.map((r) => r.garment))];
  chart('cGa', { type: 'bar', data: { labels: gs, datasets: [{ label: 'Given out', data: gs.map((g) => rows.filter((r) => r.garment === g).reduce((x, r) => x + n(r.issued), 0)), backgroundColor: PALETTE[2], borderRadius: 3 }, { label: 'In hand', data: gs.map((g) => rows.filter((r) => r.garment === g).reduce((x, r) => x + n(r.in_hand), 0)), backgroundColor: '#C9B3D1', borderRadius: 3 }] }, options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } } });
}

// ---------- Supplies ----------
async function suppliesTab(c, query) {
  const qs = new URLSearchParams({ kind: 'supply', ...Object.fromEntries(['category', 'branch_id', 'q'].filter((k) => query[k]).map((k) => [k, query[k]])) });
  const { rows } = await api('/store/items?' + qs);
  const cats = Object.keys(c.supply.categories);
  const low = rows.filter((r) => r.min_stock > 0 && n(r.in_hand) < r.min_stock);
  const usedCats = cats.filter((k) => rows.some((r) => r.category === k));
  page('Store — Supplies', html`${head('Safai ka saaman, stationery, pantry, bijli ka saaman, first aid — sab yahan.')}${tabs('supplies')}
    ${filterForm(html`
      <div class="fld"><label for="fca">Category</label><select id="fca" name="category">${opts(cats, query.category, { blank: 'All categories' })}</select></div>
      <div class="fld"><label for="fq">Search</label><input id="fq" type="search" name="q" value="${query.q || ''}" placeholder="Phenyl, marker, toner…"></div>`, query, 'supplies')}
    <div class="kpis">
      <div class="kpi"><span class="l">Items tracked</span><span class="v">${rows.length}</span><span class="n">${usedCats.length} categories</span></div>
      <div class="kpi"><span class="l">Below minimum</span><span class="v" style="color:${low.length ? 'var(--high)' : 'inherit'}">${low.length}</span><span class="n">Reorder needed</span></div>
      <div class="kpi"><span class="l">Given out (all time)</span><span class="v">${fmt(rows.reduce((a, r) => a + n(r.issued), 0))}</span><span class="n">units</span></div>
    </div>
    ${low.length ? html`<div class="callout pend"><b>Reorder:</b> ${low.slice(0, 10).map((r) => `${r.name} (${fmt(r.in_hand)}/${fmt(r.min_stock)} ${r.unit})`).join(' · ')}</div>` : ''}
    <div class="grid g2"><div class="card"><div class="card-h"><h2>Usage by category</h2></div><div class="chart-box"><canvas id="cCat" role="img" aria-label="Given out by category"></canvas></div></div>
      <div class="card"><div class="card-h"><h2>Categories</h2></div><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">${cats.map((k) => { const rs = rows.filter((r) => r.category === k); const lw = rs.filter((r) => r.min_stock > 0 && n(r.in_hand) < r.min_stock).length;
        return html`<a class="card tight" href="#/store?tab=supplies&category=${encodeURIComponent(k)}" style="text-decoration:none;color:inherit"><b class="small">${k}</b><div class="tiny muted">${rs.length} items${lw ? html` · <span style="color:var(--high)">${lw} low</span>` : ''}</div></a>`; })}</div></div></div>
    ${itemTable(rows, 'supply')}`);
  bindFilters(); bindXl(rows, 'supplies');
  chart('cCat', { type: 'bar', data: { labels: usedCats, datasets: [{ label: 'Given out', data: usedCats.map((k) => rows.filter((r) => r.category === k).reduce((a, r) => a + n(r.issued), 0)), backgroundColor: PALETTE[2], borderRadius: 3 }, { label: 'In hand', data: usedCats.map((k) => rows.filter((r) => r.category === k).reduce((a, r) => a + n(r.in_hand), 0)), backgroundColor: '#C9B3D1', borderRadius: 3 }] }, options: { indexAxis: 'y', plugins: { legend: { position: 'bottom' } }, scales: { x: { beginAtZero: true } } } });
}

// ---------- Batches ----------
async function batchModal(c, b) {
  b = b || { students: 0, session: c.session, active: true };
  const co = courseOf(c, b.course) || c.module.courses[0];
  return modal(b.id ? 'Edit batch' : 'Add batch', html`<div class="form" id="bf">
    <div class="fld"><label for="bn">Batch name</label><input id="bn" type="text" name="name" value="${b.name || ''}" placeholder="e.g. NEET-11 Morning A"></div>
    ${branchSel('branch_id', b.branch_id)}
    <div class="fld"><label for="bc">Course</label><select id="bc" name="course" data-bcourse>${opts(c.module.courses.map((x) => x.name), b.course || co.name)}</select></div>
    <div class="fld"><label for="bcl">Class</label><select id="bcl" name="class_level">${opts(co.classes, b.class_level, { blank: '— All classes —' })}</select></div>
    <div class="fld"><label for="bs">No. of students</label><input id="bs" type="number" min="0" name="students" value="${b.students}"></div>
    <div class="fld"><label for="bse">Session</label><input id="bse" type="text" name="session" value="${b.session || c.session}"></div>
    <div class="fld"><label for="bl">Language / medium</label><select id="bl" name="language">${opts(c.module.languages, b.language, { blank: '—' })}</select></div>
    ${b.id ? html`<label class="chk"><input type="checkbox" name="active" ${b.active ? raw('checked') : ''}> Active</label>` : ''}</div>`, {
    onMount: (ctx) => {
      ctx.el.addEventListener('change', (e) => { if (e.target.matches('[data-bcourse]')) { const cc = courseOf(c, e.target.value); ctx.el.querySelector('#bcl').innerHTML = opts(cc.classes, '', { blank: '— All classes —' }).s; } });
      ctx.onAction = async (a, el) => { if (a !== 'ok') return; const f = formData(el); if (b.id) await put('/batches/' + b.id, f); else await post('/batches', f); toast('Batch saved'); return true; };
    }
  });
}
async function batchesTab(c, query) {
  const rows = await api('/batches' + (query.branch_id ? '?branch_id=' + query.branch_id : ''));
  page('Store — Batches', html`${head('Batch ki student sankhya se pata chalta hai kitne module / T-shirt abhi dene baaki hain.')}${tabs('batches')}
    <div class="pagehead"><div class="small muted">${rows.filter((b) => b.active).length} active batches · ${rows.filter((b) => b.active).reduce((a, b) => a + b.students, 0)} students</div>${can.review() || state.me.role === 'staff' ? html`<button class="btn pri" data-addb>${icon('plus')} Add batch</button>` : ''}</div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Batch</th><th>Course</th><th>Class</th><th>Session</th><th class="r">Students</th><th>Branch</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.length ? rows.map((b) => html`<tr><td><b>${b.name}</b>${b.language ? html`<div class="tiny muted">${b.language}</div>` : ''}</td><td>${b.course}</td><td>${b.class_level || 'All'}</td><td>${b.session || ''}</td><td class="r num">${b.students}</td><td>${b.branch}</td><td>${b.active ? badge('approved', 'Active') : badge('cancelled', 'Closed')}</td>
      <td style="white-space:nowrap"><a class="btn sm" href="#/store/entry?type=issue&batch_id=${b.id}">Give modules</a> ${can.review() || state.me.role === 'staff' ? html`<button class="btn sm" data-edb="${b.id}">${icon('edit')}</button>` : ''}</td></tr>`) : html`<tr><td colspan="8" class="empty">No batches yet. Add your batches with student count to track pending modules.</td></tr>`}</tbody></table></div>`);
  on('click', '[data-addb]', async () => { if (await batchModal(c)) go(location.hash); });
  on('click', '[data-edb]', async (bt) => { if (await batchModal(c, rows.find((x) => x.id === Number(bt.dataset.edb)))) go(location.hash); });
}

// ---------- History ----------
async function editTxnModal(t) {
  const ok = await modal(`Edit — ${TXN_LABEL[t.kind]}`, html`<div class="form">
    <div class="fld"><label for="eq">Quantity</label><input id="eq" type="number" step="any" name="qty" value="${fmt(t.qty)}"></div>
    ${t.kind === 'receipt' ? html`<div class="fld"><label for="ed">Damaged / short copies</label><input id="ed" type="number" step="any" name="damaged_qty" value="${fmt(t.damaged_qty)}"></div>
      <div class="fld"><label for="ech">Challan / bill no.</label><input id="ech" type="text" name="challan_no" value="${t.challan_no || ''}"></div>` : ''}
    <div class="fld"><label for="edt">Date</label><input id="edt" type="date" name="date" value="${t.date}"></div>
    ${t.kind === 'issue' ? html`<div class="fld"><label for="eto">Given to</label><input id="eto" type="text" name="issued_to" value="${t.issued_to || ''}"></div>
      <div class="fld full"><label for="est">Saathi IDs / student names (optional)</label><textarea id="est" name="students">${t.students || ''}</textarea></div>` : ''}
    <div class="fld full"><label for="erm">Remarks</label><input id="erm" type="text" name="remarks" value="${t.remarks || ''}"></div>
    <div class="fld full"><label for="ers">Reason for edit</label><input id="ers" type="text" name="reason"></div></div>`, {
    onMount: (ctx) => { ctx.onAction = async (a, el) => { if (a !== 'ok') return; await put('/store/txns/' + t.id, formData(el)); toast('Saved'); return true; }; }
  });
  return ok;
}
function txnTable(rows, showItem = true) {
  return html`<div class="tbl-wrap"><table class="tbl" id="ttbl"><thead><tr><th>Date</th><th>Entry</th>${showItem ? html`<th>Item</th>` : ''}<th class="r">Qty</th><th>Details</th><th>Branch</th><th>By</th><th></th></tr></thead><tbody>
    ${rows.length ? rows.map((t) => html`<tr style="${t.status === 'cancelled' ? 'opacity:.55' : ''}"><td style="white-space:nowrap">${fdate(t.date)}</td><td>${badge(TXN_BADGE[t.kind], TXN_LABEL[t.kind])}${t.status === 'cancelled' ? html`<div class="tiny" style="color:var(--crit)">Cancelled: ${t.cancel_reason}</div>` : ''}</td>
      ${showItem ? html`<td><a href="#/store/item/${t.item_id}">${t.item}</a></td>` : ''}<td class="r num">${t.kind === 'issue' || t.kind === 'damaged' || t.kind === 'transfer' ? '−' : '+'}${fmt(t.qty)}${n(t.damaged_qty) ? html`<div class="tiny" style="color:var(--high)">${fmt(t.damaged_qty)} damaged</div>` : ''}</td>
      <td class="small">${[t.batch && 'Batch: ' + t.batch, t.issued_to && 'To: ' + t.issued_to, t.department, t.to_branch && '→ ' + t.to_branch, t.source && 'From: ' + t.source + (t.source_name ? ' (' + t.source_name + ')' : ''), t.challan_no && 'Challan ' + t.challan_no, t.remarks].filter(Boolean).join(' · ')}
        ${t.students ? html`<div class="tiny muted">${t.students.slice(0, 120)}${t.students.length > 120 ? '…' : ''}</div>` : ''}${t.file_id ? html` <a class="tiny" href="/api/files/${t.file_id}" target="_blank" rel="noopener">challan</a>` : ''}</td>
      <td class="small">${t.branch}</td><td class="small">${t.created_by_name}${t.updated_by_name ? html`<div class="tiny" style="color:var(--high)">edited by ${t.updated_by_name}</div>` : ''}</td>
      <td style="white-space:nowrap">${t.status === 'active' && (can.review() || t.created_by === state.me.id) ? html`<button class="btn sm" data-edt="${t.id}" aria-label="Edit">${icon('edit')}</button> <button class="btn sm danger" data-cnt="${t.id}">Cancel</button>` : ''}</td></tr>`) : html`<tr><td colspan="8" class="empty">No entries.</td></tr>`}
  </tbody></table></div>`;
}
function bindTxnActions(rows) {
  on('click', '[data-edt]', async (b) => { if (await editTxnModal(rows.find((x) => x.id === Number(b.dataset.edt)))) go(location.hash); });
  on('click', '[data-cnt]', async (b) => { const r = await promptReason('Cancel this entry', 'Reason (stock will be corrected)', { danger: true, okLabel: 'Cancel entry' }); if (r === null) return; await post(`/store/txns/${b.dataset.cnt}/cancel`, { reason: r }); toast('Cancelled'); go(location.hash); });
}
async function historyTab(c, query) {
  const qs = new URLSearchParams(Object.fromEntries(['item_kind', 'kind', 'from', 'to', 'q', 'branch_id'].filter((k) => query[k]).map((k) => [k, query[k]])));
  const rows = await api('/store/txns?' + qs);
  page('Store — History', html`${head('Har entry ka record — kisne, kab, kitna. Badlav ka kaaran bhi.')}${tabs('history')}
    ${filterForm(html`
      <div class="fld"><label for="hk">What is it?</label><select id="hk" name="item_kind">${opts(Object.entries(KIND_LABEL).map(([id, name]) => ({ id, name })), query.item_kind, { blank: 'All' })}</select></div>
      <div class="fld"><label for="ht">Entry</label><select id="ht" name="kind">${opts(Object.entries(TXN_LABEL).map(([id, name]) => ({ id, name })), query.kind, { blank: 'All' })}</select></div>
      <div class="fld"><label for="hf">From</label><input id="hf" type="date" name="from" value="${query.from || ''}"></div><div class="fld"><label for="hto">To</label><input id="hto" type="date" name="to" value="${query.to || ''}"></div>
      <div class="fld"><label for="hq">Search</label><input id="hq" type="search" name="q" value="${query.q || ''}" placeholder="Item, Saathi ID, challan…"></div>`, query, 'history')}
    <div style="display:flex;justify-content:flex-end"><button class="btn sm" data-xlh>Export Excel</button></div>
    ${txnTable(rows)}`);
  bindFilters(); bindTxnActions(rows);
  on('click', '[data-xlh]', () => { const wb = window.XLSX.utils.table_to_book(document.getElementById('ttbl')); window.XLSX.writeFile(wb, `store-history-${todayStr()}.xlsx`); });
}

// ---------- Lookup ----------
async function lookupTab(c, query) {
  const rows = query.q ? await api('/store/lookup?q=' + encodeURIComponent(query.q)) : [];
  page('Store — Lookup', html`${head('Saathi ID ya naam se dekhiye kis student / staff ko kya mila.')}${tabs('lookup')}
    <form class="card filters" data-form="lk"><div class="fld" style="flex:1 1 280px"><label for="lq">Student name / Saathi ID</label><input id="lq" type="search" name="q" value="${query.q || ''}" placeholder="SCB-000123 or name"></div><button class="btn pri" type="submit">Search</button></form>
    ${query.q ? (rows.length ? html`<div class="card"><h2 style="margin-bottom:8px">${rows.length} item(s) given · “${query.q}”</h2><div class="tbl-wrap" style="border:0"><table class="tbl"><thead><tr><th>Date</th><th>Item</th><th class="r">Qty</th><th>Batch / to</th><th>Branch</th></tr></thead><tbody>
      ${rows.map((t) => html`<tr><td>${fdate(t.date)}</td><td>${t.item}</td><td class="r num">${fmt(t.qty)}</td><td class="small">${t.batch || t.issued_to || t.department || ''}${t.students ? html`<div class="tiny muted">${t.students.slice(0, 100)}</div>` : ''}</td><td>${t.branch}</td></tr>`)}</tbody></table></div></div>`
    : html`<div class="card empty">Nothing given to “${query.q}” yet. Tip: when giving modules to a batch, type the Saathi IDs so they can be searched here.</div>`) : ''}`);
  on('submit', '[data-form="lk"]', (f) => go('#/store?tab=lookup&q=' + encodeURIComponent(new FormData(f).get('q'))));
}

// ---------- Setup ----------
async function setupTab(c) {
  const lines = (a) => a.join(', ');
  page('Store — Setup', html`${head('Course, class, subject, size, category ki list yahan badliye.')}${tabs('setup')}
    <form id="sf" class="card" style="display:flex;flex-direction:column;gap:16px">
      <div class="form"><div class="fld"><label for="ss">Current session</label><input id="ss" type="text" name="session" value="${c.session}"></div></div>
      <div><h2 style="margin-bottom:8px">Modules — courses, classes, subjects</h2><div id="crs" style="display:flex;flex-direction:column;gap:8px">
        ${c.module.courses.map((co, i) => html`<div class="card tight form" data-course><div class="fld"><label for="cn${i}">Course</label><input id="cn${i}" type="text" data-k="name" value="${co.name}"></div>
          <div class="fld"><label for="cc${i}">Classes (comma separated)</label><input id="cc${i}" type="text" data-k="classes" value="${lines(co.classes)}"></div>
          <div class="fld full"><label for="cs${i}">Subjects (comma separated)</label><input id="cs${i}" type="text" data-k="subjects" value="${lines(co.subjects)}"></div></div>`)}</div>
        <button type="button" class="btn sm" data-addc style="margin-top:8px">${icon('plus')} Add course</button>
        <div class="form" style="margin-top:10px"><div class="fld"><label for="ml">Languages / medium</label><input id="ml" type="text" name="languages" value="${lines(c.module.languages)}"></div>
          <div class="fld"><label for="msrc">Module sources</label><input id="msrc" type="text" name="sources" value="${lines(c.module.sources)}"></div></div></div>
      <div><h2 style="margin-bottom:8px">T-shirts & uniforms</h2><div class="form">
        <div class="fld full"><label for="ag">Garments</label><input id="ag" type="text" name="garments" value="${lines(c.apparel.garments)}"></div>
        <div class="fld full"><label for="as">Sizes</label><input id="as" type="text" name="sizes" value="${lines(c.apparel.sizes)}"></div>
        <div class="fld"><label for="aa">For whom</label><input id="aa" type="text" name="audiences" value="${lines(c.apparel.audiences)}"></div>
        <div class="fld"><label for="age">Gender options</label><input id="age" type="text" name="genders" value="${lines(c.apparel.genders)}"></div>
        <div class="fld full"><label for="aco">Colours</label><input id="aco" type="text" name="colours" value="${lines(c.apparel.colours)}"></div></div></div>
      <div><h2 style="margin-bottom:8px">Housekeeping & supplies — categories and suggested items</h2><div class="small muted" style="margin-bottom:8px">One item per line as <code>Item name | unit</code>. Staff can also type new items while receiving.</div>
        <div id="cats" class="grid g2">${Object.entries(c.supply.categories).map(([k, its], i) => html`<div class="card tight" data-cat><div class="fld"><label for="sc${i}">Category</label><input id="sc${i}" type="text" data-k="cat" value="${k}"></div>
          <div class="fld"><label for="si${i}">Items</label><textarea id="si${i}" data-k="items" rows="6">${its.map((x) => `${x.name} | ${x.unit}`).join('\n')}</textarea></div></div>`)}</div>
        <button type="button" class="btn sm" data-addcat style="margin-top:8px">${icon('plus')} Add category</button></div>
      <div class="form"><div class="fld full"><label for="dp">Departments (who items are given to)</label><input id="dp" type="text" name="departments" value="${lines(c.departments)}"></div>
        <div class="fld full"><label for="ar">Areas</label><input id="ar" type="text" name="areas" value="${lines(c.areas)}"></div></div>
      <div><button class="btn pri lg" type="submit">Save set-up</button></div></form>`);
  on('click', '[data-addc]', () => document.getElementById('crs').insertAdjacentHTML('beforeend', html`<div class="card tight form" data-course><div class="fld"><label>Course</label><input type="text" data-k="name"></div><div class="fld"><label>Classes (comma separated)</label><input type="text" data-k="classes"></div><div class="fld full"><label>Subjects (comma separated)</label><input type="text" data-k="subjects"></div></div>`.s));
  on('click', '[data-addcat]', () => document.getElementById('cats').insertAdjacentHTML('beforeend', html`<div class="card tight" data-cat><div class="fld"><label>Category</label><input type="text" data-k="cat"></div><div class="fld"><label>Items</label><textarea data-k="items" rows="6"></textarea></div></div>`.s));
  on('submit', '#sf', async (f) => {
    const split = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);
    const fd = formData(f);
    const courses = [...f.querySelectorAll('[data-course]')].map((d) => ({ name: d.querySelector('[data-k=name]').value.trim(), classes: split(d.querySelector('[data-k=classes]').value), subjects: split(d.querySelector('[data-k=subjects]').value) })).filter((x) => x.name);
    const categories = {};
    f.querySelectorAll('[data-cat]').forEach((d) => { const k = d.querySelector('[data-k=cat]').value.trim(); if (!k) return; categories[k] = d.querySelector('[data-k=items]').value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [nm, u] = l.split('|').map((s) => s.trim()); return { name: nm, unit: u || 'pcs' }; }); });
    const body = { session: fd.session.trim(), module: { courses, languages: split(fd.languages), sources: split(fd.sources) },
      apparel: { garments: split(fd.garments), sizes: split(fd.sizes), audiences: split(fd.audiences), genders: split(fd.genders), colours: split(fd.colours) },
      supply: { categories }, departments: split(fd.departments), areas: split(fd.areas) };
    await put('/store/config', body); await cfg(true); toast('Set-up saved');
  });
}

// ================= Entry form (receive / issue / transfer / damaged) =================
route('/store/entry', async (p, query) => {
  const c = await cfg();
  const type = ['receipt', 'issue', 'transfer', 'damaged'].includes(query.type) ? query.type : 'receipt';
  let preItem = null;
  if (query.item_id) preItem = (await api('/store/items/' + query.item_id)).item;
  let preBatch = null;
  const batches = await api('/batches');
  if (query.batch_id) preBatch = batches.find((b) => String(b.id) === query.batch_id);
  let kind = preItem ? preItem.item_kind : (query.kind || (preBatch ? 'module' : (['housekeeping', 'office_boy', 'maintenance'].includes(state.me.role) ? 'supply' : 'module')));
  if (!['module', 'apparel', 'supply'].includes(kind)) kind = 'supply';
  const title = { receipt: 'Receive stock', issue: 'Give out / issue', transfer: 'Transfer to another branch', damaged: 'Damaged, lost or returned' }[type];
  const hiTitle = { receipt: 'Saaman aaya — darj karein', issue: 'Saaman diya — darj karein', transfer: 'Doosri branch ko bhejna', damaged: 'Kharab / kho gaya / wapas aaya' }[type];
  const items = type === 'receipt' ? [] : (await api(`/store/items?kind=${kind}`)).rows;
  page(title, html`<div class="pagehead"><div><div class="eyebrow">Store</div><h1>${title}</h1><div class="small" style="color:#7A4A86;font-style:italic">${hiTitle}</div></div><a class="btn" href="#/store?tab=${{ module: 'modules', apparel: 'apparel', supply: 'supplies' }[kind]}">Back to store</a></div>
    <form id="se" class="card" style="display:flex;flex-direction:column;gap:16px" novalidate>
      <div class="fld"><div class="lab">What is it?</div><div class="modebox" role="radiogroup" aria-label="Item type">${Object.entries(KIND_LABEL).map(([k, l]) => html`<label><input type="radio" name="item_kind" value="${k}" ${k === kind ? raw('checked') : ''} ${preItem ? raw('disabled') : ''}><b>${l}</b><span>${{ module: 'Books for students', apparel: 'Sizes · students / staff', supply: 'Cleaning, stationery, pantry…' }[k]}</span></label>`)}</div></div>
      <div class="form" id="itemBox"></div>
      <div id="stockInfo" class="small"></div>
      <div class="form" id="txnBox"></div>
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><button class="btn" type="submit" data-again="1">Save & add another</button><button class="btn pri lg" type="submit">${type === 'receipt' ? 'Receive stock' : type === 'issue' ? 'Issue / give out' : 'Save'}</button></div>
    </form>`);
  const form = document.getElementById('se');
  const itemBox = document.getElementById('itemBox');
  const txnBox = document.getElementById('txnBox');
  let curItems = items;
  const dl = (id, list) => html`<datalist id="${id}">${list.map((x) => html`<option value="${x}">`)}</datalist>`;

  function drawItemFields() {
    const k = kind;
    if (preItem) { itemBox.innerHTML = html`<div class="fld full"><div class="lab">Item</div><div class="callout info"><b>${preItem.name}</b></div><input type="hidden" name="item_id" value="${preItem.id}"></div>`.s; return; }
    if (type === 'receipt') {
      if (k === 'module') {
        const co = courseOf(c, (preBatch && preBatch.course) || c.module.courses[0].name);
        itemBox.innerHTML = html`<div class="fld"><label for="ec">Course</label><select id="ec" name="course" data-course>${opts(c.module.courses.map((x) => x.name), co.name)}</select></div>
          <div class="fld"><label for="ecl">Class</label><select id="ecl" name="class_level">${opts(co.classes, '', { blank: '— Select —' })}</select></div>
          <div class="fld"><label for="esu">Subject</label><select id="esu" name="subject">${opts(co.subjects, '', { blank: '— Select —' })}</select></div>
          <div class="fld"><label for="emn">Module no.</label><input id="emn" type="text" name="module_no" placeholder="e.g. 3" autocomplete="off"></div>
          <div class="fld"><label for="ese">Session</label><input id="ese" type="text" name="session" value="${c.session}"></div>
          <div class="fld"><label for="ela">Language / medium</label><select id="ela" name="language">${opts(c.module.languages, 'English')}</select></div>
          <div class="fld"><label for="eti">Module title (optional)</label><input id="eti" type="text" name="title" placeholder="e.g. Kinematics & Laws of Motion"></div>
          <div class="fld"><label for="eed">Edition (optional)</label><input id="eed" type="text" name="edition" placeholder="e.g. 2026 rev-1"></div>`.s;
      } else if (k === 'apparel') {
        itemBox.innerHTML = html`<div class="fld"><label for="eg">Garment</label><select id="eg" name="garment">${opts(c.apparel.garments, '', { blank: '— Select —' })}</select></div>
          <div class="fld"><label for="ez">Size</label><select id="ez" name="size">${opts(c.apparel.sizes, '', { blank: '— Select —' })}</select></div>
          <div class="fld"><label for="ea">For whom</label><select id="ea" name="audience">${opts(c.apparel.audiences, '', { blank: '— Select —' })}</select></div>
          <div class="fld"><label for="ege">Gender</label><select id="ege" name="gender">${opts(c.apparel.genders, 'Unisex')}</select></div>
          <div class="fld"><label for="eco">Colour</label><input id="eco" type="text" name="colour" list="dlco" autocomplete="off">${dl('dlco', c.apparel.colours)}</div>`.s;
      } else {
        const cats = Object.keys(c.supply.categories);
        itemBox.innerHTML = html`<div class="fld"><label for="eca">Category</label><select id="eca" name="category" data-cat>${opts(cats, cats[0])}</select></div>
          <div class="fld"><label for="ein">Item name</label><input id="ein" type="text" name="name" list="dlit" autocomplete="off" placeholder="Type or pick from list"><datalist id="dlit">${c.supply.categories[cats[0]].map((x) => html`<option value="${x.name}">`)}</datalist></div>
          <div class="fld"><label for="eun">Unit</label><input id="eun" type="text" name="unit" value="pcs" list="dlun">${dl('dlun', ['pcs', 'packet', 'box', 'bottle', 'can', 'litre', 'kg', 'roll', 'ream', 'pair', 'set', 'jar', 'case', 'kit'])}</div>
          <div class="fld"><label for="esp">Brand / specification</label><input id="esp" type="text" name="spec" placeholder="e.g. Lizol 5 L, Kangaro HD-10"></div>`.s;
      }
    } else {
      // pick an existing item, with cascading filters built from the list
      if (k === 'module') {
        const crs = [...new Set(curItems.map((r) => r.course))];
        const pc = (preBatch && preBatch.course) || crs[0] || '';
        itemBox.innerHTML = html`<div class="fld"><label for="pc">Course</label><select id="pc" data-f="course">${opts(crs, pc)}</select></div>
          <div class="fld"><label for="pcl">Class</label><select id="pcl" data-f="class_level"></select></div><div class="fld"><label for="psu">Subject</label><select id="psu" data-f="subject"></select></div>
          <div class="fld"><label for="pit">Module</label><select id="pit" name="item_id" data-pick></select></div>`.s;
      } else if (k === 'apparel') {
        itemBox.innerHTML = html`<div class="fld"><label for="pg">Garment</label><select id="pg" data-f="garment">${opts([...new Set(curItems.map((r) => r.garment))], '')}</select></div>
          <div class="fld"><label for="pa">For whom</label><select id="pa" data-f="audience"></select></div><div class="fld"><label for="pit">Size</label><select id="pit" name="item_id" data-pick></select></div>`.s;
      } else {
        itemBox.innerHTML = html`<div class="fld"><label for="pca">Category</label><select id="pca" data-f="category">${opts([...new Set(curItems.map((r) => r.category))], '')}</select></div>
          <div class="fld"><label for="pit">Item</label><select id="pit" name="item_id" data-pick></select></div>`.s;
      }
      if (!curItems.length) itemBox.innerHTML = html`<div class="fld full"><div class="callout pend">No ${KIND_LABEL[k].toLowerCase()} in stock yet. <a href="#/store/entry?type=receipt&kind=${k}">Receive stock first</a>.</div></div>`.s;
      cascade();
    }
  }
  function cascade() {
    const sel = (f) => itemBox.querySelector(`[data-f="${f}"]`);
    let list = curItems;
    const chain = kind === 'module' ? ['course', 'class_level', 'subject'] : kind === 'apparel' ? ['garment', 'audience'] : ['category'];
    chain.forEach((f, i) => {
      const s = sel(f); if (!s) return;
      if (i > 0) { const vals = [...new Set(list.map((r) => r[f] || ''))]; const keep = vals.includes(s.value) ? s.value : (preBatch && f === 'class_level' && vals.includes(preBatch.class_level) ? preBatch.class_level : vals[0]); s.innerHTML = opts(vals, keep).s; }
      list = list.filter((r) => (r[f] || '') === s.value);
    });
    const pick = itemBox.querySelector('[data-pick]');
    if (pick) {
      const lab = (r) => (kind === 'module' ? `Module ${r.module_no}${r.title ? ' — ' + r.title : ''} (in hand ${fmt(r.in_hand)})` : kind === 'apparel' ? `${r.size}${r.gender && r.gender !== 'Unisex' ? ' · ' + r.gender : ''}${r.colour ? ' · ' + r.colour : ''} (in hand ${fmt(r.in_hand)})` : `${r.name}${r.spec ? ' — ' + r.spec : ''} (in hand ${fmt(r.in_hand)} ${r.unit})`);
      pick.innerHTML = opts(list.map((r) => ({ id: r.id, name: lab(r) })), pick.value).s;
    }
    drawTxnFields();
  }
  const selItem = () => { const id = Number((form.querySelector('[name=item_id]') || {}).value); return preItem && Number(preItem.id) === id ? preItem : curItems.find((r) => r.id === id); };
  function drawTxnFields() {
    const it = selItem();
    const today = todayStr();
    const common = html`${branchSel('branch_id')}<div class="fld"><label for="tdt">Date</label><input id="tdt" type="date" name="date" value="${today}"></div>`;
    if (type === 'receipt') {
      txnBox.innerHTML = html`${common}
        <div class="fld"><label for="tq">Quantity received</label><input id="tq" type="number" min="1" step="any" name="qty" inputmode="numeric"></div>
        <div class="fld"><label for="tdm">Damaged / short copies</label><input id="tdm" type="number" min="0" step="any" name="damaged_qty" value="0" inputmode="numeric"></div>
        <div class="fld"><label for="tsr">Source</label><select id="tsr" name="source">${opts(kind === 'supply' ? ['Vendor purchase', 'Head office', 'Other branch'] : c.module.sources, kind === 'supply' ? 'Vendor purchase' : 'Head office')}</select></div>
        <div class="fld"><label for="tsn">Supplier / sender name</label><input id="tsn" type="text" name="source_name"></div>
        <div class="fld"><label for="tch">Challan / bill no.</label><input id="tch" type="text" name="challan_no"></div>
        <div class="fld"><label for="trb">Received by</label><input id="trb" type="text" name="received_by" value="${state.me.name}" list="dl_us">${dl('dl_us', state.lookups.users.map((u) => u.name))}</div>
        <div class="fld"><label for="tmn">Min. stock alert</label><input id="tmn" type="number" min="0" name="min_stock" placeholder="${it ? fmt(it.min_stock) : 'e.g. 10'}"></div>
        <div class="fld"><div class="lab">Challan photo</div><input type="hidden" name="file_id"><div class="upl"><label class="btn sm">${icon('camera')} Take / choose photo<input type="file" class="sr" accept="image/*,application/pdf" data-chup></label><span id="chp"></span></div></div>
        <div class="fld full"><label for="trm">Remarks</label><input id="trm" type="text" name="remarks"></div>
        ${kind === 'supply' ? html`<div class="fld full"><div class="callout info small">Bought with money? Also record it in <a href="#/purchase/new">Purchases</a> so a voucher is made. This screen only tracks the stock.</div></div>` : ''}`.s;
    } else if (type === 'issue') {
      const bl = batches.filter((b) => b.active && (kind !== 'module' || !it || (b.course === it.course && (!b.class_level || b.class_level === it.class_level))));
      const toType = preBatch ? 'batch' : (kind === 'module' ? 'batch' : (kind === 'apparel' && it && it.audience !== 'Students' ? 'staff' : (kind === 'supply' ? 'department' : 'student')));
      txnBox.innerHTML = html`${common}
        <div class="fld full"><div class="lab">Given to</div><div class="yn" role="radiogroup" aria-label="Given to">${[['batch', 'Batch'], ['student', 'Student'], ['staff', 'Staff'], ['department', 'Department / area']].map(([v, l]) => html`<label><input type="radio" name="issued_to_type" value="${v}" ${v === toType ? raw('checked') : ''}><span>${l}</span></label>`)}</div></div>
        <div class="fld" data-to="batch"><label for="tba">Batch</label><select id="tba" name="batch_id" data-batch>${opts(bl.map((b) => ({ id: b.id, name: `${b.name} (${b.students} students)` })), preBatch ? preBatch.id : '', { blank: '— Select batch —' })}</select></div>
        <div class="fld" data-to="student"><label for="tst">Student name / Saathi ID</label><input id="tst" type="text" name="issued_to_student" autocomplete="off"></div>
        <div class="fld" data-to="staff"><label for="tsf">Staff name</label><input id="tsf" type="text" name="issued_to_staff" list="dl_us2" autocomplete="off">${dl('dl_us2', state.lookups.users.map((u) => u.name))}</div>
        <div class="fld" data-to="department"><label for="tdp">Department / area</label><select id="tdp" name="department">${opts([...c.departments, ...c.areas], '', { blank: '— Select —' })}</select></div>
        <div class="fld"><label for="tq">Quantity given</label><input id="tq" type="number" min="1" step="any" name="qty" inputmode="numeric"></div>
        <div class="fld full" data-to="batch"><label for="tsl">Saathi IDs / student names (optional)</label><textarea id="tsl" name="students" rows="3" placeholder="SCB-000101, SCB-000102 … (helps student lookup later)"></textarea></div>
        <div class="fld full"><label for="trm">Remarks</label><input id="trm" type="text" name="remarks"></div>`.s;
      toggleTo();
    } else if (type === 'transfer') {
      txnBox.innerHTML = html`${branchSel('branch_id')}<div class="fld"><label for="ttb">Send to branch</label><select id="ttb" name="to_branch_id">${opts(state.lookups.branches.filter((b) => b.id !== state.me.branch_id || can.allBranches()), '', { blank: '— Select —' })}</select></div>
        <div class="fld"><label for="tdt">Date</label><input id="tdt" type="date" name="date" value="${today}"></div>
        <div class="fld"><label for="tq">Quantity</label><input id="tq" type="number" min="1" step="any" name="qty"></div><div class="fld full"><label for="trm">Remarks</label><input id="trm" type="text" name="remarks"></div>`.s;
    } else {
      txnBox.innerHTML = html`${common}<div class="fld full"><div class="lab">What happened?</div><div class="yn" role="radiogroup" aria-label="What happened">${[['damaged', 'Damaged / lost'], ['return', 'Returned to store']].map(([v, l], i) => html`<label><input type="radio" name="dkind" value="${v}" ${i === 0 ? raw('checked') : ''}><span>${l}</span></label>`)}</div></div>
        <div class="fld"><label for="tq">Quantity</label><input id="tq" type="number" min="1" step="any" name="qty"></div><div class="fld"><label for="tsf">Returned by / responsible (optional)</label><input id="tsf" type="text" name="issued_to"></div>
        <div class="fld full"><label for="trm">Remarks</label><input id="trm" type="text" name="remarks" placeholder="e.g. pages missing, torn, wrong size"></div>`.s;
    }
    showStock();
  }
  function toggleTo() {
    const v = (form.querySelector('[name=issued_to_type]:checked') || {}).value;
    form.querySelectorAll('[data-to]').forEach((el) => el.classList.toggle('hidden', el.dataset.to !== v));
    showStock();
  }
  async function showStock() {
    const it = selItem();
    const box = document.getElementById('stockInfo');
    if (!it || type === 'receipt') { box.innerHTML = ''; return; }
    let txt = html`<div class="callout info"><b>In hand:</b> ${fmt(it.in_hand)} ${it.unit || ''}${can.allBranches() ? ' (all branches)' : ''}`;
    const bsel = form.querySelector('[data-batch]');
    if (type === 'issue' && bsel && bsel.value && !bsel.closest('.hidden')) {
      const det = await api('/store/items/' + it.id);
      const b = det.batches.find((x) => String(x.id) === bsel.value);
      if (b) { const pend = Math.max(0, b.students - n(b.given)); txt = html`${txt} · <b>${b.name}:</b> ${b.students} students, already given ${fmt(b.given)}, <b>still to give ${pend}</b>`; const q = form.querySelector('[name=qty]'); if (q && !q.value) q.value = pend || ''; }
    }
    box.innerHTML = html`${txt}</div>`.s;
  }
  drawItemFields();
  if (type === 'receipt' || preItem) drawTxnFields();

  on('change', '#se [name=item_kind]', async (r) => { kind = r.value; curItems = type === 'receipt' ? [] : (await api(`/store/items?kind=${kind}`)).rows; drawItemFields(); if (type === 'receipt') drawTxnFields(); });
  on('change', '#se [data-course]', (s) => { const co = courseOf(c, s.value); form.querySelector('[name=class_level]').innerHTML = opts(co.classes, '', { blank: '— Select —' }).s; form.querySelector('[name=subject]').innerHTML = opts(co.subjects, '', { blank: '— Select —' }).s; });
  on('change', '#se [data-cat]', (s) => { document.getElementById('dlit').innerHTML = c.supply.categories[s.value].map((x) => `<option value="${esc(x.name)}">`).join(''); });
  on('change', '#se [name=name]', (i) => { const cat = form.querySelector('[name=category]').value; const sug = (c.supply.categories[cat] || []).find((x) => x.name === i.value); if (sug) form.querySelector('[name=unit]').value = sug.unit; });
  on('change', '#se [data-f]', () => cascade());
  on('change', '#se [data-pick]', () => drawTxnFields());
  on('change', '#se [name=issued_to_type]', () => toggleTo());
  on('change', '#se [data-batch]', () => { const q = form.querySelector('[name=qty]'); if (q) q.value = ''; showStock(); });
  on('change', '#se [data-chup]', async (inp) => { const f = inp.files[0]; if (!f) return; document.getElementById('chp').textContent = 'Uploading…'; const up = await uploadFile(f); form.querySelector('[name=file_id]').value = up.id; document.getElementById('chp').innerHTML = `<a href="/api/files/${up.id}" target="_blank" rel="noopener">Challan attached ✓</a>`; });
  let again = false;
  on('click', '#se [type=submit]', (b) => { again = !!b.dataset.again; });
  on('submit', '#se', async () => {
    const btns = form.querySelectorAll('[type=submit]'); btns.forEach((b) => { b.disabled = true; });
    try {
      const f = formData(form);
      const body = { ...f, item_kind: kind, kind: type === 'damaged' ? f.dkind : type };
      if (type === 'issue') {
        const t = f.issued_to_type;
        body.issued_to = t === 'student' ? f.issued_to_student : t === 'staff' ? f.issued_to_staff : '';
        if (t !== 'batch') { body.batch_id = ''; body.students = ''; }
        if (t !== 'department') body.department = '';
        if (t === 'department' && !body.department) throw new Error('Choose a department or area / vibhag chuniye.');
        if (t === 'batch' && !body.batch_id) throw new Error('Choose a batch / batch chuniye.');
      }
      const r = await post('/store/txns', body);
      toast('Saved ✓ / Darj ho gaya');
      if (again) go(location.hash.includes('item_id') ? location.hash : `#/store/entry?type=${type}&kind=${kind}`); else go(r && body.item_id ? `#/store/item/${body.item_id}` : `#/store?tab=${{ module: 'modules', apparel: 'apparel', supply: 'supplies' }[kind]}`);
    } catch (e) { err(e); } finally { btns.forEach((b) => { b.disabled = false; }); }
  });
});

// ================= Item detail =================
route('/store/item/:id', async ({ id }) => {
  const d = await api('/store/items/' + id);
  const it = d.item;
  const tabKey = { module: 'modules', apparel: 'apparel', supply: 'supplies' }[it.item_kind] || 'supplies';
  const sum = (k) => d.txns.filter((t) => t.kind === k && t.status === 'active').reduce((a, t) => a + n(t.qty), 0);
  const dmg = d.txns.filter((t) => t.status === 'active').reduce((a, t) => a + (t.kind === 'receipt' ? n(t.damaged_qty) : t.kind === 'damaged' ? n(t.qty) : 0), 0);
  const inHand = d.stock.reduce((a, s) => a + n(s.qty), 0);
  page(it.name, html`<div class="pagehead"><div><div class="eyebrow">${KIND_LABEL[it.item_kind] || 'Item'}</div><h1>${it.name}</h1><div class="small muted">${[it.title, it.edition && 'Edition ' + it.edition, it.spec, it.category].filter(Boolean).join(' · ')}</div></div>
    <div class="actions"><a class="btn" href="#/store?tab=${tabKey}">Back</a>${canTxn() ? html`<a class="btn" href="#/store/entry?type=damaged&item_id=${it.id}">Damaged / return</a><a class="btn" href="#/store/entry?type=transfer&item_id=${it.id}">Transfer</a><a class="btn" href="#/store/entry?type=receipt&item_id=${it.id}">+ Receive</a><a class="btn pri" href="#/store/entry?type=issue&item_id=${it.id}">Give out</a>` : ''}
      ${can.finance() || state.me.role === 'manager' ? html`<button class="btn" data-edi>${icon('edit')} Edit item</button>` : ''}</div></div>
    <div class="kpis"><div class="kpi"><span class="l">In hand</span><span class="v">${fmt(inHand)}</span><span class="n">${d.stock.map((s) => `${s.branch}: ${fmt(s.qty)}`).join(' · ') || '—'}</span></div>
      <div class="kpi"><span class="l">Received</span><span class="v">${fmt(sum('receipt'))}</span></div><div class="kpi"><span class="l">Given out</span><span class="v">${fmt(sum('issue'))}</span></div>
      <div class="kpi"><span class="l">Damaged / lost</span><span class="v">${fmt(dmg)}</span><span class="n">${fmt(sum('return'))} returned</span></div>
      <div class="kpi"><span class="l">Min. stock alert</span><span class="v">${fmt(it.min_stock)}</span><span class="n ${it.min_stock > 0 && inHand < it.min_stock ? 'warn' : ''}">${it.min_stock > 0 && inHand < it.min_stock ? 'Below minimum — reorder' : 'OK'}</span></div></div>
    ${d.batches.length ? html`<div class="card"><div class="card-h"><h2>Batch-wise distribution</h2><span class="small muted">Students in batch vs copies given</span></div><div class="tbl-wrap" style="border:0"><table class="tbl"><thead><tr><th>Batch</th><th>Branch</th><th class="r">Students</th><th class="r">Given</th><th class="r">Still to give</th><th></th></tr></thead><tbody>
      ${d.batches.map((b) => { const pend = Math.max(0, b.students - n(b.given)); return html`<tr><td><b>${b.name}</b></td><td>${b.branch}</td><td class="r num">${b.students}</td><td class="r num">${fmt(b.given)}</td><td class="r"><span class="bd ${pend ? 'pend' : 'ok'}">${pend}</span></td><td>${pend && canTxn() ? html`<a class="btn sm" href="#/store/entry?type=issue&item_id=${it.id}&batch_id=${b.id}">Give ${pend}</a>` : ''}</td></tr>`; })}</tbody></table></div></div>` : ''}
    <div class="card"><h2 style="margin-bottom:10px">History</h2>${txnTable(d.txns, false)}</div>`);
  bindTxnActions(d.txns.map((t) => ({ ...t, item: it.name })));
  on('click', '[data-edi]', async () => {
    const ok = await modal('Edit item', html`<div class="form">
      <div class="fld"><label for="im">Min. stock alert</label><input id="im" type="number" min="0" name="min_stock" value="${fmt(it.min_stock)}"></div>
      <div class="fld"><label for="ir">Rate ₹ (optional)</label><input id="ir" type="number" min="0" step="any" name="rate" value="${fmt(it.rate)}"></div>
      ${it.item_kind === 'module' ? html`<div class="fld"><label for="itt">Module title (optional)</label><input id="itt" type="text" name="title" value="${it.title || ''}"></div><div class="fld"><label for="ie">Edition (optional)</label><input id="ie" type="text" name="edition" value="${it.edition || ''}"></div>` : ''}
      ${it.item_kind === 'supply' ? html`<div class="fld"><label for="isp">Brand / specification</label><input id="isp" type="text" name="spec" value="${it.spec || ''}"></div><div class="fld"><label for="iu">Unit</label><input id="iu" type="text" name="unit" value="${it.unit}"></div>` : ''}
      <label class="chk"><input type="checkbox" name="active" ${it.active ? raw('checked') : ''}> Active</label></div>`, {
      onMount: (ctx) => { ctx.onAction = async (a, el) => { if (a !== 'ok') return; await put('/store/items/' + it.id, formData(el)); toast('Saved'); return true; }; }
    });
    if (ok) go(location.hash);
  });
});
