const bcrypt = require('bcryptjs');
const { q, one } = require('./db');
const builtins = require('./registers-builtin');

const DEFAULT_SETTINGS = {
  company_name: 'S-Cubus Career Private Limited',
  manager_approval_limit: 5000,
  petty_cash_default_float: 10000,
  petty_cash_float: {},
  digest_time: '21:00'
};

const CATEGORIES = ['Stationery & printing', 'Housekeeping supplies', 'Maintenance & repairs', 'Utilities', 'Refreshments & pantry', 'Transport & fuel',
  'Courier & postage', 'Books & study material', 'Uniforms & merchandise', 'IT & electronics', 'Furniture & fixtures', 'Events & marketing', 'Rent', 'Miscellaneous'];

async function seedBase() {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    await q('INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING', [k, JSON.stringify(v)]);
  }
  const nb = await one('SELECT COUNT(*)::int AS n FROM branches');
  if (!nb.n) await q("INSERT INTO branches (name, code) VALUES ('Main Branch', 'MAIN')");
  for (const c of CATEGORIES) await q('INSERT INTO expense_categories (name) VALUES ($1) ON CONFLICT (name) DO NOTHING', [c]);
  for (const d of builtins) {
    await q(`INSERT INTO register_defs (key, name, description, department, responsible_role, frequency, deadline, fields, builtin, important, sort)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,TRUE,$9,$10) ON CONFLICT (key) DO NOTHING`,
    [d.key, d.name, d.description, d.department, d.responsible_role, d.frequency, d.deadline || null, JSON.stringify(d.fields), !!d.important, d.sort]);
  }
  const owner = await one("SELECT id FROM users WHERE role='owner' LIMIT 1");
  if (!owner) {
    const email = process.env.OWNER_EMAIL || 'director@scubus.com';
    const pw = process.env.OWNER_PASSWORD || 'Scubus@2026';
    const b = await one('SELECT id FROM branches ORDER BY id LIMIT 1');
    await q("INSERT INTO users (name, email, role, designation, branch_id, password_hash) VALUES ('Director', $1, 'owner', 'Director', $2, $3) ON CONFLICT (email) DO NOTHING",
      [email, b.id, await bcrypt.hash(pw, 10)]);
    console.log(`Owner account created: ${email}`);
  }
}

module.exports = { seedBase, CATEGORIES };
