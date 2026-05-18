-- Key Language library entries
CREATE TABLE IF NOT EXISTS key_language (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    term        TEXT        NOT NULL,
    content     TEXT        NOT NULL DEFAULT '',
    category    TEXT        NOT NULL DEFAULT '',
    notes       TEXT        NOT NULL DEFAULT '',
    sort_order  INT         NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Singleton settings row for marketing module
CREATE TABLE IF NOT EXISTS marketing_settings (
    id                      INT  PRIMARY KEY DEFAULT 1,
    key_language_doc_id     TEXT,
    key_language_doc_url    TEXT,
    key_language_synced_at  TIMESTAMPTZ,
    CHECK (id = 1)
);

INSERT INTO marketing_settings (id) VALUES (1) ON CONFLICT DO NOTHING;

-- Version history for key language entries
CREATE TABLE IF NOT EXISTS key_language_history (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    entry_id   UUID        NOT NULL REFERENCES key_language(id) ON DELETE CASCADE,
    content    TEXT        NOT NULL,
    saved_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS key_language_history_entry_idx ON key_language_history(entry_id, saved_at DESC);
