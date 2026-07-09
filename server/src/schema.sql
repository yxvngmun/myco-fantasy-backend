CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS superadmins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  logo TEXT DEFAULT '',
  primary_color TEXT DEFAULT '#2563eb',
  secondary_color TEXT DEFAULT '#14b8a6',
  subdomain TEXT UNIQUE NOT NULL,
  contact_name TEXT,
  phone TEXT,
  business_type TEXT,
  commission NUMERIC NOT NULL DEFAULT 15,
  monthly_fee NUMERIC NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pending',
  sports JSONB NOT NULL DEFAULT '[]',
  users INTEGER NOT NULL DEFAULT 0,
  contests INTEGER NOT NULL DEFAULT 0,
  platform_fees_collected NUMERIC NOT NULL DEFAULT 0,
  revenue_share_collected NUMERIC NOT NULL DEFAULT 0,
  entry_fees_collected NUMERIC NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'Pending',
  live_tournaments INTEGER NOT NULL DEFAULT 0,
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sports_config (
  key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Active',
  rule_profile TEXT,
  data_provider TEXT,
  squad_size INTEGER NOT NULL DEFAULT 11,
  positions JSONB NOT NULL DEFAULT '[]',
  default_scoring JSONB NOT NULL DEFAULT '[]',
  tournament_types JSONB NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS global_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  min_contest_entry_fee NUMERIC NOT NULL DEFAULT 0,
  max_contest_entry_fee NUMERIC NOT NULL DEFAULT 1000,
  platform_fee_percent NUMERIC NOT NULL DEFAULT 10,
  min_players_per_contest INTEGER NOT NULL DEFAULT 2,
  max_players_per_contest INTEGER NOT NULL DEFAULT 100000,
  user_kyc_required BOOLEAN NOT NULL DEFAULT false,
  withdrawal_min_amount NUMERIC NOT NULL DEFAULT 10,
  max_teams_per_user INTEGER NOT NULL DEFAULT 11,
  field_policies JSONB NOT NULL DEFAULT '{}',
  CONSTRAINT single_row CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  period TEXT NOT NULL,
  total_entry_fees NUMERIC NOT NULL,
  our_share NUMERIC NOT NULL,
  partner_share NUMERIC NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS session (
  sid VARCHAR NOT NULL COLLATE "default",
  sess JSON NOT NULL,
  expire TIMESTAMP(6) NOT NULL
);

ALTER TABLE session DROP CONSTRAINT IF EXISTS session_pkey;
ALTER TABLE session ADD CONSTRAINT session_pkey PRIMARY KEY (sid) NOT DEFERRABLE INITIALLY IMMEDIATE;
CREATE INDEX IF NOT EXISTS idx_session_expire ON session (expire);
