-- Migration 056: Native bioSTEAM LCA characterization factor tables
-- Switches from the broken biosteam_lca package to native bioSTEAM LCA methods:
-- stream.set_CF(), HeatUtility.set_CF(), PowerUtility.set_CF(), system.get_net_impact().
-- Scientific principle: every impact factor has a citation; every inventory flow is auditable.

-- ---------------------------------------------------------------------------
-- Stream characterization factors
-- Chemical-level CFs consumed via stream.set_CF(key, value).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lca_stream_cfs (
    cf_id           SERIAL PRIMARY KEY,
    chemical_id     TEXT NOT NULL,        -- matches bst Stream/chemical name e.g. 'NaOH', 'Starch'
    impact_key      TEXT NOT NULL,        -- e.g. 'GWP', 'AP', 'EP'
    cf_value_per_kg NUMERIC NOT NULL,     -- impact per kg of this chemical
    cf_units        TEXT DEFAULT 'kg CO2 eq/kg',
    background_db   TEXT DEFAULT 'GREET 2022',
    uncertainty_pct NUMERIC,
    citation_text   TEXT NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT now(),
    UNIQUE (chemical_id, impact_key)
);

CREATE INDEX IF NOT EXISTS idx_lca_stream_cfs_chemical_impact
    ON lca_stream_cfs (chemical_id, impact_key);

-- ---------------------------------------------------------------------------
-- Heat utility characterization factors
-- Agent-level CFs consumed via HeatUtility.set_CF(agent_id, key, value, basis).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lca_heat_utility_cfs (
    cf_id       SERIAL PRIMARY KEY,
    agent_id    TEXT NOT NULL,     -- matches bst HeatUtility agent ID e.g. 'low_pressure_steam'
    impact_key  TEXT NOT NULL,
    cf_value    NUMERIC NOT NULL,
    cf_basis    TEXT DEFAULT 'kg', -- 'kg', 'mol', or 'kJ'
    cf_units    TEXT,
    background_db TEXT DEFAULT 'GREET 2022',
    uncertainty_pct NUMERIC,
    citation_text TEXT NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT now(),
    UNIQUE (agent_id, impact_key)
);

CREATE INDEX IF NOT EXISTS idx_lca_heat_utility_cfs_agent_impact
    ON lca_heat_utility_cfs (agent_id, impact_key);

-- ---------------------------------------------------------------------------
-- Power utility characterization factors
-- Electricity CFs consumed via PowerUtility.set_CF(key, consumption, production).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lca_power_utility_cfs (
    cf_id           SERIAL PRIMARY KEY,
    impact_key      TEXT NOT NULL UNIQUE,
    consumption_cf  NUMERIC NOT NULL,   -- impact per kWh consumed
    production_cf   NUMERIC NOT NULL,   -- impact per kWh exported (usually negative)
    cf_units        TEXT DEFAULT 'kg CO2 eq/kWh',
    grid_region     TEXT DEFAULT 'US_avg',
    year            INTEGER,
    background_db   TEXT DEFAULT 'EPA eGRID 2022',
    citation_text   TEXT NOT NULL,
    updated_at      TIMESTAMPTZ DEFAULT now()
);


-- ---------------------------------------------------------------------------
-- SEED DATA: lca_stream_cfs
-- Real literature values for common biorefinery chemicals.
-- ---------------------------------------------------------------------------
INSERT INTO lca_stream_cfs
    (chemical_id, impact_key, cf_value_per_kg, background_db, citation_text)
VALUES
    ('NaOH', 'GWP', 2.09, 'GREET 2022',
     'Wang et al. 2022 GREET Model, ANL/ESD-21/8; caustic soda membrane cell process'),

    ('H2SO4', 'GWP', 0.0433, 'ecoinvent 3.9 proxy',
     'Wernet et al. 2016 Int J LCA; sulfuric acid production, global average'),

    ('NH3', 'GWP', 2.64, 'GREET 2022',
     'Wang et al. 2022 GREET Model; Haber-Bosch ammonia, natural gas feedstock'),

    ('HCl', 'GWP', 1.97, 'ecoinvent 3.9 proxy',
     'Wernet et al. 2016 Int J LCA; hydrogen chloride from chlorine-alkali'),

    ('Starch', 'GWP', 0.28, 'USDA LCA Commons',
     'Interagency LCA working group; corn starch, wet milling, cradle-to-gate'),

    ('Cellulose', 'GWP', 0.50, 'GREET 2022',
     'Wang et al. 2022; agricultural residue cellulose, field-to-biorefinery gate'),

    ('Glucose', 'GWP', 0.47, 'GREET 2022',
     'Wang et al. 2022; glucose syrup from corn wet milling'),

    ('NaOH', 'AP', 0.006, 'ecoinvent 3.9 proxy',
     'Wernet et al. 2016; acidification potential, SO2 eq'),

    ('NH3', 'AP', 0.015, 'ecoinvent 3.9 proxy',
     'Wernet et al. 2016; ammonia acidification potential'),

    ('NaOH', 'EP', 0.0008, 'ecoinvent 3.9 proxy',
     'Wernet et al. 2016; eutrophication potential, PO4 eq')

ON CONFLICT DO NOTHING;


-- ---------------------------------------------------------------------------
-- SEED DATA: lca_heat_utility_cfs
-- Natural gas boiler steam and cooling utility CFs.
-- ---------------------------------------------------------------------------
INSERT INTO lca_heat_utility_cfs
    (agent_id, impact_key, cf_value, cf_basis, cf_units, citation_text)
VALUES
    ('low_pressure_steam', 'GWP', 0.0724, 'kg', 'kg CO2 eq/kg steam',
     'Thinkstep 2019; natural gas steam boiler, 90% efficiency, US average gas mix'),

    ('medium_pressure_steam', 'GWP', 0.0724, 'kg', 'kg CO2 eq/kg steam',
     'Thinkstep 2019; natural gas steam boiler, 90% efficiency, US average gas mix'),

    ('high_pressure_steam', 'GWP', 0.0724, 'kg', 'kg CO2 eq/kg steam',
     'Thinkstep 2019; natural gas steam boiler, 90% efficiency, US average gas mix'),

    ('cooling_water', 'GWP', 0.000302, 'kg', 'kg CO2 eq/kg water',
     'Gleick 1994 + GREET 2022; cooling tower electricity + makeup water, US avg'),

    ('chilled_water', 'GWP', 0.000450, 'kg', 'kg CO2 eq/kg water',
     'GREET 2022; chilled water including chiller electricity at US grid intensity')

ON CONFLICT DO NOTHING;


-- ---------------------------------------------------------------------------
-- SEED DATA: lca_power_utility_cfs
-- US average grid electricity CFs from EPA eGRID 2022.
-- ---------------------------------------------------------------------------
INSERT INTO lca_power_utility_cfs
    (impact_key, consumption_cf, production_cf, grid_region, year, citation_text)
VALUES
    ('GWP', 0.386, -0.386, 'US_avg', 2022,
     'EPA eGRID 2022; national average electricity CO2 emission factor, 0.386 kg CO2e/kWh'),

    ('AP', 0.00121, -0.00121, 'US_avg', 2022,
     'EPA eGRID 2022; SO2 emission factor, national average'),

    ('EP', 0.000147, -0.000147, 'US_avg', 2022,
     'EPA eGRID 2022; NOx-based eutrophication, national average')

ON CONFLICT DO NOTHING;
