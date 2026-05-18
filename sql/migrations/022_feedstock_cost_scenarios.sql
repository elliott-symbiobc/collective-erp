-- 022_feedstock_cost_scenarios.sql
-- Adds feedstock cost scenario support to TEA pipeline.
-- Substrates received as food waste sidestreams may have zero, nominal, or custom cost.

ALTER TABLE tea_process_configs
    ADD COLUMN IF NOT EXISTS feedstock_cost_scenario TEXT
        DEFAULT 'nominal'
        CHECK (feedstock_cost_scenario IN ('zero','nominal','low','high','custom')),
    ADD COLUMN IF NOT EXISTS feedstock_nominal_cost_per_ton DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS feedstock_cost_citation TEXT,
    ADD COLUMN IF NOT EXISTS feedstock_gate_fee_usd_ton DOUBLE PRECISION;

-- Also store resolved scenario on results for reporting transparency
ALTER TABLE route_tea_results
    ADD COLUMN IF NOT EXISTS feedstock_cost_scenario TEXT,
    ADD COLUMN IF NOT EXISTS feedstock_cost_usd_ton DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS workbook_summary JSONB;

ALTER TABLE substrate_tea_results
    ADD COLUMN IF NOT EXISTS feedstock_cost_scenario TEXT,
    ADD COLUMN IF NOT EXISTS feedstock_cost_usd_ton DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS workbook_summary JSONB;

COMMENT ON COLUMN tea_process_configs.feedstock_cost_scenario IS
    'zero=waste sidestream at no cost; nominal=literature default; low=nominal×0.70; high=nominal×1.30; custom=sub_cost_per_ton field';
COMMENT ON COLUMN tea_process_configs.feedstock_gate_fee_usd_ton IS
    'Optional tipping/gate fee received per tonne of waste substrate (reduces effective cost). Negative = revenue.';
