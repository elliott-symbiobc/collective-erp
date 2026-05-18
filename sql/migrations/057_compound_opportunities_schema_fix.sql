-- Migration 057: Fix strain_compound_opportunities schema
-- Adds columns referenced by application code but missing from the table,
-- plus new fields needed for card display in the discovery UI.

-- ---------------------------------------------------------------------------
-- Bug-fix columns: code already references these; they must exist.
-- ---------------------------------------------------------------------------
ALTER TABLE strain_compound_opportunities
    ADD COLUMN IF NOT EXISTS biosynthetic_plausibility FLOAT;

ALTER TABLE strain_compound_opportunities
    ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMPTZ DEFAULT now();

ALTER TABLE strain_compound_opportunities
    ADD COLUMN IF NOT EXISTS novelty_explanation TEXT;

ALTER TABLE strain_compound_opportunities
    ADD COLUMN IF NOT EXISTS market_segments JSONB;

ALTER TABLE strain_compound_opportunities
    ADD COLUMN IF NOT EXISTS ec_numbers JSONB;

-- ---------------------------------------------------------------------------
-- Foreign key column: links an opportunity to a specific substrate.
-- ---------------------------------------------------------------------------
ALTER TABLE strain_compound_opportunities
    ADD COLUMN IF NOT EXISTS substrate_id UUID REFERENCES substrates(substrate_id);

-- ---------------------------------------------------------------------------
-- Card display columns: new fields surfaced in the discovery card UI.
-- ---------------------------------------------------------------------------
ALTER TABLE strain_compound_opportunities
    ADD COLUMN IF NOT EXISTS production_method TEXT
        CHECK (production_method IN ('fermentation', 'enzymatic_extraction', 'chemical_synthesis', 'unknown'));

ALTER TABLE strain_compound_opportunities
    ADD COLUMN IF NOT EXISTS market_size_usd_bn NUMERIC;

ALTER TABLE strain_compound_opportunities
    ADD COLUMN IF NOT EXISTS applications JSONB;   -- array of strings

ALTER TABLE strain_compound_opportunities
    ADD COLUMN IF NOT EXISTS source_url TEXT;

ALTER TABLE strain_compound_opportunities
    ADD COLUMN IF NOT EXISTS lotus_id TEXT;
