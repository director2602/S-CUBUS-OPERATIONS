import { html, raw, api, post, put, route, page, state, can, chart, PALETTE, inr, fdate, fdt, badge, icon, on, go, toast, modal, opts, formData, todayStr, addDays, cap, loadLookups, esc } from '../core.js';
import { controlCentre } from './dash.js';
import { entryTitle } from '../forms.js';

// ---------------- Generic master editor ----------------
function master(path, title, cols, fieldsHtml, { canWrite = () => can.mgmt(), note } = {}) {
  route('/admin/' + path, async () => {
    const rows = await api('/' + path);
    const edit = async (r) => modal(r ? 'Edit' : 'Add', fieldsHtml(r || { active: true }), {
      onMount: (ctx) => { ctx.onAction = async (a, el) => { if (a !== 'ok') return; const f = formData(el); if (r) await put(`/${path}/${r.id}`, f); else await post('/' + path, f); await loadLookups(true); toast('Saved'); return true; }; }
    });
    page(title, html`<div class="pagehead"><div><h1>${title}</h1>${note ? html`<div class="small muted">${note}</div>` : ''}</div>${canWrite() ? html`<div class="actions"><button class="btn pri" data-add>${icon('plus')} Add</button></div>` : ''}</div>
      <div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map(([, l]) => html`<th>${l}</th>`)}<th>Status</th><th></th></tr></thead><tbody>
      ${rows.map((r) => html`<tr>${cols.map(([k]) => html`<td>${r[k] ?? ''}</td>`)}<td>${r.active ? badge('approved', 'Active') : badge('cancelled', 'Inactive')}</td><td>${canWrite() ? html`<button class="btn sm" data-ed="${r.id}">${icon('edit')} Edit</button>` : ''}</td></tr>`)}</tbody></table></div>`);
    on('click', '[data-add]', async () => { if (await edit()) go(location.hash); });
    on('click', '[data-ed]', async (b) => { if (await edit(rows.find((x) => x.id === Number(b.dataset.ed)))) go(location.hash); });
  });
}
const tf = (name, label, v, type = 'text') => html`<div class="fld"><label for="m_${name}">${label}</label><input id="m_${name}" type="${type}" ${type === 'number' ? raw('step="any"') : ''} name="${name}" value="${v ?? ''}"></div>`;
const act = (r) => html`<label class="chk"><input type="checkbox" name="active" ${r.active ? raw('checked') : ''}> Active</label>`;
master('branches', 'Branches', [['name', 'Name'], ['code', 'Code'], ['address', 'Address']], (r) => html`<div class="form">${tf('name', 'Name *', r.name)}${tf('code', 'Code', r.code)}<div class="full">${tf('address', 'Address (printed on vouchers)', r.address)}</div>${act(r)}</div>`);
master('items', 'Items', [['name', 'Item'], ['category', 'Category'], ['unit', 'Unit'], ['min_stock', 'Min stock / branch'], ['rate', 'Std. rate ₹']], (r) => html`<div class="form">${tf('name', 'Item name *', r.name)}${tf('sku', 'SKU / code', r.sku)}${tf('category', 'Category', r.category)}${tf('unit', 'Unit (pcs, ream, kit…)', r.unit || 'pcs')}${tf('min_stock', 'Minimum stock per branch', r.min_stock ?? 0, 'number')}${tf('rate', 'Standard rate ₹', r.rate ?? 0, 'number')}${act(r)}</div>`,
  { canWrite: () => can.finance() || state.me.role === 'manager', note: 'Stock items (books, T-shirts, stationery…). Low-stock alerts use the minimum.' });
master('categories', 'Expense categories', [['name', 'Category']], (r) => html`<div class="form">${tf('name', 'Name *', r.name)}${act(r)}</div>`, { canWrite: () => can.finance() });

// ---------------- Users ----------------
route('/admin/users', async () => {
  const rows = await api('/users');
  const edit = async (u) => modal(u ? 'Edit user' : 'Add user', html`<div class="form">
    ${tf('name', 'Full name *', u && u.name)}${tf('email', 'Login email / ID *', u && u.email)}${tf('phone', 'Phone (can also sign in with this)', u && u.phone, 'tel')}
    <div class="fld"><label for="ur">Role *</label><select id="ur" name="role">${opts(Object.entries(state.roles).filter(([k]) => k !== 'owner' || state.me.role === 'owner').map(([id, name]) => ({ id, name })), u ? u.role : 'staff')}</select></div>
    ${tf('designation', 'Designation', u && u.designation)}
    <div class="fld"><label for="ub">Branch</label><select id="ub" name="branch_id">${opts(state.lookups.branches, u ? u.branch_id : state.me.branch_id)}</select></div>
    ${tf('password', u ? 'New password (leave blank to keep)' : 'Password *', '', 'password')}
    ${u ? html`<label class="chk"><input type="checkbox" name="active" ${u.active ? raw('checked') : ''}> Active (untick to block sign-in)</label>` : ''}</div>
    <div class="callout info small" style="margin-top:12px"><b>What each role sees:</b> Guards, office boys, housekeeping, drivers and maintenance staff get a simple phone screen with only their registers and tasks. Managers see their branch. Owner, Admin and Accounts see all branches.</div>`, {
    onMount: (ctx) => { ctx.onAction = async (a, el) => { if (a !== 'ok') return; const f = formData(el); if (u) await put('/users/' + u.id, f); else await post('/users', f); await loadLookups(true); toast('Saved'); return true; }; }
  });
  page('Users', html`<div class="pagehead"><div><h1>Users & roles</h1><div class="small muted">${rows.length} users</div></div><div class="actions"><button class="btn pri" data-add>${icon('plus')} Add user</button></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Name</th><th>Login</th><th>Role</th><th>Branch</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map((u) => html`<tr><td><b>${u.name}</b><div class="tiny muted">${u.designation || ''}</div></td><td class="small">${u.email}${u.phone ? html`<div class="tiny muted">${u.phone}</div>` : ''}</td><td>${badge('brand', state.roles[u.role])}</td><td>${u.branch_name || ''}</td><td>${u.active ? badge('approved', 'Active') : badge('cancelled', 'Blocked')}</td><td>${u.role !== 'owner' || state.me.role === 'owner' ? html`<button class="btn sm" data-ed="${u.id}">${icon('edit')} Edit</button>` : ''}</td></tr>`)}</tbody></table></div>`);
  on('click', '[data-add]', async () => { if (await edit()) go(location.hash); });
  on('click', '[data-ed]', async (b) => { if (await edit(rows.find((x) => x.id === Number(b.dataset.ed)))) go(location.hash); });
});

// ---------------- Settings ----------------
route('/settings', async () => {
  const s = await api('/settings');
  page('Settings', html`<div class="pagehead"><h1>Settings</h1></div>
    <form id="sf" class="card" style="display:flex;flex-direction:column;gap:14px;max-width:760px">
      <div class="form">${tf('company_name', 'Company name (printed on vouchers)', s.company_name)}${tf('manager_approval_limit', 'Branch manager approval limit ₹', s.manager_approval_limit, 'number')}${tf('petty_cash_default_float', 'Petty cash float per branch ₹', s.petty_cash_default_float, 'number')}</div>
      <div class="small muted">Purchases above the manager limit need Owner, Admin or Accounts approval. Register deadlines are set per register in the Register Builder.</div>
      <div><button class="btn pri" type="submit">Save settings</button></div></form>
    ${state.me.role === 'owner' ? html`<div class="card" style="max-width:760px;border-color:#E9C4BF"><h2 style="margin-bottom:8px">Clear transaction data</h2><p class="small muted">Deletes all purchases, vouchers, petty cash, stock, register entries, tasks and documents — for example to remove the demo data before going live. Users, branches, vendors, items, categories and register designs are kept. This cannot be undone.</p>
      <form id="rf" style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end"><div class="fld"><label for="rc">Type DELETE ALL DATA to confirm</label><input id="rc" type="text" name="confirm" autocomplete="off"></div><button class="btn danger" type="submit">Delete all transaction data</button></form></div>` : ''}`);
  on('submit', '#sf', async (f) => { const v = formData(f); v.manager_approval_limit = Number(v.manager_approval_limit); v.petty_cash_default_float = Number(v.petty_cash_default_float); await put('/settings', v); toast('Settings saved'); });
  on('submit', '#rf', async (f) => { await post('/admin/reset-data', formData(f)); toast('All transaction data cleared'); go('#/'); });
});

route('/password', async () => {
  page('Change password', html`<div class="pagehead"><h1>Change password</h1></div><form id="pw" class="card form" style="max-width:520px">${tf('current', 'Current password', '', 'password')}${tf('next', 'New password (min 6 characters)', '', 'password')}<div class="full"><button class="btn pri" type="submit">Change password</button></div></form>`);
  on('submit', '#pw', async (f) => { await post('/me/password', formData(f)); toast('Password changed'); f.reset(); });
});

// ---------------- Global search ----------------
route('/search', async (p, query) => {
  const q = query.q || '';
  const rows = await api('/search?q=' + encodeURIComponent(q));
  const mods = [...new Set(rows.map((r) => r.module))];
  page('Search', html`<div class="pagehead"><div><div class="eyebrow">Search all registers & records</div><h1>“${q}”</h1><div class="small muted">${rows.length} result${rows.length === 1 ? '' : 's'}${mods.length ? ' in ' + mods.join(', ') : ''}</div></div></div>
    ${rows.length ? mods.map((m) => html`<section><div class="eyebrow" style="margin-bottom:6px">${m}</div><div class="card tight"><ul class="att">${rows.filter((r) => r.module === m).map((r) => html`<li><span class="t"><a href="${r.link}" style="font-weight:600">${r.title}</a><div class="tiny muted">${r.sub}</div></span>${badge('brand', r.module)}</li>`)}</ul></div></section>`) : html`<div class="card empty">Nothing found. Try a vehicle number, name, phone, voucher number or item.</div>`}`);
  const gs = document.getElementById('gs'); if (gs) gs.value = q;
});

// ---------------- Report builder ----------------
route('/reports', async (p, query) => {
  const mods = await api('/reports/modules');
  const sel = query.module || 'purchases';
  const m = mods[sel] || mods.purchases;
  page('Report Builder', html`<div class="pagehead"><div><h1>Custom Report Builder</h1><div class="small muted">Pick a module, dates, branch, columns and filters. Export to Excel or PDF.</div></div></div>
    <form id="rbf" class="card" style="display:flex;flex-direction:column;gap:14px">
      <div class="form">
        <div class="fld"><label for="rm">Module</label><select id="rm" name="module">${opts(Object.entries(mods).map(([id, x]) => ({ id, name: x.name })), sel)}</select></div>
        <div class="fld"><label for="rfr">From</label><input id="rfr" type="date" name="from" value="${query.from || addDays(todayStr(), -30)}"></div>
        <div class="fld"><label for="rto">To</label><input id="rto" type="date" name="to" value="${query.to || todayStr()}"></div>
        ${can.allBranches() ? html`<div class="fld"><label for="rbr">Branch</label><select id="rbr" name="branch_id">${opts(state.lookups.branches, query.branch_id, { blank: 'All branches' })}</select></div>` : ''}
      </div>
      <div><div class="lab" style="font-size:13px;font-weight:600;margin-bottom:6px">Columns</div><div style="display:flex;flex-wrap:wrap;gap:2px 16px">${m.fields.map((f) => html`<label class="chk small"><input type="checkbox" data-col="${f}" checked> ${(m.labels && m.labels[f]) || cap(f)}</label>`)}</div></div>
      <div><div class="lab" style="font-size:13px;font-weight:600;margin-bottom:6px">Filters</div><div id="flts" style="display:flex;flex-direction:column;gap:6px"></div><button type="button" class="btn sm" data-addflt style="margin-top:6px">${icon('plus')} Add filter</button>
        <div class="tiny muted" style="margin-top:4px">Example: Maintenance register, Branch = Delhi, Estimated cost greater than 5000.</div></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn pri" type="submit">Run report</button><button class="btn" type="button" data-xl disabled>Export Excel</button><button class="btn" type="button" data-pdf disabled>${icon('print')} PDF / print</button></div></form>
    <div id="rout"></div>`);
  const fltRow = () => html`<div style="display:flex;gap:6px;flex-wrap:wrap" data-f><select data-ff aria-label="Field" style="width:auto">${opts(m.fields.map((f) => ({ id: f, name: (m.labels && m.labels[f]) || cap(f) })), '')}</select><select data-fo aria-label="Condition" style="width:auto">${opts([['contains', 'contains'], ['eq', 'equals'], ['gt', 'greater than'], ['lt', 'less than']].map(([id, name]) => ({ id, name })), 'contains')}</select><input data-fv type="text" aria-label="Value" style="width:200px"><button type="button" class="btn sm" data-rmf aria-label="Remove filter">✕</button></div>`;
  on('change', '#rm', (s) => go('#/reports?module=' + encodeURIComponent(s.value)));
  on('click', '[data-addflt]', () => document.getElementById('flts').insertAdjacentHTML('beforeend', fltRow().s));
  on('click', '[data-rmf]', (b) => b.closest('[data-f]').remove());
  let last = null;
  on('submit', '#rbf', async (f) => {
    const top = formData(f);
    const fields = [...f.querySelectorAll('[data-col]:checked')].map((c) => c.dataset.col);
    const filters = [...f.querySelectorAll('[data-f]')].map((r) => ({ field: r.querySelector('[data-ff]').value, op: r.querySelector('[data-fo]').value, value: r.querySelector('[data-fv]').value }));
    const r = await post('/reports/run', { module: top.module, from: top.from, to: top.to, branch_id: top.branch_id, fields, filters });
    last = r;
    const num = r.fields.filter((k) => r.rows.length && r.rows.every((x) => x[k] === null || x[k] === '' || !Number.isNaN(Number(x[k]))) && !/date|_no|number|phone|km$|reading/.test(k));
    const sums = Object.fromEntries(num.map((k) => [k, r.rows.reduce((a, x) => a + (Number(x[k]) || 0), 0)]));
    const groupKey = r.fields.find((k) => /category|type|status|branch|payment_mode|priority|severity|area|purpose|visitor_type|direction/.test(k));
    const valKey = num.find((k) => /total|amount|cost/.test(k));
    const groups = {};
    if (groupKey) r.rows.forEach((x) => { const g = x[groupKey] || '—'; groups[g] = (groups[g] || 0) + (valKey ? Number(x[valKey]) || 0 : 1); });
    document.getElementById('rout').innerHTML = html`<div class="grid g2" style="margin-bottom:14px"><div class="card"><h2 style="margin-bottom:8px">Summary</h2><dl class="kv"><dt>Rows</dt><dd class="num">${r.rows.length}</dd><dt>Period</dt><dd>${fdate(r.from)} – ${fdate(r.to)}</dd>${num.map((k) => html`<dt>Total ${(m.labels && m.labels[k]) || cap(k)}</dt><dd class="num">${/total|amount|cost|subtotal|gst|paid/.test(k) ? inr(sums[k], true) : Math.round(sums[k] * 100) / 100}</dd>`)}</dl></div>
      ${groupKey ? html`<div class="card"><h2 style="margin-bottom:8px">${valKey ? cap(valKey) : 'Count'} by ${(m.labels && m.labels[groupKey]) || cap(groupKey)}</h2><div class="chart-box"><canvas id="rch" role="img" aria-label="Report chart"></canvas></div></div>` : ''}</div>
      <div class="tbl-wrap"><table class="tbl" id="rtbl"><thead><tr>${r.fields.map((k) => html`<th>${(m.labels && m.labels[k]) || cap(k)}</th>`)}</tr></thead><tbody>${r.rows.length ? r.rows.slice(0, 2000).map((x) => html`<tr>${r.fields.map((k) => html`<td class="${num.includes(k) ? 'r num' : ''}">${x[k] ?? ''}</td>`)}</tr>`) : html`<tr><td class="empty" colspan="${r.fields.length}">No matching records.</td></tr>`}</tbody></table></div>`.s;
    f.querySelector('[data-xl]').disabled = false; f.querySelector('[data-pdf]').disabled = false;
    if (groupKey) { const ks = Object.keys(groups).sort((a, b) => groups[b] - groups[a]).slice(0, 12); chart('rch', { type: 'bar', data: { labels: ks, datasets: [{ data: ks.map((k) => groups[k]), backgroundColor: PALETTE[0], borderRadius: 3 }] }, options: { indexAxis: 'y', plugins: { legend: { display: false } } } }); }
  });
  on('click', '[data-xl]', () => { if (!last) return; const ws = window.XLSX.utils.json_to_sheet(last.rows); const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, 'Report'); window.XLSX.writeFile(wb, `report-${sel.replace(':', '-')}-${last.from}-${last.to}.xlsx`); });
  on('click', '[data-pdf]', () => window.print());
});

// ---------------- Home (role-based) ----------------
const STAFF_TILES = {
  guard: [['#/registers/security/new', 'shield', 'My shift log', 'Security register', true], ['#/registers/visitor/new', 'person', 'Visitor check-in', 'Parent, student or other'], ['#/registers/visitor', 'door', 'Visitors on site', 'Check out'],
    ['#/registers/delivery/new', 'truck', 'Delivery', 'Delivery register'], ['#/registers/inward_outward/new', 'box', 'Material in / out', 'Gate pass'], ['#/registers/key/new', 'key', 'Key issue', 'Key register'],
    ['#/registers/incident/new', 'alert', 'Incident report', 'Safety & security'], ['#/registers/opening/new', 'check', 'Opening checklist', 'Morning'], ['#/registers/closing/new', 'check', 'Closing checklist', 'Night'], ['#/my-submissions', 'inbox', 'My submissions', '']],
  office_boy: [['#/tasks', 'tasks', 'My tasks', 'Today\'s errands', true], ['#/purchase/new', 'cart', 'Purchase errand', 'Petty cash purchase'], ['#/purchases', 'receipt', 'Upload receipt', 'My purchases'],
    ['#/registers/courier/new', 'truck', 'Delivery / courier', 'Courier register'], ['#/quick-issue', 'camera', 'Report issue', 'Photo first'], ['#/my-submissions', 'inbox', 'Task & register history', '']],
  housekeeping: [['#/registers/housekeeping/new', 'broom', "Today's checklist", 'Area cleaning', true], ['#/quick-issue', 'camera', 'Report issue', 'Take a photo'], ['#/registers/lost_found/new', 'box', 'Lost & found', 'Item found'],
    ['#/tasks', 'tasks', 'My tasks', ''], ['#/my-submissions', 'inbox', 'Completed tasks', 'My submissions']],
  driver: [['#/registers/vehicle/new', 'truck', 'Trip log', 'Vehicle register', true], ['#/tasks', 'tasks', 'My tasks', ''], ['#/purchase/new', 'cart', 'Fuel / expense', 'Petty cash'], ['#/quick-issue', 'camera', 'Report issue', ''], ['#/my-submissions', 'inbox', 'My submissions', '']],
  maintenance: [['#/registers/maintenance', 'alert', 'Open issues', 'Maintenance register', true], ['#/quick-issue', 'camera', 'Report issue', ''], ['#/tasks', 'tasks', 'My tasks', ''], ['#/purchase/new', 'cart', 'Buy parts', 'Petty cash'], ['#/my-submissions', 'inbox', 'My submissions', '']],
  staff: [['#/registers/visitor/new', 'person', 'Visitor check-in', '', true], ['#/registers/courier/new', 'truck', 'Courier', ''], ['#/registers/reception/new', 'clip', 'Reception summary', 'End of day'], ['#/registers/lost_found/new', 'box', 'Lost & found', ''],
    ['#/tasks', 'tasks', 'Tasks', ''], ['#/purchase/new', 'cart', 'Purchase / expense', ''], ['#/quick-issue', 'camera', 'Report issue', ''], ['#/registers', 'clip', 'All registers', '']]
};
route('/', async (p, query) => {
  if (can.review()) return controlCentre(query);
  const tiles = STAFF_TILES[state.me.role] || STAFF_TILES.staff;
  const [tasks, mine] = await Promise.all([api('/tasks?mine=1'), api('/entries?mine=1&limit=20')]);
  const open = tasks.filter((t) => ['pending', 'in_progress'].includes(t.status));
  const returned = mine.filter((e) => e.status === 'returned');
  const hr = Number(new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(11, 13));
  page('Home', html`<div class="pagehead"><div><div class="eyebrow">${fdate(todayStr())} · ${state.me.branch_name || ''}</div><h1>Good ${hr < 12 ? 'morning' : hr < 17 ? 'afternoon' : 'evening'}, ${state.me.name.split(' ')[0]}</h1></div></div>
    ${returned.map((r) => html`<div class="callout pend"><b>${r.register_name}</b> was returned for correction: ${r.review_note} — <a href="#/entry/${r.id}/edit">Fix now</a></div>`)}
    <div class="tiles">${tiles.map(([href, ic, t, s, hot]) => html`<a class="tile ${hot ? 'hot' : ''}" href="${href}"><span class="ic">${icon(ic)}</span><b>${t}</b>${s ? html`<span>${s}</span>` : ''}</a>`)}</div>
    ${open.length ? html`<div class="card"><div class="card-h"><h2>My open tasks (${open.length})</h2><a class="small" href="#/tasks">All</a></div><ul class="att">${open.slice(0, 6).map((t) => html`<li><span class="t"><b>${t.title}</b><div class="tiny muted">${t.due_date ? 'Due ' + fdate(t.due_date) : ''} ${t.requested_by_name ? '· from ' + t.requested_by_name : ''}</div></span>${badge(t.priority)}<button class="btn sm ok" data-done="${t.id}">${icon('check')} Done</button></li>`)}</ul></div>` : ''}
    <div class="card"><div class="card-h"><h2>My recent submissions</h2><a class="small" href="#/my-submissions">All</a></div><ul class="att">${mine.slice(0, 8).map((e) => html`<li class="small"><span class="t"><a href="#/entry/${e.id}">${e.register_name}</a> — ${entryTitle(e.register_key, e.data)}</span>${badge(e.status)}<span class="tiny muted">${fdt(e.created_at)}</span></li>`)}${mine.length ? '' : html`<li class="muted">Nothing yet today.</li>`}</ul></div>`);
  on('click', '[data-done]', async (b) => { await put('/tasks/' + b.dataset.done, { status: 'done' }); toast('Done'); go(location.hash); });
});
