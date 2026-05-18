-- 041: notebook entry collaborators + Google Doc link

-- Per-entry collaborators (platform users who can view/edit regardless of is_shared)
CREATE TABLE IF NOT EXISTS eln_entry_collaborators (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id    UUID NOT NULL REFERENCES eln_entries(entry_id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    added_by    UUID REFERENCES users(user_id) ON DELETE SET NULL,
    added_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (entry_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_eln_collaborators_entry ON eln_entry_collaborators(entry_id);
CREATE INDEX IF NOT EXISTS idx_eln_collaborators_user  ON eln_entry_collaborators(user_id);

-- Google Doc URL stored on the entry
ALTER TABLE eln_entries ADD COLUMN IF NOT EXISTS gdoc_url TEXT;
ALTER TABLE eln_entries ADD COLUMN IF NOT EXISTS gdoc_id  TEXT;
