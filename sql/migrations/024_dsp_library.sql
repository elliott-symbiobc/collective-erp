-- 024_dsp_library.sql
-- Downstream processing (DSP) unit operation library.
-- Replaces the 4-category hardcoded dict with cited, per-output sequences.
-- Capital costs are in 2024 USD (CEPCI 820), escalated from reference year.

CREATE TABLE IF NOT EXISTS dsp_unit_operations (
    op_id                   UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    output_category         TEXT    NOT NULL,
    step_order              INT     NOT NULL,
    operation_name          TEXT    NOT NULL,
    operation_label         TEXT    NOT NULL,
    operation_type          TEXT    NOT NULL,
    -- 'centrifuge' | 'uf_membrane' | 'nf_membrane' | 'evaporator' | 'crystallizer' |
    -- 'spray_dryer' | 'drum_dryer' | 'ion_exchange' | 'solvent_extraction' | 'filtration'

    -- Capital cost (2024 USD)
    ref_capex_usd           DOUBLE PRECISION,
    ref_capex_scale_tonne_yr DOUBLE PRECISION,   -- tonne/yr at which ref_capex applies
    capex_scale_exponent    DOUBLE PRECISION DEFAULT 0.6,
    capex_source            TEXT,
    capex_source_year       INT,
    capex_cepci_ref         DOUBLE PRECISION,    -- CEPCI index of source year
    capex_cepci_2024        DOUBLE PRECISION DEFAULT 820.0,

    -- Operating cost
    ref_energy_kwh_tonne    DOUBLE PRECISION,    -- kWh per tonne product processed
    energy_type             TEXT DEFAULT 'electricity',
    -- 'electricity' | 'steam_low' | 'steam_high' | 'cooling_water' | 'chilled_water'
    energy_source_citation  TEXT,

    -- Chemical consumption
    chemical_kg_tonne_product DOUBLE PRECISION,
    chemical_name           TEXT,
    chemical_cost_usd_kg    DOUBLE PRECISION,

    -- Performance
    product_recovery_pct    DOUBLE PRECISION NOT NULL DEFAULT 95.0,
    -- fraction of product retained through this step (0-100)
    typical_residence_hrs   DOUBLE PRECISION,
    notes                   TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (output_category, step_order)
);

CREATE INDEX IF NOT EXISTS idx_dsp_category ON dsp_unit_operations (output_category);

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED DATA
-- Capital costs from Turton et al. (2012) "Analysis, Synthesis and Design of
-- Chemical Processes" 4th ed. Table 22.14 and Appendix A.
-- Peters, Timmerhaus & West (2003) "Plant Design and Economics" 5th ed.
-- GEA Group vendor estimates (2022 web catalogue).
-- All costs escalated to 2024 USD using CEPCI ratio (source_year CEPCI / 820).
-- CEPCI reference values: 2001=394, 2003=402, 2012=584, 2022=816, 2024=820.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── LACTIC ACID (homofermentative SmF → crystallization) ─────────────────────
-- Process: broth → disc centrifuge → evaporator → acidification → crystallizer → wash filter → dryer
-- Reference: Wee H.B. et al. (2006) Food Technol Biotechnol 44(2):163-172.
INSERT INTO dsp_unit_operations
    (output_category, step_order, operation_name, operation_label, operation_type,
     ref_capex_usd, ref_capex_scale_tonne_yr, capex_source, capex_source_year, capex_cepci_ref,
     ref_energy_kwh_tonne, energy_type, energy_source_citation,
     product_recovery_pct, notes)
VALUES
('Lactic Acid', 1, 'disc_centrifuge', 'Disc Stack Centrifuge (Biomass Removal)', 'centrifuge',
 420000, 1000, 'Turton_2012_TableA6', 2012, 584,
 12.0, 'electricity', 'GEA_Group_2022',
 98.0, 'Removes ~95% biomass. Turton Table A.6 disc centrifuge $200K at 500 L/min, CEPCI-escalated.'),
('Lactic Acid', 2, 'evaporator', 'Multi-Effect Evaporator (Concentration 10→80% LA)', 'evaporator',
 680000, 1000, 'Peters_Timmerhaus_2003_p555', 2003, 402,
 280.0, 'steam_low', 'Peters_Timmerhaus_2003',
 99.0, '3-effect evaporator. Peters & Timmerhaus Fig 13-38. CEPCI-escalated 402→820.'),
('Lactic Acid', 3, 'crystallizer', 'Draft-Tube Crystallizer', 'crystallizer',
 540000, 1000, 'Peters_Timmerhaus_2003_p610', 2003, 402,
 35.0, 'electricity', 'Peters_Timmerhaus_2003',
 88.0, 'Crystallization yield ~85-90%. Peters & Timmerhaus Ch 15. Mother liquor recycled.'),
('Lactic Acid', 4, 'wash_filter', 'Rotary Vacuum Filter (Crystal Washing)', 'filtration',
 185000, 1000, 'Turton_2012_TableA6', 2012, 584,
 8.0, 'electricity', 'Turton_2012',
 97.0, 'Crystal wash to remove impurities. Turton Table A.6 filtration equipment.'),
('Lactic Acid', 5, 'dryer', 'Rotary Dryer (Crystal Drying)', 'drum_dryer',
 210000, 1000, 'Peters_Timmerhaus_2003_p502', 2003, 402,
 120.0, 'steam_low', 'Peters_Timmerhaus_2003',
 99.0, 'Final moisture <0.5%. Peters & Timmerhaus Ch 12 rotary dryer.');

-- ── CITRIC ACID (A. niger SmF → crystallization) ─────────────────────────────
-- Reference: Papagianni M. (2007) Biotechnol Adv 25(3):244-263.
INSERT INTO dsp_unit_operations
    (output_category, step_order, operation_name, operation_label, operation_type,
     ref_capex_usd, ref_capex_scale_tonne_yr, capex_source, capex_source_year, capex_cepci_ref,
     ref_energy_kwh_tonne, energy_type, energy_source_citation,
     product_recovery_pct, notes)
VALUES
('Citric Acid', 1, 'mycelium_filter', 'Rotary Drum Filter (Mycelium Removal)', 'filtration',
 220000, 1000, 'Turton_2012_TableA6', 2012, 584,
 6.0, 'electricity', 'Turton_2012',
 99.0, 'Removes A. niger mycelium from fermentation broth.'),
('Citric Acid', 2, 'lime_precipitation', 'Precipitation Tank (Calcium Citrate, Ca(OH)₂)', 'filtration',
 85000, 1000, 'Peters_Timmerhaus_2003_assumption', 2003, 402,
 5.0, 'electricity', 'assumption',
 96.0, 'Precipitate citric acid as calcium citrate. Industry standard. Cost: mixing tank estimate. ASSUMPTION: no vendor quote.'),
('Citric Acid', 3, 'sulfuric_acid_tank', 'Acidulation Tank (H₂SO₄ Treatment)', 'filtration',
 65000, 1000, 'Peters_Timmerhaus_2003_assumption', 2003, 402,
 4.0, 'electricity', 'assumption',
 98.0, 'React calcium citrate with H₂SO₄ to release citric acid. CaSO₄ filtration.'),
('Citric Acid', 4, 'ion_exchange', 'Ion Exchange Columns (Decolorization)', 'ion_exchange',
 380000, 1000, 'GEA_Group_2022', 2022, 816,
 15.0, 'electricity', 'GEA_Group_2022',
 97.0, 'Activated carbon + cation/anion IX columns. GEA vendor estimate 2022.'),
('Citric Acid', 5, 'evaporator', 'Multi-Effect Evaporator', 'evaporator',
 650000, 1000, 'Peters_Timmerhaus_2003_p555', 2003, 402,
 260.0, 'steam_low', 'Peters_Timmerhaus_2003',
 99.0, 'Concentrate to 75% before crystallization.'),
('Citric Acid', 6, 'crystallizer', 'Cooling Crystallizer', 'crystallizer',
 490000, 1000, 'Peters_Timmerhaus_2003_p610', 2003, 402,
 25.0, 'cooling_water', 'Peters_Timmerhaus_2003',
 90.0, 'Cooling crystallization of anhydrous citric acid at 36.6°C.');

-- ── GLUCONIC ACID (A. niger glucose oxidase → crystallization) ───────────────
-- Reference: Ramachandran S. et al. (2006) Biochem Eng J 28(3):199-204.
INSERT INTO dsp_unit_operations
    (output_category, step_order, operation_name, operation_label, operation_type,
     ref_capex_usd, ref_capex_scale_tonne_yr, capex_source, capex_source_year, capex_cepci_ref,
     ref_energy_kwh_tonne, energy_type, energy_source_citation,
     product_recovery_pct, notes)
VALUES
('Gluconic Acid', 1, 'disc_centrifuge', 'Disc Centrifuge (Mycelium)', 'centrifuge',
 380000, 1000, 'Turton_2012_TableA6', 2012, 584,
 10.0, 'electricity', 'Turton_2012',
 99.0, 'Biomass removal.'),
('Gluconic Acid', 2, 'neutralization', 'Neutralization Tank (pH adjustment)', 'filtration',
 55000, 1000, 'Peters_Timmerhaus_2003_assumption', 2003, 402,
 3.0, 'electricity', 'assumption',
 99.5, 'NaOH neutralization to sodium gluconate if targeting Na-gluconate form. ASSUMPTION.'),
('Gluconic Acid', 3, 'evaporator', 'Evaporator (Concentration)', 'evaporator',
 580000, 1000, 'Peters_Timmerhaus_2003_p555', 2003, 402,
 240.0, 'steam_low', 'Peters_Timmerhaus_2003',
 99.0, 'Concentrate to 50% solution for sale as gluconate, or proceed to crystallize.'),
('Gluconic Acid', 4, 'crystallizer', 'Crystallizer (Glucono-δ-lactone form)', 'crystallizer',
 420000, 1000, 'Peters_Timmerhaus_2003_p610', 2003, 402,
 20.0, 'cooling_water', 'Peters_Timmerhaus_2003',
 88.0, 'Optional: crystallize as glucono-δ-lactone. 88% recovery from concentrated solution.');

-- ── CELLULASE COCKTAIL (T. reesei SmF → spray drying) ────────────────────────
-- Reference: Merino S.T. & Cherry J. (2007) Adv Biochem Eng Biotechnol 108:95-120.
INSERT INTO dsp_unit_operations
    (output_category, step_order, operation_name, operation_label, operation_type,
     ref_capex_usd, ref_capex_scale_tonne_yr, capex_source, capex_source_year, capex_cepci_ref,
     ref_energy_kwh_tonne, energy_type, energy_source_citation,
     product_recovery_pct, notes)
VALUES
('Cellulase Cocktail', 1, 'disc_centrifuge', 'Disc Centrifuge (Mycelium Removal)', 'centrifuge',
 410000, 1000, 'Turton_2012_TableA6', 2012, 584,
 12.0, 'electricity', 'Turton_2012',
 98.0, 'Removes T. reesei mycelium. Broth clarification.'),
('Cellulase Cocktail', 2, 'uf_membrane', 'Ultrafiltration (30 kDa MWCO, Enzyme Concentration)', 'uf_membrane',
 520000, 1000, 'GEA_Group_2022', 2022, 816,
 45.0, 'electricity', 'GEA_Group_2022',
 95.0, 'Concentrate enzyme protein from ~2% to 20%. GEA spiral UF modules. 30 kDa MWCO.'),
('Cellulase Cocktail', 3, 'spray_dryer', 'Spray Dryer (Enzyme Powder, Toutlet=80°C)', 'spray_dryer',
 680000, 1000, 'GEA_Group_2022', 2022, 816,
 420.0, 'steam_low', 'GEA_Group_2022',
 94.0, 'Spray dry to 5% moisture enzyme powder. Toutlet 80°C to preserve activity. GEA Niro estimate.');

-- ── XYLANASE (SSF/SmF → spray drying) ────────────────────────────────────────
INSERT INTO dsp_unit_operations
    (output_category, step_order, operation_name, operation_label, operation_type,
     ref_capex_usd, ref_capex_scale_tonne_yr, capex_source, capex_source_year, capex_cepci_ref,
     ref_energy_kwh_tonne, energy_type, energy_source_citation,
     product_recovery_pct, notes)
VALUES
('Xylanase', 1, 'disc_centrifuge', 'Disc Centrifuge (Mycelium)', 'centrifuge',
 380000, 1000, 'Turton_2012_TableA6', 2012, 584,
 10.0, 'electricity', 'Turton_2012',
 98.0, 'Biomass removal.'),
('Xylanase', 2, 'uf_membrane', 'Ultrafiltration (10 kDa MWCO)', 'uf_membrane',
 490000, 1000, 'GEA_Group_2022', 2022, 816,
 40.0, 'electricity', 'GEA_Group_2022',
 95.0, 'Concentrate xylanase. 10 kDa MWCO to retain enzyme. GEA Filtration.'),
('Xylanase', 3, 'spray_dryer', 'Spray Dryer', 'spray_dryer',
 620000, 1000, 'GEA_Group_2022', 2022, 816,
 400.0, 'steam_low', 'GEA_Group_2022',
 94.0, 'Spray dry to powder. GEA Niro SDM-25 reference.');

-- ── PROTEASE ENZYME (SmF → spray drying) ─────────────────────────────────────
INSERT INTO dsp_unit_operations
    (output_category, step_order, operation_name, operation_label, operation_type,
     ref_capex_usd, ref_capex_scale_tonne_yr, capex_source, capex_source_year, capex_cepci_ref,
     ref_energy_kwh_tonne, energy_type, energy_source_citation,
     product_recovery_pct, notes)
VALUES
('Protease Enzyme', 1, 'disc_centrifuge', 'Disc Centrifuge', 'centrifuge',
 380000, 1000, 'Turton_2012_TableA6', 2012, 584,
 10.0, 'electricity', 'Turton_2012',
 98.0, 'Biomass removal.'),
('Protease Enzyme', 2, 'uf_membrane', 'Ultrafiltration (10 kDa MWCO)', 'uf_membrane',
 490000, 1000, 'GEA_Group_2022', 2022, 816,
 40.0, 'electricity', 'GEA_Group_2022',
 95.0, 'Enzyme concentration. 10 kDa MWCO.'),
('Protease Enzyme', 3, 'spray_dryer', 'Spray Dryer', 'spray_dryer',
 620000, 1000, 'GEA_Group_2022', 2022, 816,
 400.0, 'steam_low', 'GEA_Group_2022',
 94.0, 'Spray dry to enzyme powder.');

-- ── LIPASE ENZYME (SmF → spray drying) ───────────────────────────────────────
INSERT INTO dsp_unit_operations
    (output_category, step_order, operation_name, operation_label, operation_type,
     ref_capex_usd, ref_capex_scale_tonne_yr, capex_source, capex_source_year, capex_cepci_ref,
     ref_energy_kwh_tonne, energy_type, energy_source_citation,
     product_recovery_pct, notes)
VALUES
('Lipase Enzyme', 1, 'disc_centrifuge', 'Disc Centrifuge', 'centrifuge',
 380000, 1000, 'Turton_2012_TableA6', 2012, 584,
 10.0, 'electricity', 'Turton_2012',
 98.0, 'Biomass removal.'),
('Lipase Enzyme', 2, 'uf_membrane', 'Ultrafiltration (30 kDa MWCO)', 'uf_membrane',
 490000, 1000, 'GEA_Group_2022', 2022, 816,
 40.0, 'electricity', 'GEA_Group_2022',
 95.0, 'Lipase concentration. 30 kDa MWCO.'),
('Lipase Enzyme', 3, 'spray_dryer', 'Spray Dryer (low temp, activity-preserving)', 'spray_dryer',
 680000, 1000, 'GEA_Group_2022', 2022, 816,
 420.0, 'steam_low', 'GEA_Group_2022',
 93.0, 'Low-temperature spray drying to preserve lipase activity. Toutlet ≤70°C.');

-- ── TANNASE (SSF → spray drying) ─────────────────────────────────────────────
INSERT INTO dsp_unit_operations
    (output_category, step_order, operation_name, operation_label, operation_type,
     ref_capex_usd, ref_capex_scale_tonne_yr, capex_source, capex_source_year, capex_cepci_ref,
     ref_energy_kwh_tonne, energy_type, energy_source_citation,
     product_recovery_pct, notes)
VALUES
('Tannase', 1, 'disc_centrifuge', 'Disc Centrifuge', 'centrifuge',
 380000, 1000, 'Turton_2012_TableA6', 2012, 584,
 10.0, 'electricity', 'Turton_2012', 98.0, 'Biomass + substrate removal.'),
('Tannase', 2, 'uf_membrane', 'Ultrafiltration (10 kDa MWCO)', 'uf_membrane',
 490000, 1000, 'GEA_Group_2022', 2022, 816,
 40.0, 'electricity', 'GEA_Group_2022', 95.0, 'Enzyme concentration.'),
('Tannase', 3, 'spray_dryer', 'Spray Dryer', 'spray_dryer',
 600000, 1000, 'GEA_Group_2022', 2022, 816,
 380.0, 'steam_low', 'GEA_Group_2022', 94.0, 'Spray dry tannase powder.');

-- ── GALLIC ACID (tannase hydrolysis → crystallization) ───────────────────────
INSERT INTO dsp_unit_operations
    (output_category, step_order, operation_name, operation_label, operation_type,
     ref_capex_usd, ref_capex_scale_tonne_yr, capex_source, capex_source_year, capex_cepci_ref,
     ref_energy_kwh_tonne, energy_type, energy_source_citation,
     product_recovery_pct, notes)
VALUES
('Gallic Acid', 1, 'solid_liquid', 'Solid-Liquid Separation (SSF Extract)', 'filtration',
 160000, 1000, 'Peters_Timmerhaus_2003_assumption', 2003, 402,
 5.0, 'electricity', 'assumption',
 92.0, 'Water extraction from SSF solid substrate. ASSUMPTION: belt filter press estimate.'),
('Gallic Acid', 2, 'activated_carbon', 'Activated Carbon Adsorption (Decolorization)', 'ion_exchange',
 120000, 1000, 'assumption', 2024, 820,
 8.0, 'electricity', 'assumption',
 95.0, 'ASSUMPTION: activated carbon columns for color removal. Vendor quote needed.'),
('Gallic Acid', 3, 'evaporator', 'Evaporator (Concentration)', 'evaporator',
 480000, 1000, 'Peters_Timmerhaus_2003_p555', 2003, 402,
 220.0, 'steam_low', 'Peters_Timmerhaus_2003',
 99.0, 'Concentrate gallic acid solution.'),
('Gallic Acid', 4, 'crystallizer', 'Cooling Crystallizer', 'crystallizer',
 400000, 1000, 'Peters_Timmerhaus_2003_p610', 2003, 402,
 18.0, 'cooling_water', 'Peters_Timmerhaus_2003',
 85.0, 'Crystallize gallic acid. 85% yield from concentrated solution.');

-- ── FERULIC ACID (SSF → solvent extraction → crystallization) ────────────────
INSERT INTO dsp_unit_operations
    (output_category, step_order, operation_name, operation_label, operation_type,
     ref_capex_usd, ref_capex_scale_tonne_yr, capex_source, capex_source_year, capex_cepci_ref,
     ref_energy_kwh_tonne, energy_type, energy_source_citation,
     product_recovery_pct, chemical_kg_tonne_product, chemical_name, chemical_cost_usd_kg,
     product_recovery_pct, notes)
VALUES
('Ferulic Acid', 1, 'solid_liquid', 'Solid-Liquid Extraction (Alkaline Water, pH 12)', 'filtration',
 180000, 100, 'Peters_Timmerhaus_2003_assumption', 2003, 402,
 8.0, 'electricity', 'assumption',
 85.0, 150.0, 'NaOH', 0.35,
 85.0, 'Alkaline extraction from bran/hemi. ASSUMPTION: belt press + tank. NaOH consumption estimated.'),
('Ferulic Acid', 2, 'acidification', 'Acidification Tank (pH 2, HCl)', 'filtration',
 45000, 100, 'assumption', 2024, 820,
 2.0, 'electricity', 'assumption',
 99.0, 80.0, 'HCl', 0.18,
 99.0, 'Acidify to precipitate ferulic acid. ASSUMPTION.'),
('Ferulic Acid', 3, 'filtration', 'Vacuum Belt Filter (Ferulic Acid Cake)', 'filtration',
 195000, 100, 'Turton_2012_TableA6', 2012, 584,
 6.0, 'electricity', 'Turton_2012',
 92.0, NULL, NULL, NULL,
 92.0, 'Filter ferulic acid precipitate. Turton Table A.6.'),
('Ferulic Acid', 4, 'recrystallization', 'Ethanol Recrystallization (98% purity)', 'crystallizer',
 280000, 100, 'Peters_Timmerhaus_2003_assumption', 2003, 402,
 180.0, 'steam_low', 'assumption',
 88.0, 400.0, 'Ethanol 96%', 0.65,
 88.0, 'Recrystallize from ethanol for food-grade purity. ASSUMPTION: batch recrystallizer. Ethanol recycled 90%.'),
('Ferulic Acid', 5, 'spray_dryer', 'Spray Dryer (Ferulic Acid Powder)', 'spray_dryer',
 420000, 100, 'GEA_Group_2022', 2022, 816,
 350.0, 'steam_low', 'GEA_Group_2022',
 97.0, NULL, NULL, NULL,
 97.0, 'Final drying to <1% moisture powder.');

-- ── GLUCOSE-MALTOSE SYRUP (enzymatic saccharification → membrane) ─────────────
INSERT INTO dsp_unit_operations
    (output_category, step_order, operation_name, operation_label, operation_type,
     ref_capex_usd, ref_capex_scale_tonne_yr, capex_source, capex_source_year, capex_cepci_ref,
     ref_energy_kwh_tonne, energy_type, energy_source_citation,
     product_recovery_pct, notes)
VALUES
('Glucose-Maltose Syrup', 1, 'disc_centrifuge', 'Disc Centrifuge (Starch Insolubles)', 'centrifuge',
 350000, 5000, 'Turton_2012_TableA6', 2012, 584,
 8.0, 'electricity', 'Turton_2012',
 99.0, 'Remove insoluble starch residues and enzyme carrier.'),
('Glucose-Maltose Syrup', 2, 'uf_membrane', 'Ultrafiltration (10 kDa MWCO, Enzyme Removal)', 'uf_membrane',
 480000, 5000, 'GEA_Group_2022', 2022, 816,
 35.0, 'electricity', 'GEA_Group_2022',
 98.0, 'Remove and optionally recycle enzyme. 10 kDa MWCO.'),
('Glucose-Maltose Syrup', 3, 'activated_carbon', 'Activated Carbon (Decolorization)', 'ion_exchange',
 110000, 5000, 'assumption', 2024, 820,
 5.0, 'electricity', 'assumption',
 99.0, 'ASSUMPTION: activated carbon for color removal from syrup.'),
('Glucose-Maltose Syrup', 4, 'evaporator', 'Multi-Effect Evaporator (to 75 DE syrup)', 'evaporator',
 720000, 5000, 'Peters_Timmerhaus_2003_p555', 2003, 402,
 200.0, 'steam_low', 'Peters_Timmerhaus_2003',
 99.5, 'Concentrate to 75% dry solids syrup for sale. 3-effect evaporator.');

-- ── SINGLE-CELL PROTEIN (SmF biomass → spray drying) ─────────────────────────
INSERT INTO dsp_unit_operations
    (output_category, step_order, operation_name, operation_label, operation_type,
     ref_capex_usd, ref_capex_scale_tonne_yr, capex_source, capex_source_year, capex_cepci_ref,
     ref_energy_kwh_tonne, energy_type, energy_source_citation,
     product_recovery_pct, notes)
VALUES
('Single-Cell Protein', 1, 'disc_centrifuge', 'Disc Centrifuge (Biomass Harvest)', 'centrifuge',
 420000, 1000, 'Turton_2012_TableA6', 2012, 584,
 12.0, 'electricity', 'Turton_2012',
 95.0, 'Harvest fungal biomass. Typical 95% recovery of DW.'),
('Single-Cell Protein', 2, 'heat_treatment', 'Pasteurization (90°C, 20 min)', 'evaporator',
 120000, 1000, 'assumption', 2024, 820,
 80.0, 'steam_low', 'assumption',
 100.0, 'ASSUMPTION: heat treatment for food safety. Continuous tubular heat exchanger estimate.'),
('Single-Cell Protein', 3, 'spray_dryer', 'Spray Dryer (SCP Powder, 95% DM)', 'spray_dryer',
 650000, 1000, 'GEA_Group_2022', 2022, 816,
 500.0, 'steam_low', 'GEA_Group_2022',
 97.0, 'Spray dry to protein powder. GEA Mobile Minor reference scaled.');

-- ── ANTIOXIDANT EXTRACT (SSF phenolics → solvent extraction → concentration) ──
INSERT INTO dsp_unit_operations
    (output_category, step_order, operation_name, operation_label, operation_type,
     ref_capex_usd, ref_capex_scale_tonne_yr, capex_source, capex_source_year, capex_cepci_ref,
     ref_energy_kwh_tonne, energy_type, energy_source_citation,
     product_recovery_pct, chemical_kg_tonne_product, chemical_name, chemical_cost_usd_kg,
     notes)
VALUES
('Antioxidant Extract', 1, 'solid_liquid', 'Solid-Liquid Extraction (60% Ethanol)', 'filtration',
 145000, 100, 'assumption', 2024, 820,
 10.0, 'electricity', 'assumption',
 80.0, 600.0, 'Ethanol 96%', 0.65,
 'ASSUMPTION: extraction vessel + belt filter. Ethanol 60% v/v, recycled 85%.'),
('Antioxidant Extract', 2, 'evaporator', 'Falling Film Evaporator (Ethanol Recovery)', 'evaporator',
 420000, 100, 'Peters_Timmerhaus_2003_p555', 2003, 402,
 280.0, 'steam_low', 'Peters_Timmerhaus_2003',
 99.0, 'Recover ethanol for reuse. Concentrate to 20% TPC.'),
('Antioxidant Extract', 3, 'spray_dryer', 'Spray Dryer (Phenolic Powder)', 'spray_dryer',
 520000, 100, 'GEA_Group_2022', 2022, 816,
 420.0, 'steam_low', 'GEA_Group_2022',
 95.0, 'Spray dry phenolic concentrate. Toutlet 80°C. Optional: maltodextrin encapsulation.');

-- ── AMINO ACID HYDROLYSATE (protease hydrolysis → membrane → spray dry) ───────
INSERT INTO dsp_unit_operations
    (output_category, step_order, operation_name, operation_label, operation_type,
     ref_capex_usd, ref_capex_scale_tonne_yr, capex_source, capex_source_year, capex_cepci_ref,
     ref_energy_kwh_tonne, energy_type, energy_source_citation,
     product_recovery_pct, notes)
VALUES
('Amino Acid Hydrolysate', 1, 'disc_centrifuge', 'Centrifuge (Insoluble Protein Removal)', 'centrifuge',
 360000, 500, 'Turton_2012_TableA6', 2012, 584,
 10.0, 'electricity', 'Turton_2012',
 96.0, 'Remove undigested protein and substrate insolubles.'),
('Amino Acid Hydrolysate', 2, 'nf_membrane', 'Nanofiltration (Peptide Fractionation)', 'nf_membrane',
 580000, 500, 'GEA_Group_2022', 2022, 816,
 50.0, 'electricity', 'GEA_Group_2022',
 90.0, 'Fractionate by molecular weight. <1 kDa fraction for free amino acids. GEA NF membranes.'),
('Amino Acid Hydrolysate', 3, 'spray_dryer', 'Spray Dryer (AA Hydrolysate Powder)', 'spray_dryer',
 600000, 500, 'GEA_Group_2022', 2022, 816,
 480.0, 'steam_low', 'GEA_Group_2022',
 95.0, 'Spray dry to free-flowing powder.');

-- ── PECTIN OLIGOSACCHARIDES (pectinase → membrane fractionation) ──────────────
INSERT INTO dsp_unit_operations
    (output_category, step_order, operation_name, operation_label, operation_type,
     ref_capex_usd, ref_capex_scale_tonne_yr, capex_source, capex_source_year, capex_cepci_ref,
     ref_energy_kwh_tonne, energy_type, energy_source_citation,
     product_recovery_pct, notes)
VALUES
('Pectin Oligosaccharides', 1, 'solid_liquid', 'Solid-Liquid Separation (Peel Extract)', 'filtration',
 155000, 200, 'assumption', 2024, 820,
 6.0, 'electricity', 'assumption',
 90.0, 'ASSUMPTION: extract from citrus peel. Belt filter press.'),
('Pectin Oligosaccharides', 2, 'uf_membrane', 'Ultrafiltration (100 kDa MWCO, Remove Pectin)', 'uf_membrane',
 460000, 200, 'GEA_Group_2022', 2022, 816,
 40.0, 'electricity', 'GEA_Group_2022',
 85.0, 'Retentate: native pectin. Permeate: oligosaccharides (<10 kDa). GEA Filtration.'),
('Pectin Oligosaccharides', 3, 'nf_membrane', 'Nanofiltration (Oligosaccharide Concentration)', 'nf_membrane',
 520000, 200, 'GEA_Group_2022', 2022, 816,
 45.0, 'electricity', 'GEA_Group_2022',
 92.0, 'Concentrate oligosaccharides, remove monosaccharides. GEA NF.'),
('Pectin Oligosaccharides', 4, 'spray_dryer', 'Spray Dryer (POS Powder)', 'spray_dryer',
 580000, 200, 'GEA_Group_2022', 2022, 816,
 450.0, 'steam_low', 'GEA_Group_2022',
 94.0, 'Spray dry prebiotic POS powder.');

-- ── KOJIC ACID (A. oryzae SmF → crystallization) ─────────────────────────────
INSERT INTO dsp_unit_operations
    (output_category, step_order, operation_name, operation_label, operation_type,
     ref_capex_usd, ref_capex_scale_tonne_yr, capex_source, capex_source_year, capex_cepci_ref,
     ref_energy_kwh_tonne, energy_type, energy_source_citation,
     product_recovery_pct, notes)
VALUES
('Kojic Acid', 1, 'disc_centrifuge', 'Disc Centrifuge (Mycelium)', 'centrifuge',
 380000, 200, 'Turton_2012_TableA6', 2012, 584,
 10.0, 'electricity', 'Turton_2012',
 99.0, 'Remove A. oryzae mycelium.'),
('Kojic Acid', 2, 'activated_carbon', 'Activated Carbon (Decolorization)', 'ion_exchange',
 130000, 200, 'assumption', 2024, 820,
 8.0, 'electricity', 'assumption',
 95.0, 'ASSUMPTION: activated carbon decolorization.'),
('Kojic Acid', 3, 'evaporator', 'Evaporator (Concentration)', 'evaporator',
 480000, 200, 'Peters_Timmerhaus_2003_p555', 2003, 402,
 220.0, 'steam_low', 'Peters_Timmerhaus_2003',
 99.0, 'Concentrate kojic acid broth.'),
('Kojic Acid', 4, 'crystallizer', 'Cooling Crystallizer', 'crystallizer',
 420000, 200, 'Peters_Timmerhaus_2003_p610', 2003, 402,
 18.0, 'cooling_water', 'Peters_Timmerhaus_2003',
 88.0, 'Crystallize kojic acid. 88% yield from concentrated solution.');

-- ── FATTY ACID FRACTIONS (lipid extraction) ───────────────────────────────────
INSERT INTO dsp_unit_operations
    (output_category, step_order, operation_name, operation_label, operation_type,
     ref_capex_usd, ref_capex_scale_tonne_yr, capex_source, capex_source_year, capex_cepci_ref,
     ref_energy_kwh_tonne, energy_type, energy_source_citation,
     product_recovery_pct, chemical_kg_tonne_product, chemical_name, chemical_cost_usd_kg,
     notes)
VALUES
('Fatty Acid Fractions', 1, 'disc_centrifuge', 'Disc Centrifuge (Biomass)', 'centrifuge',
 380000, 200, 'Turton_2012_TableA6', 2012, 584,
 10.0, 'electricity', 'Turton_2012',
 98.0, NULL, NULL, NULL,
 'Biomass harvest for lipid extraction.'),
('Fatty Acid Fractions', 2, 'solvent_extraction', 'Hexane Extraction (Lipid)', 'solvent_extraction',
 580000, 200, 'Peters_Timmerhaus_2003_p490', 2003, 402,
 80.0, 'electricity', 'Peters_Timmerhaus_2003',
 92.0, 200.0, 'Hexane 95%', 0.55,
 'Hexane extraction. Peters & Timmerhaus Ch 11. Hexane recycled 95%. ASSUMPTION scaled.'),
('Fatty Acid Fractions', 3, 'distillation', 'Thin-Film Evaporator (Hexane Recovery)', 'evaporator',
 380000, 200, 'Peters_Timmerhaus_2003_p555', 2003, 402,
 180.0, 'steam_low', 'Peters_Timmerhaus_2003',
 99.0, NULL, NULL, NULL,
 'Remove hexane. Thin-film evaporator for gentle processing.');

-- ── BIOMASS PROTEIN (generic fungal biomass → drying) ────────────────────────
INSERT INTO dsp_unit_operations
    (output_category, step_order, operation_name, operation_label, operation_type,
     ref_capex_usd, ref_capex_scale_tonne_yr, capex_source, capex_source_year, capex_cepci_ref,
     ref_energy_kwh_tonne, energy_type, energy_source_citation,
     product_recovery_pct, notes)
VALUES
('Biomass Protein', 1, 'disc_centrifuge', 'Disc Centrifuge (Biomass Harvest)', 'centrifuge',
 380000, 500, 'Turton_2012_TableA6', 2012, 584,
 11.0, 'electricity', 'Turton_2012',
 95.0, 'Harvest fungal biomass.'),
('Biomass Protein', 2, 'drum_dryer', 'Drum Dryer (Biomass, 92% DM)', 'drum_dryer',
 290000, 500, 'Peters_Timmerhaus_2003_p502', 2003, 402,
 350.0, 'steam_low', 'Peters_Timmerhaus_2003',
 97.0, 'Drum dry fungal biomass to 92% dry matter. Peters & Timmerhaus Ch 12.');

-- ── COCOA BUTTER EQUIVALENT (oleaginous fungi → lipid extraction) ─────────────
INSERT INTO dsp_unit_operations
    (output_category, step_order, operation_name, operation_label, operation_type,
     ref_capex_usd, ref_capex_scale_tonne_yr, capex_source, capex_source_year, capex_cepci_ref,
     ref_energy_kwh_tonne, energy_type, energy_source_citation,
     product_recovery_pct, chemical_kg_tonne_product, chemical_name, chemical_cost_usd_kg,
     notes)
VALUES
('Cocoa Butter Equivalent', 1, 'disc_centrifuge', 'Disc Centrifuge (Biomass)', 'centrifuge',
 380000, 50, 'Turton_2012_TableA6', 2012, 584,
 12.0, 'electricity', 'Turton_2012',
 97.0, NULL, NULL, NULL,
 'ASSUMPTION: high-value product, small scale assumed (50 t/yr ref).'),
('Cocoa Butter Equivalent', 2, 'solvent_extraction', 'Hexane/Supercritical CO₂ Extraction', 'solvent_extraction',
 980000, 50, 'assumption', 2024, 820,
 220.0, 'electricity', 'assumption',
 90.0, 100.0, 'Hexane 95%', 0.55,
 'ASSUMPTION: scCO₂ preferred for food-grade CBE. Vendor quote required. Hexane alternative shown.'),
('Cocoa Butter Equivalent', 3, 'winterization', 'Winterization (Fractionation, 5°C)', 'crystallizer',
 420000, 50, 'assumption', 2024, 820,
 45.0, 'cooling_water', 'assumption',
 82.0, NULL, NULL, NULL,
 'ASSUMPTION: winterization to separate SOS/POP triglycerides. Chilling + filtration.');
