-- S-CUBUS Operations Control System schema (idempotent)

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS branches (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  address TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'staff',
  designation TEXT,
  branch_id INT REFERENCES branches(id),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS files (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  mime TEXT,
  size INT,
  data BYTEA NOT NULL,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vendors (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  gstin TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  bank_details TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS expense_categories (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS items (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  sku TEXT,
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'pcs',
  min_stock NUMERIC NOT NULL DEFAULT 0,
  rate NUMERIC NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock (
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  branch_id INT NOT NULL REFERENCES branches(id),
  qty NUMERIC NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, branch_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id SERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  branch_id INT NOT NULL REFERENCES branches(id),
  qty NUMERIC NOT NULL,
  type TEXT NOT NULL,           -- purchase, issue, return, adjustment, loss, damage, inward, outward
  ref_type TEXT,
  ref_id INT,
  issued_to TEXT,
  remarks TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  last INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS purchases (
  id SERIAL PRIMARY KEY,
  purchase_no TEXT UNIQUE,
  branch_id INT NOT NULL REFERENCES branches(id),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  kind TEXT NOT NULL DEFAULT 'purchase',   -- purchase (items) or expense (service/other)
  vendor_id INT REFERENCES vendors(id),
  vendor_name TEXT,                        -- free text for petty-cash shops
  category_id INT REFERENCES expense_categories(id),
  description TEXT,
  subtotal NUMERIC NOT NULL DEFAULT 0,
  gst_amount NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC NOT NULL DEFAULT 0,
  payment_mode TEXT NOT NULL,              -- petty_cash, cash, upi, bank_transfer, cheque, card, credit
  mode_details JSONB NOT NULL DEFAULT '{}',
  amount_paid NUMERIC NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'unpaid', -- unpaid, partial, paid
  status TEXT NOT NULL DEFAULT 'submitted',      -- submitted, approved, rejected, cancelled
  bill_no TEXT,
  bill_date DATE,
  attachment_id INT REFERENCES files(id),
  update_stock BOOLEAN NOT NULL DEFAULT TRUE,
  reject_reason TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by INT REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  updated_by INT REFERENCES users(id),
  updated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS purchase_lines (
  id SERIAL PRIMARY KEY,
  purchase_id INT NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  item_id INT REFERENCES items(id),
  description TEXT,
  qty NUMERIC NOT NULL DEFAULT 1,
  unit TEXT,
  rate NUMERIC NOT NULL DEFAULT 0,
  gst_rate NUMERIC NOT NULL DEFAULT 0,
  amount NUMERIC NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS vouchers (
  id SERIAL PRIMARY KEY,
  voucher_no TEXT UNIQUE NOT NULL,
  type TEXT NOT NULL,           -- PCV, CPV, BPV, CCV, JV, PCR
  purpose TEXT NOT NULL,        -- purchase, payment, petty_topup
  branch_id INT NOT NULL REFERENCES branches(id),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  purchase_id INT REFERENCES purchases(id),
  vendor_id INT REFERENCES vendors(id),
  payee TEXT,
  amount NUMERIC NOT NULL,
  payment_mode TEXT NOT NULL,
  mode_details JSONB NOT NULL DEFAULT '{}',
  narration TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending, approved, rejected, cancelled
  attachment_id INT REFERENCES files(id),
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by INT REFERENCES users(id),
  approved_at TIMESTAMPTZ,
  reject_reason TEXT
);

CREATE TABLE IF NOT EXISTS petty_cash (
  id SERIAL PRIMARY KEY,
  branch_id INT NOT NULL REFERENCES branches(id),
  date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC NOT NULL,      -- + top-up, - spend
  type TEXT NOT NULL,           -- topup, expense, adjustment
  voucher_id INT REFERENCES vouchers(id),
  narration TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS register_defs (
  id SERIAL PRIMARY KEY,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  department TEXT,
  responsible_role TEXT,
  frequency TEXT NOT NULL DEFAULT 'as_needed', -- daily, per_shift, twice_daily, live, as_needed
  deadline TEXT,                               -- HH:MM
  fields JSONB NOT NULL DEFAULT '[]',
  builtin BOOLEAN NOT NULL DEFAULT FALSE,
  important BOOLEAN NOT NULL DEFAULT FALSE,
  branch_id INT REFERENCES branches(id),
  status TEXT NOT NULL DEFAULT 'active',
  sort INT NOT NULL DEFAULT 100,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS register_entries (
  id SERIAL PRIMARY KEY,
  register_id INT NOT NULL REFERENCES register_defs(id) ON DELETE CASCADE,
  branch_id INT NOT NULL REFERENCES branches(id),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  data JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'submitted',  -- submitted, reviewed, verified, returned
  review_note TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by INT REFERENCES users(id),
  updated_at TIMESTAMPTZ,
  verified_by INT REFERENCES users(id),
  verified_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_reg_entries ON register_entries(register_id, entry_date);

CREATE TABLE IF NOT EXISTS register_history (
  id SERIAL PRIMARY KEY,
  entry_id INT NOT NULL REFERENCES register_entries(id) ON DELETE CASCADE,
  old_data JSONB,
  new_data JSONB,
  reason TEXT,
  edited_by INT REFERENCES users(id),
  edited_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  category TEXT,
  branch_id INT REFERENCES branches(id),
  assigned_to INT REFERENCES users(id),
  requested_by INT REFERENCES users(id),
  priority TEXT NOT NULL DEFAULT 'normal',  -- low, normal, high, urgent
  status TEXT NOT NULL DEFAULT 'pending',   -- pending, in_progress, done, cancelled
  due_date DATE,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  remarks TEXT,
  attachment_id INT REFERENCES files(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  doc_type TEXT NOT NULL DEFAULT 'document', -- license, contract, insurance, document, certificate
  branch_id INT REFERENCES branches(id),
  number TEXT,
  vendor_id INT REFERENCES vendors(id),
  issued_on DATE,
  expires_on DATE,
  file_id INT REFERENCES files(id),
  notes TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id SERIAL PRIMARY KEY,
  entity TEXT NOT NULL,
  entity_id INT,
  action TEXT NOT NULL,
  reason TEXT,
  data JSONB,
  user_id INT REFERENCES users(id),
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity, entity_id);

CREATE INDEX IF NOT EXISTS idx_reg_entries_date ON register_entries(entry_date, branch_id);
CREATE INDEX IF NOT EXISTS idx_reg_entries_status ON register_entries(status);
CREATE INDEX IF NOT EXISTS idx_purchases_date ON purchases(date, branch_id);
CREATE INDEX IF NOT EXISTS idx_stock_mv_created ON stock_movements(created_at, branch_id);
CREATE INDEX IF NOT EXISTS idx_tasks_completed ON tasks(completed_at);
CREATE INDEX IF NOT EXISTS idx_vouchers_status ON vouchers(status, branch_id);
