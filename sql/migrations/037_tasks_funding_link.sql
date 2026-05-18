-- 037_tasks_funding_link.sql
-- Adds source_ref column to tasks to enable linking tasks to any platform entity.
-- Format: "funding:{opportunity_id}", "dilutive:{investor_id}", etc.
-- Apply: docker exec -i symbio_postgres psql -U symbio -d symbio < /opt/symbio/sql/migrations/037_tasks_funding_link.sql

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS source_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_tasks_source_ref ON tasks (source_ref) WHERE source_ref IS NOT NULL;
