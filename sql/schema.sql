-- Collective ERP — PostgreSQL 16 Schema
-- Init script: runs once on first container start.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- 0. Users
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS users (
    user_id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    email           TEXT        NOT NULL UNIQUE,
    hashed_password TEXT        NOT NULL,
    name            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 1. Google OAuth tokens (per-user, for Gmail/Calendar sync)
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
-- 2. Contacts
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
-- 3. Contact → Contact relationship graph edges
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_relationships (
    rel_id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_a_id        UUID    NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
    contact_b_id        UUID    NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
    relationship_type   TEXT    NOT NULL DEFAULT 'colleague',
    description         TEXT,
    strength            INT     DEFAULT 3 CHECK (strength BETWEEN 1 AND 5),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (contact_a_id, contact_b_id, relationship_type)
);

-- ---------------------------------------------------------------------------
-- 4. Contact interactions (emails, meetings, notes, calls)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_interactions (
    interaction_id  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id      UUID        NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
    interaction_type TEXT       NOT NULL,
    subject         TEXT,
    content_preview TEXT,
    full_content    TEXT,
    external_id     TEXT,
    occurred_at     TIMESTAMPTZ NOT NULL,
    direction       TEXT,
    metadata        JSONB       DEFAULT '{}',
    synced_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (contact_id, external_id)
);

CREATE INDEX IF NOT EXISTS idx_interactions_contact  ON contact_interactions (contact_id);
CREATE INDEX IF NOT EXISTS idx_interactions_occurred ON contact_interactions (occurred_at DESC);

-- ---------------------------------------------------------------------------
-- 5. Contact reminders
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS contact_reminders (
    reminder_id     UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    contact_id      UUID    NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
    reminder_type   TEXT    NOT NULL DEFAULT 'follow_up',
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
-- 6. Invoices
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;

CREATE TABLE IF NOT EXISTS invoices (
    invoice_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_number  TEXT        NOT NULL UNIQUE,
    contact_id      UUID        REFERENCES contacts(contact_id) ON DELETE SET NULL,
    project_id      UUID,
    status          TEXT        NOT NULL DEFAULT 'draft',
    issue_date      DATE        NOT NULL DEFAULT CURRENT_DATE,
    due_date        DATE,
    paid_date       DATE,
    currency        TEXT        NOT NULL DEFAULT 'USD',
    line_items      JSONB       NOT NULL DEFAULT '[]',
    subtotal        NUMERIC(14,2) NOT NULL DEFAULT 0,
    tax_rate        NUMERIC(6,4)  NOT NULL DEFAULT 0,
    tax_amount      NUMERIC(14,2) NOT NULL DEFAULT 0,
    total           NUMERIC(14,2) NOT NULL DEFAULT 0,
    notes           TEXT,
    created_by      UUID        REFERENCES users(user_id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invoices_contact    ON invoices (contact_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status     ON invoices (status);
CREATE INDEX IF NOT EXISTS idx_invoices_issue_date ON invoices (issue_date DESC);

-- ---------------------------------------------------------------------------
-- 7. Invoice catalog (reusable line item templates)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS invoice_catalog (
    item_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT        NOT NULL,
    description TEXT,
    unit_price  NUMERIC(14,2) NOT NULL DEFAULT 0,
    unit        TEXT        NOT NULL DEFAULT 'each',
    category    TEXT,
    created_by  UUID        REFERENCES users(user_id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_catalog_category ON invoice_catalog (category);

-- ---------------------------------------------------------------------------
-- 8. API usage log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_usage_log (
    id              BIGSERIAL   PRIMARY KEY,
    service         TEXT        NOT NULL,
    operation       TEXT        NOT NULL,
    model           TEXT,
    input_tokens    INT,
    output_tokens   INT,
    audio_seconds   FLOAT,
    cost_usd        NUMERIC(12,6),
    called_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_api_usage_service   ON api_usage_log (service);
CREATE INDEX IF NOT EXISTS idx_api_usage_called_at ON api_usage_log (called_at);
