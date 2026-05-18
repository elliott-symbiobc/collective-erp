-- 014_dilutive.sql — Dilutive (investor) funding tracker

CREATE TABLE IF NOT EXISTS dilutive_investors (
    investor_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    status         TEXT NOT NULL DEFAULT 'Not Started',  -- Not Started | Need to Follow Up | In Progress | Passed | Committed
    name           TEXT,
    role           TEXT,
    firm           TEXT,
    firm_type      TEXT,       -- VC | CVC | Angel | Family Office | Gov. Grant
    intro_type     TEXT,       -- Warm | Cold
    intro_notes    TEXT,
    email          TEXT,
    notes          TEXT,
    office_phone   TEXT,
    cell_phone     TEXT,
    tags           TEXT[]  DEFAULT '{}',
    funding_type   TEXT,
    avg_check_size TEXT,
    source_link    TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dilutive_status ON dilutive_investors (status);
CREATE INDEX IF NOT EXISTS idx_dilutive_firm   ON dilutive_investors (firm);