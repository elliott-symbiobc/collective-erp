-- Migration 034: Move hardcoded TEA parameters out of tea_agent.py into DB with citations
-- Replaces: _ANALYTICAL_COST_PARAMS dict and _TEA_HURDLE_RATE/_TEA_PROJECT_YEARS/_DSP_LANG_FACTOR/_CEPCI_CURRENT constants

-- ---------------------------------------------------------------------------
-- Process cost benchmarks (replaces _ANALYTICAL_COST_PARAMS in tea_agent.py)
-- Each row represents a literature-cited (processing_usd_kg, capex_charge_usd_kg)
-- estimate for a specific output type. These are process engineering benchmarks,
-- not substrate-specific — they capture the cost of the unit operations needed
-- to produce each output type from a fungal fermentation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tea_process_benchmarks (
    benchmark_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    output_name         text NOT NULL,
    processing_usd_kg   double precision NOT NULL,
    capex_charge_usd_kg double precision NOT NULL,
    citation_text       text NOT NULL,
    doi                 text,
    basis_cepci         double precision NOT NULL DEFAULT 820.0,
    basis_year          integer NOT NULL DEFAULT 2022,
    notes               text,
    created_at          timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tea_process_benchmarks_output_name_key UNIQUE (output_name)
);

INSERT INTO tea_process_benchmarks
    (output_name, processing_usd_kg, capex_charge_usd_kg, citation_text, doi, basis_cepci, basis_year, notes)
VALUES
    ('Lactic Acid',           0.55, 0.35,
     'Wee Y.-J. et al. (2006) Biotechnological production of lactic acid. Food Technol Biotechnol 44(2):163–172; Humbird et al. (2011) NREL/TP-5100-47764.',
     'https://doi.org/10.2172/1013269', 820.0, 2022,
     'SSF + centrifugation + crystallization'),

    ('Citric Acid',           0.50, 0.30,
     'Papagianni M. (2007) Advances in citric acid fermentation. Biotechnol Adv 25(3):244–263. Anastassiadis S. et al. (2008) Citric acid production patent review. Recent Pat Biotechnol 2(2):107–123.',
     NULL, 820.0, 2022,
     'SSF + calcium citrate precipitation + acidification + crystallization'),

    ('Gluconic Acid',         0.45, 0.30,
     'Ramachandran S. et al. (2006) Gluconic acid: Properties, applications and microbial production. Food Technol Biotechnol 44(2):185–195.',
     NULL, 820.0, 2022,
     'Submerged fermentation + ion exchange chromatography'),

    ('Glucose-Maltose Syrup', 0.25, 0.15,
     'Bhatt S.M. et al. (2018) Synergistic effect of combined pretreatment for enzymatic saccharification. 3 Biotech 8:329. Crabb W.D. & Shetty J.K. (1999) Commodity scale production of sugars from starches. Curr Opin Microbiol 2(3):252–259.',
     'https://doi.org/10.1007/s13205-018-1346-3', 820.0, 2022,
     'Enzymatic saccharification (amylases) + plate filtration + evaporation'),

    ('Single-Cell Protein',   0.60, 0.40,
     'Nasseri A.T. et al. (2011) Single cell protein: production and process. Am J Food Technol 6(2):103–116.',
     NULL, 820.0, 2022,
     'Centrifuge + spray drying'),

    ('Fatty Acid Fractions',  1.80, 1.10,
     'Hasan F. et al. (2006) Industrial applications of microbial lipases. Enzyme Microb Technol 39(2):235–251.',
     'https://doi.org/10.1016/j.enzmictec.2005.10.016', 820.0, 2022,
     'Solvent extraction (hexane) + fractional distillation'),

    ('Cellulase Cocktail',    3.50, 2.00,
     'Merino S.T. & Cherry J. (2007) Progress and challenges in enzyme development for biomass utilization. Adv Biochem Eng Biotechnol 108:95–120.',
     'https://doi.org/10.1007/10_2007_066', 820.0, 2022,
     'Ultrafiltration concentration + spray drying'),

    ('Xylanase',              3.50, 2.00,
     'Polizeli M.L.T.M. et al. (2005) Xylanases from fungi: properties and industrial applications. Appl Microbiol Biotechnol 67(5):577–591.',
     'https://doi.org/10.1007/s00253-005-1982-2', 820.0, 2022,
     'Ultrafiltration concentration + spray drying'),

    ('Protease Enzyme',       3.50, 2.00,
     'Gupta R. et al. (2002) Microbial α-amylases: a biotechnological perspective. Process Biochem 38(11):1599–1616.',
     'https://doi.org/10.1016/S0032-9592(03)00053-0', 820.0, 2022,
     'Ultrafiltration concentration + spray drying'),

    ('Lipase Enzyme',         4.00, 2.50,
     'Hasan F. et al. (2006) Industrial applications of microbial lipases. Enzyme Microb Technol 39(2):235–251.',
     'https://doi.org/10.1016/j.enzmictec.2005.10.016', 820.0, 2022,
     'Immobilization on carrier or spray-drying with stabilisers'),

    ('Glucose Syrup',         0.25, 0.15,
     'Crabb W.D. & Shetty J.K. (1999) Commodity scale production of sugars from starches. Curr Opin Microbiol 2(3):252–259.',
     'https://doi.org/10.1016/S1369-5274(99)80044-X', 820.0, 2022,
     'Enzymatic saccharification + plate filtration + evaporation'),

    ('Glucose',               0.25, 0.15,
     'Crabb W.D. & Shetty J.K. (1999) Commodity scale production of sugars from starches. Curr Opin Microbiol 2(3):252–259.',
     'https://doi.org/10.1016/S1369-5274(99)80044-X', 820.0, 2022,
     'Enzymatic saccharification + filtration; analogous to Glucose Syrup'),

    ('Maltose',               0.25, 0.20,
     'Crabb W.D. & Shetty J.K. (1999) Commodity scale production of sugars from starches. Curr Opin Microbiol 2(3):252–259.',
     'https://doi.org/10.1016/S1369-5274(99)80044-X', 820.0, 2022,
     'Starch liquefaction + maltogenic amylase + filtration + evaporation'),

    ('Xylose Hydrolysate',    0.35, 0.20,
     'Gírio F.M. et al. (2010) Hemicelluloses for fuel ethanol: A review. Bioresour Technol 101(13):4775–4800.',
     'https://doi.org/10.1016/j.biortech.2010.01.088', 820.0, 2022,
     'Xylanase hydrolysis + plate filtration'),

    ('Peptides',              0.65, 0.40,
     'Sánchez-Vioque R. et al. (1999) Protein isolates from chickpea (Cicer arietinum L.): chemical composition, functional properties and protein characterization. Food Chem 64(2):237–243.',
     'https://doi.org/10.1016/S0308-8146(98)00133-X', 820.0, 2022,
     'Protease hydrolysis + ultrafiltration; analogous to Protein Hydrolysate'),

    ('Protein Hydrolysate',   0.65, 0.40,
     'Sánchez-Vioque R. et al. (1999) Food Chem 64(2):237–243.',
     'https://doi.org/10.1016/S0308-8146(98)00133-X', 820.0, 2022,
     'Alcalase/Neutrase hydrolysis + ultrafiltration'),

    ('Gallic Acid',           1.20, 0.80,
     'Aguilar C.N. et al. (2007) Ellagitannins, gallotannins, and gallic acid. Chem Eng J 136(2–3):160–166.',
     'https://doi.org/10.1016/j.cej.2007.03.067', 820.0, 2022,
     'Tannase hydrolysis + active carbon adsorption + crystallization'),

    ('Ferulic Acid',          2.50, 1.50,
     'Topakas E. et al. (2005) Comparison of wet and dry fractionation for extraction of ferulic acid from wheat bran. Bioresour Technol 96(15):1658–1669.',
     'https://doi.org/10.1016/j.biortech.2004.12.024', 820.0, 2022,
     'Feruloyl esterase hydrolysis + adsorption chromatography + crystallization')

ON CONFLICT (output_name) DO NOTHING;


-- ---------------------------------------------------------------------------
-- Financial model parameters (replaces module-level constants in tea_agent.py)
-- Each row is a named scalar with a primary literature citation.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tea_financial_params (
    param_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    param_name      text NOT NULL UNIQUE,
    param_value     double precision NOT NULL,
    param_type      text NOT NULL DEFAULT 'scalar',  -- scalar | index
    param_unit      text,
    param_description text,
    citation_text   text NOT NULL,
    doi             text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

INSERT INTO tea_financial_params
    (param_name, param_value, param_unit, param_description, citation_text, doi)
VALUES
    ('hurdle_rate', 0.15, 'fraction',
     'Discount (hurdle) rate for NPV calculation. NREL standard for nth-plant bioprocess TEA.',
     'Humbird D. et al. (2011) Process Design and Economics for Biochemical Conversion of Lignocellulosic Biomass to Ethanol. NREL/TP-5100-47764.',
     'https://doi.org/10.2172/1013269'),

    ('project_years', 10.0, 'years',
     'Project lifetime used for NPV discounting.',
     'Peters M.S., Timmerhaus K.D. & West R.E. (2003) Plant Design and Economics for Chemical Engineers, 5th ed., McGraw-Hill, Ch. 6.',
     NULL),

    ('lang_factor', 3.5, 'dimensionless',
     'Bare-module installation factor (purchased equipment cost → installed fixed capital). Value 3.5 applies to mixed fluid/solid processes.',
     'Peters M.S. et al. (2003) Table 6-8; Turton R. et al. (2018) Analysis, Synthesis, and Design of Chemical Processes, 5th ed., Appendix A.',
     NULL),

    ('cepci_current', 820.0, 'index',
     'Chemical Engineering Plant Cost Index basis used for equipment cost escalation (~2022 annual average).',
     'Chemical Engineering Magazine (2023) Annual CEPCI tabulation. Access: www.chemengonline.com/pci',
     NULL)

ON CONFLICT (param_name) DO NOTHING;

-- Index for fast name lookups (both tables)
CREATE INDEX IF NOT EXISTS idx_tea_process_benchmarks_output ON tea_process_benchmarks (lower(output_name));
CREATE INDEX IF NOT EXISTS idx_tea_financial_params_name ON tea_financial_params (param_name);
