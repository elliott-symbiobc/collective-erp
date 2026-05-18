-- Migration 009: PDF attachments for notebook entries

BEGIN;

CREATE TABLE IF NOT EXISTS eln_entry_attachments (
  attachment_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id       UUID NOT NULL REFERENCES eln_entries(entry_id) ON DELETE CASCADE,
  original_name  TEXT NOT NULL,
  file_path      TEXT NOT NULL,
  file_size      BIGINT,
  content_type   TEXT DEFAULT 'application/pdf',
  uploaded_by    UUID REFERENCES users(user_id) ON DELETE SET NULL,
  uploaded_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS eln_entry_attachments_entry_idx ON eln_entry_attachments(entry_id);

COMMIT;
