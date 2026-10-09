// Core helpers: html templating, API, router, layout, UI primitives, charts.
class Raw { constructor(s) { this.s = s; } toString() { return this.s; } }
export const raw = (s) => new Raw(s);
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const rnd = (v) => (v === null || v === undefined || v === false ? '' : v instanceof Raw ? v.s : Array.isArray(v) ? v.map(rnd).join('') : esc(String(v)));
export function html(strings, ...vals) {
  let out = '';
  strings.forEach((s, i) => { out += s; if (i < vals.length) out += rnd(vals[i]); });
  return new Raw(out);
}

export const state = { me: null, lookups: null, settings: {} };

let GEN = 0;
class Stale extends Error { constructor() { super('stale'); this.stale = true; } }
export async function api(path, opts = {}) {
  const g0 = GEN;
  const init = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
  if (opts.body !== undefined) {
    if (opts.body instanceof FormData) init.body = opts.body;
    else { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  }
  const res = await fetch('/api' + path, init);
  let data = null;
  try { data = await res.json(); } catch (e) { data = null; }
  if (res.status === 401 && !path.startsWith('/auth')) { state.me = null; renderLogin(); throw new Error('Please sign in.'); }
  if (!res.ok) throw new Error((data && data.error) || 'Request failed.');
  if (g0 !== GEN && init.method === 'GET') throw new Stale();
  return data;
}
export const post = (p, body) => api(p, { method: 'POST', body: body || {} });
export const put = (p, body) => api(p, { method: 'PUT', body: body || {} });

export async function loadLookups(force) {
  if (!state.lookups || force) state.lookups = await api('/lookups');
  return state.lookups;
}

// ---------- formatting ----------
export const inr = (n, dec) => (n === null || n === undefined || n === '' ? '—' : '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: dec ? 2 : 0, minimumFractionDigits: dec ? 2 : 0 }));
export const inrShort = (n) => { n = Number(n) || 0; if (Math.abs(n) >= 1e7) return '₹' + (n / 1e7).toFixed(2) + 'Cr'; if (Math.abs(n) >= 1e5) return '₹' + (n / 1e5).toFixed(2) + 'L'; if (Math.abs(n) >= 1e3) return '₹' + (n / 1e3).toFixed(1) + 'K'; return '₹' + Math.round(n); };
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fdate = (d) => { if (!d) return '—'; const s = String(d).slice(0, 10).split('-'); return `${s[2]} ${MON[Number(s[1]) - 1]} ${s[0]}`; };
export const fdateShort = (d) => { if (!d) return ''; const s = String(d).slice(0, 10).split('-'); return `${Number(s[2])} ${MON[Number(s[1]) - 1]}`; };
export const fdt = (d) => { if (!d) return '—'; const x = new Date(d); if (Number.isNaN(x.getTime())) return String(d).replace('T', ' '); return x.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }); };
export const ftime = (d) => { if (!d) return '—'; if (/^\d{2}:\d{2}/.test(d)) return d.slice(0, 5); const s = String(d); if (/T\d{2}:\d{2}/.test(s) && !/Z|[+-]\d{2}:?\d{2}$/.test(s)) return s.slice(11, 16); return new Date(d).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' }); };
export const todayStr = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const nowLocal = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 16);
export const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
export const pctTxt = (p) => (p === null || p === undefined ? 'new' : (p > 0 ? '+' : '') + p + '%');
export const cap = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

const BADGE = {
  submitted: 'pend', pending: 'pend', approved: 'ok', paid: 'ok', verified: 'ok', reviewed: 'info', rejected: 'crit', cancelled: '', returned: 'high',
  unpaid: 'high', partial: 'pend', done: 'ok', in_progress: 'info', urgent: 'crit', high: 'high', normal: '', low: '',
  Critical: 'crit', High: 'high', Medium: 'pend', Low: 'info', Open: 'high', Assigned: 'pend', 'In progress': 'info', Investigating: 'pend', Resolved: 'ok', Closed: 'ok'
};
export const badge = (s, label) => html`<span class="bd ${BADGE[s] || ''}">${label || cap(s)}</span>`;

// ---------- icons ----------
const P = {
  home: 'M3 11l9-8 9 8M5 10v10h14V10', chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2', clip: 'M9 4h6v3H9zM7 5H5v16h14V5h-2M8 12h8M8 16h5',
  cart: 'M3 4h2l2.4 11h11L21 7H6M9 20a1 1 0 100-2 1 1 0 000 2zM18 20a1 1 0 100-2 1 1 0 000 2z', receipt: 'M6 2h12v20l-3-2-3 2-3-2-3 2zM9 7h6M9 11h6M9 15h4',
  wallet: 'M3 7h16a2 2 0 012 2v9a2 2 0 01-2 2H3zM3 7l12-4v4M16 13h2', box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
  tasks: 'M9 6h11M9 12h11M9 18h11M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2', file: 'M14 2H6v20h12V6zM14 2v4h4M9 13h6M9 17h6',
  users: 'M16 20v-2a4 4 0 00-8 0v2M12 12a4 4 0 100-8 4 4 0 000 8zM20 20v-2a3 3 0 00-2-2.8M17 4.2a3 3 0 010 5.6',
  cog: 'M12 15a3 3 0 100-6 3 3 0 000 6zM19 12l2-1-1-3-2 .2-1.3-1.3.2-2-3-1-1 2h-2l-1-2-3 1 .2 2L5.8 8 3.8 8l-1 3 2 1v2l-2 1 1 3 2-.2 1.3 1.3-.2 2 3 1 1-2h2l1 2 3-1-.2-2 1.3-1.3 2 .2 1-3-2-1z',
  search: 'M11 18a7 7 0 100-14 7 7 0 000 14zM21 21l-4.3-4.3', plus: 'M12 5v14M5 12h14', check: 'M5 12l5 5L20 7', camera: 'M3 8h4l2-3h6l2 3h4v12H3zM12 17a4 4 0 100-8 4 4 0 000 8z',
  mic: 'M12 15a3 3 0 003-3V6a3 3 0 00-6 0v6a3 3 0 003 3zM19 11a7 7 0 01-14 0M12 18v3', alert: 'M12 3l10 18H2zM12 10v5M12 18v.5',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z', key: 'M15 7a4 4 0 11-3.9 5H3v3h3v3h3v-3h2.1A4 4 0 0115 7z', truck: 'M2 6h12v10H2zM14 10h4l3 3v3h-7M6 19a2 2 0 100-4 2 2 0 000 4zM17 19a2 2 0 100-4 2 2 0 000 4z',
  broom: 'M14 3l-4 9M7 12h8l2 9H5zM9 17v4M13 17v4', door: 'M5 21V3h11v18M5 21h14M13 12h.5', person: 'M12 12a4 4 0 100-8 4 4 0 000 8zM5 21a7 7 0 0114 0',
  menu: 'M3 6h18M3 12h18M3 18h18', logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11', print: 'M6 9V3h12v6M6 18H3v-8h18v8h-3M7 14h10v7H7z', edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  inbox: 'M3 13h5l1 3h6l1-3h5M5 4h14l2 9v7H3v-7z', layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5', star: 'M12 3l3 6 6 1-4.5 4 1 6-5.5-3-5.5 3 1-6L3 10l6-1z'
};
export const icon = (n) => raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n] || ''}"/></svg>`);

// ---------- UI primitives ----------
export function toast(msg, isErr) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  const d = document.createElement('div');
  if (isErr) d.className = 'err';
  d.textContent = msg; t.appendChild(d);
  setTimeout(() => d.remove(), isErr ? 6000 : 3200);
}
export const err = (e) => toast(e.message || String(e), true);

export function modal(title, body, { wide, onMount, actions } = {}) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = html`<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="mh"><h2>${title}</h2><button type="button" class="btn sm" data-x="close" aria-label="Close">✕</button></div>
      <div class="mb">${body}</div>
      ${actions === false ? '' : html`<div class="mf">${actions || html`<button type="button" class="btn" data-x="close">Cancel</button><button type="button" class="btn pri" data-x="ok">Save</button>`}</div>`}
    </div>`.s;
    document.body.appendChild(bg);
    const close = (v) => { bg.remove(); resolve(v); };
    const box = bg.querySelector('.modal');
    const ctx = { el: box, close, busy: false };
    bg.addEventListener('click', async (ev) => {
      if (ev.target === bg) return close(null);
      const b = ev.target.closest('[data-x]');
      if (!b) return;
      if (b.dataset.x === 'close') return close(null);
      if (ctx.busy) return;
      if (ctx.onAction) {
        ctx.busy = true; b.disabled = true;
        try { const v = await ctx.onAction(b.dataset.x, box); if (v !== undefined) close(v); } catch (e) { err(e); } finally { ctx.busy = false; b.disabled = false; }
      } else close(b.dataset.x);
    });
    if (onMount) onMount(ctx);
    const f = box.querySelector('input,select,textarea'); if (f) setTimeout(() => f.focus(), 30);
  });
}
export function promptReason(title, label = 'Reason', { required = true, placeholder = '', okLabel = 'Confirm', danger } = {}) {
  return modal(title, html`<div class="fld"><label for="pr">${label}${required ? html` <span class="req">*</span>` : ''}</label><textarea id="pr" placeholder="${placeholder}"></textarea></div>`, {
    actions: html`<button type="button" class="btn" data-x="close">Cancel</button><button type="button" class="btn ${danger ? 'danger' : 'pri'}" data-x="ok">${okLabel}</button>`,
    onMount: (ctx) => { ctx.onAction = async (a, el) => { const v = el.querySelector('#pr').value.trim(); if (required && !v) throw new Error(`${label} is required.`); return v || ''; }; }
  });
}
export const confirmBox = (title, text, okLabel = 'Confirm') => modal(title, html`<p>${text}</p>`, { actions: html`<button type="button" class="btn" data-x="close">Cancel</button><button type="button" class="btn pri" data-x="ok">${okLabel}</button>` });

// Collect named inputs inside an element into an object
export function formData(el) {
  const o = {};
  el.querySelectorAll('[name]').forEach((i) => {
    if (i.type === 'radio') { if (i.checked) o[i.name] = i.value; else if (!(i.name in o)) o[i.name] = ''; return; }
    if (i.type === 'checkbox') { o[i.name] = i.checked; return; }
    o[i.name] = i.value;
  });
  return o;
}
export const opts = (list, sel, { blank, val = 'id', lab = 'name' } = {}) => html`${blank !== undefined ? html`<option value="">${blank}</option>` : ''}${list.map((x) => {
  const v = typeof x === 'object' ? x[val] : x; const l = typeof x === 'object' ? x[lab] : x;
  return html`<option value="${v}" ${String(v) === String(sel ?? '') ? raw('selected') : ''}>${l}</option>`;
})}`;

// Delegated events scoped to the current page; cleared on navigation
let handlers = [];
export function on(type, selector, fn) { handlers.push({ type, selector, fn }); }
['click', 'change', 'input', 'submit', 'keydown'].forEach((type) => {
  document.addEventListener(type, (ev) => {
    for (const h of handlers) {
      if (h.type !== type) continue;
      const t = ev.target.closest && ev.target.closest(h.selector);
      if (t) { if (type === 'submit') ev.preventDefault(); Promise.resolve(h.fn(t, ev)).catch(err); }
    }
  });
});

// ---------- Charts ----------
export const PALETTE = ['#400C4D', '#C2541B', '#1C7C7D', '#B79AC2', '#E9A77D', '#23395B', '#7FB5B5', '#A39E92'];
let charts = [];
export function chart(id, config) {
  const c = document.getElementById(id);
  if (!c || !window.Chart) return null;
  const Chart = window.Chart;
  Chart.defaults.font.family = "'IBM Plex Sans', system-ui, sans-serif";
  Chart.defaults.color = '#5D5966';
  Chart.defaults.borderColor = '#ECE9E4';
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  config.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: { duration: 300 } }, config.options || {});
  const allData = (config.data.datasets || []).flatMap((d) => d.data || []);
  if (config.type !== 'line' && allData.length && allData.every((v) => !v)) {
    const box = c.parentElement; box.innerHTML = '<div class="empty" style="height:100%;display:flex;align-items:center;justify-content:center">No data for this period yet</div>'; return null;
  }
  if (!allData.length) { c.parentElement.innerHTML = '<div class="empty">No data for this period yet</div>'; return null; }
  const ch = new Chart(c, config);
  charts.push(ch);
  return ch;
}
export function spark(id, data, color = '#400C4D') {
  return chart(id, {
    type: 'line',
    data: { labels: data.map((_, i) => i), datasets: [{ data, borderColor: color, backgroundColor: color + '18', fill: true, tension: 0.35, pointRadius: 0, borderWidth: 2 }] },
    options: { plugins: { legend: { display: false }, tooltip: { enabled: false } }, scales: { x: { display: false }, y: { display: false, beginAtZero: true } }, animation: false }
  });
}
export const moneyTick = { callback: (v) => inrShort(v) };

// ---------- Router & layout ----------
const routes = [];
export function route(pattern, handler, opts = {}) { routes.push({ re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, opts }); }
export function go(hash) { if (location.hash === hash) render(); else location.hash = hash; }
export function parseHash() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  return { path, query: Object.fromEntries(new URLSearchParams(qs || '')) };
}

export const can = {
  mgmt: () => ['owner', 'admin'].includes(state.me.role),
  finance: () => ['owner', 'admin', 'accounts'].includes(state.me.role),
  review: () => ['owner', 'admin', 'manager', 'accounts'].includes(state.me.role),
  field: () => ['guard', 'office_boy', 'housekeeping', 'driver', 'maintenance'].includes(state.me.role),
  allBranches: () => ['owner', 'admin', 'accounts'].includes(state.me.role)
};

function navFor() {
  const r = state.me.role;
  const items = [];
  const add = (grp, list) => items.push({ grp, list });
  if (can.field() || r === 'staff') {
    add('My work', [['#/', 'home', 'Home'], ['#/my-submissions', 'inbox', 'My submissions'], ['#/tasks', 'tasks', 'My tasks'], ['#/purchase/new', 'cart', 'Purchase / errand'], ['#/purchases', 'receipt', 'My purchases'], ['#/quick-issue', 'alert', 'Report issue']]);
    add('Registers', [['#/registers', 'clip', 'All registers']]);
    return items;
  }
  add('Overview', [['#/', 'home', r === 'manager' ? 'Branch dashboard' : 'Control Centre'], ['#/digest', 'star', 'Daily Digest'], ['#/summary', 'chart', 'Weekly & Monthly'],
    ...(can.allBranches() || r === 'manager' ? [['#/branches', 'layers', 'Branch Comparison']] : [])]);
  add('Registers & Logs', [['#/registers-centre', 'clip', 'Registers Centre'], ['#/registers', 'inbox', 'All registers'], ['#/review', 'check', 'Review & verify'],
    ...(can.mgmt() ? [['#/register-builder', 'plus', 'Register Builder']] : [])]);
  add('Money', [['#/approvals', 'check', 'Approvals'], ['#/purchases', 'cart', 'Purchases & expenses'], ['#/vouchers', 'receipt', 'Vouchers'], ['#/petty-cash', 'wallet', 'Petty cash'], ['#/vendors', 'users', 'Vendors']]);
  add('Operations', [['#/inventory', 'box', 'Inventory'], ['#/tasks', 'tasks', 'Tasks'], ['#/documents', 'file', 'Documents & compliance'], ['#/reports', 'chart', 'Report Builder']]);
  if (can.mgmt()) add('Admin', [['#/admin/users', 'users', 'Users & roles'], ['#/admin/branches', 'home', 'Branches'], ['#/admin/items', 'box', 'Items'], ['#/admin/categories', 'layers', 'Expense categories'], ['#/settings', 'cog', 'Settings']]);
  else if (r === 'accounts' || r === 'manager') add('Masters', [['#/admin/items', 'box', 'Items']]);
  return items;
}

function shell() {
  const me = state.me;
  const initials = me.name.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean).map((x) => x[0]).slice(0, 2).join('').toUpperCase();
  document.getElementById('app').innerHTML = html`<div class="shell">
    <aside class="side" id="side">
      <div class="brandblk"><div class="b1">S-<span>CUBUS</span></div><div class="b2">Operations Control</div></div>
      <nav class="nav" aria-label="Main">${navFor().map((g) => html`<div class="grp">${g.grp}</div>${g.list.map(([href, ic, label]) => html`<a href="${href}" data-nav="${href}">${icon(ic)}<span>${label}</span></a>`)}`)}
        <div class="grp">Account</div><a href="#/password">${icon('key')}<span>Change password</span></a><a href="#" data-act="logout">${icon('logout')}<span>Sign out</span></a>
      </nav>
    </aside>
    <div class="main">
      <header class="top">
        <button type="button" class="btn sm menu-btn" data-act="menu" aria-label="Open menu">${icon('menu')}</button>
        <form class="search" role="search" data-form="gsearch"><label for="gs" class="sr">Search all registers and records</label>${icon('search')}<input id="gs" type="search" placeholder="Search everything — vehicle no., name, voucher, item…" autocomplete="off"></form>
        <div class="who"><div class="nm" style="text-align:right"><div style="font-weight:600">${me.name}</div><div class="muted tiny">${state.roles[me.role]}${me.branch_name ? ' · ' + me.branch_name : ''}</div></div><div class="av">${initials}</div></div>
      </header>
      <main class="content" id="content" tabindex="-1"></main>
    </div>
  </div>`.s;
}

document.addEventListener('click', async (ev) => {
  const a = ev.target.closest('[data-act="logout"]');
  if (a) { ev.preventDefault(); await post('/auth/logout'); state.me = null; location.hash = '#/'; renderLogin(); }
  const m = ev.target.closest('[data-act="menu"]');
  if (m) document.getElementById('side').classList.toggle('open');
  if (ev.target.closest('.nav a')) { const s = document.getElementById('side'); if (s) s.classList.remove('open'); }
});
document.addEventListener('submit', (ev) => {
  if (ev.target.matches('[data-form="gsearch"]')) { ev.preventDefault(); const v = ev.target.querySelector('input').value.trim(); if (v) go('#/search?q=' + encodeURIComponent(v)); }
});

export function page(title, body) {
  const c = document.getElementById('content');
  c.innerHTML = (body instanceof Raw ? body.s : rnd(body));
  document.title = `${title} · S-CUBUS Operations`;
}
export function loading() { const c = document.getElementById('content'); if (c) c.innerHTML = '<div class="empty">Loading…</div>'; }

export async function render() {
  if (!state.me) return renderLogin();
  GEN += 1;
  charts.forEach((c) => c.destroy()); charts = [];
  handlers = [];
  const { path, query } = parseHash();
  document.querySelectorAll('.nav a[data-nav]').forEach((a) => {
    const href = a.dataset.nav.slice(1);
    a.classList.toggle('on', href === path || (href !== '/' && path.startsWith(href + '/') && !routes.some(() => false)));
  });
  loading();
  for (const r of routes) {
    const m = r.re.exec(path);
    if (m) {
      try { await r.handler(m.groups || {}, query); } catch (e) { if (e.stale) return; page('Error', html`<div class="callout crit">${e.message}</div>`); }
      window.scrollTo(0, 0);
      return;
    }
  }
  page('Not found', html`<div class="empty">Page not found. <a href="#/">Go home</a></div>`);
}

export function renderLogin() {
  document.title = 'Sign in · S-CUBUS Operations';
  document.getElementById('app').innerHTML = html`<div class="login"><form class="box" id="loginf">
    <div><div class="b1">S-<span>CUBUS</span></div><div class="muted small">Operations Control System</div></div>
    <div class="fld"><label for="le">Email or phone</label><input id="le" name="email" type="text" autocomplete="username" required></div>
    <div class="fld"><label for="lp">Password</label><input id="lp" name="password" type="password" autocomplete="current-password" required></div>
    <button class="btn pri lg" type="submit">Sign in</button>
    <div class="muted tiny" id="lerr" role="alert"></div>
  </form></div>`.s;
  document.getElementById('loginf').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = formData(ev.target);
    try { await post('/auth/login', f); await boot(); } catch (e) { document.getElementById('lerr').textContent = e.message; }
  });
}

export async function boot() {
  try {
    const r = await api('/me');
    state.me = r.user; state.roles = r.roles; state.settings = r.settings;
  } catch (e) { return; }
  await loadLookups(true);
  shell();
  render();
}
window.addEventListener('hashchange', () => { if (state.me) render(); });
