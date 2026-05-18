-- 012_bioprocess_flowsheets.sql
-- Stores saved BioSTEAM bioprocess flowsheets

CREATE TABLE IF NOT EXISTS bioprocess_flowsheets (
    flowsheet_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    description     TEXT,
    created_by      UUID REFERENCES users(user_id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    flowsheet_data  JSONB NOT NULL DEFAULT '{}',
    last_simulation_result JSONB,
    last_simulated_at      TIMESTAMPTZ,
    is_archived     BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_bioprocess_flowsheets_created_by
    ON bioprocess_flowsheets(created_by);
CREATE INDEX IF NOT EXISTS idx_bioprocess_flowsheets_created_at
    ON bioprocess_flowsheets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bioprocess_flowsheets_archived
    ON bioprocess_flowsheets(is_archived);