-- Comments on notebook entries, visible to owner and collaborators
CREATE TABLE IF NOT EXISTS eln_entry_comments (
    comment_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id    UUID        NOT NULL REFERENCES eln_entries(entry_id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    body        TEXT        NOT NULL CHECK (char_length(body) > 0),
    is_deleted  BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS eln_entry_comments_entry_idx ON eln_entry_comments(entry_id);
CREATE INDEX IF NOT EXISTS eln_entry_comments_user_idx  ON eln_entry_comments(user_id);
