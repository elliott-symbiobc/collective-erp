-- 038_funding_deadline_time_gcal.sql
-- Adds time component to funding deadlines and GCal event link.
-- Apply: docker exec -i symbio_postgres psql -U symbio -d symbio < /opt/symbio/sql/migrations/038_funding_deadline_time_gcal.sql

ALTER TABLE funding_opportunities
  ADD COLUMN IF NOT EXISTS deadline_time TEXT,     -- HH:MM (24-hr)
  ADD COLUMN IF NOT EXISTS gcal_event_id TEXT;     -- Google Calendar event ID for sync
