-- Migration 033: Expand strain matching to handle collection accessions
-- and species-level proxy strains.
--
-- Problem: staging_queue rows with strain_unmatched=TRUE cannot reach
-- training_pairs because strain_id IS NULL. This affects strains identified
-- only by collection accession (ATCC, CBS, DSMZ, NRRL, etc.) or species
-- name without a genome record.
--
-- Solution:
-- 1. strain_collection_accessions table for collection ID lookup
-- 2. is_species_proxy flag on strains for genus/species-level records
-- 3. strain_match_tier on staging_queue to track match quality
-- 4. Updated training_pairs view to apply tier-based confidence weights
--    (species-proxy matches get 0.7×, genus-proxy 0.5×)

-- ---------------------------------------------------------------------------
-- 1. Collection accession lookup table
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS strain_collection_accessions (
    id               SERIAL PRIMARY KEY,
    strain_id        UUID NOT NULL REFERENCES strains(strain_id) ON DELETE CASCADE,
    collection       TEXT NOT NULL
        CHECK (collection IN (
            'ATCC', 'CBS', 'DSMZ', 'NRRL', 'JMU', 'MTCC',
            'NBRC', 'IAM', 'IFO', 'CCT', 'IMI', 'QM',
            'CGMCC', 'CICC', 'AS', 'BCRC', 'RIB', 'other'
        )),
    accession_number TEXT NOT NULL,  -- e.g. '16888' for ATCC 16888
    full_accession   TEXT NOT NULL,  -- e.g. 'ATCC 16888'
    notes            TEXT,
    added_at         TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (collection, accession_number)
);

CREATE INDEX IF NOT EXISTS idx_collection_acc_strain
    ON strain_collection_accessions(strain_id);
CREATE INDEX IF NOT EXISTS idx_collection_acc_lookup
    ON strain_collection_accessions(collection, accession_number);
CREATE INDEX IF NOT EXISTS idx_collection_acc_full
    ON strain_collection_accessions(lower(full_accession));

COMMENT ON TABLE strain_collection_accessions IS
    'Maps culture collection accession numbers (ATCC, CBS, DSMZ, NRRL, etc.)
     to strains in the strains table. Allows staging_queue rows reporting
     collection-accession strains to be matched even without NCBI genome
     accessions. Source: manual entry or automated lookup.';

-- ---------------------------------------------------------------------------
-- 2. Matching metadata on strains
-- ---------------------------------------------------------------------------

ALTER TABLE strains
    ADD COLUMN IF NOT EXISTS is_species_proxy    BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS species_proxy_note  TEXT,
    ADD COLUMN IF NOT EXISTS cazyme_feature_source TEXT
        DEFAULT 'annotated'
        CHECK (cazyme_feature_source IN (
            'annotated',       -- from dbCAN annotation of own genome
            'species_median',  -- median of annotated strains of same species
            'genus_median',    -- median of annotated strains of same genus
            'literature',      -- manually entered from literature
            'unknown'
        ));

-- Backfill: mark existing species_level strains as proxies
UPDATE strains
SET is_species_proxy       = TRUE,
    cazyme_feature_source  = 'unknown',
    species_proxy_note     = 'Auto-set by migration 033: species_specificity=species_level and no genome'
WHERE strain_specificity = 'species_level'
  AND (ncbi_accession IS NULL OR ncbi_accession = '')
  AND is_species_proxy IS DISTINCT FROM TRUE;

COMMENT ON COLUMN strains.is_species_proxy IS
    'TRUE for strain records representing a species or genus without a specific
     sequenced genome. CAZyme features may be medians from annotated strains
     of the same species/genus. Used for training_pairs rows where only
     organism name was reported, not a specific strain.';

-- ---------------------------------------------------------------------------
-- 3. Match tier on staging_queue
-- ---------------------------------------------------------------------------

ALTER TABLE staging_queue
    ADD COLUMN IF NOT EXISTS strain_match_tier TEXT
        DEFAULT 'unmatched'
        CHECK (strain_match_tier IN (
            'exact_ncbi',        -- matched via NCBI assembly accession
            'exact_collection',  -- matched via ATCC/CBS/DSMZ/NRRL accession
            'species_proxy',     -- matched to species-level proxy strain
            'genus_proxy',       -- matched to genus-level proxy strain
            'unmatched'          -- no match possible
        )),
    ADD COLUMN IF NOT EXISTS strain_match_confidence FLOAT DEFAULT NULL;

-- Backfill existing matched rows with 'exact_ncbi' or 'exact_collection'
UPDATE staging_queue sq
SET strain_match_tier = CASE
    WHEN st.ncbi_accession IS NOT NULL AND st.ncbi_accession != '' THEN 'exact_ncbi'
    WHEN st.atcc_catalog_number IS NOT NULL AND st.atcc_catalog_number != '' THEN 'exact_collection'
    ELSE 'exact_collection'  -- matched to a strain record, genome TBD
END,
strain_match_confidence = sq.strain_match_score
FROM strains st
WHERE sq.strain_id_matched = st.strain_id
  AND sq.strain_unmatched = FALSE
  AND sq.strain_match_tier = 'unmatched';

COMMENT ON COLUMN staging_queue.strain_match_tier IS
    'Quality tier of the strain match. Determines confidence_weight multiplier
     applied to training_pairs rows:
       exact_ncbi:        1.0  (genome-annotated CAZyme features)
       exact_collection:  1.0  (same strain, no genome yet — identity certain)
       species_proxy:     0.7  (species median features)
       genus_proxy:       0.5  (genus median features)
       unmatched:         NULL (excluded from training_pairs)';

-- ---------------------------------------------------------------------------
-- 4. Tier weight function
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION strain_match_tier_weight(
    tier TEXT
) RETURNS FLOAT AS $$
BEGIN
    RETURN CASE tier
        WHEN 'exact_ncbi'        THEN 1.0
        WHEN 'exact_collection'  THEN 1.0
        WHEN 'species_proxy'     THEN 0.7
        WHEN 'genus_proxy'       THEN 0.5
        WHEN 'unmatched'         THEN NULL  -- excluded
        ELSE                          NULL
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

COMMENT ON FUNCTION strain_match_tier_weight IS
    'Training weight multiplier for strain match quality tier.
     NULL means the row is excluded from training_pairs.
     Applied multiplicatively with engineering_class_weight and data_weight.';

-- ---------------------------------------------------------------------------
-- 5. Rebuild training_pairs materialized view
-- ---------------------------------------------------------------------------
-- Adds strain_match_tier to the output and applies tier weight to
-- confidence_weight. The WHERE clause now filters via tier rather than
-- implicitly relying on routing to exclude unmatched rows.

DROP MATERIALIZED VIEW IF EXISTS training_pairs;

CREATE MATERIALIZED VIEW training_pairs AS
SELECT
    fr.run_id,
    fr.strain_id,
    fr.enzyme_cocktail_id,
    fr.substrate_id,
    fr.enzyme_titer_u_ml                               AS titer,
    fr.enzyme_titer_u_ml                               AS target_titer,
    fr.run_date,
    fr.off_target_flag,
    fr.fermentation_subtype,
    fr.process_mode,
    COALESCE(fr.data_weight, 1.0)                      AS data_weight,
    fr.assay_method,
    fr.enzyme_class                                    AS run_enzyme_class,
    fr.carbon_source,
    fr.medium_composition,
    COALESCE(fr.is_reference_condition, false)         AS is_reference_condition,
    COALESCE(cf.gh13_count, 0)::float                  AS gh13_count,
    COALESCE(cf.gh15_count, 0)::float                  AS gh15_count,
    COALESCE(cf.gh10_count, 0)::float                  AS gh10_count,
    COALESCE(cf.gh11_count, 0)::float                  AS gh11_count,
    COALESCE(cf.aa9_count, 0)::float                   AS aa9_count,
    COALESCE(cf.ce1_count, 0)::float                   AS ce1_count,
    COALESCE(cf.aa1_laccase_count, 0)::float           AS aa1_laccase_count,
    COALESCE(cf.aa2_peroxidase_count, 0)::float        AS aa2_peroxidase_count,
    COALESCE(cf.gh18_chitinase_count, 0)::float        AS gh18_chitinase_count,
    COALESCE(cf.ce4_deacetylase_count, 0)::float       AS ce4_deacetylase_count,
    COALESCE(cf.gh76_mannanase_count, 0)::float        AS gh76_mannanase_count,
    COALESCE(cf.bgc_pks_count, 0)::float               AS bgc_pks_count,
    COALESCE(cf.bgc_nrps_count, 0)::float              AS bgc_nrps_count,
    COALESCE(cf.protease_serine, 0)::float             AS protease_serine,
    COALESCE(cf.protease_aspartyl, 0)::float           AS protease_aspartyl,
    COALESCE(st.mu_max, 0.0)                           AS mu_max,
    COALESCE(st.ph_optimum_min, 5.0)                   AS ph_optimum_min,
    CASE WHEN st.crea_allele = ANY (ARRAY['partial_loss','strong_loss','truncated']) THEN 1.0 ELSE 0.0 END AS crea_derepressed,
    CASE WHEN st.xlnr_variant = 'gain_of_function' THEN 1.0 ELSE 0.0 END AS xlnr_overactive,
    COALESCE(ecf.has_alpha_amylase, false)::int::float AS has_alpha_amylase,
    COALESCE(ecf.has_beta_amylase,  false)::int::float AS has_beta_amylase,
    COALESCE(ecf.has_glucoamylase,  false)::int::float AS has_glucoamylase,
    COALESCE(ecf.has_xylanase,      false)::int::float AS has_xylanase,
    COALESCE(ecf.has_protease,      false)::int::float AS has_protease,
    COALESCE(ecf.has_dextranase,    false)::int::float AS has_dextranase,
    COALESCE(ecf.n_enzyme_classes, 0)::float           AS n_enzyme_classes,
    COALESCE(ecf.cocktail_temp_opt_c, 0.0)             AS cocktail_temp_opt_c,
    COALESCE(ecf.cocktail_ph_opt, 0.0)                 AS cocktail_ph_opt,
    COALESCE(ecf.is_maltogenic, false)::int::float     AS is_maltogenic,
    COALESCE(s.pct_starch, 0.0)                        AS pct_starch,
    COALESCE(s.pct_cellulose, 0.0)                     AS pct_cellulose,
    COALESCE(s.pct_hemicellulose, 0.0)                 AS pct_hemicellulose,
    COALESCE(s.pct_pectin, 0.0)                        AS pct_pectin,
    COALESCE(s.pct_lignin, 0.0)                        AS pct_lignin,
    COALESCE(s.pct_protein, 0.0)                       AS pct_protein,
    COALESCE(s.pct_lipid, 0.0)                         AS pct_lipid,
    COALESCE(s.total_phenolics_mgkg, 0.0)              AS total_phenolics_mgkg,
    COALESCE(s.tannin_load_mgkg, 0.0)                  AS tannin_load_mgkg,
    COALESCE(s.cn_ratio, 0.0)                          AS cn_ratio,
    COALESCE(s.water_activity, 0.0)                    AS water_activity,
    COALESCE(s.ph_native, 7.0)                         AS ph_native,
    COALESCE(s.is_reference_substrate, false)::int::float AS is_reference_substrate,
    COALESCE(s.carbon_source_purity_pct, 0.0)          AS carbon_source_purity_pct,
    CASE COALESCE(s.substrate_category, 'waste_stream')
        WHEN 'waste_stream'          THEN 0.0
        WHEN 'reference_natural'     THEN 0.3
        WHEN 'commercial_substrate'  THEN 0.5
        WHEN 'defined_liquid'        THEN 0.7
        WHEN 'reference_synthetic'   THEN 0.8
        WHEN 'agar_medium'           THEN 1.0
        ELSE 0.0
    END AS substrate_complexity_score,
    CASE WHEN fr.target_product = 'reducing_sugar' THEN 1.0 ELSE 0.0 END AS target_reducing_sugar,
    CASE WHEN fr.target_product = ANY (ARRAY['alpha_amylase','beta_amylase','glucoamylase','xylanase','endocellulase','protease','laccase','peroxidase','enzyme']) THEN 1.0 ELSE 0.0 END AS target_enzyme,
    CASE WHEN fr.target_product = 'phenolic' THEN 1.0 ELSE 0.0 END AS target_phenolic,
    CASE WHEN fr.target_product = 'lipid'    THEN 1.0 ELSE 0.0 END AS target_lipid,
    CASE WHEN fr.target_product = 'biomass'  THEN 1.0 ELSE 0.0 END AS target_biomass,
    COALESCE(s.cluster_id, 0)                          AS cluster_id,
    COALESCE(s.substrate_category, 'waste_stream')     AS substrate_category,
    s.primary_carbon_source,
    fr.titer_unit,
    COALESCE(sq.strain_engineering_class, 'unknown')   AS strain_engineering_class,
    COALESCE(sq.strain_match_tier, 'exact_ncbi')       AS strain_match_tier,
    -- confidence_weight = data_weight × engineering_class_weight × tier_weight
    COALESCE(fr.data_weight, 1.0)
        * engineering_class_weight(COALESCE(sq.strain_engineering_class, 'unknown'))
        * COALESCE(strain_match_tier_weight(COALESCE(sq.strain_match_tier, 'exact_ncbi')), 1.0)
        AS confidence_weight,
    CASE
        WHEN fr.titer_unit = 'g_per_g_substrate' THEN 'yield'
        WHEN fr.titer_unit = 'U/g'               THEN 'enzyme_production'
        ELSE 'yield'
    END AS model_type
FROM fermentation_runs fr
JOIN  substrates s  ON s.substrate_id = fr.substrate_id
LEFT JOIN strains st ON st.strain_id = fr.strain_id
LEFT JOIN staging_queue sq ON sq.queue_id = fr.queue_id
LEFT JOIN LATERAL (
    SELECT * FROM strain_cazyme_features
    WHERE strain_id = fr.strain_id
    ORDER BY annotation_date DESC NULLS LAST, created_at DESC
    LIMIT 1
) cf ON true
LEFT JOIN enzyme_cocktail_features ecf ON ecf.cocktail_id = fr.enzyme_cocktail_id
WHERE fr.off_target_flag = false
  AND fr.archived = false
  AND fr.enzyme_titer_u_ml IS NOT NULL
  AND fr.titer_unit = ANY (ARRAY['g_per_g_substrate', 'U/g'])
  AND (
      sq.strain_match_tier IS NULL  -- pre-tier rows: include (treat as exact_ncbi)
      OR strain_match_tier_weight(sq.strain_match_tier) IS NOT NULL  -- tier has nonzero weight
  );

CREATE UNIQUE INDEX ON training_pairs (run_id);

COMMENT ON MATERIALIZED VIEW training_pairs IS
    'ML training dataset. Each row is one approved fermentation run with all
     feature columns pre-joined. confidence_weight = data_weight ×
     engineering_class_weight × strain_match_tier_weight. Rows with
     strain_match_tier=''unmatched'' are excluded (tier weight is NULL).
     Refresh after approval: REFRESH MATERIALIZED VIEW CONCURRENTLY training_pairs.';
