-- 039_funding_attachments.sql
-- Links Google Drive files and Gmail threads to funding opportunities.
-- Apply: docker exec -i symbio_postgres psql -U symbio -d symbio < /opt/symbio/sql/migrations/039_funding_attachments.sql

CREATE TABLE IF NOT EXISTS funding_attachments (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    opportunity_id  UUID        NOT NULL REFERENCES funding_opportunities(opportunity_id) ON DELETE CASCADE,
    type            TEXT        NOT NULL CHECK (type IN ('drive', 'email')),
    external_id     TEXT        NOT NULL,
    title           TEXT        NOT NULL,
    url             TEXT,
    mime_type       TEXT,
    attached_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (opportunity_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_funding_att_opp ON funding_attachments (opportunity_id);
