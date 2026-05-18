-- 010_tasks_contact_link.sql
-- Link tasks to contacts and track task origin (gmail follow-ups vs manual).

ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS contact_id UUID REFERENCES contacts(contact_id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS source     TEXT NOT NULL DEFAULT 'manual';

CREATE INDEX IF NOT EXISTS idx_tasks_contact ON tasks (contact_id) WHERE contact_id IS NOT NULL;