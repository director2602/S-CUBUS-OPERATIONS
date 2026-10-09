import { html, raw, api, post, put, route, page, state, can, chart, PALETTE, inr, fdate, fdt, badge, icon, on, go, toast, modal, opts, formData, todayStr, addDays, cap, loadLookups } from '../core.js';
import { uploadFile } from '../forms.js';

// ---------------- Inventory ----------------
route('/inventory', async (p, query) => {
  const d = await api('/inventory/stock' + (query.branch_id ? '?branch_id=' + query.branch_id : ''));
  const mv = await api('/inventory/movements' + (query.item ? '?item_id=' + query.item : '') + (query.branch_id ? (query.item ? '&' : '?') + 'branch_id=' + query.branch_id : ''));
  const branches = [...new Set(d.rows.map((r) => r.branch))];
  const byItem = d.items.map((it) => { const rs = d.rows.filter((r) => r.id === it.id); return { ...it, per: Object.fromEntries(rs.map((r) => [r.branch, r.qty])), total: rs.reduce((a, r) => a + r.qty, 0), low: rs.filter((r) => r.min_stock > 0 && r.qty < r.min_stock).map((r) => r.branch) }; })
    .filter((it) => !query.item || String(it.id) === query.item);
  const canAdj = can.finance() || state.me.role === 'manager';
  page('Inventory', html`<div class="pagehead"><div><h1>Inventory</h1><div class="small muted">Stock goes up when purchases are approved or inward entries are logged, and down when items are issued.</div></div>
    <div class="actions">${can.allBranches() ? html`<select data-bp style="width:auto;height:40px" aria-label="Branch">${opts(state.lookups.branches, query.branch_id, { blank: 'All branches' })}</select>` : ''}
      <button class="btn" data-xl>Export Excel</button><button class="btn" data-mv="return">Return</button>${canAdj ? html`<button class="btn" data-mv="adjustment">Adjust / loss</button>` : ''}<button class="btn pri" data-mv="issue">${icon('box')} Issue items</button></div></div>
    ${query.item ? html`<div class="callout info small">Showing one item. <a href="#/inventory">Show all</a></div>` : ''}
    <div class="grid g2"><div class="card"><div class="card-h"><h2>Stock vs minimum</h2><span class="tiny muted">All branches combined</span></div><div class="chart-box lg"><canvas id="cStk" role="img" aria-label="Stock versus minimum"></canvas></div></div>
      <div class="card"><div class="card-h"><h2>Movements — last 30 days</h2></div><div class="chart-box lg"><canvas id="cMv" role="img" aria-label="Stock movements by type"></canvas></div></div></div>
    <div class="tbl-wrap"><table class="tbl" id="itbl"><thead><tr><th>Item</th><th>Category</th>${branches.map((b) => html`<th class="r">${b}</th>`)}<th class="r">Total</th><th class="r">Min / branch</th><th class="r">Value</th><th></th></tr></thead><tbody>
      ${byItem.map((it) => html`<tr><td><a href="#/inventory?item=${it.id}"><b>${it.name}</b></a> <span class="tiny muted">${it.unit}</span></td><td>${it.category || ''}</td>${branches.map((b) => html`<td class="r num" style="${it.low.includes(b) ? 'background:var(--high-bg);color:var(--high);font-weight:700' : ''}">${it.per[b] ?? 0}</td>`)}<td class="r num"><b>${it.total}</b></td><td class="r num">${it.min_stock}</td><td class="r num">${inr(it.total * it.rate)}</td><td>${it.low.length ? badge('High', 'Low') : ''}</td></tr>`)}
    </tbody></table></div>
    <div class="card"><h2 style="margin-bottom:10px">Recent movements</h2><div class="tbl-wrap" style="border:0"><table class="tbl"><thead><tr><th>When</th><th>Item</th><th>Type</th><th class="r">Qty</th><th>To / remarks</th><th>Branch</th><th>By</th></tr></thead><tbody>
      ${mv.slice(0, 80).map((m) => html`<tr><td class="small">${fdt(m.created_at)}</td><td>${m.item}</td><td>${badge(m.qty > 0 ? 'approved' : 'pending', m.type)}</td><td class="r num" style="color:${m.qty < 0 ? 'var(--high)' : 'var(--ok)'}">${m.qty > 0 ? '+' : ''}${m.qty} ${m.unit}</td><td class="small">${[m.issued_to, m.remarks].filter(Boolean).join(' · ')}${m.ref_type === 'purchase' ? html` <a href="#/purchase/${m.ref_id}">purchase</a>` : m.ref_type === 'register_entry' ? html` <a href="#/entry/${m.ref_id}">gate entry</a>` : ''}</td><td>${m.branch}</td><td class="small">${m.created_by_name || ''}</td></tr>`)}</tbody></table></div></div>`);
  on('change', '[data-bp]', (s) => go('#/inventory' + (s.value ? '?branch_id=' + s.value : '')));
  on('click', '[data-xl]', () => { const wb = window.XLSX.utils.table_to_book(document.getElementById('itbl')); window.XLSX.writeFile(wb, `stock-${todayStr()}.xlsx`); });
  const top = byItem.slice().sort((a, b) => a.total / (a.min_stock * branches.length || 1) - b.total / (b.min_stock * branches.length || 1)).slice(0, 12);
  chart('cStk', { type: 'bar', data: { labels: top.map((i) => i.name), datasets: [{ label: 'In stock', data: top.map((i) => i.total), backgroundColor: top.map((i) => (i.low.length ? PALETTE[1] : PALETTE[0])), borderRadius: 3 }, { label: 'Minimum (all branches)', data: top.map((i) => i.min_stock * branches.length), backgroundColor: '#D9CCE0', borderRadius: 3 }] },
    options: { indexAxis: 'y', plugins: { legend: { position: 'bottom' } }, scales: { x: { beginAtZero: true } } } });
  const since = addDays(todayStr(), -30);
  const types = ['purchase', 'inward', 'issue', 'outward', 'return', 'loss', 'damage', 'adjustment'];
  const recent = mv.filter((m) => String(m.created_at).slice(0, 10) >= since);
  chart('cMv', { type: 'bar', data: { labels: types.map(cap), datasets: [{ data: types.map((t) => recent.filter((m) => m.type === t).reduce((a, m) => a + Math.abs(m.qty), 0)), backgroundColor: types.map((t, i) => PALETTE[i % PALETTE.length]), borderRadius: 3 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } });
  on('click', '[data-mv]', async (b) => {
    const type = b.dataset.mv;
    const types2 = type === 'adjustment' ? [['adjustment', 'Stock correction (+/-)'], ['loss', 'Loss'], ['damage', 'Damage'], ['opening', 'Opening stock']] : [[type, cap(type)]];
    const ok = await modal(type === 'issue' ? 'Issue items' : type === 'return' ? 'Return items to stock' : 'Adjust stock', html`<div class="form">
      ${types2.length > 1 ? html`<div class="fld"><label for="mt">Type</label><select id="mt" name="type">${opts(types2.map(([k, v]) => ({ id: k, name: v })), 'adjustment')}</select></div>` : html`<input type="hidden" name="type" value="${type}">`}
      ${can.allBranches() || state.me.role === 'manager' ? html`<div class="fld"><label for="mb">Branch</label><select id="mb" name="branch_id">${opts(state.lookups.branches, query.branch_id || state.me.branch_id)}</select></div>` : ''}
      <div class="fld"><label for="mi">Item</label><select id="mi" name="item_id">${opts(state.lookups.items, query.item)}</select></div>
      <div class="fld"><label for="mq">Quantity${type === 'adjustment' ? ' (negative to reduce)' : ''}</label><input id="mq" type="number" step="any" name="qty"></div>
      <div class="fld"><label for="mto">${type === 'issue' ? 'Issued to (student / batch / staff)' : 'From / to'}</label><input id="mto" type="text" name="issued_to"></div>
      <div class="fld full"><label for="mr">Remarks</label><input id="mr" type="text" name="remarks"></div></div>`, {
      onMount: (ctx) => { ctx.onAction = async (a, el) => { if (a !== 'ok') return; await post('/inventory/move', formData(el)); toast('Stock updated'); return true; }; }
    });
    if (ok) go(location.hash);
  });
});

// ---------------- Tasks ----------------
async function taskModal(t) {
  t = t || { priority: 'normal', status: 'pending' };
  const users = state.lookups.users;
  return modal(t.id ? 'Edit task' : 'New task', html`<div class="form">
    <div class="fld full"><label for="tt">Task *</label><input id="tt" type="text" name="title" value="${t.title || ''}" list="dltask"><datalist id="dltask">${['Collect documents', 'Deliver courier', 'Purchase stationery', 'Bring refreshments', 'Move files', 'Bank work', 'Office supply purchase', 'Room setup', 'Event support'].map((x) => html`<option value="${x}">`)}</datalist></div>
    ${!can.field() ? html`<div class="fld"><label for="ta">Assign to</label><select id="ta" name="assigned_to">${opts(users, t.assigned_to, { blank: '— Unassigned —' })}</select></div>` : ''}
    <div class="fld"><label for="tp">Priority</label><select id="tp" name="priority">${opts(['low', 'normal', 'high', 'urgent'].map((x) => ({ id: x, name: cap(x) })), t.priority)}</select></div>
    <div class="fld"><label for="ts">Status</label><select id="ts" name="status">${opts([['pending', 'Pending'], ['in_progress', 'In progress'], ['done', 'Done'], ['cancelled', 'Cancelled']].map(([id, name]) => ({ id, name })), t.status)}</select></div>
    <div class="fld"><label for="td">Due date</label><input id="td" type="date" name="due_date" value="${t.due_date || ''}"></div>
    <div class="fld"><label for="tc">Category</label><input id="tc" type="text" name="category" value="${t.category || ''}" list="dltc"><datalist id="dltc"><option value="Errand"><option value="Admin"><option value="Facilities"><option value="Event"><option value="Academic"></datalist></div>
    ${can.allBranches() ? html`<div class="fld"><label for="tb">Branch</label><select id="tb" name="branch_id">${opts(state.lookups.branches, t.branch_id || state.me.branch_id)}</select></div>` : ''}
    <div class="fld full"><label for="tdesc">Details</label><textarea id="tdesc" name="description">${t.description || ''}</textarea></div>
    <div class="fld full"><label for="trm">Remarks / update</label><input id="trm" type="text" name="remarks" value="${t.remarks || ''}"></div>
    <div class="fld full"><div class="lab">Receipt / photo</div><input type="hidden" name="attachment_id" value="${t.attachment_id || ''}"><div class="upl"><label class="btn sm">${icon('camera')} Upload<input type="file" class="sr" data-tup accept="image/*,application/pdf"></label><span data-tprev>${t.attachment_id ? html`<a href="/api/files/${t.attachment_id}" target="_blank" rel="noopener">View</a>` : ''}</span></div></div></div>`, {
    onMount: (ctx) => {
      ctx.el.addEventListener('change', async (e) => { if (e.target.matches('[data-tup]')) { const up = await uploadFile(e.target.files[0]); ctx.el.querySelector('[name=attachment_id]').value = up.id; ctx.el.querySelector('[data-tprev]').textContent = 'Uploaded ✓'; } });
      ctx.onAction = async (a, el) => { if (a !== 'ok') return; const f = formData(el); if (t.id) await put('/tasks/' + t.id, f); else await post('/tasks', f); toast('Saved'); return true; };
    }
  });
}
route('/tasks', async (p, query) => {
  const rows = await api('/tasks?' + new URLSearchParams(query));
  const today = todayStr();
  const groups = [['in_progress', 'In progress'], ['pending', 'Pending'], ['done', 'Done'], ['cancelled', 'Cancelled']];
  const done = rows.filter((r) => r.status === 'done').length;
  page('Tasks', html`<div class="pagehead"><div><h1>${can.field() ? 'My tasks' : 'Tasks'}</h1><div class="small muted">${rows.filter((r) => ['pending', 'in_progress'].includes(r.status)).length} open · ${rows.filter((r) => ['pending', 'in_progress'].includes(r.status) && r.due_date && r.due_date < today).length} overdue · ${done} done</div></div>
    <div class="actions">${!can.field() ? html`<a class="btn ${query.overdue ? 'pri' : ''}" href="#/tasks${query.overdue ? '' : '?overdue=1'}">Overdue only</a><a class="btn ${query.mine ? 'pri' : ''}" href="#/tasks${query.mine ? '' : '?mine=1'}">Mine</a>` : ''}<button class="btn pri" data-new>${icon('plus')} New task</button></div></div>
    ${groups.map(([st, label]) => { const list = rows.filter((r) => r.status === st).slice(0, st === 'done' || st === 'cancelled' ? 30 : 500); if (!list.length) return ''; return html`<section><div class="eyebrow" style="margin-bottom:8px">${label} (${rows.filter((r) => r.status === st).length})</div>
      <div class="tbl-wrap"><table class="tbl"><tbody>${list.map((t) => html`<tr><td style="width:40%"><b>${t.title}</b>${t.description ? html`<div class="tiny muted">${t.description}</div>` : ''}${t.remarks ? html`<div class="tiny">${t.remarks}</div>` : ''}</td>
        <td>${badge(t.priority)}</td><td class="small">${t.assigned_to_name || html`<span class="faint">Unassigned</span>`}<div class="tiny muted">by ${t.requested_by_name || ''}</div></td>
        <td class="small" style="${['pending', 'in_progress'].includes(t.status) && t.due_date && t.due_date < today ? 'color:var(--crit);font-weight:600' : ''}">${t.due_date ? 'Due ' + fdate(t.due_date) : ''}${t.completed_at ? html`<div class="tiny muted">Done ${fdt(t.completed_at)}</div>` : ''}</td>
        <td style="white-space:nowrap;text-align:right">${st === 'pending' ? html`<button class="btn sm" data-set="in_progress" data-id="${t.id}">Start</button> ` : ''}${['pending', 'in_progress'].includes(st) ? html`<button class="btn sm ok" data-set="done" data-id="${t.id}">${icon('check')} Done</button> ` : ''}<button class="btn sm" data-ed="${t.id}" aria-label="Edit task">${icon('edit')}</button></td></tr>`)}</tbody></table></div></section>`; })}
    ${rows.length ? '' : html`<div class="card empty">No tasks.</div>`}`);
  on('click', '[data-new]', async () => { if (await taskModal()) go(location.hash); });
  on('click', '[data-ed]', async (b) => { if (await taskModal(rows.find((r) => r.id === Number(b.dataset.ed)))) go(location.hash); });
  on('click', '[data-set]', async (b) => { await put('/tasks/' + b.dataset.id, { status: b.dataset.set }); toast(b.dataset.set === 'done' ? 'Marked done' : 'Started'); go(location.hash); });
  if (query.open) { const t = rows.find((r) => String(r.id) === query.open); if (t) taskModal(t).then((ok) => ok && go('#/tasks')); }
});

// ---------------- Documents & compliance ----------------
async function docModal(d) {
  d = d || { doc_type: 'license' };
  return modal(d.id ? 'Edit document' : 'Add document / licence', html`<div class="form">
    <div class="fld full"><label for="dt">Title *</label><input id="dt" type="text" name="title" value="${d.title || ''}" placeholder="e.g. Fire NOC"></div>
    <div class="fld"><label for="dty">Type</label><select id="dty" name="doc_type">${opts([['license', 'Licence'], ['contract', 'Contract'], ['insurance', 'Insurance'], ['certificate', 'Certificate'], ['document', 'Other document']].map(([id, name]) => ({ id, name })), d.doc_type)}</select></div>
    <div class="fld"><label for="dn">Number</label><input id="dn" type="text" name="number" value="${d.number || ''}"></div>
    <div class="fld"><label for="db">Branch</label><select id="db" name="branch_id">${opts(state.lookups.branches, d.branch_id, { blank: 'All / company-wide' })}</select></div>
    <div class="fld"><label for="dv">Vendor / issuer</label><select id="dv" name="vendor_id">${opts(state.lookups.vendors, d.vendor_id, { blank: '—' })}</select></div>
    <div class="fld"><label for="di">Issued on</label><input id="di" type="date" name="issued_on" value="${d.issued_on || ''}"></div>
    <div class="fld"><label for="de">Expires on</label><input id="de" type="date" name="expires_on" value="${d.expires_on || ''}"></div>
    <div class="fld full"><div class="lab">File</div><input type="hidden" name="file_id" value="${d.file_id || ''}"><div class="upl"><label class="btn sm">${icon('file')} Upload<input type="file" class="sr" data-dup></label><span data-dprev>${d.file_id ? html`<a href="/api/files/${d.file_id}" target="_blank" rel="noopener">${d.file_name || 'View'}</a>` : ''}</span></div></div>
    <div class="fld full"><label for="dno">Notes</label><input id="dno" type="text" name="notes" value="${d.notes || ''}"></div></div>`, {
    onMount: (ctx) => {
      ctx.el.addEventListener('change', async (e) => { if (e.target.matches('[data-dup]')) { ctx.el.querySelector('[data-dprev]').textContent = 'Uploading…'; const up = await uploadFile(e.target.files[0]); ctx.el.querySelector('[name=file_id]').value = up.id; ctx.el.querySelector('[data-dprev]').textContent = up.name; } });
      ctx.onAction = async (a, el) => { if (a !== 'ok') return; const f = formData(el); if (d.id) await put('/documents/' + d.id, f); else await post('/documents', f); toast('Saved'); return true; };
    }
  });
}
route('/documents', async () => {
  const rows = await api('/documents');
  const exp = rows.filter((r) => r.days_left !== null && r.days_left < 0).length; const soon = rows.filter((r) => r.days_left !== null && r.days_left >= 0 && r.days_left <= 30).length; const s60 = rows.filter((r) => r.days_left !== null && r.days_left > 30 && r.days_left <= 60).length;
  page('Documents', html`<div class="pagehead"><div><h1>Documents & compliance</h1><div class="small muted">Licences, contracts, insurance and certificates with expiry tracking</div></div><div class="actions"><button class="btn pri" data-add>${icon('plus')} Add document</button></div></div>
    <div class="kpis"><div class="kpi"><span class="l">Expired</span><span class="v" style="color:var(--crit)">${exp}</span></div><div class="kpi"><span class="l">Expiring ≤ 30 days</span><span class="v" style="color:var(--high)">${soon}</span></div><div class="kpi"><span class="l">31–60 days</span><span class="v">${s60}</span></div><div class="kpi"><span class="l">Total on file</span><span class="v">${rows.length}</span></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Title</th><th>Type</th><th>Number</th><th>Branch</th><th>Expires</th><th>Status</th><th>File</th><th></th></tr></thead><tbody>
      ${rows.map((d) => html`<tr><td><b>${d.title}</b>${d.vendor ? html`<div class="tiny muted">${d.vendor}</div>` : ''}</td><td>${cap(d.doc_type)}</td><td>${d.number || ''}</td><td>${d.branch || 'All'}</td><td>${fdate(d.expires_on)}</td>
        <td>${d.days_left === null ? '' : d.days_left < 0 ? badge('Critical', 'Expired') : d.days_left <= 30 ? badge('High', d.days_left + ' days') : d.days_left <= 60 ? badge('pending', d.days_left + ' days') : badge('done', 'Valid')}</td>
        <td>${d.file_id ? html`<a href="/api/files/${d.file_id}" target="_blank" rel="noopener">Open</a>` : ''}</td><td><button class="btn sm" data-ed="${d.id}">${icon('edit')} Edit</button></td></tr>`)}</tbody></table></div>`);
  on('click', '[data-add]', async () => { if (await docModal()) go(location.hash); });
  on('click', '[data-ed]', async (b) => { if (await docModal(rows.find((r) => r.id === Number(b.dataset.ed)))) go(location.hash); });
});
