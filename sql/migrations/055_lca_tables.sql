-- Migration 055: LCA (Life Cycle Assessment) tables
-- Integrates bioSTEAM LCA with Brightway2/FORWAST for per-substrate environmental impact analysis.
-- Scientific principle: every impact factor has a citation; every inventory flow is auditable.

-- ---------------------------------------------------------------------------
-- LCA activity mappings
-- Maps bioSTEAM unit types and stream chemicals to Brightway2/FORWAST activity keys.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lca_activity_mappings (
    unit_type           TEXT PRIMARY KEY,
    bw2_database        TEXT NOT NULL,
    bw2_activity_key    TEXT NOT NULL,
    activity_name       TEXT,
    flow_category       TEXT CHECK (flow_category IN ('material', 'utility', 'chemical', 'process')),
    mapping_confidence  TEXT NOT NULL DEFAULT 'proxy' CHECK (mapping_confidence IN ('high', 'proxy', 'estimated')),
    notes               TEXT,
    citation_text       TEXT NOT NULL,
    updated_at          TIMESTAMPTZ DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- LCA method selections
-- Which Brightway2/TRACI LCIA methods to run for each LCA computation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lca_method_selections (
    method_id       SERIAL PRIMARY KEY,
    method_tuple    JSONB NOT NULL,
    display_name    TEXT NOT NULL,
    impact_category TEXT,
    units           TEXT,
    is_active       BOOLEAN DEFAULT true
);

-- ---------------------------------------------------------------------------
-- Substrate LCA results
-- Per-substrate LCA results; mirrors substrate_tea_results structure.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS substrate_lca_results (
    lca_id                  SERIAL PRIMARY KEY,
    substrate_id            UUID REFERENCES substrates(substrate_id) ON DELETE CASCADE,
    candidate_output        TEXT NOT NULL,
    functional_unit_kg      NUMERIC DEFAULT 1.0,
    allocation_method       TEXT DEFAULT 'mass',
    lca_database            TEXT DEFAULT 'FORWAST',
    gwp100_kg_co2eq_per_kg  NUMERIC,
    ced_mj_per_kg           NUMERIC,
    fwd_m3_per_kg           NUMERIC,
    hct_ctuh_per_kg         NUMERIC,
    gwp100_annual_kg_co2eq  NUMERIC,
    hotspot_flow            TEXT,
    hotspot_pct             NUMERIC,
    simulation_method       TEXT DEFAULT 'biosteam_lca',
    created_at              TIMESTAMPTZ DEFAULT now(),
    UNIQUE (substrate_id, candidate_output, allocation_method)
);

CREATE INDEX IF NOT EXISTS idx_substrate_lca_results_substrate
    ON substrate_lca_results (substrate_id);

-- ---------------------------------------------------------------------------
-- LCA inventory workbook
-- Per-flow impact breakdown for audit trail and waterfall chart rendering.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lca_inventory_workbook (
    id                          SERIAL PRIMARY KEY,
    substrate_id                UUID REFERENCES substrates(substrate_id) ON DELETE CASCADE,
    candidate_output            TEXT NOT NULL,
    impact_key                  TEXT NOT NULL,
    flow_type                   TEXT CHECK (flow_type IN ('stream', 'heat_utility', 'power_utility', 'process_item')),
    flow_id                     TEXT,
    flow_amount_per_kg_product  NUMERIC,
    cf_value                    NUMERIC,
    impact_contribution_per_kg  NUMERIC,
    pct_of_total                NUMERIC,
    bw2_activity_key            TEXT,
    citation_text               TEXT,
    assumption_flag             BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_lca_inventory_workbook_substrate
    ON lca_inventory_workbook (substrate_id);


-- ---------------------------------------------------------------------------
-- SEED DATA: lca_method_selections
-- ---------------------------------------------------------------------------
INSERT INTO lca_method_selections
    (method_tuple, display_name, impact_category, units, is_active)
VALUES
    ('["TRACI 2.1", "environmental impact", "global warming"]',
     'GWP100 (TRACI 2.1)', 'GWP', 'kg CO2 eq', true),

    ('["TRACI 2.1", "environmental impact", "acidification"]',
     'Acidification (TRACI 2.1)', 'AP', 'kg SO2 eq', true),

    ('["TRACI 2.1", "environmental impact", "eutrophication"]',
     'Eutrophication (TRACI 2.1)', 'EP', 'kg N eq', true),

    ('["TRACI 2.1", "human health", "carcinogenics"]',
     'Human Health - Carcinogenics (TRACI 2.1)', 'HH_carc', 'CTUh', false),

    ('["IPCC 2013", "climate change", "GWP 100a"]',
     'GWP100 (IPCC 2013)', 'GWP', 'kg CO2 eq', false)

ON CONFLICT DO NOTHING;


-- ---------------------------------------------------------------------------
-- SEED DATA: lca_activity_mappings
-- Common bioSTEAM unit type / chemical → FORWAST activity key mappings.
-- ---------------------------------------------------------------------------
INSERT INTO lca_activity_mappings
    (unit_type, bw2_database, bw2_activity_key, activity_name,
     flow_category, mapping_confidence, citation_text)
VALUES
    ('AerobicFermenter', 'FORWAST', 'fermentation, aerobic',
     'Aerobic fermentation process', 'process', 'proxy',
     'FORWAST database v1.0; proxy mapping for aerobic fermentation'),

    ('AnaerobicFermenter', 'FORWAST', 'fermentation, anaerobic',
     'Anaerobic fermentation process', 'process', 'proxy',
     'FORWAST database v1.0; proxy mapping for anaerobic fermentation'),

    ('SprayDryer', 'FORWAST', 'drying, spray',
     'Spray drying process', 'process', 'proxy',
     'FORWAST database v1.0'),

    ('DiscCentrifuge', 'FORWAST', 'separation, centrifugation',
     'Centrifugation separation', 'process', 'proxy',
     'FORWAST database v1.0'),

    ('UltrafiltrationSkid', 'FORWAST', 'separation, membrane filtration',
     'Membrane ultrafiltration', 'process', 'estimated',
     'FORWAST database v1.0; estimated proxy'),

    ('NaOH', 'FORWAST', 'sodium hydroxide production',
     'Sodium hydroxide (NaOH)', 'chemical', 'high',
     'FORWAST database v1.0; caustic soda production'),

    ('H2SO4', 'FORWAST', 'sulfuric acid production',
     'Sulfuric acid (H2SO4)', 'chemical', 'high',
     'FORWAST database v1.0'),

    ('NH3', 'FORWAST', 'ammonia production',
     'Ammonia (NH3)', 'chemical', 'high',
     'FORWAST database v1.0'),

    ('electricity', 'FORWAST', 'electricity production, US average',
     'US grid electricity', 'utility', 'high',
     'FORWAST database v1.0; US average grid mix'),

    ('low_pressure_steam', 'FORWAST', 'steam production, natural gas',
     'Low pressure steam (natural gas)', 'utility', 'proxy',
     'FORWAST database v1.0'),

    ('cooling_water', 'FORWAST', 'cooling water supply',
     'Cooling water', 'utility', 'proxy',
     'FORWAST database v1.0')

ON CONFLICT (unit_type) DO NOTHING;
