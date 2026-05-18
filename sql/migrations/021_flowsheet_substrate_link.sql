-- 021_flowsheet_substrate_link.sql
-- Links bioprocess_flowsheets to substrate TEA pipeline

ALTER TABLE bioprocess_flowsheets
    ADD COLUMN IF NOT EXISTS substrate_id UUID REFERENCES substrates(substrate_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS linked_output TEXT,
    ADD COLUMN IF NOT EXISTS route_code TEXT REFERENCES process_routes(route_code) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS is_auto_generated BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS tea_last_synced_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS tea_sync_result JSONB;

CREATE INDEX IF NOT EXISTS idx_flowsheets_substrate_id
    ON bioprocess_flowsheets(substrate_id);
CREATE INDEX IF NOT EXISTS idx_flowsheets_substrate_output
    ON bioprocess_flowsheets(substrate_id, linked_output)
    WHERE substrate_id IS NOT NULL;
