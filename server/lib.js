const jwt = require('jsonwebtoken');
const { q, one } = require('./db');

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';

const ROLES = {
  owner: 'Owner',
  admin: 'Admin',
  accounts: 'Accounts',
  manager: 'Branch Manager',
  staff: 'Office / Reception Staff',
  guard: 'Guard / Security',
  office_boy: 'Office Boy / Peon',
  housekeeping: 'Housekeeping',
  driver: 'Driver',
  maintenance: 'Maintenance Staff'
};
const FIELD_ROLES = ['guard', 'office_boy', 'housekeeping', 'driver', 'maintenance'];
const isMgmt = (u) => u && (u.role === 'owner' || u.role === 'admin');
const isFinance = (u) => u && ['owner', 'admin', 'accounts'].includes(u.role);
const seesAll = (u) => isFinance(u);
const isReviewer = (u) => u && ['owner', 'admin', 'manager', 'accounts'].includes(u.role);

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (msg) => new HttpError(400, msg);
const forbidden = (msg = 'You do not have permission for this action.') => new HttpError(403, msg);

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function sign(user) {
  return jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
}

async function auth(req, res, next) {
  try {
    const token = req.cookies.sid || (req.headers.authorization || '').replace(/^Bearer /, '');
    if (!token) throw new HttpError(401, 'Please sign in.');
    const { id } = jwt.verify(token, JWT_SECRET);
    const user = await one('SELECT u.id, u.name, u.email, u.phone, u.role, u.designation, u.branch_id, u.active, b.name AS branch_name FROM users u LEFT JOIN branches b ON b.id = u.branch_id WHERE u.id = $1', [id]);
    if (!user || !user.active) throw new HttpError(401, 'Please sign in.');
    req.user = user;
    next();
  } catch (e) {
    next(e.status ? e : new HttpError(401, 'Please sign in.'));
  }
}

const need = (check, msg) => (req, res, next) => (check(req.user) ? next() : next(forbidden(msg)));

// Branch filter: finance/mgmt can pick any branch (or all); others are locked to their own branch.
function branchFilter(req, alias = '', paramList, explicit) {
  const col = (alias ? alias + '.' : '') + 'branch_id';
  const want = explicit !== undefined ? explicit : req.query.branch_id;
  if (seesAll(req.user)) {
    if (want && want !== 'all') { paramList.push(parseInt(want, 10)); return ` AND ${col} = $${paramList.length}`; }
    return '';
  }
  paramList.push(req.user.branch_id || 0);
  return ` AND ${col} = $${paramList.length}`;
}

function userBranch(req, bodyBranch) {
  if (seesAll(req.user) || req.user.role === 'manager') return parseInt(bodyBranch || req.user.branch_id, 10) || null;
  return req.user.branch_id;
}

async function getSettings() {
  const rows = await q('SELECT key, value FROM settings');
  const s = {};
  rows.forEach((r) => { s[r.key] = r.value; });
  return s;
}

async function audit(h, entity, entityId, action, userId, data, reason) {
  await (h || { q }).q('INSERT INTO audit_log (entity, entity_id, action, user_id, data, reason) VALUES ($1,$2,$3,$4,$5,$6)',
    [entity, entityId, action, userId, data ? JSON.stringify(data) : null, reason || null]);
}

function fyOf(dateStr) {
  const d = dateStr ? new Date(dateStr + 'T00:00:00') : new Date();
  const y = d.getFullYear();
  const start = d.getMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

async function nextNumber(h, prefix, dateStr) {
  const key = `${prefix}/${fyOf(dateStr)}`;
  const r = await h.one(`INSERT INTO counters (key, last) VALUES ($1, 1)
    ON CONFLICT (key) DO UPDATE SET last = counters.last + 1 RETURNING last`, [key]);
  return `${key}/${String(r.last).padStart(4, '0')}`;
}

const today = () => {
  const d = new Date(Date.now() + 5.5 * 3600 * 1000); // IST
  return d.toISOString().slice(0, 10);
};
const nowIST = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 16);

module.exports = {
  ROLES, FIELD_ROLES, isMgmt, isFinance, seesAll, isReviewer, HttpError, bad, forbidden, ah, sign, auth, need,
  branchFilter, userBranch, getSettings, audit, nextNumber, fyOf, today, nowIST, JWT_SECRET
};
