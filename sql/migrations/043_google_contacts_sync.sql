-- Migration: Google Contacts bidirectional sync + pending contacts queue
-- Apply:
--   docker exec -i symbio_postgres psql -U symbio -d symbio < /opt/symbio/sql/migrations/043_google_contacts_sync.sql

-- Per-user mapping from platform contact → Google resource name.
-- Separate from contacts table because each user has their own Google Contacts list.
CREATE TABLE IF NOT EXISTS contact_google_mappings (
    mapping_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id          UUID        NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
    user_id             UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    google_resource_name TEXT       NOT NULL,
    google_etag         TEXT,
    synced_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (contact_id, user_id),
    UNIQUE (user_id, google_resource_name)
);

CREATE INDEX IF NOT EXISTS idx_cgm_contact ON contact_google_mappings (contact_id);
CREATE INDEX IF NOT EXISTS idx_cgm_user    ON contact_google_mappings (user_id);

-- Sync token for incremental Google Contacts syncs (per user)
ALTER TABLE google_oauth_tokens ADD COLUMN IF NOT EXISTS google_contacts_sync_token TEXT;

-- Pending contacts — surfaced from Google Contacts import or Gmail activity.
-- Require human approval before becoming full contact records.
CREATE TABLE IF NOT EXISTS pending_contacts (
    pending_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    source              TEXT        NOT NULL,  -- 'google_contacts' | 'gmail_activity'
    name                TEXT,
    email               TEXT,
    phone               TEXT,
    organization        TEXT,
    title               TEXT,
    google_resource_name TEXT,
    google_etag         TEXT,
    raw_data            JSONB       DEFAULT '{}',
    status              TEXT        NOT NULL DEFAULT 'pending',  -- pending | approved | dismissed
    reviewed_by         UUID        REFERENCES users(user_id) ON DELETE SET NULL,
    reviewed_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pending_status   ON pending_contacts (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pending_email    ON pending_contacts (email) WHERE email IS NOT NULL;

-- Partial unique indexes to deduplicate active pending records
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_unique_email_source
    ON pending_contacts (email, source) WHERE email IS NOT NULL AND status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS idx_pending_unique_resource_source
    ON pending_contacts (google_resource_name, source) WHERE google_resource_name IS NOT NULL AND status = 'pending';
