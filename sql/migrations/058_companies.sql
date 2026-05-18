-- Migration 058: Companies as first-class entities
-- Creates a companies table, links contacts to companies,
-- and adds missing columns (tagline, is_client) referenced by existing code.

-- ── Companies table ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS companies (
    company_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name                TEXT        NOT NULL,
    website_url         TEXT,
    linkedin_url        TEXT,
    logo_url            TEXT,
    industry            TEXT,
    company_size        TEXT,
    company_type        TEXT,
    company_location    TEXT,
    description         TEXT,           -- AI-generated (mirrors projects.company_description pipeline)
    esg_url             TEXT,
    partnership_potential TEXT,
    regulatory_pressures  TEXT[]  DEFAULT '{}',
    government_incentives TEXT[]  DEFAULT '{}',
    tags                TEXT[]  DEFAULT '{}',
    notes               TEXT,
    enrichment_data     JSONB   DEFAULT '{}',
    last_enriched_at    TIMESTAMPTZ,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    archived            BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_companies_name ON companies (name);
CREATE INDEX IF NOT EXISTS idx_companies_archived ON companies (archived);

-- ── Link contacts to companies ────────────────────────────────────────────────

ALTER TABLE contacts
    ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(company_id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_company_id ON contacts (company_id);

-- ── Missing columns referenced by existing code ───────────────────────────────

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tagline   TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS is_client BOOLEAN DEFAULT FALSE;

-- ── Seed companies from existing contact organisation strings ─────────────────
-- Creates one company record per unique non-null organisation name,
-- then links every contact with that organisation to the new record.

DO $$
DECLARE
    org_name TEXT;
    new_company_id UUID;
BEGIN
    FOR org_name IN
        SELECT DISTINCT TRIM(organization)
        FROM contacts
        WHERE organization IS NOT NULL
          AND TRIM(organization) <> ''
          AND archived = FALSE
        ORDER BY TRIM(organization)
    LOOP
        -- Insert company (skip if a company with this name already exists)
        INSERT INTO companies (name)
        VALUES (org_name)
        ON CONFLICT DO NOTHING
        RETURNING company_id INTO new_company_id;

        -- If it already existed, look it up
        IF new_company_id IS NULL THEN
            SELECT company_id INTO new_company_id
            FROM companies
            WHERE name = org_name
            LIMIT 1;
        END IF;

        -- Link all contacts with this organisation to the company
        UPDATE contacts
        SET company_id = new_company_id
        WHERE TRIM(organization) = org_name
          AND company_id IS NULL;
    END LOOP;
END $$;
