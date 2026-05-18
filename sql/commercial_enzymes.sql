-- Migration: Commercial Enzyme Supplementation
-- Adds commercial enzyme registry, supplementation tracking, and process_mode
-- to fermentation_runs and tea_process_configs.

-- ---------------------------------------------------------------------------
-- 1. Commercial enzyme product catalogue
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS commercial_enzymes (
    enzyme_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_name       TEXT NOT NULL,
    supplier           TEXT NOT NULL,
    enzyme_class       TEXT NOT NULL,    -- 'feruloyl_esterase', 'lipase', 'tannase', 'protease', 'xylanase', 'cellulase', 'amylase'
    ec_numbers         TEXT[],           -- e.g. ARRAY['3.1.1.73']
    activity_u_mg      NUMERIC,          -- declared specific activity U/mg
    price_usd_kg       NUMERIC,          -- current list price USD/kg
    gras_status        BOOLEAN DEFAULT FALSE,
    min_temp_c         NUMERIC,
    max_temp_c         NUMERIC,
    ph_optimum_min     NUMERIC,
    ph_optimum_max     NUMERIC,
    typical_loading_g_kg_substrate NUMERIC,  -- g enzyme per kg dry substrate
    notes              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 2. Enzyme supplementation records (links runs to enzymes)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS enzyme_supplementation (
    supplementation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id             UUID REFERENCES fermentation_runs(run_id) ON DELETE CASCADE,
    enzyme_id          UUID REFERENCES commercial_enzymes(enzyme_id),
    loading_g_kg       NUMERIC NOT NULL,  -- g enzyme per kg dry substrate
    addition_time_hrs  NUMERIC,           -- hours post-inoculation when enzyme was added
    cost_usd           NUMERIC,           -- calculated cost for this run
    notes              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 3. Add process_mode to fermentation_runs
-- ---------------------------------------------------------------------------

ALTER TABLE fermentation_runs
    ADD COLUMN IF NOT EXISTS process_mode TEXT
        CHECK (process_mode IN ('ssf_only', 'enzyme_supplemented', 'enzyme_only'))
        DEFAULT 'ssf_only';

-- ---------------------------------------------------------------------------
-- 4. Add process_mode + enzyme_supplementation JSONB to tea_process_configs
-- ---------------------------------------------------------------------------

ALTER TABLE tea_process_configs
    ADD COLUMN IF NOT EXISTS process_mode TEXT
        CHECK (process_mode IN ('ssf_only', 'enzyme_supplemented', 'enzyme_only'))
        DEFAULT 'ssf_only';

ALTER TABLE tea_process_configs
    ADD COLUMN IF NOT EXISTS enzyme_supplementation JSONB;
-- Expected shape: [{"enzyme_id": "...", "loading_g_kg": 5.0, "price_usd_kg": 120.0}, ...]

-- ---------------------------------------------------------------------------
-- 5. discovery_mode on strain_compound_opportunities is already INTEGER.
--    Mode 4 = enzyme_supplemented. No schema change needed.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 6. Seed 8 commercial enzyme products
-- ---------------------------------------------------------------------------

INSERT INTO commercial_enzymes
    (product_name, supplier, enzyme_class, ec_numbers, activity_u_mg, price_usd_kg, gras_status,
     min_temp_c, max_temp_c, ph_optimum_min, ph_optimum_max, typical_loading_g_kg_substrate, notes)
VALUES
    ('Ultraflo Max',       'Novozymes',       'xylanase',         ARRAY['3.2.1.8'],   500,   80,  TRUE,  30, 65, 4.5, 8.0, 2.0,  'Wheat processing xylanase, broad pH tolerance'),
    ('Shearzyme 500L',     'Novozymes',       'xylanase',         ARRAY['3.2.1.8'],   500,   75,  TRUE,  30, 60, 4.0, 7.5, 2.0,  'Arabinoxylanase for cereal substrates'),
    ('Feruloyl Esterase A','AB Enzymes',      'feruloyl_esterase',ARRAY['3.1.1.73'],  180,  220, FALSE,  30, 60, 4.5, 7.0, 5.0,  'Research-grade FAE-A for ferulic acid release'),
    ('Resinase A 2X',      'Novozymes',       'lipase',           ARRAY['3.1.1.3'],   600,  150,  TRUE,  30, 70, 5.0, 9.0, 3.0,  'Triacylglycerol lipase for lipid-rich substrates'),
    ('Tannase 500',        'Shin Nihon',       'tannase',          ARRAY['3.1.1.20'],  500,  340, FALSE,  25, 60, 4.0, 7.0, 4.0,  'Tannin acyl hydrolase for tannin-rich substrates'),
    ('Validase FP Conc',   'Valley Research', 'cellulase',        ARRAY['3.2.1.4'],   700,   60,  TRUE,  40, 65, 4.5, 6.5, 5.0,  'Fungal cellulase cocktail for lignocellulosic substrates'),
    ('Protex 6L',          'Genencor',        'protease',         ARRAY['3.4.21.62'], 450,  110,  TRUE,  30, 65, 6.0, 9.0, 3.0,  'Subtilisin serine protease for protein-rich substrates'),
    ('AMANO Lipase PS',    'Amano Enzyme',    'lipase',           ARRAY['3.1.1.3'],   400,  280, FALSE,  20, 50, 5.0, 8.0, 2.0,  'Burkholderia cepacia lipase, high regioselectivity')
ON CONFLICT DO NOTHING;
