-- 006_notebook_notes_tasks.sql
-- Apply: docker exec -i symbio_postgres psql -U symbio -d symbio < /opt/symbio/sql/migrations/006_notebook_notes_tasks.sql

-- ── Protocol versioning enhancements ─────────────────────────────────────────

ALTER TABLE protocol_revisions
  ADD COLUMN IF NOT EXISTS version_label    TEXT,
  ADD COLUMN IF NOT EXISTS is_major         BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS change_summary   TEXT,
  ADD COLUMN IF NOT EXISTS changed_by       UUID REFERENCES users(user_id) ON DELETE SET NULL;

ALTER TABLE protocols
  ADD COLUMN IF NOT EXISTS version_major INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS version_minor INT NOT NULL DEFAULT 0;

-- Seed version_major from existing version field where possible
UPDATE protocols
SET version_major = CASE
      WHEN version ~ '^\d+$' THEN version::INT
      ELSE 1
    END,
    version_minor = 0
WHERE version_major = 1 AND version_minor = 0;

-- ── ELN: project link on notebooks ───────────────────────────────────────────

ALTER TABLE eln_notebooks
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(project_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_eln_notebooks_project ON eln_notebooks (project_id) WHERE project_id IS NOT NULL;

-- ── ELN: linked entities on entries ──────────────────────────────────────────

ALTER TABLE eln_entries
  ADD COLUMN IF NOT EXISTS linked_run_ids       UUID[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS linked_strain_ids    UUID[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS linked_substrate_ids UUID[]  DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS linked_protocols     JSONB   DEFAULT '[]';

-- ── Notes ─────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS notes (
    note_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    title                TEXT        NOT NULL DEFAULT 'Untitled Note',
    body                 TEXT,
    raw_transcript       TEXT,
    ai_summary           TEXT,
    action_items         JSONB       NOT NULL DEFAULT '[]',
    decisions            JSONB       NOT NULL DEFAULT '[]',
    follow_ups           JSONB       NOT NULL DEFAULT '[]',
    calendar_event_id    TEXT,
    calendar_event_title TEXT,
    calendar_event_time  TIMESTAMPTZ,
    ai_status            TEXT        NOT NULL DEFAULT 'none',
    -- none | processing | done | error
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_deleted           BOOLEAN     NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_notes_user     ON notes (user_id, created_at DESC) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_notes_calendar ON notes (calendar_event_id)        WHERE calendar_event_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS note_contacts (
    id          UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id     UUID    NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
    contact_id  UUID    NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
    source      TEXT    NOT NULL DEFAULT 'manual',  -- attendee | manual
    UNIQUE (note_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_note_contacts_note    ON note_contacts (note_id);
CREATE INDEX IF NOT EXISTS idx_note_contacts_contact ON note_contacts (contact_id);

CREATE TABLE IF NOT EXISTS note_recordings (
    recording_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    note_id              UUID        NOT NULL REFERENCES notes(note_id) ON DELETE CASCADE,
    duration_secs        INT,
    transcription_status TEXT        NOT NULL DEFAULT 'pending',
    -- pending | processing | done | error
    created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Personal tasks ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS tasks (
    task_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    title           TEXT        NOT NULL,
    description     TEXT,
    due_date        DATE,
    status          TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
    source_note_id  UUID        REFERENCES notes(note_id) ON DELETE SET NULL,
    project_id      UUID        REFERENCES projects(project_id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_user    ON tasks (user_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks (project_id) WHERE project_id IS NOT NULL;
