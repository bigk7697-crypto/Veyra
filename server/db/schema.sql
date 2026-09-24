-- Veyra V2 — schéma Postgres prêt (non utilisé en démo mémoire V1)
CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  color TEXT NOT NULL CHECK (color IN ('violet','jaune','bleu')),
  motif TEXT NOT NULL DEFAULT 'etoile',
  secret_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  secret_length INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS challenges (
  id UUID PRIMARY KEY,
  user_id TEXT REFERENCES users(user_id) ON DELETE SET NULL,
  solution INT[] NOT NULL,
  secret_hash TEXT NOT NULL,
  user_color TEXT NOT NULL,
  user_motif TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_challenges_expires ON challenges(expires_at);

CREATE TABLE IF NOT EXISTS risk_sessions (
  session_id UUID PRIMARY KEY,
  verified BOOLEAN NOT NULL,
  risk_score INT NOT NULL,
  risk_level TEXT NOT NULL,
  next_action TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  key_hash TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS security_events (
  id BIGGENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  type TEXT NOT NULL,
  user_id TEXT,
  session_id UUID,
  risk_level TEXT,
  meta JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
