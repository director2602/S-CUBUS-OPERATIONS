// Dynamic register fields: render, behaviour (show-if, uploads, signature, voice), collect, display.
import { html, raw, esc, state, opts, icon, nowLocal, todayStr, toast, err, fdate, fdt, inr, badge } from './core.js';

const id = (k) => 'f_' + k;

function visible(f, data) {
  if (!f.showIf) return true;
  const v = data[f.showIf.field];
  if (f.showIf.equals !== undefined) return v === f.showIf.equals;
  return (f.showIf.in || []).includes(v);
}

export function renderFields(fields, data = {}, { isNew } = {}) {
  const L = state.lookups;
  return html`${fields.map((f) => {
    let v = data[f.key];
    if (isNew && (v === undefined || v === '')) {
      if (f.defaultNow) v = f.type === 'date' ? todayStr() : (f.type === 'time' ? nowLocal().slice(11) : nowLocal());
      else if (f.default !== undefined) v = f.default;
      else if (f.type === 'user' && /guard_name|handed_by|driver|booked_by/.test(f.key)) v = state.me.name;
    }
    const req = f.required ? html` <span class="req">*</span>` : '';
    const wide = ['textarea', 'checklist', 'signature', 'multiselect'].includes(f.type);
    const sh = f.showIf ? raw(`data-showif='${esc(JSON.stringify(f.showIf))}'`) : '';
    const hide = f.showIf && !visible(f, data) ? 'hidden' : '';
    const hiLine = f.hi ? html`<span class="hi">${f.hi}</span>` : '';
    const lab = html`<label for="${id(f.key)}" ${f.hi ? raw('data-hi="1"') : ''}>${f.label}${req}${hiLine}</label>`;
    const val = v === undefined || v === null ? '' : v;
    let input;
    switch (f.type) {
      case 'textarea':
        input = html`<div class="lab" style="display:flex;justify-content:space-between;align-items:center;gap:8px"><label for="${id(f.key)}" style="font-size:13px;font-weight:600">${f.label}${req}</label>
          ${window.SpeechRecognition || window.webkitSpeechRecognition ? html`<button type="button" class="btn sm" data-mic="${id(f.key)}" aria-label="Speak to fill ${f.label}">${icon('mic')} Speak</button>` : ''}</div>
          <textarea id="${id(f.key)}" name="${id(f.key)}">${val}</textarea>`;
        break;
      case 'number': case 'currency':
        input = html`${lab}<input type="number" step="any" inputmode="decimal" id="${id(f.key)}" name="${id(f.key)}" value="${val}">`; break;
      case 'date': input = html`${lab}<input type="date" id="${id(f.key)}" name="${id(f.key)}" value="${val}">`; break;
      case 'time': input = html`${lab}<input type="time" id="${id(f.key)}" name="${id(f.key)}" value="${String(val).slice(0, 5)}">`; break;
      case 'datetime': input = html`${lab}<div style="display:flex;gap:6px"><input type="datetime-local" id="${id(f.key)}" name="${id(f.key)}" value="${String(val).slice(0, 16)}"><button type="button" class="btn sm" data-now="${id(f.key)}">Now</button></div>`; break;
      case 'phone': input = html`${lab}<input type="tel" inputmode="tel" id="${id(f.key)}" name="${id(f.key)}" value="${val}" autocomplete="off">`; break;
      case 'email': input = html`${lab}<input type="email" id="${id(f.key)}" name="${id(f.key)}" value="${val}">`; break;
      case 'select': input = html`${lab}<select id="${id(f.key)}" name="${id(f.key)}">${opts(f.options, val, { blank: '— Select —' })}</select>`; break;
      case 'user': input = html`${lab}<input type="text" list="dl_users" id="${id(f.key)}" name="${id(f.key)}" value="${val}" autocomplete="off">`; break;
      case 'item': input = html`${lab}<select id="${id(f.key)}" name="${id(f.key)}">${opts(L.items, val, { blank: '— None —' })}</select>`; break;
      case 'vehicle': input = html`${lab}<input type="text" id="${id(f.key)}" name="${id(f.key)}" value="${val}" style="text-transform:uppercase" autocomplete="off" placeholder="DL01AB1234">`; break;
      case 'checkbox': input = html`<label class="chk"><input type="checkbox" name="${id(f.key)}" ${val === true || val === 'true' ? raw('checked') : ''}> ${f.label}${req}</label>`; break;
      case 'yesno': input = html`<div class="lab">${f.label}${req}</div><div class="yn" role="radiogroup" aria-label="${f.label}">${['Yes', 'No'].map((o) => html`<label><input type="radio" name="${id(f.key)}" value="${o}" ${val === o ? raw('checked') : ''}><span>${o}</span></label>`)}</div>`; break;
      case 'multiselect': {
        const arr = Array.isArray(val) ? val : [];
        input = html`<div class="lab">${f.label}${req}</div><div style="display:flex;flex-wrap:wrap;gap:4px 16px">${f.options.map((o) => html`<label class="chk"><input type="checkbox" data-ms="${id(f.key)}" value="${o}" ${arr.includes(o) ? raw('checked') : ''}> ${o}</label>`)}</div>`;
        break;
      }
      case 'checklist': {
        const cv = val && typeof val === 'object' ? val : {};
        input = html`<div class="lab">${f.label}${req}</div><div class="checklist">${f.options.map((o, i) => {
          const cur = cv[o] || {};
          return html`<div class="row"><span>${o}</span><span class="opts" role="radiogroup" aria-label="${o}">
            ${[['Completed', '✓'], ['Not Completed', '✗'], ['Not Applicable', 'N/A']].map(([s, t]) => html`<label title="${s}"><input type="radio" name="cl_${f.key}_${i}" value="${s}" ${cur.status === s ? raw('checked') : ''}><span aria-label="${s}">${t}</span></label>`)}
            </span><input class="rem ${cur.status === 'Not Completed' ? '' : 'hidden'}" type="text" name="clr_${f.key}_${i}" value="${cur.remark || ''}" placeholder="Remark required — what was wrong?" aria-label="Remark for ${o}"></div>`;
        })}</div><div style="display:flex;gap:6px;margin-top:6px"><button type="button" class="btn sm" data-allok="${f.key}">Mark all completed</button></div>`;
        break;
      }
      case 'file': case 'image': case 'signature': {
        const isImg = f.type !== 'file';
        input = html`<div class="lab">${f.label}${req}</div>
          <input type="hidden" name="${id(f.key)}" value="${val}">
          ${f.type === 'signature' ? html`<canvas class="sig" data-sig="${id(f.key)}" aria-label="Sign here with finger or mouse"></canvas>
            <div style="display:flex;gap:8px;align-items:center"><button type="button" class="btn sm" data-sigclear="${id(f.key)}">Clear</button><span class="tiny muted">Sign above</span>
            ${val ? html`<img src="/api/files/${val}" alt="Saved signature" style="height:40px;border:1px solid var(--line);border-radius:4px">` : ''}</div>`
    : html`<div class="upl"><label class="btn sm">${icon(isImg ? 'camera' : 'file')} ${isImg ? 'Take / choose photo' : 'Attach file'}<input type="file" class="sr" data-up="${id(f.key)}" ${isImg ? raw('accept="image/*" capture="environment"') : ''}></label>
            <span data-prev="${id(f.key)}">${val ? (isImg ? html`<img src="/api/files/${val}" alt="">` : html`<a href="/api/files/${val}" target="_blank" rel="noopener">View file</a>`) : ''}</span></div>`}`;
        break;
      }
      default:
        input = html`${lab}<input type="text" id="${id(f.key)}" name="${id(f.key)}" value="${val}" ${f.maxLength ? raw(`maxlength="${Number(f.maxLength)}"`) : ''} autocomplete="off">`;
    }
    return html`<div class="fld ${wide ? 'full' : ''} ${hide}" data-key="${f.key}" ${sh}>${input}</div>`;
  })}<datalist id="dl_users">${state.lookups.users.map((u) => html`<option value="${u.name}">`)}</datalist>`;
}

async function compressImage(file) {
  if (!file.type.startsWith('image/') || file.size < 400 * 1024) return file;
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const max = 1600; const s = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.8));
  return new File([blob], file.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' });
}
export async function uploadFile(file) {
  const f = await compressImage(file);
  const fd = new FormData(); fd.append('file', f);
  const r = await fetch('/api/files', { method: 'POST', body: fd, credentials: 'same-origin' });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Upload failed');
  return d;
}

export function setupFields(root, fields) {
  const getData = () => collectFields(root, fields, { partial: true });
  const reflow = () => {
    const d = getData();
    root.querySelectorAll('[data-showif]').forEach((el) => { const s = JSON.parse(el.dataset.showif); el.classList.toggle('hidden', !visible({ showIf: s }, d)); });
  };
  root.addEventListener('change', async (ev) => {
    const t = ev.target;
    if (t.matches('input[type=radio][name^="cl_"]')) {
      const rem = t.closest('.row').querySelector('.rem');
      rem.classList.toggle('hidden', t.value !== 'Not Completed');
      if (t.value === 'Not Completed') rem.focus();
    }
    if (t.matches('[data-up]')) {
      const file = t.files[0]; if (!file) return;
      const prev = root.querySelector(`[data-prev="${t.dataset.up}"]`);
      prev.textContent = 'Uploading…';
      try {
        const up = await uploadFile(file);
        root.querySelector(`input[name="${t.dataset.up}"]`).value = up.id;
        prev.innerHTML = up.mime && up.mime.startsWith('image/') ? `<img src="/api/files/${up.id}" alt="">` : `<a href="/api/files/${up.id}" target="_blank" rel="noopener">${esc(up.name)}</a>`;
      } catch (e) { prev.textContent = ''; err(e); }
    }
    reflow();
  });
  root.addEventListener('click', (ev) => {
    const now = ev.target.closest('[data-now]');
    if (now) root.querySelector('#' + now.dataset.now).value = nowLocal();
    const all = ev.target.closest('[data-allok]');
    if (all) root.querySelectorAll(`input[type=radio][name^="cl_${all.dataset.allok}_"][value="Completed"]`).forEach((r) => { r.checked = true; r.closest('.row').querySelector('.rem').classList.add('hidden'); });
    const mic = ev.target.closest('[data-mic]');
    if (mic) voice(root.querySelector('#' + mic.dataset.mic), mic);
    const clr = ev.target.closest('[data-sigclear]');
    if (clr) { const c = root.querySelector(`[data-sig="${clr.dataset.sigclear}"]`); c.getContext('2d').clearRect(0, 0, c.width, c.height); c.dataset.dirty = ''; }
  });
  root.querySelectorAll('canvas[data-sig]').forEach(initSig);
}

function initSig(c) {
  const ratio = window.devicePixelRatio || 1;
  const fit = () => { const r = c.getBoundingClientRect(); c.width = r.width * ratio; c.height = r.height * ratio; const g = c.getContext('2d'); g.scale(ratio, ratio); g.lineWidth = 2.2; g.lineCap = 'round'; g.strokeStyle = '#111'; };
  setTimeout(fit, 30);
  let drawing = false;
  const pos = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  c.addEventListener('pointerdown', (e) => { drawing = true; c.setPointerCapture(e.pointerId); const g = c.getContext('2d'); g.beginPath(); g.moveTo(...pos(e)); });
  c.addEventListener('pointermove', (e) => { if (!drawing) return; const g = c.getContext('2d'); g.lineTo(...pos(e)); g.stroke(); c.dataset.dirty = '1'; });
  c.addEventListener('pointerup', () => { drawing = false; });
}

export function voice(target, btn) {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return toast('Voice input is not supported in this browser. Try Chrome.', true);
  const rec = new SR();
  rec.lang = 'en-IN'; rec.interimResults = false; rec.maxAlternatives = 1;
  const orig = btn.innerHTML; btn.innerHTML = 'Listening…'; btn.disabled = true;
  rec.onresult = (e) => { const t = e.results[0][0].transcript; target.value = (target.value ? target.value + ' ' : '') + t; target.dispatchEvent(new Event('input', { bubbles: true })); };
  rec.onerror = (e) => toast('Could not hear clearly: ' + e.error, true);
  rec.onend = () => { btn.innerHTML = orig; btn.disabled = false; };
  rec.start();
}

// Upload any drawn signatures, then collect values
export async function finalizeSignatures(root) {
  for (const c of root.querySelectorAll('canvas[data-sig]')) {
    if (c.dataset.dirty) {
      const r = await fetch('/api/files/dataurl', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ dataUrl: c.toDataURL('image/png'), name: 'signature.png' }) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || 'Signature upload failed');
      root.querySelector(`input[name="${c.dataset.sig}"]`).value = d.id;
      c.dataset.dirty = '';
    }
  }
}

export function collectFields(root, fields) {
  const data = {};
  for (const f of fields) {
    const n = id(f.key);
    if (f.type === 'checklist') {
      const o = {};
      f.options.forEach((opt, i) => {
        const r = root.querySelector(`input[name="cl_${f.key}_${i}"]:checked`);
        if (r) o[opt] = { status: r.value, remark: (root.querySelector(`[name="clr_${f.key}_${i}"]`) || {}).value || '' };
      });
      data[f.key] = o; continue;
    }
    if (f.type === 'multiselect') { data[f.key] = [...root.querySelectorAll(`[data-ms="${n}"]:checked`)].map((x) => x.value); continue; }
    if (f.type === 'yesno') { const r = root.querySelector(`input[name="${n}"]:checked`); data[f.key] = r ? r.value : ''; continue; }
    if (f.type === 'checkbox') { const r = root.querySelector(`input[name="${n}"]`); data[f.key] = r ? r.checked : false; continue; }
    const el = root.querySelector(`[name="${n}"]`);
    if (!el) continue;
    let v = el.value;
    if (f.type === 'vehicle') v = v.toUpperCase().replace(/\s+/g, '');
    if (f.type === 'item' && v) v = Number(v);
    data[f.key] = v;
  }
  return data;
}

export function showValue(f, v) {
  if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) return html`<span class="faint">—</span>`;
  switch (f.type) {
    case 'image': case 'signature': return html`<a href="/api/files/${v}" target="_blank" rel="noopener"><img src="/api/files/${v}" alt="${f.label}" style="max-height:${f.type === 'signature' ? 60 : 160}px;border-radius:6px;border:1px solid var(--line)"></a>`;
    case 'file': return html`<a href="/api/files/${v}" target="_blank" rel="noopener">Open attachment</a>`;
    case 'checklist': return html`<div style="display:flex;flex-direction:column;gap:3px">${Object.entries(v).map(([k, x]) => html`<div>${badge(x.status === 'Completed' ? 'done' : (x.status === 'Not Completed' ? 'rejected' : 'cancelled'), x.status === 'Completed' ? '✓' : (x.status === 'Not Completed' ? '✗' : 'N/A'))} ${k}${x.remark ? html` — <i>${x.remark}</i>` : ''}</div>`)}</div>`;
    case 'item': { const it = state.lookups.items.find((i) => i.id === Number(v)); return it ? it.name : v; }
    case 'multiselect': return Array.isArray(v) ? v.join(', ') : v;
    case 'datetime': return fdt(v);
    case 'date': return fdate(v);
    case 'currency': return inr(v);
    case 'checkbox': return v ? 'Yes' : 'No';
    case 'phone': return html`<a href="tel:${v}">${v}</a>`;
    case 'email': return html`<a href="mailto:${v}">${v}</a>`;
    default: return String(v);
  }
}

// Short summary for list rows
export function entryTitle(key, d) {
  switch (key) {
    case 'visitor': return `${d.visitor_name || ''} · ${d.visitor_type === 'Other' ? (d.visitor_type_other || 'Other') : (d.visitor_type || '')}${d.purpose ? ' · ' + d.purpose : ''}`;
    case 'security': return `${d.shift || ''} shift · ${d.guard_name || ''}`;
    case 'courier': return `${d.direction || ''} · ${d.courier_company || ''} ${d.tracking_number || ''} · ${d.courier_status || ''}`;
    case 'inward_outward': return `${d.direction || ''} · ${d.material || ''} × ${d.quantity || ''} ${d.unit || ''}`;
    case 'delivery': return `${d.delivery_type || ''} from ${d.from_vendor || ''}`;
    case 'key': return `${d.key_name || ''} → ${d.issued_to || ''} · ${d.key_status || ''}`;
    case 'vehicle': return `${d.vehicle_number || ''} · ${d.start_km && d.end_km ? (d.end_km - d.start_km) + ' km' : ''} · ${d.purpose || ''}`;
    case 'housekeeping': return `${d.area || ''} · ${d.task_status || ''}${d.issue_found ? ' · Issue: ' + d.issue_found : ''}`;
    case 'maintenance': return `${d.issue || ''}${d.location ? ' · ' + d.location : ''}`;
    case 'incident': return `${d.incident_type || ''} · ${d.severity || ''} · ${(d.description || '').slice(0, 60)}`;
    case 'lost_found': return `${d.item || ''} · ${d.lf_status || ''}`;
    case 'opening': case 'closing': { const c = d.checklist || {}; const bad = Object.values(c).filter((x) => x.status === 'Not Completed').length; return `${Object.keys(c).length} checks${bad ? ` · ${bad} not completed` : ' · all OK'}`; }
    case 'staff_movement': return `${d.staff || ''} · ${d.movement || ''}`;
    default: {
      const v = Object.values(d).filter((x) => typeof x === 'string' && x.length < 80).slice(0, 3);
      return v.join(' · ');
    }
  }
}
