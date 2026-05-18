-- 023_tea_calculation_workbook.sql
-- Full calculation transparency for TEA: one row per cost component per run.
-- Every number in the TEA output is traceable to a source, formula, and inputs.

CREATE TABLE IF NOT EXISTS tea_calculation_workbook (
    workbook_id     UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    -- Link to either route_tea_results or substrate_tea_results
    result_id       UUID,       -- route_tea_results.result_id (preferred)
    tea_id          UUID,       -- substrate_tea_results.tea_id (legacy)
    substrate_id    UUID        REFERENCES substrates(substrate_id) ON DELETE CASCADE,
    candidate_output TEXT       NOT NULL,
    route_code      TEXT,

    step_order      INT         NOT NULL,
    cost_component  TEXT        NOT NULL,
    -- Values: raw_material | utility_electricity | utility_steam | utility_cooling |
    --         utility_water | labor | maintenance | insurance | overhead |
    --         capex_amortization | ww_treatment | enzyme_supplementation |
    --         dsp_{operation_name} | inoculum | chemicals
    value_usd_kg    DOUBLE PRECISION,   -- cost in USD/kg product (primary metric)
    value_usd_yr    DOUBLE PRECISION,   -- cost in USD/year (for absolute scale)
    unit            TEXT        NOT NULL DEFAULT 'USD/kg product',

    -- Full audit trail
    formula_text    TEXT,       -- human-readable e.g. "sub_cost_per_ton/1000 / yield_g_g"
    input_values    JSONB,      -- all inputs used: {"sub_cost_per_ton": 200, "yield_g_g": 0.88, ...}
    computed_value  DOUBLE PRECISION,   -- the intermediate value before final unit conversion

    -- Provenance
    source_type     TEXT        NOT NULL DEFAULT 'assumption',
    -- 'internal_data' | 'literature' | 'vendor_quote' | 'assumption' | 'user_input'
    source_citation TEXT,       -- full citation string
    source_year     INT,        -- publication year for staleness detection
    assumption_flag BOOLEAN     NOT NULL DEFAULT TRUE,
    assumption_note TEXT,       -- why this is flagged, what would de-flag it

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_workbook_result ON tea_calculation_workbook (result_id);
CREATE INDEX IF NOT EXISTS idx_workbook_tea    ON tea_calculation_workbook (tea_id);
CREATE INDEX IF NOT EXISTS idx_workbook_sub    ON tea_calculation_workbook (substrate_id, candidate_output);

COMMENT ON TABLE tea_calculation_workbook IS
    'Full calculation audit trail for TEA results. One row per cost component. '
    'All values must have source_citation. assumption_flag=true means value was not '
    'derived from internal experimental data or a confirmed vendor quote.';

COMMENT ON COLUMN tea_calculation_workbook.assumption_flag IS
    'TRUE if derived from literature defaults, industry rules-of-thumb, or unvalidated estimates. '
    'FALSE only when derived from ≥3 internal fermentation runs or a confirmed vendor quote.';
