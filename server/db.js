const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// DATABASE_URL may hold several candidate URLs separated by spaces or commas (e.g. two Supabase pooler hosts);
// the first one that connects is used.
const candidates = String(process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/scubus_ops').split(/[\s,]+/).filter(Boolean);
const sslFor = (cs) => (/supabase|render\.com|neon\.tech|sslmode=require/.test(cs) && !/localhost/.test(cs) ? { rejectUnauthorized: false } : false);
const mkPool = (cs) => new Pool({ connectionString: cs.replace(/[?&]sslmode=require/, ''), ssl: sslFor(cs), max: 8, idleTimeoutMillis: 30000, connectionTimeoutMillis: 15000 });

let pool = mkPool(candidates[0]);

// All date logic in India time
const onConnect = (c) => { c.query("SET TIME ZONE 'Asia/Kolkata'").catch(() => {}); };
pool.on('connect', onConnect);

async function pickPool() {
  for (const cs of candidates) {
    const p = cs === candidates[0] ? pool : mkPool(cs);
    try {
      await p.query('SELECT 1');
      if (p !== pool) { pool.end().catch(() => {}); pool = p; pool.on('connect', onConnect); }
      console.log('Database connected via', cs.replace(/:\/\/([^:]+):[^@]+@/, '://$1:****@').split('?')[0]);
      return;
    } catch (e) {
      console.error('Database candidate failed:', cs.replace(/:\/\/([^:]+):[^@]+@/, '://$1:****@').split('?')[0], '-', e.message);
      if (p !== pool) p.end().catch(() => {});
    }
  }
  throw new Error('Could not connect to any database URL.');
}

// Return dates as plain YYYY-MM-DD strings
require('pg').types.setTypeParser(1082, (v) => v);
// NUMERIC as JS number
require('pg').types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));

async function q(text, params) {
  const r = await pool.query(text, params);
  return r.rows;
}
async function one(text, params) {
  const r = await pool.query(text, params);
  return r.rows[0] || null;
}
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const helpers = {
      q: async (t, p) => (await client.query(t, p)).rows,
      one: async (t, p) => (await client.query(t, p)).rows[0] || null
    };
    const out = await fn(helpers);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

async function migrate() {
  await pickPool();
  // One-time wipe of this app's own tables (only when RESET_DB=wipe-all-data is set on purpose).
  if (process.env.RESET_DB === 'wipe-all-data') {
    const t = await pool.query("SELECT tablename FROM pg_tables WHERE schemaname = current_schema()");
    for (const r of t.rows) await pool.query(`DROP TABLE IF EXISTS "${r.tablename}" CASCADE`);
    console.log(`RESET_DB: dropped ${t.rows.length} tables in schema. Remove RESET_DB now.`);
  }
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

module.exports = { get pool() { return pool; }, q, one, tx, migrate };
