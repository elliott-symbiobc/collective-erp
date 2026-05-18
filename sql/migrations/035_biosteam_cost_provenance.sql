-- Migration 035: BioSTEAM cost provenance tables
-- Moves FOOD_EQUIPMENT_COSTS dict → biosteam_unit_cost_params (user-editable, cited)
-- Moves CEPCI regression constants → bls_regression_params (user-editable, cited)
-- Adds biosteam_chemical_properties, biosteam_unit_utilities, tea_sensitivity_params,
--     tea_computation_log, tea_sensitivity_results (extended), biosteam_data_requests
-- Scientific principle: every number has a citation; every computation has a provenance record.

-- ---------------------------------------------------------------------------
-- Equipment cost reference parameters
-- Replaces FOOD_EQUIPMENT_COSTS Python dict in food_costs.py.
-- Six-tenths power law: Cp = Cp_ref × (S/S_ref)^n × (CEPCI_current/CEPCI_ref)
--                       CBM = Cp × FBM × FM
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS biosteam_unit_cost_params (
    id               SERIAL PRIMARY KEY,
    unit_type        TEXT NOT NULL UNIQUE,
    sizing_param     TEXT NOT NULL,
    sizing_label     TEXT NOT NULL,
    cp_ref_usd       NUMERIC NOT NULL,
    s_ref            NUMERIC NOT NULL,
    s_min            NUMERIC NOT NULL,
    s_max            NUMERIC NOT NULL,
    n_exponent       NUMERIC NOT NULL,
    cepci_ref        NUMERIC NOT NULL,
    fbm              NUMERIC NOT NULL,
    fm               NUMERIC NOT NULL DEFAULT 1.0,
    accuracy_pct     TEXT,
    method_note      TEXT,
    valid_range_note TEXT,
    citation_doi     TEXT,
    citation_text    TEXT NOT NULL,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_biosteam_unit_cost_params_type
    ON biosteam_unit_cost_params (unit_type);

INSERT INTO biosteam_unit_cost_params
    (unit_type, sizing_param, sizing_label,
     cp_ref_usd, s_ref, s_min, s_max, n_exponent, cepci_ref, fbm, fm,
     accuracy_pct, method_note, valid_range_note, citation_doi, citation_text)
VALUES

('AerobicFermenter', 'vessel_volume_m3', 'Vessel volume (m³)',
 350000, 50.0, 1.0, 500.0, 0.60, 800.0, 2.4, 1.0,
 '±35%',
 'Six-tenths power law (Cp = Cp_ref × (S/S_ref)^0.60 × CEPCI_ratio); FBM=2.4 for SS316L bioreactor with agitator and aeration system.',
 'Validated for pilot-to-commercial scale 1–500 m³ vessel volume. Above 500 m³ multiple-train scaling recommended.',
 NULL,
 'Blanch, H.W. & Clark, D.S. (1997). Biochemical Engineering. Marcel Dekker. ISBN 0-8247-0099-2; Turton, R. et al. (2012). Analysis, Synthesis and Design of Chemical Processes, 4th ed. Prentice Hall.'),

('AnaerobicFermenter', 'vessel_volume_m3', 'Vessel volume (m³)',
 280000, 50.0, 1.0, 500.0, 0.60, 800.0, 2.2, 1.0,
 '±35%',
 'Six-tenths power law; FBM=2.2 for SS316L vessel without aeration sparger (lower installation complexity than aerobic).',
 'Validated 1–500 m³. Excludes gas handling infrastructure (H₂, CH₄).',
 NULL,
 'Peters, M.S., Timmerhaus, K.D. & West, R.E. (2003). Plant Design and Economics for Chemical Engineers, 5th ed. McGraw-Hill; Blanch, H.W. & Clark, D.S. (1997). Biochemical Engineering. Marcel Dekker.'),

('FedBatchFermenter', 'vessel_volume_m3', 'Vessel volume (m³)',
 380000, 50.0, 1.0, 500.0, 0.60, 800.0, 2.4, 1.0,
 '±35%',
 'Six-tenths power law; FBM=2.4; higher Cp_ref than batch due to precision feed control instrumentation and peristaltic pump skid.',
 'Validated 1–500 m³.',
 NULL,
 'Blanch, H.W. & Clark, D.S. (1997). Biochemical Engineering. Marcel Dekker; Turton, R. et al. (2012). Analysis, Synthesis and Design of Chemical Processes, 4th ed. Prentice Hall.'),

('SolidStateFermenter', 'bed_area_m2', 'Bed area (m²)',
 120000, 100.0, 5.0, 2000.0, 0.65, 800.0, 1.8, 1.0,
 '±40%',
 'Six-tenths power law on bed area; FBM=1.8 for tray or rotary drum SSF bioreactor. Higher exponent (0.65) reflects non-linear scale-up of ventilation and mixing systems.',
 'Validated 5–2000 m² bed area. Estimate accuracy lower than submerged systems due to limited commercial scale data.',
 NULL,
 'Mitchell, D.A. et al. (2006). Solid-State Fermentation Bioreactors. Springer. ISBN 3-540-31285-9; Pandey, A. (2003). Biochemical Engineering Journal, 13(2-3), 81-84.'),

('HTSTPasteurizer', 'throughput_L_hr', 'Throughput (L/hr)',
 180000, 5000.0, 200.0, 100000.0, 0.55, 800.0, 1.8, 1.0,
 '±30%',
 'Six-tenths power law on volumetric throughput; FBM=1.8; plate-type HTST with regeneration section.',
 'Validated 200–100,000 L/hr. Above 100,000 L/hr parallel trains required.',
 NULL,
 'Alfa Laval AB. (2022). Pasteurization Solutions for the Dairy Industry. Technical Brochure; Bylund, G. (2003). Dairy Processing Handbook. Tetra Pak Processing Systems. ISBN 91-631-3440-4.'),

('UHTSterilizer', 'throughput_L_hr', 'Throughput (L/hr)',
 320000, 5000.0, 200.0, 50000.0, 0.55, 800.0, 2.0, 1.0,
 '±30%',
 'Six-tenths power law; FBM=2.0; indirect or direct-injection UHT sterilizer including homogenizer and aseptic surge tank.',
 'Validated 200–50,000 L/hr.',
 NULL,
 'SPX FLOW Inc. (2022). UHT Processing Solutions. Technical Brochure; Lewis, M. & Heppell, N. (2000). Continuous Thermal Processing of Foods. Aspen Publishers.'),

('BatchPasteurizer', 'vessel_volume_L', 'Vessel volume (L)',
 45000, 1000.0, 50.0, 20000.0, 0.60, 800.0, 1.8, 1.0,
 '±35%',
 'Six-tenths power law on vessel volume (L); FBM=1.8; jacketed agitated vessel with temperature control system.',
 'Validated 50–20,000 L.',
 NULL,
 'Turton, R. et al. (2012). Analysis, Synthesis and Design of Chemical Processes, 4th ed. Prentice Hall; Singh, R.P. & Heldman, D.R. (2013). Introduction to Food Engineering, 5th ed. Academic Press.'),

('DiscCentrifuge', 'feed_rate_L_hr', 'Feed rate (L/hr)',
 250000, 10000.0, 200.0, 200000.0, 0.58, 800.0, 2.0, 1.0,
 '±30%',
 'Six-tenths power law on volumetric feed rate; FBM=2.0; disc stack centrifuge for cell harvesting or cream separation.',
 'Validated 200–200,000 L/hr. GEA Westfalia indicative pricing basis.',
 NULL,
 'GEA Westfalia Separator Group. (2022). Disc Stack Centrifuges for the Food Industry. Technical Brochure; Turton, R. et al. (2012). Analysis, Synthesis and Design of Chemical Processes, 4th ed. Prentice Hall.'),

('DecanterCentrifuge', 'feed_rate_m3_hr', 'Feed rate (m³/hr)',
 220000, 20.0, 1.0, 200.0, 0.55, 800.0, 1.9, 1.0,
 '±30%',
 'Six-tenths power law on volumetric feed rate (m³/hr); FBM=1.9; horizontal scroll decanter for solid-liquid separation.',
 'Validated 1–200 m³/hr.',
 NULL,
 'Alfa Laval AB. (2022). Decanter Centrifuges for the Food and Beverage Industry. Technical Brochure; Leung, W.W.F. (1998). Industrial Centrifugation Technology. McGraw-Hill.'),

('MicrofiltrationSkid', 'membrane_area_m2', 'Membrane area (m²)',
 180000, 50.0, 2.0, 2000.0, 0.70, 800.0, 1.6, 1.0,
 '±35%',
 'Six-tenths power law on membrane area; FBM=1.6; ceramic or polymeric MF skid for cell removal or clarification. Higher exponent (0.70) reflects membrane module scaling.',
 'Validated 2–2000 m² installed area.',
 NULL,
 'Pall Corporation. (2022). Microfiltration Solutions for Bioprocessing. Technical Brochure; Mulder, M. (1996). Basic Principles of Membrane Technology, 2nd ed. Kluwer Academic.'),

('PlateFrameFilter', 'filter_area_m2', 'Filter area (m²)',
 35000, 20.0, 1.0, 200.0, 0.65, 800.0, 1.7, 1.0,
 '±35%',
 'Six-tenths power law on filter area; FBM=1.7; plate-and-frame pressure filter, SS316L plates.',
 'Validated 1–200 m².',
 NULL,
 'Turton, R. et al. (2012). Analysis, Synthesis and Design of Chemical Processes, 4th ed. Prentice Hall; Purchas, D.B. & Sutherland, K. (2002). Handbook of Filter Media, 2nd ed. Elsevier.'),

('UltrafiltrationSkid', 'membrane_area_m2', 'Membrane area (m²)',
 200000, 50.0, 2.0, 2000.0, 0.70, 800.0, 1.6, 1.0,
 '±35%',
 'Six-tenths power law on membrane area; FBM=1.6; spiral-wound or hollow-fiber UF for protein concentration.',
 'Validated 2–2000 m² installed area.',
 NULL,
 'Koch Membrane Systems. (2022). Ultrafiltration Systems for Food Processing. Technical Brochure; Mulder, M. (1996). Basic Principles of Membrane Technology, 2nd ed. Kluwer Academic.'),

('NanofiltrationSkid', 'membrane_area_m2', 'Membrane area (m²)',
 220000, 50.0, 2.0, 1000.0, 0.70, 800.0, 1.6, 1.0,
 '±35%',
 'Six-tenths power law on membrane area; FBM=1.6; spiral-wound NF for partial demineralization and sugar retention.',
 'Validated 2–1000 m².',
 NULL,
 'DowDuPont. (2022). FILMTEC Nanofiltration Elements — Technical Manual. Form No. 609-00071; Rautenbach, R. & Albrecht, R. (1989). Membrane Processes. John Wiley & Sons.'),

('ReverseOsmosisSkid', 'membrane_area_m2', 'Membrane area (m²)',
 180000, 100.0, 5.0, 5000.0, 0.68, 800.0, 1.6, 1.0,
 '±30%',
 'Six-tenths power law on membrane area; FBM=1.6; spiral-wound RO for water recovery or concentration.',
 'Validated 5–5000 m².',
 NULL,
 'DowDuPont. (2022). FILMTEC Reverse Osmosis Membranes — Technical Manual. Form No. 609-00071; Metcalf & Eddy. (2014). Water Reuse: Issues, Technologies, and Applications. McGraw-Hill.'),

('FallingFilmEvaporator', 'evap_rate_kg_hr', 'Evaporative capacity (kg water/hr)',
 380000, 1000.0, 50.0, 50000.0, 0.58, 800.0, 2.2, 1.0,
 '±30%',
 'Six-tenths power law on evaporative capacity; FBM=2.2; single-effect falling film evaporator, SS316L tubes.',
 'Validated 50–50,000 kg water/hr evaporative capacity.',
 NULL,
 'GEA Group AG. (2022). Evaporation Technology for the Food Industry. Technical Brochure; Minton, P.E. (1986). Handbook of Evaporation Technology. Noyes Publications; Turton, R. et al. (2012). 4th ed. Prentice Hall.'),

('MultiEffectEvaporator', 'evap_rate_kg_hr', 'Evaporative capacity (kg water/hr)',
 520000, 1000.0, 100.0, 100000.0, 0.58, 800.0, 2.2, 1.0,
 '±30%',
 'Six-tenths power law; FBM=2.2; triple-effect evaporator reference cost (Turton 2012 Table A.6).',
 'Validated 100–100,000 kg water/hr.',
 NULL,
 'Turton, R. et al. (2012). Analysis, Synthesis and Design of Chemical Processes, 4th ed. Prentice Hall; GEA Group AG. (2022). Multiple-Effect Evaporation Systems. Technical Brochure.'),

('PlateHeatExchanger', 'area_m2', 'Heat transfer area (m²)',
 25000, 10.0, 0.5, 1000.0, 0.60, 800.0, 1.8, 1.0,
 '±30%',
 'Six-tenths power law on heat transfer area; FBM=1.8; gasketed plate-and-frame HX, SS316L plates.',
 'Validated 0.5–1000 m².',
 NULL,
 'Alfa Laval AB. (2022). Gasketed Plate Heat Exchangers. Technical Reference Guide; Shah, R.K. & Sekulic, D.P. (2003). Fundamentals of Heat Exchanger Design. John Wiley & Sons; Turton, R. et al. (2012). 4th ed. Prentice Hall.'),

('BatchCrystallizer', 'volume_m3', 'Crystallizer volume (m³)',
 95000, 5.0, 0.1, 100.0, 0.60, 800.0, 2.0, 1.0,
 '±35%',
 'Six-tenths power law on crystallizer volume; FBM=2.0; agitated batch crystallizer vessel with cooling jacket.',
 'Validated 0.1–100 m³.',
 NULL,
 'Turton, R. et al. (2012). Analysis, Synthesis and Design of Chemical Processes, 4th ed. Prentice Hall; Myerson, A.S. (2002). Handbook of Industrial Crystallization, 2nd ed. Butterworth-Heinemann.'),

('IonExchangeColumn', 'bed_volume_m3', 'Resin bed volume (m³)',
 85000, 2.0, 0.05, 50.0, 0.65, 800.0, 1.9, 1.0,
 '±35%',
 'Six-tenths power law on bed volume; FBM=1.9; ion exchange column with resin, distributor, and regeneration piping.',
 'Validated 0.05–50 m³ bed volume.',
 NULL,
 'Seider, W.D., Seader, J.D. & Lewin, D.R. (2010). Product and Process Design Principles, 3rd ed. Wiley; Dorfner, K. (1991). Ion Exchangers. Walter de Gruyter.'),

('AdsorptionColumn', 'bed_volume_m3', 'Adsorbent bed volume (m³)',
 75000, 2.0, 0.05, 50.0, 0.65, 800.0, 1.8, 1.0,
 '±35%',
 'Six-tenths power law on bed volume; FBM=1.8; fixed-bed adsorption column, SS316L vessel.',
 'Validated 0.05–50 m³.',
 NULL,
 'Turton, R. et al. (2012). Analysis, Synthesis and Design of Chemical Processes, 4th ed. Prentice Hall; Yang, R.T. (2003). Adsorbents: Fundamentals and Applications. John Wiley & Sons.'),

('SprayDryer', 'evap_rate_kg_hr', 'Evaporative capacity (kg water/hr)',
 1200000, 500.0, 20.0, 5000.0, 0.60, 800.0, 2.0, 1.0,
 '±35%',
 'Six-tenths power law; FBM=2.0; GEA Niro indicative pricing basis. FBM from Turton et al. (2012) Table A.4.',
 'Validated 20–5000 kg water/hr evaporative capacity.',
 NULL,
 'Masters, K. (1991). Spray Drying Handbook, 5th ed. Longman Scientific. ISBN 0-582-06266-7; GEA Group AG. (2022). Spray Drying — Process Solutions for the Food Industry; Turton, R. et al. (2012). 4th ed. Prentice Hall.'),

('FreezeDryer', 'shelf_area_m2', 'Shelf area (m²)',
 350000, 20.0, 1.0, 500.0, 0.65, 800.0, 2.2, 1.0,
 '±35%',
 'Six-tenths power law on shelf area; FBM=2.2; industrial freeze dryer with refrigerated shelves and ice condenser.',
 'Validated 1–500 m² shelf area.',
 NULL,
 'Azbil Telstar Technologies. (2022). Industrial Freeze Dryers — GMP-Grade Lyophilizers. Technical Brochure; Rey, L. & May, J.C. (2010). Freeze-Drying/Lyophilization of Pharmaceutical and Biological Products, 3rd ed. Informa Healthcare.'),

('FluidBedDryer', 'evap_rate_kg_hr', 'Evaporative capacity (kg water/hr)',
 280000, 300.0, 20.0, 5000.0, 0.60, 800.0, 2.0, 1.0,
 '±35%',
 'Six-tenths power law; FBM=2.0; continuous fluid bed dryer for powder/granule products.',
 'Validated 20–5000 kg water/hr.',
 NULL,
 'GEA Group AG. (2022). Fluid Bed Dryers and Coolers for the Food and Feed Industry. Technical Brochure; Mujumdar, A.S. (2014). Handbook of Industrial Drying, 4th ed. CRC Press.'),

('Homogenizer', 'throughput_L_hr', 'Throughput (L/hr)',
 120000, 2000.0, 100.0, 50000.0, 0.55, 800.0, 1.7, 1.0,
 '±30%',
 'Six-tenths power law; FBM=1.7; two-stage high-pressure homogenizer, SS316L contact parts.',
 'Validated 100–50,000 L/hr.',
 NULL,
 'SPX FLOW Inc. (2022). APV High Pressure Homogenizers. Technical Brochure; Walstra, P. (2003). Physical Chemistry of Foods. Marcel Dekker.'),

('HighShearMixer', 'throughput_L_hr', 'Throughput (L/hr)',
 45000, 1000.0, 50.0, 20000.0, 0.55, 800.0, 1.7, 1.0,
 '±35%',
 'Six-tenths power law; FBM=1.7; in-line or batch high-shear rotor-stator mixer.',
 'Validated 50–20,000 L/hr.',
 NULL,
 'Silverson Machines Ltd. (2022). High Shear Mixing Solutions. Technical Brochure; Atiemo-Obeng, V.A. & Calabrese, R.V. (2004). In: Handbook of Industrial Mixing. Wiley.'),

('LiquidLiquidExtractor', 'feed_rate_m3_hr', 'Feed rate (m³/hr)',
 180000, 10.0, 0.5, 100.0, 0.60, 800.0, 2.0, 1.0,
 '±40%',
 'Six-tenths power law; FBM=2.0; mixer-settler or pulsed column extractor. ±40% accuracy reflects process-specific solvent selection variability.',
 'Validated 0.5–100 m³/hr.',
 NULL,
 'Turton, R. et al. (2012). Analysis, Synthesis and Design of Chemical Processes, 4th ed. Prentice Hall; Robbins, L.A. (1997). In: Perry''s Chemical Engineers'' Handbook, 7th ed. McGraw-Hill.'),

('PrecipitationTank', 'volume_m3', 'Tank volume (m³)',
 55000, 5.0, 0.1, 100.0, 0.60, 800.0, 1.8, 1.0,
 '±35%',
 'Six-tenths power law; FBM=1.8; agitated tank with pH/temperature control.',
 'Validated 0.1–100 m³.',
 NULL,
 'Peters, M.S. et al. (2003). Plant Design and Economics for Chemical Engineers, 5th ed. McGraw-Hill; Turton, R. et al. (2012). 4th ed. Prentice Hall.'),

('MixTank', 'volume_m3', 'Tank volume (m³)',
 60000, 5.0, 0.1, 200.0, 0.60, 800.0, 1.8, 1.0,
 '±35%',
 'Six-tenths power law; FBM=1.8; agitated SS316L mixing tank with jacket.',
 'Validated 0.1–200 m³.',
 NULL,
 'Turton, R. et al. (2012). Analysis, Synthesis and Design of Chemical Processes, 4th ed. Prentice Hall; Singh, R.P. & Heldman, D.R. (2013). Introduction to Food Engineering, 5th ed. Academic Press.'),

('CIPSystem', 'vessels_served', 'Number of vessels served',
 180000, 8.0, 1.0, 50.0, 0.55, 800.0, 1.5, 1.0,
 '±35%',
 'Six-tenths power law on vessel count; FBM=1.5; centralized CIP skid with solution tanks and distribution pumps.',
 'Validated for 1–50 vessels served.',
 NULL,
 'Sani-Matic Inc. (2022). CIP System Design Guide; Tamime, A.Y. (2008). Cleaning-in-Place: Dairy, Food and Beverage Operations. Blackwell Publishing.'),

('SanitaryPump', 'power_kW', 'Motor power (kW)',
 8000, 5.0, 0.1, 200.0, 0.45, 800.0, 3.3, 1.0,
 '±35%',
 'Six-tenths power law on motor power; FBM=3.3 (Turton 2012, centrifugal pump in CS → SS316L material factor applied); sanitary pump with SS316L wetted parts.',
 'Validated 0.1–200 kW.',
 NULL,
 'Turton, R. et al. (2012). Analysis, Synthesis and Design of Chemical Processes, 4th ed. Prentice Hall; 3-A Sanitary Standards Inc. (2019). Standard 74-07 for Centrifugal Pumps.'),

('StorageTank', 'volume_m3', 'Tank volume (m³)',
 42000, 10.0, 0.5, 500.0, 0.57, 800.0, 1.8, 1.0,
 '±30%',
 'Six-tenths power law on volume; FBM=1.8; vertical SS316L storage tank with dished head.',
 'Validated 0.5–500 m³.',
 NULL,
 'Turton, R. et al. (2012). Analysis, Synthesis and Design of Chemical Processes, 4th ed. Prentice Hall; Peters, M.S. et al. (2003). 5th ed. McGraw-Hill.'),

('HeatExchanger', 'area_m2', 'Heat transfer area (m²)',
 18000, 10.0, 0.5, 500.0, 0.60, 800.0, 3.2, 1.0,
 '±35%',
 'Six-tenths power law on heat transfer area; FBM=3.2; fixed-head shell-and-tube heat exchanger (Turton 2012 Table A.1 base factor for floating-head S&T with SS316L correction).',
 'Validated 0.5–500 m².',
 NULL,
 'Turton, R. et al. (2012). Analysis, Synthesis and Design of Chemical Processes, 4th ed. Prentice Hall; Kern, D.Q. (1950). Process Heat Transfer. McGraw-Hill.')

ON CONFLICT (unit_type) DO NOTHING;


-- ---------------------------------------------------------------------------
-- Custom chemical properties for Chemical.blank() registration
-- Enables non-zero HeatUtility costs in BioSTEAM
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS biosteam_chemical_properties (
    id            SERIAL PRIMARY KEY,
    chemical_id   TEXT NOT NULL UNIQUE,
    mw_g_mol      NUMERIC NOT NULL,
    hf_kJ_mol     NUMERIC,
    cp_kJ_kgK     NUMERIC,
    phase         TEXT NOT NULL DEFAULT 'l',
    data_source   TEXT,
    uncertainty_pct NUMERIC,
    citation_doi  TEXT,
    citation_text TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO biosteam_chemical_properties
    (chemical_id, mw_g_mol, hf_kJ_mol, cp_kJ_kgK, phase, data_source, uncertainty_pct, citation_doi, citation_text)
VALUES
    ('Starch', 162.14, -960.0, 1.50, 'l', 'Perry_8th_ed', 10.0,
     NULL,
     'Perry, R.H. & Green, D.W. (2008). Perry''s Chemical Engineers'' Handbook, 8th ed., Table 2-196. MW = anhydroglucose repeat unit (C6H10O5). Hf from glucose oxidation enthalpy adjusted for polymerization. Cp from DSC data on hydrated starch gels.'),

    ('Cellulose', 162.14, -975.0, 1.30, 'l', 'Nrel_2011', 10.0,
     'https://doi.org/10.2172/1013269',
     'Humbird, D. et al. (2011). Process Design and Economics for Biochemical Conversion of Lignocellulosic Biomass to Ethanol. NREL/TP-5100-47764. MW = anhydroglucose repeat unit. Cp from thermosteam default for crystalline polysaccharide.'),

    ('Protein', 110.0, -420.0, 2.00, 'l', 'Blanch_Clark_1997', 15.0,
     NULL,
     'Blanch, H.W. & Clark, D.S. (1997). Biochemical Engineering. Marcel Dekker. MW = average amino acid residue MW (range 89–204 Da, mean ~110 Da). Cp from calorimetry of hydrated protein solutions. Hf is an approximation; uncertainty ±15%.'),

    ('Lipid', 860.0, -2500.0, 1.90, 'l', 'Perry_8th_ed', 12.0,
     NULL,
     'Perry, R.H. & Green, D.W. (2008). Perry''s Chemical Engineers'' Handbook, 8th ed. MW = tripalmitin (C51H98O6, 806 g/mol) as representative triacylglycerol; rounded to 860 for mixed lipid fraction. Cp from calorimetry of vegetable oils. Hf from combustion enthalpy of palm oil.'),

    ('Chitin', 203.19, -950.0, 1.25, 'l', 'Perry_8th_ed', 15.0,
     NULL,
     'Perry, R.H. & Green, D.W. (2008). Perry''s Chemical Engineers'' Handbook, 8th ed. MW = N-acetylglucosamine repeat unit (C8H13NO5). Cp estimated from analogous polysaccharide data. Relevant for fungal cell wall in SSF biomass streams.')

ON CONFLICT (chemical_id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- BLS regression parameters for CEPCI estimation
-- Replaces hardcoded slope/intercept in bls_updater.py
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bls_regression_params (
    id               SERIAL PRIMARY KEY,
    param_name       TEXT NOT NULL UNIQUE,
    param_value      NUMERIC NOT NULL,
    description      TEXT,
    r_squared        NUMERIC,
    calibration_years TEXT,
    calibration_n    INTEGER,
    bls_series       TEXT,
    citation_text    TEXT NOT NULL,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO bls_regression_params
    (param_name, param_value, description, r_squared, calibration_years, calibration_n, bls_series, citation_text)
VALUES
    ('cepci_wpu117_slope', 0.78,
     'Slope of OLS regression: CEPCI_annual = slope × WPU117_annual + intercept. Calibrated on Chemical Engineering magazine annual CEPCI vs BLS WPU117 data.',
     0.94, '2010-2023', 14, 'WPU117',
     'Chemical Engineering Magazine (2010–2023). Annual CEPCI tabulation. Access: www.chemengonline.com/pci; U.S. Bureau of Labor Statistics (2010–2023). Producer Price Index: WPU117 — Industrial Machinery and Equipment. Series ID WPU117.'),

    ('cepci_wpu117_intercept', 338.0,
     'Intercept of OLS regression: CEPCI_annual = 0.78 × WPU117_annual + intercept.',
     0.94, '2010-2023', 14, 'WPU117',
     'Chemical Engineering Magazine (2010–2023). Annual CEPCI tabulation; U.S. Bureau of Labor Statistics (2010–2023). PPI Series WPU117.')

ON CONFLICT (param_name) DO NOTHING;


-- ---------------------------------------------------------------------------
-- Per-unit utility intensities
-- Enables PowerUtility and HeatUtility declarations in BioSTEAM _design() methods
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS biosteam_unit_utilities (
    id            SERIAL PRIMARY KEY,
    unit_type     TEXT NOT NULL,
    utility_type  TEXT NOT NULL,
    value         NUMERIC NOT NULL,
    units         TEXT NOT NULL,
    uncertainty_pct NUMERIC,
    citation_doi  TEXT,
    citation_text TEXT NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (unit_type, utility_type)
);

INSERT INTO biosteam_unit_utilities
    (unit_type, utility_type, value, units, uncertainty_pct, citation_doi, citation_text)
VALUES
    ('AerobicFermenter',    'electricity_kWh_m3',  2.5,  'kWh/m³ broth·hr', 25.0, NULL,
     'Blanch, H.W. & Clark, D.S. (1997). Biochemical Engineering. Marcel Dekker. Table 9.2. Typical agitation power 1–5 kW/m³ for aerobic fermentation; 2.5 kW/m³ used as mid-range.'),
    ('AerobicFermenter',    'cooling_MJ_m3',        9.0,  'MJ/m³ broth·hr',  20.0, NULL,
     'Blanch, H.W. & Clark, D.S. (1997). Biochemical Engineering. Marcel Dekker. Metabolic heat generation ~400 kJ/mol O₂ consumed; value represents typical mesophilic aerobic fermentation heat duty.'),

    ('AnaerobicFermenter',  'electricity_kWh_m3',  0.5,  'kWh/m³ broth·hr', 30.0, NULL,
     'Peters, M.S. et al. (2003). Plant Design and Economics for Chemical Engineers, 5th ed. McGraw-Hill. Low agitation for anaerobic systems; biogas lift or gentle stirring only.'),

    ('FedBatchFermenter',   'electricity_kWh_m3',  2.5,  'kWh/m³ broth·hr', 25.0, NULL,
     'Blanch, H.W. & Clark, D.S. (1997). Biochemical Engineering. Marcel Dekker. Same agitation basis as aerobic batch; additional pump energy for feed delivery included in FBM.'),
    ('FedBatchFermenter',   'cooling_MJ_m3',        9.0,  'MJ/m³ broth·hr',  20.0, NULL,
     'Blanch, H.W. & Clark, D.S. (1997). Biochemical Engineering. Marcel Dekker. Same metabolic heat basis as AerobicFermenter.'),

    ('DiscCentrifuge',      'electricity_kWh_m3',  0.8,  'kWh/m³ feed',     20.0, NULL,
     'GEA Westfalia Separator Group. (2022). Disc Stack Centrifuges for the Food Industry. Technical Brochure. Typical specific energy 0.5–1.2 kWh/m³ feed; 0.8 used as representative mid-range.'),

    ('DecanterCentrifuge',  'electricity_kWh_m3',  1.5,  'kWh/m³ feed',     20.0, NULL,
     'Alfa Laval AB. (2022). Decanter Centrifuges for the Food and Beverage Industry. Technical Brochure. Typical 1.0–2.0 kWh/m³; decanter higher than disc centrifuge due to scroll conveyor drive.'),

    ('SprayDryer',          'electricity_kWh_kg',  0.06, 'kWh/kg water evaporated', 25.0, NULL,
     'Masters, K. (1991). Spray Drying Handbook, 5th ed. Longman Scientific. Electrical energy for atomizer and fans; thermal energy (steam/gas) handled separately.'),
    ('SprayDryer',          'steam_kg_kg',          1.5,  'kg steam/kg water evaporated', 15.0, NULL,
     'GEA Group AG. (2022). Spray Drying — Process Solutions. Thermal efficiency ~70%; 1.5 kg steam (≈ 2.7 MJ) per kg water evaporated for single-stage spray dryer.'),

    ('FreezeDryer',         'electricity_kWh_kg',  0.80, 'kWh/kg water evaporated', 20.0, NULL,
     'Rey, L. & May, J.C. (2010). Freeze-Drying/Lyophilization of Pharmaceutical and Biological Products, 3rd ed. Informa Healthcare. High energy consumption due to refrigeration and vacuum systems.'),

    ('UltrafiltrationSkid', 'electricity_kWh_m2',  0.15, 'kWh/m² membrane·hr', 25.0, NULL,
     'Mulder, M. (1996). Basic Principles of Membrane Technology, 2nd ed. Kluwer Academic. Circulation pump energy for crossflow UF; TMP = 2–5 bar, crossflow velocity 1–3 m/s.')

ON CONFLICT (unit_type, utility_type) DO NOTHING;


-- ---------------------------------------------------------------------------
-- Sensitivity analysis parameter bounds
-- Used by bst.Model for Latin hypercube sampling
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tea_sensitivity_params (
    id             SERIAL PRIMARY KEY,
    param_name     TEXT NOT NULL,
    output_name    TEXT,
    lower_bound    NUMERIC NOT NULL,
    upper_bound    NUMERIC NOT NULL,
    baseline_value NUMERIC,
    distribution   TEXT NOT NULL DEFAULT 'uniform',
    units          TEXT,
    rationale      TEXT,
    citation_text  TEXT,
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (param_name, output_name)
);

INSERT INTO tea_sensitivity_params
    (param_name, output_name, lower_bound, upper_bound, baseline_value, distribution, units, rationale, citation_text)
VALUES
    ('yield_g_g',       NULL, 0.10, 0.55, NULL, 'uniform', 'g product/g substrate',
     'Biological range for fungal aerobic fermentation. Lower bound = marginal yield near maintenance energy; upper bound = 70% of theoretical maximum for most metabolites.',
     'Blanch, H.W. & Clark, D.S. (1997). Biochemical Engineering. Marcel Dekker. Ch. 5.'),

    ('titer_g_l',       NULL, 5.0, 150.0, NULL, 'uniform', 'g/L',
     'Practical titer range for submerged fermentation. 5 g/L = early development; 150 g/L = high-performance production strain.',
     'Papagianni, M. (2007). Advances in citric acid fermentation by Aspergillus niger. Biotechnol Adv 25(3):244-263.'),

    ('sub_cost_per_ton', NULL, 50.0, 400.0, NULL, 'uniform', 'USD/tonne',
     'Agricultural commodity substrate price range (wheat bran, corn stover, cassava). Reflects market volatility ±50% around mid-range.',
     'FAO (2023). Food Price Index. Food and Agriculture Organization of the United Nations. www.fao.org/worldfoodsituation/foodpricesindex.'),

    ('operating_days',  NULL, 300.0, 340.0, 330.0, 'uniform', 'days/year',
     'Typical industrial bioprocess uptime 82–93% (300–340 days/year). Accounts for scheduled maintenance, CIP, and unplanned downtime.',
     'Peters, M.S. et al. (2003). Plant Design and Economics for Chemical Engineers, 5th ed. McGraw-Hill. Ch. 9.'),

    ('lang_factor',     NULL, 3.0, 5.0, 3.5, 'uniform', 'dimensionless',
     'Installation factor range for mixed fluid-solid bioprocess plants. 3.0 = minimal installation complexity; 5.0 = complex solid handling with extensive piping.',
     'Peters, M.S. et al. (2003). Table 6-8; Turton, R. et al. (2012). Analysis, Synthesis and Design of Chemical Processes, 4th ed. Appendix A.'),

    ('project_years',   NULL, 7.0, 15.0, 10.0, 'uniform', 'years',
     'Plant economic life range for bioprocess facilities. 7 years = early-stage technology; 15 years = mature commodity process.',
     'Humbird, D. et al. (2011). NREL/TP-5100-47764; Peters, M.S. et al. (2003). 5th ed. McGraw-Hill. Ch. 6.')

ON CONFLICT (param_name, output_name) DO NOTHING;


-- ---------------------------------------------------------------------------
-- Computation provenance log
-- Every TEA run stores a record of each computation step for UI display
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tea_computation_log (
    id              SERIAL PRIMARY KEY,
    run_id          INTEGER,
    step_order      INTEGER NOT NULL,
    step_name       TEXT NOT NULL,
    formula_text    TEXT,
    inputs          JSONB,
    outputs         JSONB,
    citations       JSONB,
    method_note     TEXT,
    assumption_flag BOOLEAN NOT NULL DEFAULT FALSE,
    assumption_note TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tea_computation_log_run
    ON tea_computation_log (run_id, step_order);


-- ---------------------------------------------------------------------------
-- Sensitivity analysis results (extended with full method metadata)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tea_sensitivity_results (
    id                  SERIAL PRIMARY KEY,
    run_id              INTEGER,
    method              TEXT NOT NULL DEFAULT 'latin_hypercube_spearman',
    n_samples           INTEGER NOT NULL,
    sampling_rule       TEXT NOT NULL DEFAULT 'L',
    random_seed         INTEGER,
    convergence_note    TEXT,
    param_name          TEXT NOT NULL,
    spearman_rho        NUMERIC,
    p_value             NUMERIC,
    p10_mpsp            NUMERIC,
    p50_mpsp            NUMERIC,
    p90_mpsp            NUMERIC,
    lower_bound_used    NUMERIC,
    upper_bound_used    NUMERIC,
    distribution_used   TEXT,
    citation_bound      TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tea_sensitivity_results_run
    ON tea_sensitivity_results (run_id);


-- ---------------------------------------------------------------------------
-- Missing data requests queue
-- Written by BioSTEAM unit _cost()/_design() when required DB row is absent
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS biosteam_data_requests (
    id            SERIAL PRIMARY KEY,
    request_type  TEXT NOT NULL,
    item_name     TEXT NOT NULL,
    field_needed  TEXT NOT NULL,
    reason        TEXT,
    run_id        INTEGER,
    status        TEXT NOT NULL DEFAULT 'pending',
    resolved_at   TIMESTAMPTZ,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_biosteam_data_requests_status
    ON biosteam_data_requests (status);
