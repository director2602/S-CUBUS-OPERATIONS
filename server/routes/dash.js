const express = require('express');
const { q, one } = require('../db');
const { ah, bad, forbidden, seesAll, isReviewer, isFinance, FIELD_ROLES, today } = require('../lib');
const { MODES } = require('../finance');

const r = express.Router();

const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 864e5);
const MON = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const fd = (d) => `${Number(d.slice(8, 10))} ${MON[Number(d.slice(5, 7)) - 1]}`;
const pct = (cur, prev) => (prev ? Math.round(((cur - prev) / prev) * 1000) / 10 : (cur ? null : 0));
const inr = (n) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');

function scope(req) {
  if (seesAll(req.user)) return req.query.branch_id && req.query.branch_id !== 'all' ? Number(req.query.branch_id) : null;
  return req.user.branch_id;
}

// ---------- Core aggregation (getDailySummary / getWeeklySummary / getMonthlySummary build on this) ----------
async function metrics(from, to, bid) {
  const p = [from, to, bid];
  const regP = one(`WITH e AS (SELECT d.key, e.* FROM register_entries e JOIN register_defs d ON d.id=e.register_id
      WHERE e.entry_date BETWEEN $1 AND $2 AND ($3::int IS NULL OR e.branch_id=$3))
    SELECT COUNT(*) FILTER (WHERE key='visitor')::int AS visitors,
      COUNT(*) FILTER (WHERE key='visitor' AND data->>'visitor_type'='Parent')::int AS v_parent,
      COUNT(*) FILTER (WHERE key='visitor' AND data->>'visitor_type'='Student')::int AS v_student,
      COUNT(*) FILTER (WHERE key='visitor' AND COALESCE(data->>'visitor_type','Other') NOT IN ('Parent','Student'))::int AS v_other,
      (COUNT(*) FILTER (WHERE key='delivery') + COUNT(*) FILTER (WHERE key='inward_outward' AND data->>'direction'='Inward'))::int AS deliveries,
      COUNT(*) FILTER (WHERE key='courier')::int AS couriers,
      COUNT(*) FILTER (WHERE key='maintenance')::int AS maintenance,
      COUNT(*) FILTER (WHERE key='incident')::int AS incidents,
      COUNT(*) FILTER (WHERE key='incident' AND data->>'severity'='Critical')::int AS critical_incidents,
      COUNT(*) FILTER (WHERE key='housekeeping' AND (COALESCE(data->>'issue_found','')<>'' OR data->>'task_status' IN ('Not done','Partly done')))::int AS cleaning_issues,
      COUNT(*) FILTER (WHERE key='vehicle')::int AS vehicle_trips,
      COALESCE(SUM(CASE WHEN key='vehicle' AND (data->>'end_km') ~ '^[0-9.]+$' AND (data->>'start_km') ~ '^[0-9.]+$' THEN (data->>'end_km')::numeric - (data->>'start_km')::numeric END),0) AS vehicle_km,
      COALESCE(SUM(CASE WHEN key='vehicle' AND (data->>'fuel_cost') ~ '^[0-9.]+$' THEN (data->>'fuel_cost')::numeric END),0) AS fuel_cost,
      COALESCE(SUM(CASE WHEN key='vehicle' AND (data->>'fuel_litres') ~ '^[0-9.]+$' THEN (data->>'fuel_litres')::numeric END),0) AS fuel_litres,
      COUNT(*)::int AS register_entries
    FROM e`, p);
  const closedP = one(`SELECT COUNT(*)::int AS n FROM register_entries e JOIN register_defs d ON d.id=e.register_id
    WHERE d.key='maintenance' AND e.data->>'issue_status' IN ('Resolved','Closed')
    AND COALESCE(NULLIF(e.data->>'completion_date','')::date, e.updated_at::date, e.entry_date) BETWEEN $1 AND $2 AND ($3::int IS NULL OR e.branch_id=$3)`, p);
  const finP = one(`SELECT COUNT(*) FILTER (WHERE status='approved')::int AS purchases,
      COALESCE(SUM(total) FILTER (WHERE status='approved'),0) AS expenses,
      COUNT(*) FILTER (WHERE bill_no IS NOT NULL AND bill_no<>'')::int AS invoices,
      COUNT(*) FILTER (WHERE status='submitted')::int AS pending_approval,
      COUNT(*) FILTER (WHERE status='rejected')::int AS rejected,
      COUNT(*)::int AS requests,
      COALESCE(SUM(total) FILTER (WHERE status='approved' AND payment_mode='petty_cash'),0) AS petty_spent
    FROM purchases WHERE date BETWEEN $1 AND $2 AND ($3::int IS NULL OR branch_id=$3)`, p);
  const invP = one(`SELECT COALESCE(SUM(-qty) FILTER (WHERE type IN ('issue','outward')),0) AS issued,
      COALESCE(SUM(qty) FILTER (WHERE type IN ('purchase','inward')),0) AS received,
      COALESCE(SUM(qty) FILTER (WHERE type='return'),0) AS returned,
      COALESCE(SUM(-qty) FILTER (WHERE type='loss'),0) AS lost,
      COALESCE(SUM(-qty) FILTER (WHERE type='damage'),0) AS damaged,
      COUNT(*)::int AS movements
    FROM stock_movements WHERE created_at::date BETWEEN $1 AND $2 AND ($3::int IS NULL OR branch_id=$3)`, p);
  const tasksP = one(`SELECT COUNT(*) FILTER (WHERE completed_at::date BETWEEN $1 AND $2)::int AS completed,
      COUNT(*) FILTER (WHERE created_at::date BETWEEN $1 AND $2)::int AS created,
      COUNT(*) FILTER (WHERE due_date BETWEEN $1 AND $2)::int AS due,
      COUNT(*) FILTER (WHERE due_date BETWEEN $1 AND $2 AND status='done' AND completed_at::date <= due_date)::int AS on_time
    FROM tasks WHERE ($3::int IS NULL OR branch_id=$3)`, p);
  const docsP = one('SELECT COUNT(*)::int AS n FROM documents WHERE created_at::date BETWEEN $1 AND $2 AND ($3::int IS NULL OR branch_id=$3 OR branch_id IS NULL)', p);
  const [reg, closed, fin, inv, tasks, docs] = await Promise.all([regP, closedP, finP, invP, tasksP, docsP]);
  return {
    ...reg, maintenance_closed: closed.n, purchases: fin.purchases, expenses: Number(fin.expenses), invoices: fin.invoices, pending_approval: fin.pending_approval,
    purchase_requests: fin.requests, purchases_rejected: fin.rejected, petty_spent: Number(fin.petty_spent),
    inventory_issued: Number(inv.issued), inventory_received: Number(inv.received), inventory_returned: Number(inv.returned), inventory_lost: Number(inv.lost),
    inventory_damaged: Number(inv.damaged), inventory_movements: inv.movements,
    tasks_completed: tasks.completed, tasks_created: tasks.created, tasks_due: tasks.due, tasks_on_time: tasks.on_time, documents_uploaded: docs.n,
    vehicle_km: Number(reg.vehicle_km), fuel_cost: Number(reg.fuel_cost), fuel_litres: Number(reg.fuel_litres)
  };
}

async function current(bid) {
  const p = [bid];
  const tP = one(`SELECT COUNT(*) FILTER (WHERE status IN ('pending','in_progress'))::int AS pending,
      COUNT(*) FILTER (WHERE status IN ('pending','in_progress') AND due_date < CURRENT_DATE)::int AS overdue
    FROM tasks WHERE ($1::int IS NULL OR branch_id=$1)`, p);
  const mP = one(`SELECT COUNT(*)::int AS open FROM register_entries e JOIN register_defs d ON d.id=e.register_id
    WHERE d.key='maintenance' AND COALESCE(e.data->>'issue_status','Open') NOT IN ('Resolved','Closed') AND ($1::int IS NULL OR e.branch_id=$1)`, p);
  const incP = one(`SELECT COUNT(*)::int AS open, COUNT(*) FILTER (WHERE e.data->>'severity'='Critical')::int AS critical FROM register_entries e JOIN register_defs d ON d.id=e.register_id
    WHERE d.key='incident' AND COALESCE(e.data->>'incident_status','Open') NOT IN ('Resolved','Closed') AND ($1::int IS NULL OR e.branch_id=$1)`, p);
  const lowP = one(`SELECT COUNT(*)::int AS n FROM stock s JOIN items i ON i.id=s.item_id WHERE i.active AND i.min_stock > 0 AND s.qty < i.min_stock AND ($1::int IS NULL OR s.branch_id=$1)`, p);
  const apP = one("SELECT COUNT(*)::int AS n, COALESCE(SUM(amount),0) AS amt FROM vouchers WHERE status='pending' AND ($1::int IS NULL OR branch_id=$1)", p);
  const outP = one("SELECT COUNT(*)::int AS n, COALESCE(SUM(total-amount_paid),0) AS amt FROM purchases WHERE status='approved' AND payment_status<>'paid' AND ($1::int IS NULL OR branch_id=$1)", p);
  const docsP = one('SELECT COUNT(*) FILTER (WHERE expires_on <= CURRENT_DATE + 30)::int AS d30, COUNT(*) FILTER (WHERE expires_on < CURRENT_DATE)::int AS expired FROM documents WHERE expires_on IS NOT NULL AND ($1::int IS NULL OR branch_id=$1 OR branch_id IS NULL)', p);
  const rvP = one(`SELECT COUNT(*)::int AS n FROM register_entries e JOIN register_defs d ON d.id=e.register_id WHERE e.status='submitted'
    AND (d.important OR d.frequency IN ('daily','per_shift','twice_daily')) AND ($1::int IS NULL OR e.branch_id=$1)`, p);
  const lfP = one(`SELECT COUNT(*)::int AS n FROM register_entries e JOIN register_defs d ON d.id=e.register_id WHERE d.key='lost_found' AND e.data->>'lf_status' IN ('Found','Under Verification','Unclaimed') AND ($1::int IS NULL OR e.branch_id=$1)`, p);
  const visP = one(`SELECT COUNT(*)::int AS n FROM register_entries e JOIN register_defs d ON d.id=e.register_id WHERE d.key='visitor' AND e.entry_date=CURRENT_DATE AND COALESCE(e.data->>'exit_time','')='' AND ($1::int IS NULL OR e.branch_id=$1)`, p);
  const keysP = one(`SELECT COUNT(*)::int AS n FROM register_entries e JOIN register_defs d ON d.id=e.register_id WHERE d.key='key' AND e.data->>'key_status'='Issued' AND ($1::int IS NULL OR e.branch_id=$1)`, p);
  const [t, m, inc, low, ap, out, docs, rv, lf, vis, keys] = await Promise.all([tP, mP, incP, lowP, apP, outP, docsP, rvP, lfP, visP, keysP]);
  return {
    tasks_pending: t.pending, tasks_overdue: t.overdue, maintenance_open: m.open, incidents_open: inc.open, incidents_critical_open: inc.critical,
    low_stock: low.n, approvals_pending: ap.n, approvals_amount: Number(ap.amt), payables_count: out.n, payables: Number(out.amt),
    docs_expiring_30: docs.d30, docs_expired: docs.expired, reviews_pending: rv.n, lost_found_open: lf.n, visitors_on_site: vis.n, keys_issued: keys.n
  };
}

async function dailySeries(from, to, bid) {
  const p = [from, to, bid];
  const [days, reg, fin, inv, tk, open] = await Promise.all([
    q("SELECT to_char(g::date,'YYYY-MM-DD') AS d FROM generate_series($1::date, $2::date, '1 day') g", [from, to]),
    q(`SELECT e.entry_date AS d,
        COUNT(*) FILTER (WHERE r.key='visitor')::int AS visitors,
        COUNT(*) FILTER (WHERE r.key='delivery' OR (r.key='inward_outward' AND e.data->>'direction'='Inward'))::int AS deliveries,
        COUNT(*) FILTER (WHERE r.key='courier')::int AS couriers,
        COUNT(*) FILTER (WHERE r.key='maintenance')::int AS maintenance,
        COUNT(*) FILTER (WHERE r.key='incident')::int AS incidents
      FROM register_entries e JOIN register_defs r ON r.id=e.register_id
      WHERE e.entry_date BETWEEN $1 AND $2 AND ($3::int IS NULL OR e.branch_id=$3) GROUP BY 1`, p),
    q(`SELECT date AS d, COALESCE(SUM(total) FILTER (WHERE status='approved'),0)::float AS expenses,
        COUNT(*) FILTER (WHERE bill_no IS NOT NULL AND bill_no<>'')::int AS invoices
      FROM purchases WHERE date BETWEEN $1 AND $2 AND ($3::int IS NULL OR branch_id=$3) GROUP BY 1`, p),
    q(`SELECT to_char(created_at::date,'YYYY-MM-DD') AS d, COALESCE(SUM(-qty),0)::float AS issued FROM stock_movements
      WHERE type IN ('issue','outward') AND created_at >= $1::date AND created_at < $2::date + 1 AND ($3::int IS NULL OR branch_id=$3) GROUP BY 1`, p),
    q(`SELECT to_char(completed_at::date,'YYYY-MM-DD') AS d, COUNT(*)::int AS tasks_done FROM tasks
      WHERE completed_at >= $1::date AND completed_at < $2::date + 1 AND ($3::int IS NULL OR branch_id=$3) GROUP BY 1`, p),
    q(`SELECT e.entry_date AS opened, CASE WHEN COALESCE(e.data->>'issue_status','Open') IN ('Resolved','Closed')
        THEN COALESCE(NULLIF(e.data->>'completion_date','')::date, e.updated_at::date, e.entry_date) END AS closed
      FROM register_entries e JOIN register_defs r ON r.id=e.register_id WHERE r.key='maintenance' AND e.entry_date <= $1::date
      AND ($2::int IS NULL OR e.branch_id=$2)`, [to, bid])
  ]);
  const by = (rows) => Object.fromEntries(rows.map((x) => [String(x.d).slice(0, 10), x]));
  const R = by(reg); const Fm = by(fin); const I = by(inv); const T = by(tk);
  return days.map(({ d }) => {
    const r = R[d] || {}; const f = Fm[d] || {};
    const closedStr = (c) => (c ? new Date(c).toISOString().slice(0, 10) : null);
    return {
      d, visitors: r.visitors || 0, deliveries: r.deliveries || 0, couriers: r.couriers || 0, maintenance: r.maintenance || 0, incidents: r.incidents || 0,
      expenses: f.expenses || 0, invoices: f.invoices || 0, issued: (I[d] || {}).issued || 0, tasks_done: (T[d] || {}).tasks_done || 0,
      open_issues: open.filter((o) => String(o.opened).slice(0, 10) <= d && !(o.closed && (typeof o.closed === 'string' ? o.closed : closedStr(o.closed)) <= d)).length
    };
  });
}

// ---------- Register submission status ----------
const SCHEDULED = ['daily', 'per_shift', 'twice_daily'];
async function registerStatus(bid, days = 7) {
  const t = today();
  const from = addDays(t, -(days - 1));
  const defs = await q("SELECT * FROM register_defs WHERE status='active' ORDER BY sort, name");
  const branches = await q('SELECT id, name FROM branches WHERE active AND ($1::int IS NULL OR id=$1) ORDER BY id', [bid]);
  const agg = await q(`SELECT register_id, branch_id, entry_date, COUNT(*)::int AS n, MIN(created_at) AS first_at,
      COUNT(*) FILTER (WHERE status='submitted')::int AS pending
    FROM register_entries WHERE entry_date BETWEEN $1 AND $2 AND ($3::int IS NULL OR branch_id=$3) GROUP BY 1,2,3`, [from, t, bid]);
  const pend = await q(`SELECT e.register_id, COUNT(*)::int AS n FROM register_entries e JOIN register_defs d ON d.id=e.register_id WHERE e.status='submitted'
    AND (d.important OR d.frequency IN ('daily','per_shift','twice_daily')) AND ($1::int IS NULL OR e.branch_id=$1) GROUP BY 1`, [bid]);
  const last = await q(`SELECT DISTINCT ON (register_id) register_id, created_at, entry_date FROM register_entries WHERE ($1::int IS NULL OR branch_id=$1) ORDER BY register_id, created_at DESC`, [bid]);
  const nowIst = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(11, 16);
  const key = (a, b, c) => `${a}|${b}|${c}`;
  const map = new Map(agg.map((x) => [key(x.register_id, x.branch_id, x.entry_date), x]));
  const dates = Array.from({ length: days }, (_, i) => addDays(from, i));
  const missing = [];
  const regs = defs.map((d) => {
    const scheduled = SCHEDULED.includes(d.frequency);
    const bs = branches.filter((b) => !d.branch_id || d.branch_id === b.id);
    const strip = dates.map((dt) => {
      let total = 0; let st = 's';
      for (const b of bs) {
        const a = map.get(key(d.id, b.id, dt));
        total += a ? a.n : 0;
        if (!scheduled) continue;
        if (!a) {
          if (dt === t && d.deadline && nowIst < d.deadline) { if (st === 's') st = 'p'; } else { st = 'm'; missing.push({ register: d.name, register_key: d.key, branch: b.name, branch_id: b.id, date: dt, deadline: d.deadline }); }
        } else if (d.deadline) {
          const firstIst = new Date(new Date(a.first_at).getTime() + 5.5 * 3600e3).toISOString();
          const lateDay = firstIst.slice(0, 10) > dt; const lateTime = firstIst.slice(0, 10) === dt && firstIst.slice(11, 16) > d.deadline;
          if ((lateDay || lateTime) && st === 's') st = 'l';
        }
      }
      if (!scheduled) st = total > 0 ? 'e' : 'n';
      return { date: dt, status: st, count: total };
    });
    const l = last.find((x) => x.register_id === d.id);
    const pe = pend.find((x) => x.register_id === d.id);
    return { id: d.id, key: d.key, name: d.name, frequency: d.frequency, deadline: d.deadline, important: d.important, scheduled,
      today: strip[strip.length - 1].count, pending_review: pe ? pe.n : 0, last_submission: l ? l.created_at : null, strip };
  });
  return { dates, registers: regs, missing: missing.filter((m) => m.date >= addDays(t, -2)).reverse(), missing_all: missing };
}

async function onTimeRate(bid, days = 14) {
  const st = await registerStatus(bid, days);
  const sched = st.registers.filter((r) => r.scheduled);
  return st.dates.map((d, i) => {
    let due = 0; let ok = 0;
    sched.forEach((r) => {
      const s = r.strip[i].status;
      if (s === 'p') return;
      due += 1; if (s === 's') ok += 1;
    });
    return { date: d, rate: due ? Math.round((ok / due) * 100) : null, due, ok };
  });
}

// ---------- Insights (management summary language: concise, factual, non-dramatic) ----------
const LABELS = {
  visitors: 'Visitors', deliveries: 'Deliveries', couriers: 'Couriers', maintenance: 'Maintenance issues reported', incidents: 'Incidents',
  expenses: 'Expenses', inventory_issued: 'Inventory issued', tasks_completed: 'Tasks completed', purchases: 'Purchases', invoices: 'Invoices',
  cleaning_issues: 'Cleaning issues', inventory_lost: 'Inventory lost', inventory_damaged: 'Inventory damaged'
};
function changes(cur, prev) {
  return Object.keys(LABELS).map((k) => ({ key: k, label: LABELS[k], current: cur[k] || 0, previous: prev[k] || 0, change: pct(cur[k] || 0, prev[k] || 0) }));
}
async function insights(bid, cur, prev, now, periodName) {
  const partialDay = periodName === 'day' && new Date(Date.now() + 5.5 * 3600e3).getUTCHours() < 19;
  const happened = [];
  happened.push(`${cur.visitors} visitors (${cur.v_parent} parents, ${cur.v_student} students, ${cur.v_other} others), ${cur.deliveries} deliveries and ${cur.couriers} couriers were logged.`);
  if (cur.purchases || cur.expenses) happened.push(`${cur.purchases} purchases were approved, totalling ${inr(cur.expenses)}${cur.petty_spent ? ` (${inr(cur.petty_spent)} from petty cash)` : ''}.`);
  if (cur.inventory_issued) happened.push(`${cur.inventory_issued} inventory units were issued; ${cur.inventory_received} received.`);
  happened.push(`${cur.tasks_completed} tasks were completed. ${cur.maintenance} maintenance issues were reported and ${cur.maintenance_closed} closed.`);
  if (partialDay) happened.unshift('Today so far:');
  if (cur.incidents) happened.push(`${cur.incidents} incident${cur.incidents > 1 ? 's were' : ' was'} recorded${cur.critical_incidents ? `, ${cur.critical_incidents} critical` : ', none critical'}.`);

  const changed = changes(cur, prev).filter((c) => Math.abs(c.current - c.previous) >= (c.key === 'expenses' ? 1000 : 3) && c.change !== null && Math.abs(c.change) >= 15)
    .filter((c) => !partialDay || c.current > c.previous)
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 6)
    .map((c) => `${c.label} ${c.current > c.previous ? 'rose' : 'fell'} from ${c.key === 'expenses' ? inr(c.previous) : c.previous} to ${c.key === 'expenses' ? inr(c.current) : c.current} (${c.change > 0 ? '+' : ''}${c.change}%) compared with the previous ${periodName}.`);

  const unusual = [];
  if (prev.expenses > 0 && cur.expenses > prev.expenses * 1.3 && cur.expenses - prev.expenses > 5000) unusual.push(`Spending is ${Math.round((cur.expenses / prev.expenses - 1) * 100)}% higher than the previous ${periodName} and may warrant review.`);
  const loss = cur.inventory_lost + cur.inventory_damaged; const ploss = prev.inventory_lost + prev.inventory_damaged;
  if (loss >= 3 && loss > ploss * 1.5) unusual.push(`Inventory loss and damage (${loss} units) appears higher than usual (${ploss} in the previous ${periodName}).`);
  if (prev.visitors >= 10 && cur.visitors > prev.visitors * 1.5) unusual.push(`Visitor volume is noticeably higher than the previous ${periodName}.`);
  if (prev.inventory_issued >= 20 && cur.inventory_issued > prev.inventory_issued * 1.6) unusual.push('Material usage appears higher than usual and may warrant review.');
  const repeats = await q(`SELECT COALESCE(NULLIF(e.data->>'asset',''), e.data->>'location', e.data->>'issue') AS what, COUNT(*)::int AS n
    FROM register_entries e JOIN register_defs d ON d.id=e.register_id WHERE d.key='maintenance' AND e.entry_date >= CURRENT_DATE - 30
    AND ($1::int IS NULL OR e.branch_id=$1) GROUP BY 1 HAVING COUNT(*) >= 2 AND COALESCE(NULLIF(e.data->>'asset',''), e.data->>'location', e.data->>'issue') IS NOT NULL ORDER BY 2 DESC LIMIT 3`, [bid]);
  repeats.forEach((x) => unusual.push(`${x.what}: ${x.n} maintenance reports in 30 days. Repeated issues may warrant a permanent fix.`));
  const repInc = await q(`SELECT e.data->>'incident_type' AS t, COUNT(*)::int AS n FROM register_entries e JOIN register_defs d ON d.id=e.register_id
    WHERE d.key='incident' AND e.entry_date >= CURRENT_DATE - 14 AND ($1::int IS NULL OR e.branch_id=$1) GROUP BY 1 HAVING COUNT(*) >= 2`, [bid]);
  repInc.forEach((x) => unusual.push(`${x.n} "${x.t}" incidents in the last 14 days.`));

  const attention = [];
  if (now.incidents_critical_open) attention.push({ level: 'critical', text: `${now.incidents_critical_open} critical incident(s) open`, link: '#/registers/incident' });
  if (now.tasks_overdue) attention.push({ level: 'high', text: `${now.tasks_overdue} overdue task(s)`, link: '#/tasks?overdue=1' });
  if (now.low_stock) attention.push({ level: 'high', text: `${now.low_stock} item(s) below minimum stock`, link: '#/inventory' });
  if (now.approvals_pending) attention.push({ level: 'pending', text: `${now.approvals_pending} voucher(s) awaiting approval (${inr(now.approvals_amount)})`, link: '#/approvals' });
  if (now.payables) attention.push({ level: 'pending', text: `${inr(now.payables)} unpaid to vendors on ${now.payables_count} credit purchase(s)`, link: '#/purchases?payment_status=unpaid' });
  if (now.docs_expired) attention.push({ level: 'high', text: `${now.docs_expired} document(s)/licence(s) already expired`, link: '#/documents' });
  if (now.docs_expiring_30) attention.push({ level: 'pending', text: `${now.docs_expiring_30} document(s) expiring within 30 days`, link: '#/documents' });
  if (now.maintenance_open) attention.push({ level: 'pending', text: `${now.maintenance_open} open maintenance issue(s)`, link: '#/registers/maintenance' });
  if (now.reviews_pending) attention.push({ level: 'normal', text: `${now.reviews_pending} register entr${now.reviews_pending > 1 ? 'ies' : 'y'} pending review`, link: '#/review' });

  const actions = [];
  if (now.incidents_critical_open) actions.push('Review and close the open critical incident(s) today.');
  repeats.slice(0, 1).forEach((x) => actions.push(`Decide on a permanent repair or replacement for ${x.what}.`));
  if (now.low_stock) actions.push(`Raise purchase requests for ${now.low_stock} low-stock item(s).`);
  if (now.approvals_pending) actions.push(`Approve or reject ${now.approvals_pending} pending voucher(s).`);
  if (now.tasks_overdue) actions.push(`Follow up on ${now.tasks_overdue} overdue task(s).`);
  if (now.docs_expired || now.docs_expiring_30) actions.push('Start renewals for expiring licences and contracts.');
  if (now.payables) actions.push(`Schedule vendor payments of ${inr(now.payables)}.`);
  if (now.reviews_pending) actions.push(`Verify ${now.reviews_pending} submitted register entries.`);
  return { happened, changed, unusual, attention, actions: actions.slice(0, 7) };
}

// ---------- Endpoints ----------
r.get('/dashboard/control', ah(async (req, res) => {
  if (!isReviewer(req.user)) throw forbidden();
  const bid = scope(req);
  const t = today();
  const monthStart = t.slice(0, 8) + '01';
  const [mToday, mYest, now, series, prevSeries] = await Promise.all([
    metrics(t, t, bid), metrics(addDays(t, -1), addDays(t, -1), bid), current(bid),
    dailySeries(addDays(t, -6), t, bid), dailySeries(addDays(t, -13), addDays(t, -7), bid)
  ]);
  const expDaysP = dailySeries(monthStart, t, bid);
  const p = [monthStart, t, bid];
  const byCatP = q(`SELECT COALESCE(c.name,'Uncategorised') AS label, SUM(p.total) AS value FROM purchases p LEFT JOIN expense_categories c ON c.id=p.category_id
    WHERE p.status='approved' AND p.date BETWEEN $1 AND $2 AND ($3::int IS NULL OR p.branch_id=$3) GROUP BY 1 ORDER BY 2 DESC`, p);
  const byModeP = q(`SELECT payment_mode AS mode, SUM(total) AS value, COUNT(*)::int AS n FROM purchases WHERE status='approved' AND date BETWEEN $1 AND $2
    AND ($3::int IS NULL OR branch_id=$3) GROUP BY 1 ORDER BY 2 DESC`, p);
  const lowStockP = q(`SELECT i.id, i.name, i.unit, i.min_stock, s.qty, b.name AS branch FROM stock s JOIN items i ON i.id=s.item_id JOIN branches b ON b.id=s.branch_id
    WHERE i.active AND i.min_stock>0 AND s.qty < i.min_stock AND ($1::int IS NULL OR s.branch_id=$1) ORDER BY s.qty / NULLIF(i.min_stock,0) LIMIT 8`, [bid]);
  const highUseP = q(`WITH d AS (SELECT item_id, SUM(-qty) FILTER (WHERE created_at::date = CURRENT_DATE) AS today, SUM(-qty) FILTER (WHERE created_at::date < CURRENT_DATE)/30.0 AS avg30
      FROM stock_movements WHERE type IN ('issue','outward') AND created_at >= CURRENT_DATE - 30 AND ($1::int IS NULL OR branch_id=$1) GROUP BY 1)
    SELECT i.name, d.today, ROUND(d.avg30,1) AS avg30 FROM d JOIN items i ON i.id=d.item_id WHERE d.today >= 5 AND d.today > 2 * COALESCE(d.avg30,0) ORDER BY d.today DESC LIMIT 4`, [bid]);
  const recentPurchasesP = q(`SELECT p.id, p.purchase_no, p.date, p.total, p.payment_mode, p.status, COALESCE(v.name,p.vendor_name) AS vendor FROM purchases p
    LEFT JOIN vendors v ON v.id=p.vendor_id WHERE ($1::int IS NULL OR p.branch_id=$1) ORDER BY p.created_at DESC LIMIT 6`, [bid]);
  const recentIssuesP = q(`SELECT m.created_at, -m.qty AS qty, i.name AS item, i.unit, m.issued_to FROM stock_movements m JOIN items i ON i.id=m.item_id
    WHERE m.type='issue' AND ($1::int IS NULL OR m.branch_id=$1) ORDER BY m.created_at DESC LIMIT 6`, [bid]);
  const maintAgeP = one(`SELECT COUNT(*) FILTER (WHERE CURRENT_DATE - e.entry_date <= 2)::int AS a, COUNT(*) FILTER (WHERE CURRENT_DATE - e.entry_date BETWEEN 3 AND 7)::int AS b,
      COUNT(*) FILTER (WHERE CURRENT_DATE - e.entry_date > 7)::int AS c FROM register_entries e JOIN register_defs d ON d.id=e.register_id
    WHERE d.key='maintenance' AND COALESCE(e.data->>'issue_status','Open') NOT IN ('Resolved','Closed') AND ($1::int IS NULL OR e.branch_id=$1)`, [bid]);
  const expiringP = q(`SELECT d.id, d.title, d.doc_type, d.expires_on, (d.expires_on - CURRENT_DATE) AS days_left, b.name AS branch FROM documents d LEFT JOIN branches b ON b.id=d.branch_id
    WHERE d.expires_on IS NOT NULL AND d.expires_on <= CURRENT_DATE + 60 AND ($1::int IS NULL OR d.branch_id=$1 OR d.branch_id IS NULL) ORDER BY d.expires_on LIMIT 8`, [bid]);
  const dueSoonP = q(`SELECT p.id, p.purchase_no, COALESCE(v.name,p.vendor_name) AS vendor, p.total - p.amount_paid AS due, p.mode_details->>'due_date' AS due_date
    FROM purchases p LEFT JOIN vendors v ON v.id=p.vendor_id WHERE p.status='approved' AND p.payment_status<>'paid' AND ($1::int IS NULL OR p.branch_id=$1)
    ORDER BY NULLIF(p.mode_details->>'due_date','') NULLS LAST, p.date LIMIT 6`, [bid]);
  const pettyP = q('SELECT b.id, b.name, COALESCE(SUM(pc.amount),0) AS balance FROM branches b LEFT JOIN petty_cash pc ON pc.branch_id=b.id WHERE b.active AND ($1::int IS NULL OR b.id=$1) GROUP BY b.id ORDER BY b.id', [bid]);
  const branchActP = q(`SELECT b.name, (SELECT COUNT(*) FROM tasks t WHERE t.branch_id=b.id AND t.completed_at >= date_trunc('month', CURRENT_DATE))::int AS tasks,
      (SELECT COUNT(*) FROM register_entries e WHERE e.branch_id=b.id AND e.entry_date >= date_trunc('month', CURRENT_DATE))::int AS entries
    FROM branches b WHERE b.active AND ($1::int IS NULL OR b.id=$1) ORDER BY b.id`, [bid]);
  const mtdP = metrics(monthStart, t, bid);
  const regsP = registerStatus(bid, 3);
  const [expDays, byCat, byMode, lowStock, highUse, recentPurchases, recentIssues, maintAge, expiring, dueSoon, petty, branchAct, mtd, regs] = await Promise.all([expDaysP, byCatP, byModeP, lowStockP, highUseP, recentPurchasesP, recentIssuesP, maintAgeP, expiringP, dueSoonP, pettyP, branchActP, mtdP, regsP]);
  byMode.forEach((x) => { x.label = MODES[x.mode] || x.mode; x.value = Number(x.value); });
  byCat.forEach((x) => { x.value = Number(x.value); });
  petty.forEach((x) => { x.balance = Number(x.balance); });
  const ins = await insights(bid, mToday, mYest, now, 'day');
  regs.missing.forEach((m) => ins.attention.push({ level: 'pending', text: `${m.register} for ${m.branch} not submitted for ${fd(m.date)}`, link: '#/registers-centre' }));
  const visTypesP = one(`SELECT COUNT(*) FILTER (WHERE e.data->>'visitor_type'='Parent')::int AS parent, COUNT(*) FILTER (WHERE e.data->>'visitor_type'='Student')::int AS student,
      COUNT(*) FILTER (WHERE COALESCE(e.data->>'visitor_type','Other') NOT IN ('Parent','Student'))::int AS other
    FROM register_entries e JOIN register_defs d ON d.id=e.register_id WHERE d.key='visitor' AND e.entry_date BETWEEN $1 AND $2 AND ($3::int IS NULL OR e.branch_id=$3)`, [addDays(t, -6), t, bid]);
  const avgVisitP = one(`SELECT ROUND(AVG(EXTRACT(EPOCH FROM ((e.data->>'exit_time')::timestamp - (e.data->>'entry_time')::timestamp))/60)) AS m
    FROM register_entries e JOIN register_defs d ON d.id=e.register_id WHERE d.key='visitor' AND e.entry_date >= CURRENT_DATE - 7 AND COALESCE(e.data->>'exit_time','')<>''
    AND COALESCE(e.data->>'entry_time','')<>'' AND ($1::int IS NULL OR e.branch_id=$1)`, [bid]);
  const [visTypes, avgVisit] = await Promise.all([visTypesP, avgVisitP]);
  res.json({
    date: t, today: mToday, yesterday: mYest, now, mtd, series, prevSeries, expDays, byCat, byMode, lowStock, highUse, recentPurchases, recentIssues,
    maintAge, expiring, dueSoon, petty, branchAct, insights: ins, visTypes, avgVisit: avgVisit && avgVisit.m !== null ? Number(avgVisit.m) : null, missing: regs.missing
  });
}));

r.get('/dashboard/registers', ah(async (req, res) => {
  if (!isReviewer(req.user)) throw forbidden();
  const bid = scope(req);
  const st = await registerStatus(bid, 7);
  const rate = await onTimeRate(bid, 14);
  const queue = await q(`SELECT e.id, e.entry_date, e.status, e.created_at, d.name AS register_name, d.key, b.name AS branch, u.name AS created_by_name
    FROM register_entries e JOIN register_defs d ON d.id=e.register_id LEFT JOIN branches b ON b.id=e.branch_id LEFT JOIN users u ON u.id=e.created_by
    WHERE e.status IN ('submitted','reviewed') AND (d.important OR d.frequency IN ('daily','per_shift','twice_daily')) AND ($1::int IS NULL OR e.branch_id=$1)
    ORDER BY e.created_at LIMIT 40`, [bid]);
  const todayCount = st.registers.reduce((a, x) => a + x.today, 0);
  const due = st.registers.filter((x) => x.scheduled);
  const submittedToday = due.filter((x) => ['s', 'l'].includes(x.strip[x.strip.length - 1].status)).length;
  const dueLater = due.filter((x) => x.strip[x.strip.length - 1].status === 'p').length;
  res.json({ ...st, rate, queue, kpis: { due: due.length, submitted: submittedToday, due_later: dueLater, pending_review: st.registers.reduce((a, x) => a + x.pending_review, 0), missing: st.missing.length, entries_today: todayCount } });
}));

async function periodRange(period, offset = 0) {
  const t = today();
  if (period === 'month') {
    const d = new Date(t + 'T00:00:00Z'); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - offset);
    const from = d.toISOString().slice(0, 10);
    const e = new Date(d); e.setUTCMonth(e.getUTCMonth() + 1); e.setUTCDate(0);
    let to = e.toISOString().slice(0, 10); if (to > t) to = t;
    const pd = new Date(d); pd.setUTCMonth(pd.getUTCMonth() - 1);
    const pfrom = pd.toISOString().slice(0, 10);
    const pe = new Date(d); pe.setUTCDate(0);
    // compare like-for-like days when current month is partial
    let pto = pe.toISOString().slice(0, 10);
    const span = daysBetween(from, to);
    if (to === t && addDays(pfrom, span) < pto) pto = addDays(pfrom, span);
    return { from, to, pfrom, pto };
  }
  const to = addDays(t, -7 * offset); const from = addDays(to, -6);
  return { from, to, pfrom: addDays(from, -7), pto: addDays(from, -1) };
}

r.get('/dashboard/summary', ah(async (req, res) => {
  if (!isReviewer(req.user)) throw forbidden();
  const bid = scope(req);
  const period = req.query.period === 'month' ? 'month' : 'week';
  const rg = await periodRange(period, Number(req.query.offset) || 0);
  const [cur, prev, now, series] = await Promise.all([metrics(rg.from, rg.to, bid), metrics(rg.pfrom, rg.pto, bid), current(bid), dailySeries(rg.from, rg.to, bid)]);
  const ins = await insights(bid, cur, prev, now, period);
  const sev = await q(`SELECT e.data->>'severity' AS label, COUNT(*)::int AS value FROM register_entries e JOIN register_defs d ON d.id=e.register_id
    WHERE d.key='incident' AND e.entry_date BETWEEN $1 AND $2 AND ($3::int IS NULL OR e.branch_id=$3) GROUP BY 1`, [rg.from, rg.to, bid]);
  const maintPri = await q(`SELECT COALESCE(e.data->>'priority','—') AS label, COUNT(*)::int AS value FROM register_entries e JOIN register_defs d ON d.id=e.register_id
    WHERE d.key='maintenance' AND e.entry_date BETWEEN $1 AND $2 AND ($3::int IS NULL OR e.branch_id=$3) GROUP BY 1 ORDER BY 2 DESC`, [rg.from, rg.to, bid]);
  const months = await Promise.all([5, 4, 3, 2, 1, 0].map(async (i) => {
    const m = await periodRange('month', i);
    const [row, tk] = await Promise.all([
      one(`SELECT COALESCE(SUM(total),0) AS exp FROM purchases WHERE status='approved' AND date BETWEEN $1 AND $2 AND ($3::int IS NULL OR branch_id=$3)`, [m.from, m.to, bid]),
      one(`SELECT COUNT(*)::int AS due, COUNT(*) FILTER (WHERE status='done' AND completed_at::date <= due_date)::int AS ok FROM tasks
      WHERE due_date BETWEEN $1 AND $2 AND ($3::int IS NULL OR branch_id=$3)`, [m.from, m.to, bid])]);
    return { month: m.from.slice(0, 7), expenses: Number(row.exp), task_rate: tk.due ? Math.round(tk.ok / tk.due * 100) : null, partial: i === 0 };
  }));
  const byCat = await q(`SELECT COALESCE(c.name,'Uncategorised') AS label, SUM(p.total)::float AS value FROM purchases p LEFT JOIN expense_categories c ON c.id=p.category_id
    WHERE p.status='approved' AND p.date BETWEEN $1 AND $2 AND ($3::int IS NULL OR p.branch_id=$3) GROUP BY 1 ORDER BY 2 DESC`, [rg.from, rg.to, bid]);
  const byMode = await q(`SELECT payment_mode AS mode, SUM(total)::float AS value FROM purchases WHERE status='approved' AND date BETWEEN $1 AND $2 AND ($3::int IS NULL OR branch_id=$3) GROUP BY 1 ORDER BY 2 DESC`, [rg.from, rg.to, bid]);
  byMode.forEach((x) => { x.label = MODES[x.mode] || x.mode; });
  const closingStock = await one('SELECT COALESCE(SUM(qty),0) AS q FROM stock WHERE ($1::int IS NULL OR branch_id=$1)', [bid]);
  const docs = await q(`SELECT title, doc_type, expires_on, (expires_on - CURRENT_DATE) AS days_left FROM documents WHERE expires_on IS NOT NULL AND expires_on <= CURRENT_DATE + 60
    AND ($1::int IS NULL OR branch_id=$1 OR branch_id IS NULL) ORDER BY expires_on`, [bid]);
  res.json({ period, range: rg, current: cur, previous: prev, now, changes: changes(cur, prev), series, insights: ins, severity: sev, maintPriority: maintPri, months, byCat, byMode, closingStock: Number(closingStock.q), docs });
}));

r.get('/dashboard/branches', ah(async (req, res) => {
  if (!seesAll(req.user) && req.user.role !== 'manager') throw forbidden();
  const t = today();
  const from = req.query.from || addDays(t, -29); const to = req.query.to || t;
  const branches = await q('SELECT id, name FROM branches WHERE active ORDER BY id');
  const out = [];
  for (const b of branches) {
    const m = await metrics(from, to, b.id);
    const n = await current(b.id);
    const rate = await onTimeRate(b.id, Math.min(30, daysBetween(from, to) + 1));
    const rs = rate.filter((x) => x.rate !== null);
    out.push({ id: b.id, name: b.name, ...m, open_issues: n.maintenance_open + n.incidents_open, overdue: n.tasks_overdue, low_stock: n.low_stock,
      on_time: rs.length ? Math.round(rs.reduce((a, x) => a + x.rate, 0) / rs.length) : null });
  }
  const weeks = [];
  for (let i = 5; i >= 0; i -= 1) {
    const wto = addDays(t, -7 * i); const wfrom = addDays(wto, -6);
    const row = { label: wfrom.slice(5) };
    for (const b of branches) {
      const c = await one(`SELECT COUNT(*)::int AS n FROM register_entries e JOIN register_defs d ON d.id=e.register_id WHERE d.key='visitor' AND e.branch_id=$1 AND e.entry_date BETWEEN $2 AND $3`, [b.id, wfrom, wto]);
      row['b' + b.id] = c.n;
    }
    weeks.push(row);
  }
  res.json({ from, to, branches: out, weeks });
}));

r.get('/dashboard/digest', ah(async (req, res) => {
  if (!isReviewer(req.user)) throw forbidden();
  const bid = scope(req);
  const t = req.query.date || today();
  const [d, dy, now] = await Promise.all([metrics(t, t, bid), metrics(addDays(t, -1), addDays(t, -1), bid), current(bid)]);
  const w = await periodRange('week'); const mo = await periodRange('month');
  const [wc, wp, mc, mp] = await Promise.all([metrics(w.from, w.to, bid), metrics(w.pfrom, w.pto, bid), metrics(mo.from, mo.to, bid), metrics(mo.pfrom, mo.pto, bid)]);
  const ins = await insights(bid, d, dy, now, 'day');
  const regs = await registerStatus(bid, 2);
  regs.missing.forEach((m) => ins.attention.push({ level: 'pending', text: `${m.register} for ${m.branch} not submitted for ${fd(m.date)}`, link: '#/registers-centre' }));
  const records = await q(`SELECT e.id, d.name AS register, d.key, e.data, e.created_at, u.name AS by FROM register_entries e JOIN register_defs d ON d.id=e.register_id
    LEFT JOIN users u ON u.id=e.created_by WHERE e.entry_date=$1 AND d.key IN ('maintenance','incident','lost_found','inward_outward') AND ($2::int IS NULL OR e.branch_id=$2) ORDER BY e.created_at DESC LIMIT 15`, [t, bid]);
  const purchases = await q(`SELECT p.id, p.purchase_no, p.total, p.status, p.payment_mode, COALESCE(v.name,p.vendor_name) AS vendor FROM purchases p LEFT JOIN vendors v ON v.id=p.vendor_id
    WHERE p.date=$1 AND ($2::int IS NULL OR p.branch_id=$2) ORDER BY p.id DESC LIMIT 15`, [t, bid]);
  res.json({
    date: t, today: d, yesterday: dy, now, insights: ins, records, purchases,
    compare: {
      day: changes(d, dy), week: changes(wc, wp), month: changes(mc, mp)
    }
  });
}));

// ---------- Global search ----------
r.get('/search', ah(async (req, res) => {
  const term = String(req.query.q || '').trim();
  if (term.length < 2) return res.json([]);
  const like = '%' + term + '%';
  const bid = seesAll(req.user) ? null : req.user.branch_id;
  const field = FIELD_ROLES.includes(req.user.role);
  const out = [];
  const entries = await q(`SELECT e.id, e.entry_date, e.data, d.name AS register, d.key, b.name AS branch FROM register_entries e JOIN register_defs d ON d.id=e.register_id
    LEFT JOIN branches b ON b.id=e.branch_id WHERE e.data::text ILIKE $1 AND ($2::int IS NULL OR e.branch_id=$2) AND (NOT $3 OR e.created_by=$4) ORDER BY e.entry_date DESC LIMIT 40`, [like, bid, field, req.user.id]);
  entries.forEach((e) => {
    const hit = Object.entries(e.data).find(([, v]) => typeof v === 'string' && v.toLowerCase().includes(term.toLowerCase()));
    const title = e.data.visitor_name || e.data.issue || e.data.material || e.data.key_name || e.data.vehicle_number || e.data.item || e.data.tracking_number || e.data.from_vendor || (hit ? hit[1] : e.register);
    out.push({ module: e.register, title: String(title).slice(0, 80), sub: `${e.entry_date} · ${e.branch}${hit ? ' · ' + hit[0].replace(/_/g, ' ') + ': ' + String(hit[1]).slice(0, 40) : ''}`, link: `#/entry/${e.id}` });
  });
  if (!field) {
    (await q(`SELECT p.id, p.purchase_no, p.date, p.total, COALESCE(v.name,p.vendor_name) AS vendor FROM purchases p LEFT JOIN vendors v ON v.id=p.vendor_id
      WHERE (p.purchase_no ILIKE $1 OR p.description ILIKE $1 OR p.bill_no ILIKE $1 OR v.name ILIKE $1 OR p.vendor_name ILIKE $1 OR p.mode_details::text ILIKE $1) AND ($2::int IS NULL OR p.branch_id=$2) LIMIT 15`, [like, bid]))
      .forEach((p) => out.push({ module: 'Purchase', title: `${p.purchase_no} · ${p.vendor || ''}`, sub: `${p.date} · ${inr(p.total)}`, link: `#/purchase/${p.id}` }));
    (await q(`SELECT id, voucher_no, date, amount, payee FROM vouchers WHERE (voucher_no ILIKE $1 OR payee ILIKE $1 OR narration ILIKE $1 OR mode_details::text ILIKE $1) AND ($2::int IS NULL OR branch_id=$2) LIMIT 15`, [like, bid]))
      .forEach((v) => out.push({ module: 'Voucher', title: `${v.voucher_no} · ${v.payee || ''}`, sub: `${v.date} · ${inr(v.amount)}`, link: `#/voucher/${v.id}` }));
    (await q('SELECT id, name, phone, gstin FROM vendors WHERE name ILIKE $1 OR phone ILIKE $1 OR gstin ILIKE $1 LIMIT 10', [like]))
      .forEach((v) => out.push({ module: 'Vendor', title: v.name, sub: [v.phone, v.gstin].filter(Boolean).join(' · '), link: `#/vendor/${v.id}` }));
    (await q('SELECT id, title, doc_type, expires_on FROM documents WHERE title ILIKE $1 OR number ILIKE $1 OR notes ILIKE $1 LIMIT 10', [like]))
      .forEach((d) => out.push({ module: d.doc_type === 'license' ? 'Licence' : 'Document', title: d.title, sub: d.expires_on ? 'Expires ' + d.expires_on : '', link: '#/documents' }));
  }
  (await q(`SELECT t.id, t.date, t.qty, t.issued_to, i.name AS item, i.id AS item_id, ba.name AS batch FROM module_txns t JOIN items i ON i.id=t.item_id LEFT JOIN batches ba ON ba.id=t.batch_id
    WHERE t.status='active' AND t.kind='issue' AND (COALESCE(t.students,'') ILIKE $1 OR COALESCE(t.issued_to,'') ILIKE $1) AND ($2::int IS NULL OR t.branch_id=$2) ORDER BY t.date DESC LIMIT 15`, [like, bid]))
    .forEach((t) => out.push({ module: 'Store issue', title: `${t.item} × ${t.qty}`, sub: `${t.date} · ${t.batch || t.issued_to || ''}`, link: `#/store/item/${t.item_id}` }));
  (await q('SELECT id, name, sku, unit FROM items WHERE name ILIKE $1 OR sku ILIKE $1 LIMIT 10', [like]))
    .forEach((i) => out.push({ module: 'Inventory', title: i.name, sub: i.sku || i.unit, link: `#/inventory?item=${i.id}` }));
  (await q(`SELECT id, title, status, due_date FROM tasks WHERE (title ILIKE $1 OR description ILIKE $1) AND ($2::int IS NULL OR branch_id=$2) AND (NOT $3 OR assigned_to=$4 OR requested_by=$4) LIMIT 10`, [like, bid, field, req.user.id]))
    .forEach((t) => out.push({ module: 'Task', title: t.title, sub: `${t.status}${t.due_date ? ' · due ' + t.due_date : ''}`, link: `#/tasks?open=${t.id}` }));
  res.json(out);
}));

// ---------- Custom report builder ----------
r.get('/reports/modules', ah(async (req, res) => {
  const defs = await q("SELECT key, name, fields FROM register_defs WHERE status='active' ORDER BY sort, name");
  const base = {
    purchases: { name: 'Purchases & expenses', fields: ['purchase_no', 'date', 'branch', 'vendor', 'category', 'description', 'payment_mode', 'bill_no', 'subtotal', 'gst_amount', 'total', 'amount_paid', 'payment_status', 'status', 'voucher_no', 'created_by'] },
    vouchers: { name: 'Vouchers', fields: ['voucher_no', 'type', 'purpose', 'date', 'branch', 'payee', 'amount', 'payment_mode', 'reference', 'narration', 'status', 'created_by', 'approved_by'] },
    petty_cash: { name: 'Petty cash book', fields: ['date', 'branch', 'type', 'voucher_no', 'narration', 'amount'] },
    stock_movements: { name: 'Inventory movements', fields: ['date', 'branch', 'item', 'type', 'qty', 'unit', 'issued_to', 'remarks', 'created_by'] },
    tasks: { name: 'Tasks', fields: ['title', 'branch', 'assigned_to', 'priority', 'status', 'due_date', 'completed_at', 'category'] },
    documents: { name: 'Documents & licences', fields: ['title', 'doc_type', 'branch', 'number', 'issued_on', 'expires_on', 'vendor'] }
  };
  defs.forEach((d) => {
    base['register:' + d.key] = { name: d.name, fields: ['entry_date', 'branch', 'status', ...d.fields.filter((f) => !['file', 'image', 'signature', 'checklist'].includes(f.type)).map((f) => f.key), 'created_by'],
      labels: Object.fromEntries(d.fields.map((f) => [f.key, f.label])) };
  });
  res.json(base);
}));

r.post('/reports/run', ah(async (req, res) => {
  if (!isReviewer(req.user)) throw forbidden();
  const b = req.body || {};
  const from = b.from || addDays(today(), -30); const to = b.to || today();
  const bid = seesAll(req.user) ? (b.branch_id && b.branch_id !== 'all' ? Number(b.branch_id) : null) : req.user.branch_id;
  const p = [from, to, bid];
  let rows = [];
  if (b.module === 'purchases') {
    rows = await q(`SELECT p.purchase_no, p.date, br.name AS branch, COALESCE(v.name,p.vendor_name) AS vendor, c.name AS category, p.description, p.payment_mode, p.bill_no,
      p.subtotal, p.gst_amount, p.total, p.amount_paid, p.payment_status, p.status, u.name AS created_by,
      (SELECT voucher_no FROM vouchers WHERE purchase_id=p.id AND purpose='purchase' AND status<>'cancelled' ORDER BY id DESC LIMIT 1) AS voucher_no
      FROM purchases p LEFT JOIN vendors v ON v.id=p.vendor_id LEFT JOIN branches br ON br.id=p.branch_id LEFT JOIN expense_categories c ON c.id=p.category_id
      LEFT JOIN users u ON u.id=p.created_by WHERE p.date BETWEEN $1 AND $2 AND ($3::int IS NULL OR p.branch_id=$3) ORDER BY p.date`, p);
    rows.forEach((x) => { x.payment_mode = MODES[x.payment_mode] || x.payment_mode; });
  } else if (b.module === 'vouchers') {
    rows = await q(`SELECT v.voucher_no, v.type, v.purpose, v.date, br.name AS branch, v.payee, v.amount, v.payment_mode,
      COALESCE(v.mode_details->>'reference', v.mode_details->>'cheque_no', v.mode_details->>'card_last4') AS reference, v.narration, v.status, u.name AS created_by, a.name AS approved_by
      FROM vouchers v LEFT JOIN branches br ON br.id=v.branch_id LEFT JOIN users u ON u.id=v.created_by LEFT JOIN users a ON a.id=v.approved_by
      WHERE v.date BETWEEN $1 AND $2 AND ($3::int IS NULL OR v.branch_id=$3) ORDER BY v.date`, p);
    rows.forEach((x) => { x.payment_mode = MODES[x.payment_mode] || x.payment_mode; });
  } else if (b.module === 'petty_cash') {
    rows = await q(`SELECT pc.date, br.name AS branch, pc.type, v.voucher_no, pc.narration, pc.amount FROM petty_cash pc LEFT JOIN branches br ON br.id=pc.branch_id
      LEFT JOIN vouchers v ON v.id=pc.voucher_id WHERE pc.date BETWEEN $1 AND $2 AND ($3::int IS NULL OR pc.branch_id=$3) ORDER BY pc.date, pc.id`, p);
  } else if (b.module === 'stock_movements') {
    rows = await q(`SELECT m.created_at::date AS date, br.name AS branch, i.name AS item, m.type, m.qty, i.unit, m.issued_to, m.remarks, u.name AS created_by
      FROM stock_movements m JOIN items i ON i.id=m.item_id LEFT JOIN branches br ON br.id=m.branch_id LEFT JOIN users u ON u.id=m.created_by
      WHERE m.created_at::date BETWEEN $1 AND $2 AND ($3::int IS NULL OR m.branch_id=$3) ORDER BY m.created_at`, p);
  } else if (b.module === 'tasks') {
    rows = await q(`SELECT t.title, br.name AS branch, a.name AS assigned_to, t.priority, t.status, t.due_date, t.completed_at::date AS completed_at, t.category
      FROM tasks t LEFT JOIN branches br ON br.id=t.branch_id LEFT JOIN users a ON a.id=t.assigned_to
      WHERE t.created_at::date BETWEEN $1 AND $2 AND ($3::int IS NULL OR t.branch_id=$3) ORDER BY t.created_at`, p);
  } else if (b.module === 'documents') {
    rows = await q(`SELECT d.title, d.doc_type, br.name AS branch, d.number, d.issued_on, d.expires_on, v.name AS vendor FROM documents d
      LEFT JOIN branches br ON br.id=d.branch_id LEFT JOIN vendors v ON v.id=d.vendor_id WHERE ($3::int IS NULL OR d.branch_id=$3 OR d.branch_id IS NULL)
      AND (d.created_at::date BETWEEN $1 AND $2 OR d.expires_on BETWEEN $1 AND $2) ORDER BY d.expires_on NULLS LAST`, p);
  } else if (String(b.module || '').startsWith('register:')) {
    const key = b.module.slice(9);
    const ents = await q(`SELECT e.entry_date, br.name AS branch, e.status, e.data, u.name AS created_by FROM register_entries e JOIN register_defs d ON d.id=e.register_id
      LEFT JOIN branches br ON br.id=e.branch_id LEFT JOIN users u ON u.id=e.created_by WHERE d.key=$4 AND e.entry_date BETWEEN $1 AND $2 AND ($3::int IS NULL OR e.branch_id=$3) ORDER BY e.entry_date, e.id`, [...p, key]);
    rows = ents.map((e) => ({ entry_date: e.entry_date, branch: e.branch, status: e.status, ...e.data, created_by: e.created_by }));
  } else throw bad('Choose a module.');
  // filters: [{field, op, value}]
  (b.filters || []).forEach((f) => {
    if (!f.field || f.value === undefined || f.value === '') return;
    const val = String(f.value).toLowerCase(); const num = Number(f.value);
    rows = rows.filter((row) => {
      const v = row[f.field];
      if (f.op === 'gt') return Number(v) > num;
      if (f.op === 'lt') return Number(v) < num;
      if (f.op === 'eq') return String(v ?? '').toLowerCase() === val;
      return String(v ?? '').toLowerCase().includes(val);
    });
  });
  const fields = Array.isArray(b.fields) && b.fields.length ? b.fields : (rows[0] ? Object.keys(rows[0]).filter((k) => typeof rows[0][k] !== 'object' || rows[0][k] === null) : []);
  rows = rows.map((row) => Object.fromEntries(fields.map((f) => [f, row[f] !== null && typeof row[f] === 'object' ? JSON.stringify(row[f]) : row[f]])));
  res.json({ from, to, fields, rows });
}));

module.exports = { router: r, metrics, current };
