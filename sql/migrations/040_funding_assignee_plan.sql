-- 040_funding_assignee_plan.sql
-- Adds user assignment to opportunities and a persistent plan config store.
-- Apply: docker exec -i symbio_postgres psql -U symbio -d symbio < /opt/symbio/sql/migrations/040_funding_assignee_plan.sql

ALTER TABLE funding_opportunities
  ADD COLUMN IF NOT EXISTS assignee_id UUID REFERENCES users(user_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_funding_assignee ON funding_opportunities (assignee_id) WHERE assignee_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS funding_plan (
    id          TEXT        PRIMARY KEY DEFAULT 'default',
    config      JSONB       NOT NULL DEFAULT '{}',
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO funding_plan (id, config) VALUES ('default', '{}') ON CONFLICT DO NOTHING;
