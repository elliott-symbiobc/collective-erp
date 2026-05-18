-- Migration 007: Unify eln_entries to support experiment, meeting, and note types

BEGIN;

-- Add entry_type and meeting/note fields to eln_entries
ALTER TABLE eln_entries
  ADD COLUMN IF NOT EXISTS entry_type        VARCHAR DEFAULT 'experiment',
  ADD COLUMN IF NOT EXISTS raw_transcript    TEXT,
  ADD COLUMN IF NOT EXISTS ai_summary        TEXT,
  ADD COLUMN IF NOT EXISTS ai_status         VARCHAR DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS action_items      JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS decisions         JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS follow_ups        JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS calendar_event_id    VARCHAR,
  ADD COLUMN IF NOT EXISTS calendar_event_title VARCHAR,
  ADD COLUMN IF NOT EXISTS calendar_event_time  TIMESTAMPTZ;

-- Add notebook_id to the old notes table so we can migrate them
ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS notebook_id UUID REFERENCES eln_notebooks(notebook_id) ON DELETE SET NULL;

-- Migrate existing notes into eln_entries
INSERT INTO eln_entries (
  entry_id, user_id, notebook_id,
  title, entry_type,
  raw_transcript, ai_summary, ai_status,
  action_items, decisions, follow_ups,
  calendar_event_id, calendar_event_title, calendar_event_time,
  created_at, updated_at
)
SELECT
  note_id, user_id, NULL,
  COALESCE(title, 'Untitled Note'), 'meeting',
  raw_transcript, ai_summary, COALESCE(ai_status, 'none'),
  COALESCE(action_items, '[]'), COALESCE(decisions, '[]'), COALESCE(follow_ups, '[]'),
  calendar_event_id, calendar_event_title, calendar_event_time,
  created_at, updated_at
FROM notes
WHERE is_deleted = false
ON CONFLICT (entry_id) DO NOTHING;

-- Migrate note_contacts to use eln_entry linked_strain_ids... actually just keep note_contacts
-- but add an entry_id column pointing to the migrated entry
ALTER TABLE note_contacts
  ADD COLUMN IF NOT EXISTS entry_id UUID REFERENCES eln_entries(entry_id) ON DELETE CASCADE;

UPDATE note_contacts nc
SET entry_id = nc.note_id
WHERE entry_id IS NULL;

-- Index for fast entry_type filtering
CREATE INDEX IF NOT EXISTS eln_entries_type_idx ON eln_entries(entry_type);
CREATE INDEX IF NOT EXISTS eln_entries_ai_status_idx ON eln_entries(ai_status);

COMMIT;
