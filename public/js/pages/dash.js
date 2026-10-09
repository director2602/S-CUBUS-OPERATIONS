import { html, raw, api, post, route, page, state, can, chart, spark, PALETTE, moneyTick, inr, inrShort, fdate, fdateShort, fdt, pctTxt, badge, icon, on, go, toast, promptReason, opts, todayStr, addDays, parseHash } from '../core.js';

const LV = { critical: ['crit', 'Critical'], high: ['high', 'High'], pending: ['pend', 'Pending'], normal: ['ok', 'Normal'] };
const SEVC = { critical: '#A61B1B', high: '#C2541B', pending: '#E0A526', normal: '#3F7D57' };

function branchPicker(query) {
  if (!can.allBranches()) return '';
  return html`<label class="sr" for="bpick">Branch</label><select id="bpick" style="width:auto;height:40px" data-bpick>${opts([{ id: 'all', name: 'All branches' }, ...state.lookups.branches], query.branch_id || 'all')}</select>`;
}
function bindBranchPicker(base) {
  on('change', '[data-bpick]', (el) => { const q = new URLSearchParams(parseHash().query); if (el.value === 'all') q.delete('branch_id'); else q.set('branch_id', el.value); go(`#${base}?${q}`); });
}
const bq = (query) => (query.branch_id ? `branch_id=${query.branch_id}` : '');

function insightsBlock(ins, title = 'Management summary') {
  return html`<div class="card ins"><div class="card-h"><h2>${title}</h2><span class="tiny muted">Generated from register, finance and inventory records</span></div>
    <div class="grid g4">
      <div><div class="eyebrow" style="margin-bottom:6px">What happened</div>${ins.happened.map((t) => html`<p>${t}</p>`)}</div>
      <div><div class="eyebrow" style="margin-bottom:6px">What changed</div>${ins.changed.length ? html`<ul>${ins.changed.map((t) => html`<li>${t}</li>`)}</ul>` : html`<p class="muted">No significant changes.</p>`}</div>
      <div><div class="eyebrow" style="margin-bottom:6px">What looks unusual</div>${ins.unusual.length ? html`<ul>${ins.unusual.map((t) => html`<li>${t}</li>`)}</ul>` : html`<p class="muted">Nothing unusual detected.</p>`}</div>
      <div><div class="eyebrow" style="margin-bottom:6px">What management should do</div>${ins.actions.length ? html`<ol>${ins.actions.map((t) => html`<li>${t}</li>`)}</ol>` : html`<p class="muted">No actions pending.</p>`}</div>
    </div></div>`;
}

function attentionCard(att) {
  const counts = { critical: 0, high: 0, pending: 0, normal: 0 };
  att.forEach((a) => { counts[a.level] = (counts[a.level] || 0) + 1; });
  const total = att.length || 1;
  return html`<div class="card"><div class="card-h"><h2>Attention required</h2><span class="small muted">${att.length} item${att.length === 1 ? '' : 's'}</span></div>
    <div class="sevbar" aria-hidden="true">${Object.keys(counts).map((k) => html`<div style="width:${(counts[k] / total) * 100}%;background:${SEVC[k]}"></div>`)}</div>
    <div class="legend" style="margin:10px 0">${Object.keys(counts).map((k) => html`<span><i style="background:${SEVC[k]}"></i>${LV[k][1]} <b class="num">${counts[k]}</b></span>`)}</div>
    ${counts.critical ? '' : html`<div class="callout ok small" style="margin-bottom:6px">No critical items. Critical incidents appear here first.</div>`}
    <ul class="att">${att.sort((a, b) => Object.keys(LV).indexOf(a.level) - Object.keys(LV).indexOf(b.level)).slice(0, 12).map((a) => html`<li>${badge(LV[a.level][0] === 'ok' ? 'done' : LV[a.level][0] === 'crit' ? 'Critical' : LV[a.level][0] === 'high' ? 'High' : 'pending', LV[a.level][1])}<span class="t small">${a.text}</span><a class="small" href="${a.link}" style="font-weight:600">Open</a></li>`)}</ul>
  </div>`;
}

// ---------------- Control Centre ----------------
route('/control', (p, q) => controlCentre(q));
export async function controlCentre(query) {
  const d = await api('/dashboard/control?' + bq(query));
  const t = d.today; const y = d.yesterday; const n = d.now; const s = d.series;
  const dlt = (a, b) => { const x = a - b; return x === 0 ? 'same as yesterday' : `${x > 0 ? '+' : ''}${x} vs yesterday`; };
  const tiles = [
    ['Visitors', t.visitors, `${n.visitors_on_site} on site · ${dlt(t.visitors, y.visitors)}`, s.map((x) => x.visitors), '#/registers/visitor'],
    ['Expenses recorded', inr(t.expenses), `MTD ${inr(d.mtd.expenses)}`, s.map((x) => x.expenses), '#/purchases'],
    ['Tasks completed', t.tasks_completed, `${n.tasks_pending} pending · ${n.tasks_overdue} overdue`, s.map((x) => x.tasks_done), '#/tasks', n.tasks_overdue > 0],
    ['Inventory issued', t.inventory_issued, `${n.low_stock} low-stock alerts`, s.map((x) => x.issued), '#/inventory', n.low_stock > 0],
    ['Deliveries · couriers', `${t.deliveries} · ${t.couriers}`, `${t.inventory_received} units received`, s.map((x) => x.deliveries + x.couriers), '#/registers/delivery'],
    ['Invoices added', t.invoices, `${n.approvals_pending} awaiting approval`, s.map((x) => x.invoices), '#/approvals', n.approvals_pending > 0],
    ['Incidents', t.incidents, `${n.incidents_critical_open} critical open · ${n.incidents_open} open`, s.map((x) => x.incidents), '#/registers/incident', n.incidents_critical_open > 0],
    ['Maintenance', `${t.maintenance} new`, `${t.maintenance_closed} closed · ${n.maintenance_open} open overall`, s.map((x) => x.maintenance), '#/registers/maintenance', n.maintenance_open > 5]
  ];
  const vt = d.visTypes;
  const days = s.map((x) => fdateShort(x.d));
  page('Control Centre', html`
    <div class="pagehead"><div><div class="eyebrow">${fdate(d.date)} · ${query.branch_id ? state.lookups.branches.find((b) => String(b.id) === query.branch_id)?.name : (can.allBranches() ? 'All branches' : state.me.branch_name)}</div><h1>${state.me.role === 'manager' ? 'Branch Dashboard' : 'Management Control Centre'}</h1></div>
      <div class="actions">${branchPicker(query)}<a class="btn" href="#/digest">${icon('star')} Daily Digest</a><a class="btn pri" href="#/purchase/new">${icon('plus')} New purchase</a></div></div>
    ${n.incidents_critical_open ? html`<div class="callout crit"><b>${n.incidents_critical_open} critical incident(s) open.</b> <a href="#/registers/incident">Review now</a></div>` : ''}
    <section aria-label="Today"><div class="eyebrow" style="margin-bottom:8px">Today</div><div class="kpis">${tiles.map(([l, v, nn, sp, href, warn], i) => html`<a class="kpi" href="${href}"><span class="l">${l}</span><span class="v">${v}</span><span class="n ${warn ? 'warn' : ''}">${nn}</span><div style="height:34px"><canvas id="sp${i}" aria-hidden="true"></canvas></div></a>`)}</div></section>
    <div class="grid g2">
      ${attentionCard(d.insights.attention)}
      <div class="card"><div class="card-h"><div><h2>Visitors — last 7 days</h2><div class="small muted">Visitor Register check-ins vs the previous 7 days</div></div>
        <div style="display:flex;gap:18px"><div><div class="num" style="font-size:20px;font-weight:600">${s.reduce((a, x) => a + x.visitors, 0)}</div><div class="tiny muted">This week</div></div><div><div class="num muted" style="font-size:20px;font-weight:600">${d.prevSeries.reduce((a, x) => a + x.visitors, 0)}</div><div class="tiny muted">Previous</div></div></div></div>
        <div class="chart-box"><canvas id="cVis" role="img" aria-label="Visitors per day"></canvas></div>
        <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1fr);margin-top:12px;align-items:center">
          <div class="chart-box sm"><canvas id="cVt" role="img" aria-label="Visitors by type"></canvas></div>
          <div class="kv"><dt>On site now</dt><dd class="num">${n.visitors_on_site}</dd><dt>Avg. visit</dt><dd class="num">${d.avgVisit !== null ? d.avgVisit + ' min' : '—'}</dd><dt>Parents (7d)</dt><dd class="num">${vt.parent}</dd><dt>Students (7d)</dt><dd class="num">${vt.student}</dd><dt>Others (7d)</dt><dd class="num">${vt.other}</dd></div>
        </div>
      </div>
    </div>
    <section><div class="eyebrow" style="margin-bottom:8px">Financial</div>
    <div class="grid g2">
      <div class="card"><div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));margin-bottom:12px">
        <div><div class="tiny muted">Today</div><div class="num" style="font-size:20px;font-weight:600">${inr(t.expenses)}</div></div>
        <div><div class="tiny muted">Month to date</div><div class="num" style="font-size:20px;font-weight:600">${inr(d.mtd.expenses)}</div></div>
        <a href="#/approvals" style="text-decoration:none;color:inherit"><div class="tiny muted">Awaiting approval</div><div class="num" style="font-size:20px;font-weight:600">${n.approvals_pending} · ${inrShort(n.approvals_amount)}</div></a>
        <a href="#/purchases?payment_status=unpaid" style="text-decoration:none;color:inherit"><div class="tiny muted">Unpaid to vendors</div><div class="num" style="font-size:20px;font-weight:600">${inrShort(n.payables)}</div></a></div>
        <h3 style="margin-bottom:8px">Daily expenses this month</h3><div class="chart-box"><canvas id="cExp" role="img" aria-label="Daily expenses"></canvas></div></div>
      <div class="card"><div class="card-h"><h2>Where the money went — month to date</h2></div>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(220px,1fr))"><div class="chart-box"><canvas id="cCat" role="img" aria-label="Expenses by category"></canvas></div>
        <div><h3 style="margin-bottom:6px">By payment mode</h3><div class="chart-box sm"><canvas id="cMode" role="img" aria-label="Expenses by payment mode"></canvas></div></div></div></div>
    </div></section>
    <div class="grid g3">
      <div class="card"><div class="card-h"><h2>Petty cash balance</h2><a class="small" href="#/petty-cash">Petty cash book</a></div>
        ${d.petty.map((p) => html`<div class="hbar"><span>${p.name}</span><div class="tr"><div style="width:${Math.min(100, p.balance / Math.max(...d.petty.map((x) => x.balance), 1) * 100)}%;background:${p.balance < 3000 ? 'var(--high)' : 'var(--teal)'}"></div></div><span class="num" style="font-weight:600">${inr(p.balance)}</span></div>`)}</div>
      <div class="card"><div class="card-h"><h2>Payments due</h2><a class="small" href="#/purchases?payment_status=unpaid">All unpaid</a></div>
        ${d.dueSoon.length ? html`<ul class="att">${d.dueSoon.map((x) => html`<li><span class="t small"><a href="#/purchase/${x.id}">${x.vendor}</a><br><span class="muted tiny">${x.purchase_no}${x.due_date ? ' · due ' + fdate(x.due_date) : ''}</span></span><b class="num small">${inr(x.due)}</b></li>`)}</ul>` : html`<div class="empty">Nothing due.</div>`}</div>
      <div class="card"><div class="card-h"><h2>Recent purchases</h2><a class="small" href="#/purchases">All</a></div>
        <ul class="att">${d.recentPurchases.map((x) => html`<li><span class="t small"><a href="#/purchase/${x.id}">${x.vendor || x.purchase_no}</a><br><span class="muted tiny">${fdate(x.date)} · ${x.payment_mode.replace('_', ' ')}</span></span>${badge(x.status)}<b class="num small">${inr(x.total)}</b></li>`)}</ul></div>
    </div>
    <section><div class="eyebrow" style="margin-bottom:8px">Inventory & facilities</div>
    <div class="grid g3">
      <div class="card"><div class="card-h"><h2>Low stock</h2><span class="small" style="color:var(--high);font-weight:600">${d.lowStock.length} alert${d.lowStock.length === 1 ? '' : 's'}</span></div>
        ${d.lowStock.length ? d.lowStock.map((x) => html`<div class="hbar"><span title="${x.name}">${x.name}<br><span class="tiny muted">${x.branch}</span></span><div class="tr"><div style="width:${Math.min(100, x.qty / x.min_stock * 80)}%;background:var(--high)"></div><span class="mk" style="left:80%"></span></div><span class="num small">${x.qty}/${x.min_stock}</span></div>`) : html`<div class="empty">All items above minimum.</div>`}
        <div class="tiny muted" style="margin-top:6px">Black tick = minimum stock level</div>
        ${d.highUse.length ? html`<div class="callout pend small" style="margin-top:10px">High consumption today: ${d.highUse.map((h) => `${h.name} (${h.today} vs avg ${h.avg30}/day)`).join(', ')}</div>` : ''}</div>
      <div class="card"><div class="card-h"><h2>Inventory issued — 7 days</h2><a class="small" href="#/inventory">Inventory</a></div><div class="chart-box"><canvas id="cIss" role="img" aria-label="Inventory issued per day"></canvas></div>
        <h3 style="margin:12px 0 6px">Recent distribution</h3><ul class="att">${d.recentIssues.slice(0, 4).map((x) => html`<li class="small"><span class="t">${x.item} × ${x.qty} ${x.unit}${x.issued_to ? ' → ' + x.issued_to : ''}</span><span class="tiny muted">${fdt(x.created_at)}</span></li>`)}</ul></div>
      <div class="card"><div class="card-h"><h2>Open maintenance by age</h2><span class="num small muted">${n.maintenance_open} open</span></div>
        <div class="chart-box sm"><canvas id="cAge" role="img" aria-label="Open maintenance by age"></canvas></div>
        <div class="eyebrow" style="margin:12px 0 6px">Repeated issues (30 days)</div>${d.insights.unusual.filter((u) => u.includes('maintenance reports')).map((u) => html`<div class="small" style="padding:3px 0">${u.split('. ')[0]}</div>`)}</div>
    </div></section>
    <div class="grid g2">
      <div class="card"><div class="card-h"><h2>Compliance — expiring in 60 days</h2><a class="small" href="#/documents">Document Centre</a></div>
        ${d.expiring.length ? d.expiring.map((e) => html`<div class="hbar" style="grid-template-columns:minmax(120px,1.4fr) minmax(0,2fr) 70px"><span>${e.title}<br><span class="tiny muted">${e.doc_type}${e.branch ? ' · ' + e.branch : ''}</span></span><div class="tr"><div style="width:${Math.max(3, Math.min(100, e.days_left / 60 * 100))}%;background:${e.days_left < 0 ? 'var(--crit)' : e.days_left <= 30 ? 'var(--high)' : 'var(--navy)'}"></div></div><span class="num small" style="text-align:right;font-weight:600;color:${e.days_left <= 30 ? 'var(--high)' : 'inherit'}">${e.days_left < 0 ? 'expired' : e.days_left + ' d'}</span></div>`) : html`<div class="empty">Nothing expiring.</div>`}</div>
      <div class="card"><div class="card-h"><h2>People & tasks</h2><a class="small" href="#/tasks">Tasks</a></div>
        <div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.3fr);align-items:center"><div class="chart-box sm"><canvas id="cTask" role="img" aria-label="Task status"></canvas></div>
        <div class="kv"><dt>Completed today</dt><dd class="num">${t.tasks_completed}</dd><dt>Pending</dt><dd class="num">${n.tasks_pending}</dd><dt>Overdue</dt><dd class="num" style="color:var(--high)">${n.tasks_overdue}</dd><dt>Registers to review</dt><dd class="num">${n.reviews_pending}</dd><dt>Keys issued now</dt><dd class="num">${n.keys_issued}</dd></div></div>
        <h3 style="margin:12px 0 6px">Branch activity this month</h3><div class="chart-box sm"><canvas id="cBr" role="img" aria-label="Branch activity"></canvas></div></div>
    </div>
    ${insightsBlock(d.insights)}
  `);
  on('change', '[data-bpick]', () => {});
  bindBranchPicker('/');
  tiles.forEach((x, i) => spark('sp' + i, x[3]));
  chart('cVis', { type: 'line', data: { labels: days, datasets: [
    { label: 'This week', data: s.map((x) => x.visitors), borderColor: PALETTE[0], backgroundColor: PALETTE[0] + '22', fill: true, tension: 0.3, borderWidth: 3 },
    { label: 'Previous week', data: d.prevSeries.map((x) => x.visitors), borderColor: '#B79AC2', borderDash: [6, 5], tension: 0.3, borderWidth: 2, pointRadius: 0 }] },
  options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } } });
  chart('cVt', { type: 'doughnut', data: { labels: ['Parents', 'Students', 'Others'], datasets: [{ data: [vt.parent, vt.student, vt.other], backgroundColor: [PALETTE[0], PALETTE[2], PALETTE[4]], borderWidth: 0 }] }, options: { cutout: '62%', plugins: { legend: { position: 'bottom' } } } });
  chart('cExp', { type: 'bar', data: { labels: d.expDays.map((x) => fdateShort(x.d)), datasets: [{ label: 'Expenses', data: d.expDays.map((x) => x.expenses), backgroundColor: d.expDays.map((x, i) => (i === d.expDays.length - 1 ? PALETTE[1] : PALETTE[0])), borderRadius: 3 }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => inr(c.raw) } } }, scales: { y: { beginAtZero: true, ticks: moneyTick } } } });
  chart('cCat', { type: 'doughnut', data: { labels: d.byCat.map((x) => x.label), datasets: [{ data: d.byCat.map((x) => x.value), backgroundColor: PALETTE, borderWidth: 0 }] },
    options: { cutout: '58%', plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } }, tooltip: { callbacks: { label: (c) => `${c.label}: ${inr(c.raw)}` } } } } });
  chart('cMode', { type: 'bar', data: { labels: d.byMode.map((x) => x.label.replace(/ \(.*\)/, '')), datasets: [{ data: d.byMode.map((x) => x.value), backgroundColor: PALETTE[2], borderRadius: 3 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => inr(c.raw) } } }, scales: { x: { beginAtZero: true, ticks: moneyTick } } } });
  chart('cIss', { type: 'bar', data: { labels: days, datasets: [{ label: 'Units issued', data: s.map((x) => x.issued), backgroundColor: PALETTE[2], borderRadius: 3 }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } } });
  chart('cAge', { type: 'bar', data: { labels: ['0–2 days', '3–7 days', '8+ days'], datasets: [{ data: [d.maintAge.a, d.maintAge.b, d.maintAge.c], backgroundColor: [PALETTE[5], '#E0A526', PALETTE[1]], borderRadius: 3 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } } });
  chart('cTask', { type: 'doughnut', data: { labels: ['Done today', 'Pending', 'Overdue'], datasets: [{ data: [t.tasks_completed, Math.max(0, n.tasks_pending - n.tasks_overdue), n.tasks_overdue], backgroundColor: [PALETTE[0], '#D9CCE0', PALETTE[1]], borderWidth: 0 }] }, options: { cutout: '64%', plugins: { legend: { position: 'bottom' } } } });
  chart('cBr', { type: 'bar', data: { labels: d.branchAct.map((b) => b.name), datasets: [{ label: 'Tasks done', data: d.branchAct.map((b) => b.tasks), backgroundColor: PALETTE[0], borderRadius: 3 }, { label: 'Register entries ÷10', data: d.branchAct.map((b) => Math.round(b.entries / 10)), backgroundColor: '#B79AC2', borderRadius: 3 }] },
    options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } } });
}

// ---------------- Registers Control Centre ----------------
route('/registers-centre', async (p, query) => {
  const d = await api('/dashboard/registers?' + bq(query));
  const k = d.kpis;
  const sym = { s: '✓', l: 'L', m: '!', p: '', n: '·', e: '' };
  page('Registers Centre', html`
    <div class="pagehead"><div><div class="eyebrow">Last 7 days</div><h1>Registers Control Centre</h1></div>
      <div class="actions">${branchPicker(query)}<a class="btn" href="#/review">${icon('check')} Review queue</a>${can.mgmt() ? html`<a class="btn pri" href="#/register-builder/new">${icon('plus')} New register</a>` : ''}</div></div>
    <div class="kpis">
      <div class="kpi"><span class="l">Scheduled registers</span><span class="v">${k.due}</span><span class="n">Daily / per shift</span></div>
      <div class="kpi"><span class="l">Submitted today</span><span class="v" style="color:var(--ok)">${k.submitted}</span><span class="n">${k.due_later} due later today</span></div>
      <a class="kpi" href="#/review"><span class="l">Pending review</span><span class="v" style="color:var(--high)">${k.pending_review}</span><span class="n">Submitted, not yet reviewed</span></a>
      <div class="kpi"><span class="l">Missing (3 days)</span><span class="v" style="color:var(--crit)">${k.missing}</span><span class="n">Alerts raised once each</span></div>
      <div class="kpi"><span class="l">Entries today</span><span class="v">${k.entries_today}</span><span class="n">All registers</span></div>
    </div>
    <div class="grid g2">
      <div class="card"><div class="card-h"><div><h2>On-time submission rate — 14 days</h2><div class="small muted">Scheduled registers submitted before their deadline · target 95%</div></div></div><div class="chart-box"><canvas id="cRate" role="img" aria-label="On-time rate"></canvas></div></div>
      <div class="card"><div class="card-h"><h2>Entries by register — today</h2></div><div class="chart-box lg"><canvas id="cEnt" role="img" aria-label="Entries by register"></canvas></div></div>
    </div>
    <div class="legend"><span><i style="background:var(--ok)"></i>Submitted</span><span><i style="background:#F2C66B"></i>Late</span><span><i style="background:var(--crit)"></i>Missing</span><span><i style="border:1px dashed #8A867C"></i>Due later today</span><span><i style="background:#D9CCE0"></i>Entries (event registers)</span></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(250px,1fr))">${d.registers.map((r) => html`<a class="card tight" href="#/registers/${r.key}" style="text-decoration:none;color:inherit;display:flex;flex-direction:column;gap:10px">
      <div style="display:flex;justify-content:space-between;gap:8px"><b>${r.name}</b><span class="tiny muted">${r.frequency.replace('_', ' ')}${r.deadline ? ' · by ' + r.deadline : ''}</span></div>
      <div class="grid" style="grid-template-columns:1fr 1fr"><div><div class="num" style="font-size:22px;font-weight:600">${r.today}</div><div class="tiny muted">Entries today</div></div><div><div class="num" style="font-size:22px;font-weight:600;color:${r.pending_review ? 'var(--high)' : 'inherit'}">${r.pending_review}</div><div class="tiny muted">Pending review</div></div></div>
      <div class="strip">${r.strip.map((x) => html`<span class="st-${x.status}" title="${fdate(x.date)}: ${x.count} entries">${x.status === 'e' ? x.count : sym[x.status]}</span>`)}</div>
      <div class="strip tiny muted">${d.dates.map((x) => html`<span style="height:auto">${fdateShort(x).split(' ')[0]}</span>`)}</div>
      <div class="tiny muted" style="border-top:1px solid var(--line-2);padding-top:8px">${r.last_submission ? 'Last entry ' + fdt(r.last_submission) : 'No entries yet'}</div></a>`)}</div>
    <div class="grid g2">
      <div class="card"><div class="card-h"><h2>Verification queue</h2><a class="small" href="#/review">Open full queue</a></div>
        ${d.queue.length ? html`<ul class="att">${d.queue.slice(0, 10).map((x) => html`<li><span class="t"><a href="#/entry/${x.id}" style="font-weight:600">${x.register_name} — ${fdateShort(x.entry_date)}</a><br><span class="tiny muted">${x.branch} · ${x.created_by_name} · ${fdt(x.created_at)}</span></span>${badge(x.status)}
          <button class="btn sm" data-ret="${x.id}">↩ Return</button><button class="btn sm ok" data-ver="${x.id}">✓ Verify</button></li>`)}</ul>` : html`<div class="empty">Nothing waiting for review.</div>`}</div>
      <div class="card"><div class="card-h"><h2>Missing register alerts</h2></div>
        ${d.missing.length ? d.missing.map((m) => html`<div class="callout crit" style="margin-bottom:8px"><b>${m.register} for ${m.branch} has not been submitted.</b><div class="tiny">For ${fdate(m.date)}${m.deadline ? ' · deadline ' + m.deadline : ''}</div></div>`) : html`<div class="callout ok">All scheduled registers are in.</div>`}
        ${can.mgmt() ? html`<div class="tiny muted" style="margin-top:8px">Deadlines are set per register in the <a href="#/register-builder">Register Builder</a>.</div>` : ''}</div>
    </div>`);
  bindBranchPicker('/registers-centre');
  chart('cRate', { type: 'bar', data: { labels: d.rate.map((x) => fdateShort(x.date)), datasets: [
    { type: 'line', label: 'Target 95%', data: d.rate.map(() => 95), borderColor: '#17151A', borderDash: [5, 4], pointRadius: 0, borderWidth: 1.5 },
    { label: 'On time %', data: d.rate.map((x) => x.rate), backgroundColor: d.rate.map((x) => (x.rate === null ? '#ddd' : x.rate >= 95 ? PALETTE[0] : '#E0A526')), borderRadius: 3 }] },
  options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } } } } });
  const ent = d.registers.filter((r) => r.today > 0).sort((a, b) => b.today - a.today);
  chart('cEnt', { type: 'bar', data: { labels: ent.map((r) => r.name.replace(' Register', '')), datasets: [{ data: ent.map((r) => r.today), backgroundColor: PALETTE[0], borderRadius: 3 }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } } } } });
  on('click', '[data-ver]', async (b) => { await post(`/entries/${b.dataset.ver}/status`, { status: 'verified' }); toast('Verified'); go(location.hash); });
  on('click', '[data-ret]', async (b) => { const note = await promptReason('Return for correction', 'What needs correcting?'); if (note === null) return; await post(`/entries/${b.dataset.ret}/status`, { status: 'returned', note }); toast('Returned to staff'); go(location.hash); });
});

// ---------------- Weekly & Monthly summary ----------------
route('/summary', async (p, query) => {
  const period = query.period === 'month' ? 'month' : 'week';
  const offset = Number(query.offset) || 0;
  const d = await api(`/dashboard/summary?period=${period}&offset=${offset}&${bq(query)}`);
  const c = d.current; const pv = d.previous; const rg = d.range;
  const bad = ['expenses', 'maintenance', 'incidents', 'cleaning_issues', 'inventory_lost', 'inventory_damaged'];
  const link = (o, per = period) => { const q = new URLSearchParams(query); q.set('period', per); q.set('offset', o); return '#/summary?' + q; };
  page('Summary', html`
    <div class="pagehead"><div><div class="eyebrow">${fdate(rg.from)} – ${fdate(rg.to)} vs ${fdate(rg.pfrom)} – ${fdate(rg.pto)}</div><h1>${period === 'week' ? 'Weekly Management Summary' : 'Monthly Operations Summary'}</h1></div>
      <div class="actions"><div class="seg" role="group" aria-label="Period"><a class="btn sm ${period === 'week' ? 'pri' : ''}" href="${link(0, 'week')}">Weekly</a><a class="btn sm ${period === 'month' ? 'pri' : ''}" href="${link(0, 'month')}">Monthly</a></div>
        <a class="btn sm" href="${link(offset + 1)}">← Previous</a>${offset > 0 ? html`<a class="btn sm" href="${link(offset - 1)}">Next →</a>` : ''}${branchPicker(query)}<button class="btn sm" data-print>${icon('print')} Print / PDF</button></div></div>
    ${insightsBlock(d.insights, period === 'week' ? 'Weekly summary' : 'Executive summary')}
    <div class="grid g2">
      <div class="card"><div class="card-h"><h2>This ${period} vs previous</h2></div>
        <div class="tbl-wrap" style="border:0"><table class="tbl"><thead><tr><th>Metric</th><th class="r">This ${period}</th><th class="r">Previous</th><th class="r">Change</th></tr></thead><tbody>
        ${d.changes.concat([
    { key: 'overdue', label: 'Overdue tasks (now)', current: d.now.tasks_overdue, previous: null, change: null },
    { key: 'open', label: 'Open maintenance (now)', current: d.now.maintenance_open, previous: null, change: null },
    { key: 'low', label: 'Low-stock items (now)', current: d.now.low_stock, previous: null, change: null },
    { key: 'docs', label: 'Licences / documents expiring ≤30 days', current: d.now.docs_expiring_30, previous: null, change: null }
  ]).map((x) => html`<tr><td>${x.label}</td><td class="r num">${x.key === 'expenses' ? inr(x.current) : x.current}</td><td class="r num muted">${x.previous === null ? '' : x.key === 'expenses' ? inr(x.previous) : x.previous}</td>
          <td class="r">${x.previous === null ? '' : html`<span class="bd ${x.change > 0 && bad.includes(x.key) ? 'high' : x.change < 0 && !bad.includes(x.key) ? 'pend' : 'info'}">${pctTxt(x.change)}</span>`}</td></tr>`)}
        </tbody></table></div></div>
      <div class="card"><div class="card-h"><h2>Comparison chart</h2><span class="tiny muted">Each metric scaled to its own maximum</span></div><div class="chart-box lg" style="height:420px"><canvas id="cCmp" role="img" aria-label="This period versus previous"></canvas></div></div>
    </div>
    <div class="grid g2">
      <div class="card"><div class="card-h"><h2>Daily activity</h2></div><div class="chart-box"><canvas id="cDaily" role="img" aria-label="Daily activity"></canvas></div></div>
      <div class="card"><div class="card-h"><h2>Open operational issues</h2><span class="small muted">Open maintenance at day end</span></div><div class="chart-box"><canvas id="cOpen" role="img" aria-label="Open issues"></canvas></div></div>
    </div>
    <div class="grid g3">
      <div class="card"><div class="card-h"><h2>Incidents by severity</h2></div><div class="chart-box sm"><canvas id="cSev" role="img" aria-label="Incident severity"></canvas></div></div>
      <div class="card"><div class="card-h"><h2>Maintenance by priority</h2></div><div class="chart-box sm"><canvas id="cPri" role="img" aria-label="Maintenance priority"></canvas></div></div>
      <div class="card"><div class="card-h"><h2>Spend by payment mode</h2></div><div class="chart-box sm"><canvas id="cPm" role="img" aria-label="Spend by payment mode"></canvas></div></div>
    </div>
    <div class="grid g2">
      <div class="card"><div class="card-h"><h2>Monthly expenses — 6 months</h2><span class="tiny muted">Current month is month-to-date</span></div><div class="chart-box"><canvas id="cMon" role="img" aria-label="Monthly expenses"></canvas></div></div>
      <div class="card"><div class="card-h"><h2>Task on-time completion rate</h2></div><div class="chart-box"><canvas id="cTr" role="img" aria-label="Task completion rate"></canvas></div></div>
    </div>
    <div class="grid g3">
      <div class="card"><h2 style="margin-bottom:10px">Inventory</h2><dl class="kv"><dt>Received / purchased</dt><dd class="num">${c.inventory_received}</dd><dt>Issued</dt><dd class="num">${c.inventory_issued}</dd><dt>Returned</dt><dd class="num">${c.inventory_returned}</dd><dt>Lost</dt><dd class="num">${c.inventory_lost}</dd><dt>Damaged</dt><dd class="num">${c.inventory_damaged}</dd><dt>Closing stock (units)</dt><dd class="num">${d.closingStock}</dd><dt>Low-stock items</dt><dd class="num">${d.now.low_stock}</dd></dl></div>
      <div class="card"><h2 style="margin-bottom:10px">Procurement & finance</h2><dl class="kv"><dt>Purchase requests</dt><dd class="num">${c.purchase_requests}</dd><dt>Approved</dt><dd class="num">${c.purchases}</dd><dt>Rejected</dt><dd class="num">${c.purchases_rejected}</dd><dt>Pending approval</dt><dd class="num">${c.pending_approval}</dd><dt>Invoices</dt><dd class="num">${c.invoices}</dd><dt>Expenses</dt><dd class="num">${inr(c.expenses)}</dd><dt>From petty cash</dt><dd class="num">${inr(c.petty_spent)}</dd><dt>Outstanding to vendors</dt><dd class="num">${inr(d.now.payables)}</dd></dl></div>
      <div class="card"><h2 style="margin-bottom:10px">Security, people & compliance</h2><dl class="kv"><dt>Visitors</dt><dd class="num">${c.visitors} <span class="tiny muted">(${c.v_parent} P · ${c.v_student} S · ${c.v_other} O)</span></dd><dt>Deliveries</dt><dd class="num">${c.deliveries}</dd><dt>Vehicle km</dt><dd class="num">${c.vehicle_km}${c.fuel_litres ? ` · ${(c.vehicle_km / c.fuel_litres).toFixed(1)} km/L` : ''}</dd><dt>Incidents</dt><dd class="num">${c.incidents}</dd><dt>Tasks completed</dt><dd class="num">${c.tasks_completed}</dd><dt>Overdue now</dt><dd class="num">${d.now.tasks_overdue}</dd><dt>Documents uploaded</dt><dd class="num">${c.documents_uploaded}</dd><dt>Renewals ≤60 days</dt><dd class="num">${d.docs.length}</dd></dl></div>
    </div>`);
  bindBranchPicker('/summary');
  on('click', '[data-print]', () => window.print());
  const keys = ['visitors', 'deliveries', 'couriers', 'inventory_issued', 'expenses', 'invoices', 'maintenance', 'incidents', 'tasks_completed'];
  const lab = Object.fromEntries(d.changes.map((x) => [x.key, x.label]));
  chart('cCmp', { type: 'bar', data: { labels: keys.map((k) => lab[k]), datasets: [
    { label: 'This ' + period, data: keys.map((k) => (Math.max(c[k], pv[k]) ? c[k] / Math.max(c[k], pv[k]) * 100 : 0)), raw: keys.map((k) => c[k]), backgroundColor: PALETTE[0], borderRadius: 3 },
    { label: 'Previous', data: keys.map((k) => (Math.max(c[k], pv[k]) ? pv[k] / Math.max(c[k], pv[k]) * 100 : 0)), raw: keys.map((k) => pv[k]), backgroundColor: '#C9B3D1', borderRadius: 3 }] },
  options: { indexAxis: 'y', plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (x) => { const v = x.dataset.raw[x.dataIndex]; return `${x.dataset.label}: ${keys[x.dataIndex] === 'expenses' ? inr(v) : v}`; } } } }, scales: { x: { display: false, max: 100 } } } });
  const lbl = d.series.map((x) => fdateShort(x.d));
  chart('cDaily', { type: 'line', data: { labels: lbl, datasets: [
    { label: 'Visitors', data: d.series.map((x) => x.visitors), borderColor: PALETTE[0], tension: 0.3 },
    { label: 'Deliveries', data: d.series.map((x) => x.deliveries), borderColor: PALETTE[1], tension: 0.3 },
    { label: 'Couriers', data: d.series.map((x) => x.couriers), borderColor: PALETTE[2], tension: 0.3 },
    { label: 'Tasks done', data: d.series.map((x) => x.tasks_done), borderColor: PALETTE[5], tension: 0.3, borderDash: [4, 3] }] },
  options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } } });
  chart('cOpen', { type: 'line', data: { labels: lbl, datasets: [{ label: 'Open issues', data: d.series.map((x) => x.open_issues), borderColor: PALETTE[1], backgroundColor: PALETTE[1] + '22', fill: true, tension: 0.3, borderWidth: 3 },
    { type: 'bar', label: 'Reported', data: d.series.map((x) => x.maintenance), backgroundColor: '#C9B3D1', borderRadius: 2 }] }, options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
  const sevOrder = ['Low', 'Medium', 'High', 'Critical'];
  chart('cSev', { type: 'doughnut', data: { labels: sevOrder, datasets: [{ data: sevOrder.map((s) => (d.severity.find((x) => x.label === s) || {}).value || 0), backgroundColor: ['#B79AC2', PALETTE[5], PALETTE[1], '#A61B1B'], borderWidth: 0 }] }, options: { cutout: '60%', plugins: { legend: { position: 'bottom' } } } });
  chart('cPri', { type: 'bar', data: { labels: d.maintPriority.map((x) => x.label), datasets: [{ data: d.maintPriority.map((x) => x.value), backgroundColor: PALETTE[0], borderRadius: 3 }] }, options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } } });
  chart('cPm', { type: 'doughnut', data: { labels: d.byMode.map((x) => x.label.replace(/ \(.*\)/, '')), datasets: [{ data: d.byMode.map((x) => x.value), backgroundColor: PALETTE, borderWidth: 0 }] }, options: { cutout: '58%', plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } }, tooltip: { callbacks: { label: (x) => `${x.label}: ${inr(x.raw)}` } } } } });
  const mlab = (m) => { const [yy, mm] = m.split('-'); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(mm) - 1] + ' ' + yy.slice(2); };
  chart('cMon', { type: 'bar', data: { labels: d.months.map((m) => mlab(m.month) + (m.partial ? '*' : '')), datasets: [{ data: d.months.map((m) => m.expenses), backgroundColor: d.months.map((m) => (m.partial ? '#C9B3D1' : PALETTE[0])), borderRadius: 3 }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => inr(x.raw) } } }, scales: { y: { beginAtZero: true, ticks: moneyTick } } } });
  chart('cTr', { type: 'line', data: { labels: d.months.map((m) => mlab(m.month)), datasets: [{ label: 'On-time %', data: d.months.map((m) => m.task_rate), borderColor: PALETTE[2], backgroundColor: PALETTE[2] + '22', fill: true, tension: 0.3, borderWidth: 3 }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } } } } });
});

// ---------------- Branch comparison ----------------
route('/branches', async (p, query) => {
  const from = query.from || addDays(todayStr(), -29); const to = query.to || todayStr();
  const d = await api(`/dashboard/branches?from=${from}&to=${to}`);
  const B = d.branches;
  const metrics = [['visitors', 'Visitors'], ['tasks_completed', 'Tasks completed'], ['maintenance', 'Maintenance issues'], ['expenses', 'Expenses'], ['inventory_issued', 'Inventory issued'], ['incidents', 'Incidents'], ['on_time', 'Registers on time %'], ['open_issues', 'Open issues now']];
  const worse = { maintenance: 'max', expenses: 'max', incidents: 'max', open_issues: 'max', on_time: 'min' };
  page('Branch Comparison', html`
    <div class="pagehead"><div><div class="eyebrow">${fdate(d.from)} – ${fdate(d.to)}</div><h1>Branch Comparison</h1></div>
      <form class="filters" data-form="range"><div class="fld"><label for="bf">From</label><input id="bf" type="date" name="from" value="${from}"></div><div class="fld"><label for="bt">To</label><input id="bt" type="date" name="to" value="${to}"></div><button class="btn pri" type="submit">Apply</button></form></div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(230px,1fr))">${metrics.slice(0, 8).map(([k, l], i) => html`<div class="card tight"><div class="card-h" style="margin-bottom:4px"><h3>${l}</h3></div><div class="chart-box sm"><canvas id="bm${i}" role="img" aria-label="${l} by branch"></canvas></div></div>`)}</div>
    <div class="grid g2">
      <div class="card"><div class="card-h"><h2>Weekly visitors by branch</h2><span class="small muted">Last 6 weeks</span></div><div class="chart-box lg"><canvas id="bWk" role="img" aria-label="Weekly visitors by branch"></canvas></div></div>
      <div class="card"><div class="card-h"><h2>Side by side</h2><button class="btn sm" data-xl>Export Excel</button></div>
        <div class="tbl-wrap"><table class="tbl" id="btbl"><thead><tr><th>Metric</th>${B.map((b) => html`<th class="r">${b.name}</th>`)}</tr></thead><tbody>
        ${metrics.concat([['deliveries', 'Deliveries'], ['couriers', 'Couriers'], ['purchases', 'Purchases approved'], ['petty_spent', 'Petty cash spent'], ['overdue', 'Overdue tasks'], ['low_stock', 'Low-stock items'], ['vehicle_km', 'Vehicle km']]).map(([k, l]) => {
    const vals = B.map((b) => b[k]); const tgt = worse[k] === 'max' ? Math.max(...vals) : worse[k] === 'min' ? Math.min(...vals.filter((v) => v !== null)) : null;
    return html`<tr><td>${l}</td>${B.map((b) => html`<td class="r num" style="${worse[k] && b[k] === tgt && B.length > 1 ? 'background:var(--high-bg)' : ''}">${['expenses', 'petty_spent'].includes(k) ? inrShort(b[k]) : b[k] === null ? '—' : b[k]}${k === 'on_time' && b[k] !== null ? '%' : ''}</td>`)}</tr>`;
  })}</tbody></table></div><div class="tiny muted" style="margin-top:6px">Shaded = needs attention in that row (most issues, highest cost or lowest compliance).</div></div>
    </div>`);
  on('submit', '[data-form="range"]', (f) => { const x = new FormData(f); go(`#/branches?from=${x.get('from')}&to=${x.get('to')}`); });
  on('click', '[data-xl]', () => { const wb = window.XLSX.utils.table_to_book(document.getElementById('btbl')); window.XLSX.writeFile(wb, `branch-comparison-${from}-to-${to}.xlsx`); });
  const colors = B.map((_, i) => PALETTE[i % PALETTE.length]);
  metrics.slice(0, 8).forEach(([k, l], i) => chart('bm' + i, { type: 'bar', data: { labels: B.map((b) => b.name), datasets: [{ data: B.map((b) => b[k]), backgroundColor: colors, borderRadius: 3 }] },
    options: { plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => (k === 'expenses' ? inr(x.raw) : x.raw) } } }, scales: { y: { beginAtZero: true, ticks: k === 'expenses' ? moneyTick : { precision: 0 }, max: k === 'on_time' ? 100 : undefined } } } }));
  chart('bWk', { type: 'line', data: { labels: d.weeks.map((w) => w.label), datasets: B.map((b, i) => ({ label: b.name, data: d.weeks.map((w) => w['b' + b.id]), borderColor: colors[i], tension: 0.3, borderWidth: 3 })) },
    options: { plugins: { legend: { position: 'bottom' } }, scales: { y: { beginAtZero: true } } } });
});

// ---------------- Daily digest ----------------
route('/digest', async (p, query) => {
  const date = query.date || todayStr();
  const d = await api(`/dashboard/digest?date=${date}&${bq(query)}`);
  const ins = d.insights; const t = d.today;
  const tab = query.cmp || 'day';
  const rows = d.compare[tab];
  page('Daily Digest', html`
    <div class="pagehead"><div><div class="eyebrow">${fdate(date)}</div><h1>Daily Digest</h1></div>
      <div class="actions"><form data-form="dd" style="display:flex;gap:6px"><label class="sr" for="dd">Date</label><input id="dd" type="date" name="date" value="${date}" style="width:auto"><button class="btn" type="submit">Go</button></form>${branchPicker(query)}<button class="btn" data-print>${icon('print')} Print</button></div></div>
    <div class="grid g2">
      <div class="card ins"><h2 style="margin-bottom:10px">What happened today?</h2>${ins.happened.map((x) => html`<p>${x}</p>`)}
        <div class="kpis" style="grid-template-columns:repeat(auto-fit,minmax(110px,1fr));margin-top:10px">${[['Visitors', t.visitors], ['Deliveries', t.deliveries], ['Couriers', t.couriers], ['Expenses', inrShort(t.expenses)], ['Tasks done', t.tasks_completed], ['Issues', t.maintenance], ['Incidents', t.incidents], ['Docs added', t.documents_uploaded]].map(([l, v]) => html`<div><div class="tiny muted">${l}</div><div class="num" style="font-size:18px;font-weight:600">${v}</div></div>`)}</div></div>
      ${attentionCard(ins.attention)}
    </div>
    <div class="grid g2">
      <div class="card"><div class="card-h"><h2>What is pending?</h2></div><dl class="kv">
        <dt>Vouchers awaiting approval</dt><dd><a href="#/approvals">${d.now.approvals_pending} · ${inr(d.now.approvals_amount)}</a></dd>
        <dt>Tasks pending / overdue</dt><dd><a href="#/tasks">${d.now.tasks_pending} / ${d.now.tasks_overdue}</a></dd>
        <dt>Open maintenance</dt><dd><a href="#/registers/maintenance">${d.now.maintenance_open}</a></dd>
        <dt>Open incidents</dt><dd><a href="#/registers/incident">${d.now.incidents_open}</a></dd>
        <dt>Register entries to review</dt><dd><a href="#/review">${d.now.reviews_pending}</a></dd>
        <dt>Unpaid to vendors</dt><dd><a href="#/purchases?payment_status=unpaid">${inr(d.now.payables)}</a></dd>
        <dt>Lost & found open</dt><dd><a href="#/registers/lost_found">${d.now.lost_found_open}</a></dd>
        <dt>Keys not returned</dt><dd><a href="#/registers/key">${d.now.keys_issued}</a></dd></dl></div>
      <div class="card ins"><div class="card-h"><h2>What changed?</h2><div class="seg">${[['day', 'Today vs yesterday'], ['week', 'Week vs last'], ['month', 'Month vs last']].map(([k, l]) => html`<a class="btn sm ${tab === k ? 'pri' : ''}" href="#/digest?date=${date}&cmp=${k}${query.branch_id ? '&branch_id=' + query.branch_id : ''}">${l}</a>`)}</div></div>
        <table class="tbl"><thead><tr><th>Metric</th><th class="r">Now</th><th class="r">Before</th><th class="r">Change</th></tr></thead><tbody>${rows.map((x) => html`<tr><td>${x.label}</td><td class="r num">${x.key === 'expenses' ? inr(x.current) : x.current}</td><td class="r num muted">${x.key === 'expenses' ? inr(x.previous) : x.previous}</td><td class="r num">${pctTxt(x.change)}</td></tr>`)}</tbody></table></div>
    </div>
    <div class="grid g2">
      <div class="card ins"><h2 style="margin-bottom:10px">What should I do tomorrow?</h2>${ins.actions.length ? html`<ol>${ins.actions.map((a) => html`<li>${a}</li>`)}</ol>` : html`<p class="muted">Nothing pressing.</p>`}
        ${ins.unusual.length ? html`<div class="eyebrow" style="margin:12px 0 6px">Worth a look</div><ul>${ins.unusual.map((a) => html`<li>${a}</li>`)}</ul>` : ''}</div>
      <div class="card"><h2 style="margin-bottom:10px">Today's records</h2><ul class="att">
        ${d.records.map((r) => html`<li class="small"><span class="t"><a href="#/entry/${r.id}">${r.register}</a> — ${r.data.issue || r.data.description || r.data.item || r.data.material || ''}</span><span class="tiny muted">${r.by}</span></li>`)}
        ${d.purchases.map((x) => html`<li class="small"><span class="t"><a href="#/purchase/${x.id}">${x.purchase_no}</a> — ${x.vendor}</span>${badge(x.status)}<b class="num">${inr(x.total)}</b></li>`)}
        ${!d.records.length && !d.purchases.length ? html`<li class="muted">No records yet today.</li>` : ''}</ul></div>
    </div>`);
  bindBranchPicker('/digest');
  on('submit', '[data-form="dd"]', (f) => go(`#/digest?date=${new FormData(f).get('date')}`));
  on('click', '[data-print]', () => window.print());
});
