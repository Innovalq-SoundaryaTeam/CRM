-- =============================================================================
-- Candidate CRM — PostgreSQL schema
-- Run this against an empty database if you prefer manual/DBA-style setup
-- instead of letting SQLAlchemy create the tables (see scripts/init_db.py).
--
--   createdb candidate_crm
--   psql -d candidate_crm -f schema.sql
-- =============================================================================

CREATE TYPE user_role AS ENUM ('USER', 'ADMIN');
CREATE TYPE candidate_status AS ENUM ('HOT', 'WARM', 'COLD', 'COMPLETED', 'DROP');

CREATE TABLE users (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(50) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    role            user_role NOT NULL DEFAULT 'USER',
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_users_username ON users (username);

CREATE TABLE candidates (
    id               SERIAL PRIMARY KEY,
    candidate_name   VARCHAR(150) NOT NULL,
    contact_number   VARCHAR(20) NOT NULL,
    status           candidate_status NOT NULL DEFAULT 'WARM',
    comments         TEXT,
    user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ix_candidates_candidate_name ON candidates (candidate_name);
CREATE INDEX ix_candidates_contact_number ON candidates (contact_number);
CREATE INDEX ix_candidates_user_id ON candidates (user_id);
CREATE INDEX ix_candidates_status ON candidates (status);
CREATE INDEX ix_candidates_user_id_status ON candidates (user_id, status);

-- Keep updated_at current on every row modification.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_candidates_updated_at
BEFORE UPDATE ON candidates
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
