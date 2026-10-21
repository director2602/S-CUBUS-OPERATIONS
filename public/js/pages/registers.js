import { html, raw, api, post, put, route, page, state, can, inr, fdate, fdt, ftime, badge, icon, on, go, toast, err, modal, promptReason, confirmBox, opts, formData, todayStr, addDays, cap } from '../core.js';
import { renderFields, setupFields, collectFields, finalizeSignatures, showValue, entryTitle, uploadFile, voice } from '../forms.js';

let DEFS = null;
const defs = async (force) => (DEFS = !DEFS || force ? await api('/registers') : DEFS);
const FREQ = { daily: 'Daily', per_shift: 'Per shift', twice_daily: 'Twice daily', live: 'As it happens', as_needed: 'When needed' };

// ---------------- All registers ----------------
route('/registers', async () => {
  const list = (await defs(true)).filter((d) => d.status === 'active');
  const today = await api(`/entries?from=${todayStr()}&to=${todayStr()}&limit=2000${can.field() ? '&mine=1' : ''}`);
  const cnt = (id) => today.filter((e) => e.register_id === id).length;
  const depts = [...new Set(list.map((d) => d.department || 'Other'))];
  page('Registers', html`<div class="pagehead"><div><h1>Registers & logs</h1><div class="small muted">Digital registers replace the paper ones. Every entry records who, when and any edits.</div></div>
    <div class="actions">${can.review() ? html`<a class="btn" href="#/registers-centre">Registers Centre</a>` : ''}${can.mgmt() ? html`<a class="btn pri" href="#/register-builder/new">${icon('plus')} Create custom register</a>` : ''}</div></div>
    ${depts.map((dep) => html`<section><div class="eyebrow" style="margin-bottom:8px">${dep}</div><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">${list.filter((d) => (d.department || 'Other') === dep).map((d) => html`
      <div class="card tight" style="display:flex;flex-direction:column;gap:8px"><div style="display:flex;justify-content:space-between;gap:8px"><a href="#/registers/${d.key}" style="font-weight:600;text-decoration:none">${d.name}</a>${d.builtin ? '' : badge('info', 'Custom')}</div>
        <div class="tiny muted">${FREQ[d.frequency]}${d.deadline ? ' · by ' + d.deadline : ''}${d.description ? ' · ' + d.description : ''}</div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:auto"><span class="small"><b class="num">${cnt(d.id)}</b> today</span><span style="display:flex;gap:6px"><a class="btn sm" href="#/registers/${d.key}">View</a><a class="btn sm pri" href="#/registers/${d.key}/new">${icon('plus')} Entry</a></span></div></div>`)}</div></section>`)}`);
});

// ---------------- Register entries list ----------------
route('/registers/:key', async ({ key }, query) => {
  const def = (await defs()).find((d) => d.key === key) || await api('/registers/' + key);
  const from = query.from || addDays(todayStr(), key === 'maintenance' || key === 'incident' || key === 'lost_found' ? -60 : -6); const to = query.to || todayStr();
  const qs = new URLSearchParams({ register: key, from, to, ...(query.status ? { status: query.status } : {}), ...(query.q ? { q: query.q } : {}), ...(query.branch_id ? { branch_id: query.branch_id } : {}), limit: 1000 });
  const rows = await api('/entries?' + qs);
  const cols = def.fields.filter((f) => !['file', 'image', 'signature', 'textarea', 'checklist'].includes(f.type) && !f.showIf).slice(0, 6);
  const checkout = { visitor: 'exit_time', key: 'returned_at', equipment_handover: 'return_time' }[key];
  const onSite = key === 'visitor' ? rows.filter((r) => r.entry_date === todayStr() && !r.data.exit_time) : [];
  page(def.name, html`<div class="pagehead"><div><div class="eyebrow">${def.department || ''} · ${FREQ[def.frequency]}${def.deadline ? ' · deadline ' + def.deadline : ''}</div><h1>${def.name}</h1></div>
    <div class="actions"><button class="btn" data-xl>Export Excel</button>${can.mgmt() ? html`<a class="btn" href="#/register-builder/${def.id}">${icon('edit')} Edit fields</a>` : ''}<a class="btn pri" href="#/registers/${key}/new">${icon('plus')} ${key === 'visitor' ? 'Check in visitor' : 'New entry'}</a></div></div>
    ${key === 'visitor' ? html`<div class="kpis"><div class="kpi"><span class="l">On site now</span><span class="v">${onSite.length}</span></div><div class="kpi"><span class="l">Today</span><span class="v">${rows.filter((r) => r.entry_date === todayStr()).length}</span></div>
      <div class="kpi"><span class="l">Parents · Students · Others (period)</span><span class="v" style="font-size:20px">${rows.filter((r) => r.data.visitor_type === 'Parent').length} · ${rows.filter((r) => r.data.visitor_type === 'Student').length} · ${rows.filter((r) => !['Parent', 'Student'].includes(r.data.visitor_type)).length}</span></div></div>` : ''}
    <form class="filters card tight" data-form="flt">
      <div class="fld"><label for="eq">Search</label><input id="eq" type="search" name="q" value="${query.q || ''}" placeholder="Name, number, vehicle…"></div>
      <div class="fld"><label for="ef">From</label><input id="ef" type="date" name="from" value="${from}"></div><div class="fld"><label for="et">To</label><input id="et" type="date" name="to" value="${to}"></div>
      <div class="fld"><label for="es">Status</label><select id="es" name="status">${opts(['submitted', 'reviewed', 'verified', 'returned'], query.status, { blank: 'All' })}</select></div>
      ${can.allBranches() ? html`<div class="fld"><label for="eb">Branch</label><select id="eb" name="branch_id">${opts(state.lookups.branches, query.branch_id, { blank: 'All' })}</select></div>` : ''}
      <button class="btn" type="submit">Filter</button></form>
    <div class="tbl-wrap"><table class="tbl" id="etbl"><thead><tr><th>Date</th>${cols.map((c) => html`<th>${c.label}</th>`)}${can.allBranches() ? html`<th>Branch</th>` : ''}<th>By</th><th>Status</th>${checkout ? html`<th></th>` : ''}</tr></thead><tbody>
      ${rows.length ? rows.map((r) => html`<tr class="click" data-href="#/entry/${r.id}"><td style="white-space:nowrap">${fdate(r.entry_date)}<div class="tiny muted">${ftime(r.created_at)}</div></td>${cols.map((c) => html`<td>${showValue(c, r.data[c.key])}</td>`)}${can.allBranches() ? html`<td>${r.branch}</td>` : ''}<td class="small">${r.created_by_name}${r.edits ? html`<div class="tiny" style="color:var(--high)">edited ${r.edits}×</div>` : ''}</td><td>${badge(r.status)}</td>
        ${checkout ? html`<td>${!r.data[checkout] ? html`<button class="btn sm pri" data-co="${r.id}">${key === 'visitor' ? 'Check out' : 'Mark returned'}</button>` : ''}</td>` : ''}</tr>`) : html`<tr><td colspan="${cols.length + 5}" class="empty">No entries in this period.</td></tr>`}
    </tbody></table></div>`);
  on('submit', '[data-form="flt"]', (f) => { const o = Object.fromEntries([...new FormData(f)].filter(([, v]) => v)); go(`#/registers/${key}?` + new URLSearchParams(o)); });
  on('click', 'tr[data-href]', (tr, ev) => { if (!ev.target.closest('button,a')) go(tr.dataset.href); });
  on('click', '[data-co]', async (b) => { b.disabled = true; await post(`/entries/${b.dataset.co}/checkout`); toast(key === 'visitor' ? 'Checked out' : 'Marked returned'); go(location.hash); });
  on('click', '[data-xl]', () => {
    const data = rows.map((r) => ({ Date: r.entry_date, Branch: r.branch, ...Object.fromEntries(def.fields.filter((f) => !['file', 'image', 'signature'].includes(f.type)).map((f) => [f.label, f.type === 'checklist' ? Object.entries(r.data[f.key] || {}).map(([k, v]) => `${k}: ${v.status}${v.remark ? ' (' + v.remark + ')' : ''}`).join('; ') : (Array.isArray(r.data[f.key]) ? r.data[f.key].join(', ') : r.data[f.key] ?? '')])), 'Entered by': r.created_by_name, Status: r.status }));
    const ws = window.XLSX.utils.json_to_sheet(data); const wb = window.XLSX.utils.book_new(); window.XLSX.utils.book_append_sheet(wb, ws, def.name.slice(0, 30)); window.XLSX.writeFile(wb, `${key}-${from}-to-${to}.xlsx`);
  });
});

// ---------------- Entry form (new & edit) ----------------
async function entryForm(def, entry) {
  const isNew = !entry;
  page(isNew ? def.name : 'Edit entry', html`<div class="pagehead"><div><div class="eyebrow">${def.name}</div><h1>${isNew ? (def.key === 'visitor' ? 'Check in visitor' : 'New entry') : 'Edit entry'}</h1></div></div>
    ${def.description ? html`<div class="small muted">${def.description}</div>` : ''}
    ${entry && entry.status === 'returned' ? html`<div class="callout pend">Returned for correction: <b>${entry.review_note}</b></div>` : ''}
    <form id="ef" class="card" style="display:flex;flex-direction:column;gap:16px" novalidate>
      <div class="form">
        <div class="fld"><label for="edate">Register date</label><input id="edate" type="date" name="entry_date" value="${entry ? entry.entry_date : todayStr()}"></div>
        ${isNew && (can.allBranches() || state.me.role === 'manager') ? html`<div class="fld"><label for="ebr">Branch</label><select id="ebr" name="branch_id">${opts(state.lookups.branches, state.me.branch_id)}</select></div>` : ''}
      </div>
      <div class="form" id="dyn">${renderFields(def.fields, entry ? entry.data : {}, { isNew })}</div>
      ${!isNew ? html`<div class="fld"><label for="ereason">Reason for edit <span class="req">*</span></label><input id="ereason" type="text" name="reason" placeholder="Every change is recorded with the original values"></div>` : ''}
      <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap"><a class="btn" href="${isNew ? '#/registers/' + def.key : '#/entry/' + entry.id}">Cancel</a>${isNew ? html`<button class="btn" type="submit" data-again="1">Save & add another</button>` : ''}<button class="btn pri lg" type="submit">${isNew ? 'Submit' : 'Save changes'}</button></div>
    </form>`);
  const form = document.getElementById('ef');
  setupFields(form.querySelector('#dyn'), def.fields);
  let again = false;
  on('click', '#ef [type=submit]', (b) => { again = !!b.dataset.again; });
  on('submit', '#ef', async () => {
    const btns = form.querySelectorAll('[type=submit]'); btns.forEach((b) => { b.disabled = true; });
    try {
      await finalizeSignatures(form);
      const data = collectFields(form, def.fields);
      const top = formData(form);
      if (isNew) {
        const r = await post('/entries', { register: def.key, data, entry_date: top.entry_date, branch_id: top.branch_id });
        toast('Saved');
        if (again) go(`#/registers/${def.key}/new`); else go(can.field() ? '#/' : `#/entry/${r.id}`);
      } else {
        await put('/entries/' + entry.id, { data, entry_date: top.entry_date, reason: top.reason });
        toast('Saved'); go('#/entry/' + entry.id);
      }
    } catch (e) { err(e); } finally { btns.forEach((b) => { b.disabled = false; }); }
  });
}
route('/registers/:key/new', async ({ key }) => { const def = await api('/registers/' + key); await entryForm(def); });
route('/entry/:id/edit', async ({ id }) => { const e = await api('/entries/' + id); const def = await api('/registers/' + e.register_id); await entryForm(def, e); });

// ---------------- Entry detail ----------------
route('/entry/:id', async ({ id }) => {
  const e = await api('/entries/' + id);
  const fields = e.fields;
  const own = e.created_by === state.me.id;
  const canEdit = can.review() || (own && e.status !== 'verified');
  const diff = (a, b) => fields.filter((f) => JSON.stringify(a[f.key] ?? '') !== JSON.stringify(b[f.key] ?? ''));
  page(e.register_name, html`<div class="pagehead"><div><div class="eyebrow">${e.register_name} · ${e.branch} · ${fdate(e.entry_date)}</div><h1>${entryTitle(e.register_key, e.data) || e.register_name}</h1><div style="margin-top:6px">${badge(e.status)}</div></div>
    <div class="actions">${canEdit ? html`<a class="btn" href="#/entry/${e.id}/edit">${icon('edit')} Edit</a>` : ''}
      ${can.review() && e.status !== 'verified' ? html`<button class="btn" data-st="returned">↩ Return for correction</button>${e.status === 'submitted' ? html`<button class="btn" data-st="reviewed">Mark reviewed</button>` : ''}<button class="btn ok" data-st="verified">${icon('check')} Verify</button>` : ''}
      <button class="btn" data-print>${icon('print')} Print</button></div></div>
    ${e.status === 'returned' ? html`<div class="callout pend">Returned for correction: <b>${e.review_note}</b></div>` : ''}
    <div class="grid g2"><div class="card"><dl class="kv">${fields.filter((f) => e.data[f.key] !== undefined).map((f) => html`<dt>${f.label}</dt><dd>${showValue(f, e.data[f.key])}</dd>`)}</dl></div>
      <div class="card"><h2 style="margin-bottom:10px">Accountability</h2><dl class="kv"><dt>Created by</dt><dd>${e.created_by_name} · ${fdt(e.created_at)}</dd>
        ${e.updated_at ? html`<dt>Last updated by</dt><dd>${e.updated_by_name} · ${fdt(e.updated_at)}</dd>` : ''}
        ${e.verified_at ? html`<dt>${e.status === 'verified' ? 'Verified' : 'Reviewed'} by</dt><dd>${e.verified_by_name} · ${fdt(e.verified_at)}</dd>` : ''}<dt>Branch</dt><dd>${e.branch}</dd></dl>
        ${e.history.length ? html`<h3 style="margin:16px 0 8px">Edit history (${e.history.length})</h3>${e.history.map((h) => { const ch = diff(h.old_data || {}, h.new_data || {}); return html`<div style="border-top:1px solid var(--line-2);padding:8px 0" class="small"><b>${h.edited_by_name}</b> · ${fdt(h.edited_at)} — <i>${h.reason}</i>
          ${ch.length ? html`<table class="tbl" style="margin-top:6px"><thead><tr><th>Field</th><th>Original</th><th>Edited</th></tr></thead><tbody>${ch.map((f) => html`<tr><td>${f.label}</td><td>${showValue(f, (h.old_data || {})[f.key])}</td><td>${showValue(f, (h.new_data || {})[f.key])}</td></tr>`)}</tbody></table>` : ''}</div>`; })}` : html`<div class="tiny muted" style="margin-top:12px">Not edited since submission.</div>`}
      </div></div>`);
  on('click', '[data-print]', () => window.print());
  on('click', '[data-st]', async (b) => {
    let note = null;
    if (b.dataset.st === 'returned') { note = await promptReason('Return for correction', 'What needs correcting?'); if (note === null) return; }
    await post(`/entries/${id}/status`, { status: b.dataset.st, note }); toast('Updated'); go(location.hash);
  });
});

// ---------------- Review queue ----------------
route('/review', async (p, query) => {
  const rows = await api('/entries?status=submitted&limit=500' + (query.branch_id ? '&branch_id=' + query.branch_id : ''));
  const ds = await defs();
  const important = rows.filter((r) => { const d = ds.find((x) => x.id === r.register_id); return d && (d.important || ['daily', 'per_shift', 'twice_daily'].includes(d.frequency)); });
  const others = rows.length - important.length;
  page('Review & verify', html`<div class="pagehead"><div><h1>Review & verify registers</h1><div class="small muted">${important.length} scheduled / important entries waiting${others ? ` · ${others} event entries (visitors, couriers…) do not need review` : ''}</div></div>
    <div class="actions"><button class="btn ok" data-bulk>${icon('check')} Verify selected</button></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th><input type="checkbox" data-all aria-label="Select all"></th><th>Register</th><th>Date</th><th>Summary</th><th>Branch</th><th>By</th><th></th></tr></thead><tbody>
    ${important.length ? important.map((r) => html`<tr><td><input type="checkbox" data-sel="${r.id}" aria-label="Select entry ${r.id}"></td><td><a href="#/entry/${r.id}">${r.register_name}</a></td><td>${fdate(r.entry_date)} <span class="tiny muted">${ftime(r.created_at)}</span></td><td class="small">${entryTitle(r.register_key, r.data)}</td><td>${r.branch}</td><td class="small">${r.created_by_name}</td>
      <td style="white-space:nowrap"><button class="btn sm" data-ret="${r.id}">↩ Return</button> <button class="btn sm ok" data-ver="${r.id}">Verify</button></td></tr>`) : html`<tr><td colspan="7" class="empty">All caught up.</td></tr>`}</tbody></table></div>`);
  on('change', '[data-all]', (c) => document.querySelectorAll('[data-sel]').forEach((x) => { x.checked = c.checked; }));
  on('click', '[data-ver]', async (b) => { await post(`/entries/${b.dataset.ver}/status`, { status: 'verified' }); b.closest('tr').remove(); toast('Verified'); });
  on('click', '[data-ret]', async (b) => { const n = await promptReason('Return for correction', 'What needs correcting?'); if (n === null) return; await post(`/entries/${b.dataset.ret}/status`, { status: 'returned', note: n }); b.closest('tr').remove(); toast('Returned'); });
  on('click', '[data-bulk]', async () => { const ids = [...document.querySelectorAll('[data-sel]:checked')].map((x) => Number(x.dataset.sel)); if (!ids.length) return toast('Select entries first', true); await post('/entries/bulk-status', { ids, status: 'verified' }); toast(`${ids.length} verified`); go(location.hash); });
});

// ---------------- My submissions ----------------
route('/my-submissions', async () => {
  const rows = await api('/entries?mine=1&limit=200');
  page('My submissions', html`<div class="pagehead"><h1>My submissions</h1></div>
    ${rows.filter((r) => r.status === 'returned').map((r) => html`<div class="callout pend"><b>${r.register_name} (${fdate(r.entry_date)})</b> was returned: ${r.review_note} — <a href="#/entry/${r.id}/edit">Correct it</a></div>`)}
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Date</th><th>Register</th><th>Summary</th><th>Status</th></tr></thead><tbody>
    ${rows.map((r) => html`<tr class="click" data-href="#/entry/${r.id}"><td>${fdate(r.entry_date)} <span class="tiny muted">${ftime(r.created_at)}</span></td><td>${r.register_name}</td><td class="small">${entryTitle(r.register_key, r.data)}</td><td>${badge(r.status)}</td></tr>`)}</tbody></table></div>`);
  on('click', 'tr[data-href]', (tr) => go(tr.dataset.href));
});

// ---------------- Quick issue (photo-first / voice) ----------------
route('/quick-issue', async () => {
  page('Report issue', html`<div class="pagehead"><div><h1>Report an issue</h1><div class="small muted">Take a photo, say or type what's wrong, and submit. The admin gets it in the Maintenance register.</div></div></div>
    <form id="qi" class="card" style="display:flex;flex-direction:column;gap:14px;max-width:640px">
      <input type="hidden" name="photo"><div class="upl"><label class="btn lg pri">${icon('camera')} Take photo<input type="file" class="sr" accept="image/*" capture="environment" data-ph></label><span id="phPrev"></span></div>
      <div class="fld"><div style="display:flex;justify-content:space-between;align-items:center"><label for="qt">What's wrong?</label><button type="button" class="btn sm" data-mic>${icon('mic')} Speak</button></div>
        <textarea id="qt" name="text" placeholder="e.g. Projector in classroom 4 is not working and needs servicing"></textarea></div>
      <div id="parsed" class="callout info small hidden"></div>
      <div class="form"><div class="fld"><label for="qp">Priority</label><select id="qp" name="priority">${opts(['Low', 'Medium', 'High', 'Critical'], 'Medium')}</select></div></div>
      <button class="btn pri lg" type="submit">Submit issue</button></form>`);
  const form = document.getElementById('qi');
  let timer;
  const preview = async () => { const t = form.text.value.trim(); if (!t) return form.querySelector('#parsed').classList.add('hidden'); const p = await post('/quick-issue/parse', { text: t }); const el = form.querySelector('#parsed'); el.classList.remove('hidden'); el.innerHTML = html`Will be saved as — <b>Issue:</b> ${p.issue} · <b>Location:</b> ${p.location || '—'} · <b>Suggested priority:</b> ${p.priority}`.s; if (p.priority === 'High') form.priority.value = 'High'; };
  on('input', '#qt', () => { clearTimeout(timer); timer = setTimeout(preview, 500); });
  on('click', '#qi [data-mic]', (b) => voice(form.text, b));
  on('change', '#qi [data-ph]', async (i) => { const f = i.files[0]; if (!f) return; document.getElementById('phPrev').textContent = 'Uploading…'; const up = await uploadFile(f); form.photo.value = up.id; document.getElementById('phPrev').innerHTML = `<img src="/api/files/${up.id}" alt="Issue photo" style="height:72px;border-radius:6px">`; });
  on('submit', '#qi', async () => { const f = formData(form); const r = await post('/quick-issue', f); toast('Issue reported'); go('#/entry/' + r.id); });
});

// ---------------- Register builder ----------------
route('/register-builder', async () => {
  const list = await defs(true);
  page('Register Builder', html`<div class="pagehead"><div><h1>Register Builder</h1><div class="small muted">Create or change any register — fields, deadlines, who fills it — without a developer.</div></div><div class="actions"><a class="btn pri" href="#/register-builder/new">${icon('plus')} New register</a></div></div>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>Register</th><th>Department</th><th>Filled by</th><th>Frequency</th><th>Deadline</th><th>Fields</th><th>Status</th><th></th></tr></thead><tbody>
    ${list.map((d) => html`<tr><td><b>${d.name}</b>${d.builtin ? '' : html` ${badge('info', 'Custom')}`}${d.important ? html` ${badge('brand', 'Important')}` : ''}</td><td>${d.department || ''}</td><td>${state.roles[d.responsible_role] || d.responsible_role || ''}</td><td>${FREQ[d.frequency]}</td><td>${d.deadline || ''}</td><td class="num">${d.fields.length}</td><td>${badge(d.status === 'active' ? 'approved' : 'cancelled', d.status)}</td><td><a class="btn sm" href="#/register-builder/${d.id}">${icon('edit')} Edit</a></td></tr>`)}</tbody></table></div>`);
});

const TYPES = { text: 'Short text', textarea: 'Long text', number: 'Number', date: 'Date', time: 'Time', datetime: 'Date & time', select: 'Dropdown', multiselect: 'Multi-select', checkbox: 'Checkbox', yesno: 'Yes / No',
  currency: 'Currency ₹', phone: 'Phone', email: 'Email', file: 'File upload', image: 'Image / photo', signature: 'Signature', user: 'Person / user', vehicle: 'Vehicle', asset: 'Asset', item: 'Inventory item', checklist: 'Checklist' };

route('/register-builder/:id', async ({ id }) => {
  const d = id === 'new' ? { name: '', fields: [{ label: '', type: 'text', required: true }], frequency: 'daily', status: 'active' } : await api('/registers/' + id);
  let fields = d.fields.map((f) => ({ ...f, options: Array.isArray(f.options) ? f.options.join(', ') : f.options || '' }));
  const fieldRow = (f, i) => html`<div class="card tight" draggable="true" data-fi="${i}" style="display:grid;grid-template-columns:28px minmax(0,2fr) minmax(0,1.3fr) minmax(0,2fr) auto;gap:8px;align-items:end">
    <span title="Drag to reorder" style="cursor:grab;font-size:18px;color:var(--faint);align-self:center" aria-hidden="true">⋮⋮</span>
    <div class="fld"><label for="fl${i}">Field label</label><input id="fl${i}" type="text" data-k="label" value="${f.label}"></div>
    <div class="fld"><label for="ft${i}">Type</label><select id="ft${i}" data-k="type">${opts(Object.entries(TYPES).map(([k, v]) => ({ id: k, name: v })), f.type)}</select></div>
    <div class="fld" style="grid-column:2/4"><label for="fh${i}">Hinglish help (optional)</label><input id="fh${i}" type="text" data-k="hi" value="${f.hi || ''}" placeholder="e.g. Kaunsi jagah saaf ki"></div>
    <div class="fld ${['select', 'multiselect', 'checklist'].includes(f.type) ? '' : 'hidden'}" data-optw><label for="fo${i}">Options (comma separated)</label><input id="fo${i}" type="text" data-k="options" value="${f.options}"></div>
    <div style="display:flex;gap:4px;align-items:center;flex-wrap:wrap;${['select', 'multiselect', 'checklist'].includes(f.type) ? '' : 'grid-column:4/6'}">
      <label class="chk"><input type="checkbox" data-k="required" ${f.required ? raw('checked') : ''}> Required</label>
      <button type="button" class="btn sm" data-up="${i}" aria-label="Move up">↑</button><button type="button" class="btn sm" data-down="${i}" aria-label="Move down">↓</button><button type="button" class="btn sm danger" data-del="${i}" aria-label="Remove field">✕</button></div></div>`;
  page('Register Builder', html`<div class="pagehead"><div><div class="eyebrow">Register Builder</div><h1>${id === 'new' ? 'New register' : d.name}</h1></div></div>
    <form id="rb" class="card" style="display:flex;flex-direction:column;gap:16px" novalidate>
      <div class="form">
        <div class="fld"><label for="rn">Register name *</label><input id="rn" type="text" name="name" value="${d.name}"></div>
        <div class="fld"><label for="rdp">Department</label><input id="rdp" type="text" name="department" value="${d.department || ''}" list="dldep"><datalist id="dldep"><option value="Security"><option value="Reception"><option value="Facilities"><option value="Operations"><option value="Admin"><option value="Transport"><option value="Academics"></datalist></div>
        <div class="fld"><label for="rr">Responsible role</label><select id="rr" name="responsible_role">${opts(Object.entries(state.roles).map(([k, v]) => ({ id: k, name: v })), d.responsible_role, { blank: 'Anyone' })}</select></div>
        <div class="fld"><label for="rf">Frequency</label><select id="rf" name="frequency">${opts(Object.entries(FREQ).map(([k, v]) => ({ id: k, name: v })), d.frequency)}</select></div>
        <div class="fld"><label for="rdl">Submission deadline</label><input id="rdl" type="time" name="deadline" value="${d.deadline || ''}"><span class="help">Missing-register alert after this time (daily / per-shift only)</span></div>
        <div class="fld"><label for="rbr">Branch</label><select id="rbr" name="branch_id">${opts(state.lookups.branches, d.branch_id, { blank: 'All branches' })}</select></div>
        <div class="fld"><label for="rst">Status</label><select id="rst" name="status">${opts([{ id: 'active', name: 'Active' }, { id: 'inactive', name: 'Inactive' }], d.status)}</select></div>
        <label class="chk"><input type="checkbox" name="important" ${d.important ? raw('checked') : ''}> Important (needs review & verification)</label>
        <div class="fld full"><label for="rds">Description</label><input id="rds" type="text" name="description" value="${d.description || ''}"></div>
      </div>
      <div><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h2>Fields</h2><span class="tiny muted">Drag ⋮⋮ or use arrows to reorder</span></div><div id="flist" style="display:flex;flex-direction:column;gap:8px"></div>
        <button type="button" class="btn" data-addf style="margin-top:8px">${icon('plus')} Add field</button></div>
      ${d.builtin ? html`<div class="callout info small">This is a built-in register. Dashboards read some of its fields (for example visitor type, severity, status). You can add fields and rename labels freely; avoid deleting those core fields.</div>` : ''}
      <div style="display:flex;gap:8px;justify-content:flex-end"><a class="btn" href="#/register-builder">Cancel</a><button class="btn pri lg" type="submit">Save register</button></div></form>`);
  const box = document.getElementById('flist');
  const sync = () => { box.querySelectorAll('[data-fi]').forEach((row) => { const i = Number(row.dataset.fi); row.querySelectorAll('[data-k]').forEach((inp) => { fields[i][inp.dataset.k] = inp.type === 'checkbox' ? inp.checked : inp.value; }); }); };
  const draw = () => { box.innerHTML = html`${fields.map(fieldRow)}`.s; };
  draw();
  on('change', '#flist [data-k="type"]', () => { sync(); draw(); });
  on('click', '[data-addf]', () => { sync(); fields.push({ label: '', type: 'text', required: false, options: '' }); draw(); box.lastElementChild.querySelector('input').focus(); });
  on('click', '#flist [data-del]', (b) => { sync(); fields.splice(Number(b.dataset.del), 1); draw(); });
  on('click', '#flist [data-up]', (b) => { sync(); const i = Number(b.dataset.up); if (i > 0) { [fields[i - 1], fields[i]] = [fields[i], fields[i - 1]]; draw(); } });
  on('click', '#flist [data-down]', (b) => { sync(); const i = Number(b.dataset.down); if (i < fields.length - 1) { [fields[i + 1], fields[i]] = [fields[i], fields[i + 1]]; draw(); } });
  let dragFrom = null;
  box.addEventListener('dragstart', (e) => { const r = e.target.closest('[data-fi]'); if (r) { sync(); dragFrom = Number(r.dataset.fi); e.dataTransfer.effectAllowed = 'move'; } });
  box.addEventListener('dragover', (e) => { e.preventDefault(); });
  box.addEventListener('drop', (e) => { e.preventDefault(); const r = e.target.closest('[data-fi]'); if (r === null || dragFrom === null) return; const to = Number(r.dataset.fi); const [m] = fields.splice(dragFrom, 1); fields.splice(to, 0, m); dragFrom = null; draw(); });
  on('submit', '#rb', async (f) => {
    sync();
    const top = formData(f);
    const body = { ...top, important: !!top.important, branch_id: top.branch_id || null, fields: fields.map((x) => ({ ...x, options: x.options ? String(x.options).split(',').map((s) => s.trim()).filter(Boolean) : undefined })) };
    if (id === 'new') await post('/registers', body); else await put('/registers/' + id, body);
    await defs(true); toast('Register saved'); go('#/register-builder');
  });
});
