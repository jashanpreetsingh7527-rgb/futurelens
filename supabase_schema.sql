-- ===================================================================
-- FUTURELENS — Supabase PostgreSQL Schema & Setup Script
-- Copy and paste this entire script into your Supabase SQL Editor and click RUN.
-- ===================================================================

-- 1. Create storage bucket for image uploads (if not already existing)
INSERT INTO storage.buckets (id, name, public)
VALUES ('uploads', 'uploads', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to uploaded images
DROP POLICY IF EXISTS "Public Read Uploads" ON storage.objects;
CREATE POLICY "Public Read Uploads" ON storage.objects
FOR SELECT USING (bucket_id = 'uploads');

-- Allow service role / authenticated to insert uploads
DROP POLICY IF EXISTS "Allow Uploads" ON storage.objects;
CREATE POLICY "Allow Uploads" ON storage.objects
FOR ALL USING (bucket_id = 'uploads')
WITH CHECK (bucket_id = 'uploads');

-- -------------------------------------------------------------------
-- Core Accounts & Auth Tables
-- -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS admins (
  id             BIGSERIAL PRIMARY KEY,
  full_name      TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT,
  role           TEXT NOT NULL CHECK (role IN ('super_admin','admin')),
  status         TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','pending')),
  permissions    TEXT NOT NULL DEFAULT '[]',
  photo          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by     BIGINT,
  last_login_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS admin_invites (
  token       TEXT PRIMARY KEY,
  admin_id    BIGINT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  purpose     TEXT NOT NULL DEFAULT 'setup',
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS members (
  id             BIGSERIAL PRIMARY KEY,
  full_name      TEXT NOT NULL,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  phone          TEXT,
  course         TEXT,
  year_of_study  TEXT,
  photo          TEXT,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','suspended')),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sessions (
  token        TEXT PRIMARY KEY,
  account_id   BIGINT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('admin','member')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at   TIMESTAMPTZ NOT NULL,
  ip           TEXT,
  user_agent   TEXT
);

CREATE TABLE IF NOT EXISTS login_attempts (
  id           BIGSERIAL PRIMARY KEY,
  scope        TEXT NOT NULL,
  identifier   TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ok           INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS audit_log (
  id          BIGSERIAL PRIMARY KEY,
  actor_id    BIGINT,
  actor_name  TEXT,
  actor_role  TEXT,
  action      TEXT NOT NULL,
  entity      TEXT,
  entity_id   TEXT,
  summary     TEXT NOT NULL,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id, account_type);
CREATE INDEX IF NOT EXISTS idx_attempts ON login_attempts(scope, identifier, attempted_at);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at DESC);

-- -------------------------------------------------------------------
-- Content Resource Tables
-- -------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS content_team (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  role        TEXT,
  course      TEXT,
  photo       TEXT,
  bio         TEXT,
  email       TEXT,
  sort_order  INT DEFAULT 0,
  published   INT DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  BIGINT
);

CREATE TABLE IF NOT EXISTS content_events (
  id               BIGSERIAL PRIMARY KEY,
  title            TEXT NOT NULL,
  starts_on        TEXT,
  time_text        TEXT,
  venue            TEXT,
  cover            TEXT,
  summary          TEXT,
  registration_url TEXT,
  status           TEXT DEFAULT 'upcoming',
  published        INT DEFAULT 1,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by       BIGINT
);

CREATE TABLE IF NOT EXISTS content_winners (
  id           BIGSERIAL PRIMARY KEY,
  name         TEXT NOT NULL,
  competition  TEXT,
  position     TEXT,
  awarded_on   TEXT,
  photo        TEXT,
  entry_title  TEXT,
  note         TEXT,
  published    INT DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by   BIGINT
);

CREATE TABLE IF NOT EXISTS content_achievements (
  id          BIGSERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  holder      TEXT,
  achieved_on TEXT,
  photo       TEXT,
  detail      TEXT,
  published   INT DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  BIGINT
);

CREATE TABLE IF NOT EXISTS content_week_stars (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  week_of     TEXT NOT NULL,
  photo       TEXT,
  reason      TEXT,
  course      TEXT,
  published   INT DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  BIGINT
);

CREATE TABLE IF NOT EXISTS content_star_members (
  id          BIGSERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  photo       TEXT,
  course      TEXT,
  citation    TEXT,
  sort_order  INT DEFAULT 0,
  published   INT DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  BIGINT
);

CREATE TABLE IF NOT EXISTS content_gallery (
  id          BIGSERIAL PRIMARY KEY,
  image       TEXT NOT NULL,
  caption     TEXT,
  credit      TEXT,
  album       TEXT,
  taken_on    TEXT,
  published   INT DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  BIGINT
);

CREATE TABLE IF NOT EXISTS content_pages (
  id          BIGSERIAL PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  body        TEXT,
  published   INT DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  BIGINT
);

CREATE TABLE IF NOT EXISTS content_statistics (
  id          BIGSERIAL PRIMARY KEY,
  label       TEXT NOT NULL,
  value       TEXT NOT NULL,
  sort_order  INT DEFAULT 0,
  published   INT DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  BIGINT
);

-- -------------------------------------------------------------------
-- Initial Default Settings
-- -------------------------------------------------------------------

INSERT INTO settings (key, value) VALUES
  ('site_title', 'FUTURELENS'),
  ('tagline', 'Look closer. Frame it better. Tell the story properly.'),
  ('about', 'Membership is open to every student, whatever you shoot with — phone, film or full frame. Register here and the committee will confirm your place.'),
  ('contact_email', 'hello@futurelens.club'),
  ('contact_phone', '+91 00000 00000'),
  ('address', 'Student Activity Centre, Room 14'),
  ('join_open', 'true')
ON CONFLICT (key) DO NOTHING;

-- -------------------------------------------------------------------
-- Demo Content
-- -------------------------------------------------------------------

INSERT INTO content_statistics (label, value, sort_order, published)
SELECT 'Members', '148', 1, 1 WHERE NOT EXISTS (SELECT 1 FROM content_statistics);
INSERT INTO content_statistics (label, value, sort_order, published)
SELECT 'Shoots this year', '26', 2, 1 WHERE (SELECT count(*) FROM content_statistics) <= 1;
INSERT INTO content_statistics (label, value, sort_order, published)
SELECT 'Competitions won', '9', 3, 1 WHERE (SELECT count(*) FROM content_statistics) <= 2;
INSERT INTO content_statistics (label, value, sort_order, published)
SELECT 'Founded', '2021', 4, 1 WHERE (SELECT count(*) FROM content_statistics) <= 3;

INSERT INTO content_events (title, starts_on, time_text, venue, status, published, summary)
SELECT 'Night photography walk', '2026-10-02', '7:30 pm', 'Clock Tower, main campus', 'upcoming', 1,
       'Long exposures after dark. Bring a tripod if you have one; the club has four to lend.'
WHERE NOT EXISTS (SELECT 1 FROM content_events);

INSERT INTO content_events (title, starts_on, time_text, venue, status, published, summary)
SELECT 'Portrait lighting workshop', '2026-10-19', '4:00 pm', 'Studio, Block C', 'upcoming', 1,
       'One light, one reflector, one afternoon. No equipment needed.'
WHERE (SELECT count(*) FROM content_events) <= 1;

INSERT INTO content_week_stars (name, week_of, course, published, reason)
SELECT 'Aditi Sharma', '2026-09-07', 'B.Des, second year', 1,
       'Her series from the monsoon contest showed real patience — she went back to the same street four evenings running until the light did what she wanted.'
WHERE NOT EXISTS (SELECT 1 FROM content_week_stars);

INSERT INTO content_team (name, role, course, sort_order, published, bio)
SELECT 'Aditi Sharma', 'President', 'B.Des, second year', 1, 1,
       'Speak to Aditi about joining, collaborations and anything to do with competitions.'
WHERE NOT EXISTS (SELECT 1 FROM content_team);

INSERT INTO content_pages (slug, title, published, body)
SELECT 'about', 'About FUTURELENS', 1,
       'FUTURELENS started in 2021 with six students and one borrowed camera. We run weekly shoots, a monthly critique session and two open competitions a year.'
WHERE NOT EXISTS (SELECT 1 FROM content_pages WHERE slug = 'about');
