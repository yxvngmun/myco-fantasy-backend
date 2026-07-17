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

CREATE TABLE IF NOT EXISTS tournaments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sport_key TEXT NOT NULL REFERENCES sports_config(key),
  status TEXT NOT NULL DEFAULT 'Active',
  api_league_id INTEGER,
  api_season INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  id INTEGER NOT NULL,
  name TEXT NOT NULL,
  club TEXT NOT NULL,
  short TEXT NOT NULL,
  color TEXT NOT NULL,
  jersey_number TEXT,
  pos TEXT NOT NULL,
  val NUMERIC NOT NULL,
  pts INTEGER NOT NULL DEFAULT 0,
  total_pts INTEGER NOT NULL DEFAULT 0,
  matches INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available',
  opp TEXT,
  fixture_date TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, id)
);

CREATE TABLE IF NOT EXISTS fixtures (
  id SERIAL PRIMARY KEY,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round TEXT,
  event_date TIMESTAMPTZ,
  date_label TEXT,
  home_name TEXT NOT NULL,
  home_code TEXT NOT NULL,
  home_color TEXT NOT NULL,
  away_name TEXT NOT NULL,
  away_code TEXT NOT NULL,
  away_color TEXT NOT NULL,
  status TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_squads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  user_identifier TEXT NOT NULL,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  player_ids JSONB NOT NULL DEFAULT '[]',
  captain_id INTEGER,
  bank_remaining NUMERIC NOT NULL DEFAULT 100,
  team_name TEXT DEFAULT '',
  country TEXT DEFAULT '',
  user_name TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_partner_user_tournament UNIQUE (partner_id, user_identifier, tournament_id)
);

ALTER TABLE user_squads ADD COLUMN IF NOT EXISTS team_name TEXT DEFAULT '';
ALTER TABLE user_squads ADD COLUMN IF NOT EXISTS country TEXT DEFAULT '';
ALTER TABLE user_squads ADD COLUMN IF NOT EXISTS user_name TEXT DEFAULT '';
ALTER TABLE user_squads ADD COLUMN IF NOT EXISTS chips_used JSONB DEFAULT '[]';
ALTER TABLE user_squads ADD COLUMN IF NOT EXISTS active_chip TEXT DEFAULT NULL;

ALTER TABLE players ADD COLUMN IF NOT EXISTS stats_breakdown JSONB DEFAULT '[]';
ALTER TABLE players ADD COLUMN IF NOT EXISTS price_history JSONB DEFAULT '[]';

CREATE TABLE IF NOT EXISTS user_gameweek_history (
  id SERIAL PRIMARY KEY,
  partner_id UUID NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  user_identifier TEXT NOT NULL,
  tournament_id UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  gameweek INTEGER NOT NULL,
  player_ids JSONB NOT NULL DEFAULT '[]',
  captain_id INTEGER,
  chip_used TEXT,
  points INTEGER NOT NULL DEFAULT 0,
  rank INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT unique_user_tournament_gw UNIQUE (partner_id, user_identifier, tournament_id, gameweek)
);

-- Clean up duplicate fixtures
DELETE FROM fixtures a USING fixtures b
WHERE a.id > b.id 
  AND a.tournament_id = b.tournament_id 
  AND a.round = b.round 
  AND a.home_name = b.home_name 
  AND a.away_name = b.away_name;

-- Add unique constraint
ALTER TABLE fixtures ADD CONSTRAINT unique_tournament_fixture UNIQUE (tournament_id, round, home_name, away_name);



