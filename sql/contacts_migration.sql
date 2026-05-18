-- Contacts module migration
-- Apply to running DB:
--   docker exec -i symbio_postgres psql -U symbio -d symbio < /opt/symbio/sql/contacts_migration.sql

-- ---------------------------------------------------------------------------
-- Google OAuth tokens (per-user, for Gmail/Calendar sync)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS google_oauth_tokens (
    token_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    access_token    TEXT        NOT NULL,
    refresh_token   TEXT,
    token_expiry    TIMESTAMPTZ,
    scopes          TEXT[]      DEFAULT '{}',
    google_email    TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id)
);

-- ---------------------------------------------------------------------------
-- Contacts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contacts (
    contact_id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name                    TEXT        NOT NULL,
    email                   TEXT,
    phone                   TEXT,
    organization            TEXT,
    title                   TEXT,
    subject_areas           TEXT[]      DEFAULT '{}',
    tags                    TEXT[]      DEFAULT '{}',
    notes                   TEXT,
    linkedin_url            TEXT,
    website_url             TEXT,
    avatar_url              TEXT,
    enrichment_data         JSONB       DEFAULT '{}',
    ai_summary              TEXT,
    ai_summary_updated_at   TIMESTAMPTZ,
    last_enriched_at        TIMESTAMPTZ,
    last_interaction_at     TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by              UUID        REFERENCES users(user_id) ON DELETE SET NULL,
    archived                BOOLEAN     DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_contacts_email         ON contacts (email);
CREATE INDEX IF NOT EXISTS idx_contacts_tags          ON contacts USING gin (tags);
CREATE INDEX IF NOT EXISTS idx_contacts_subject_areas ON contacts USING gin (subject_areas);
CREATE INDEX IF NOT EXISTS idx_contacts_org           ON contacts (organization);

-- ---------------------------------------------------------------------------
-- Contact → Contact relationship graph edges
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_relationships (
    rel_id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_a_id        UUID    NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
    contact_b_id        UUID    NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
    relationship_type   TEXT    NOT NULL DEFAULT 'colleague',
    -- colleague | reports_to | client | partner | advisor | investor | co_author | supplier
    description         TEXT,
    strength            INT     DEFAULT 3 CHECK (strength BETWEEN 1 AND 5),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (contact_a_id, contact_b_id, relationship_type)
);

-- ---------------------------------------------------------------------------
-- Contact interactions (emails, meetings, notes, calls)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_interactions (
    interaction_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id      UUID        NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
    interaction_type TEXT       NOT NULL,
    -- email_sent | email_received | meeting | call | note
    subject         TEXT,
    content_preview TEXT,       -- first 500 chars
    full_content    TEXT,
    external_id     TEXT,       -- Gmail message-id or Calendar event-id
    occurred_at     TIMESTAMPTZ NOT NULL,
    direction       TEXT,       -- inbound | outbound | null (meetings/notes)
    metadata        JSONB       DEFAULT '{}',
    synced_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (contact_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_interactions_contact  ON contact_interactions (contact_id);
CREATE INDEX IF NOT EXISTS idx_interactions_occurred ON contact_interactions (occurred_at DESC);

-- ---------------------------------------------------------------------------
-- Contact reminders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_reminders (
    reminder_id     UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id      UUID    NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
    reminder_type   TEXT    NOT NULL DEFAULT 'follow_up',
    -- unanswered_email | unfinished_deal | follow_up | custom
    title           TEXT    NOT NULL,
    description     TEXT,
    due_date        DATE,
    resolved        BOOLEAN DEFAULT FALSE,
    resolved_at     TIMESTAMPTZ,
    auto_generated  BOOLEAN DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reminders_open ON contact_reminders (contact_id, created_at)
    WHERE NOT resolved;

-- ---------------------------------------------------------------------------
-- Contact → Substrate (waste stream / TEA) links
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_substrate_links (
    link_id         UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id      UUID    NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
    substrate_id    UUID    NOT NULL REFERENCES substrates(substrate_id) ON DELETE CASCADE,
    role            TEXT    DEFAULT 'partner',  -- partner | supplier | advisor | client
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (contact_id, substrate_id)
);
