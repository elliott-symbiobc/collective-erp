-- 028_bgc_clusters.sql
-- BGC annotation results from antiSMASH 7.x

CREATE TABLE IF NOT EXISTS bgc_clusters (
    id                  SERIAL PRIMARY KEY,
    strain_id           UUID NOT NULL REFERENCES strains(strain_id) ON DELETE CASCADE,
    region_number       INTEGER NOT NULL,           -- antiSMASH region index (1-based)
    contig              TEXT,                        -- scaffold/contig name
    start_pos           INTEGER,                     -- cluster start on contig
    end_pos             INTEGER,                     -- cluster end on contig
    bgc_type            TEXT NOT NULL,              -- e.g. 'T1PKS', 'NRPS', 'terpene'
    bgc_type_detail     TEXT[],                     -- all product types (can be hybrid)
    product_names       TEXT[],                     -- predicted compound names
    contig_edge         BOOLEAN DEFAULT FALSE,       -- cluster truncated at contig edge
    mibig_hit_id        TEXT,                        -- best MIBiG cluster ID (e.g. 'BGC0000001')
    mibig_hit_name      TEXT,                        -- known compound name from MIBiG
    mibig_similarity    NUMERIC(5,2),               -- % similarity to MIBiG hit (0–100)
    mibig_hit_count     INTEGER DEFAULT 0,           -- number of MIBiG hits above threshold
    smcog_hits          JSONB DEFAULT '[]',          -- smCoG annotations [{"smcog": ..., "score": ...}]
    safety_flag         TEXT,                        -- NULL | 'mycotoxin' | 'review_required'
    safety_flag_reason  TEXT,
    raw_region_json     JSONB,                       -- full antiSMASH region JSON for traceability
    antismash_version   TEXT DEFAULT '7.1.0',
    annotated_at        TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (strain_id, region_number, contig)
);

CREATE INDEX IF NOT EXISTS bgc_clusters_strain_idx ON bgc_clusters(strain_id);
CREATE INDEX IF NOT EXISTS bgc_clusters_type_idx   ON bgc_clusters(bgc_type);
CREATE INDEX IF NOT EXISTS bgc_clusters_mibig_idx  ON bgc_clusters(mibig_hit_id) WHERE mibig_hit_id IS NOT NULL;

-- BGC summary columns on strains table
ALTER TABLE strains
    ADD COLUMN IF NOT EXISTS bgc_count            INTEGER,
    ADD COLUMN IF NOT EXISTS bgc_types            TEXT[],
    ADD COLUMN IF NOT EXISTS bgc_has_pks          BOOLEAN GENERATED ALWAYS AS (bgc_types && ARRAY['T1PKS','T2PKS','T3PKS','transAT-PKS','PKS-like']) STORED,
    ADD COLUMN IF NOT EXISTS bgc_has_nrps         BOOLEAN GENERATED ALWAYS AS (bgc_types && ARRAY['NRPS','NRPS-like']) STORED,
    ADD COLUMN IF NOT EXISTS bgc_has_terpene      BOOLEAN GENERATED ALWAYS AS (bgc_types && ARRAY['terpene']) STORED,
    ADD COLUMN IF NOT EXISTS bgc_safety_flagged   BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS bgc_annotated_at     TIMESTAMP WITH TIME ZONE,
    ADD COLUMN IF NOT EXISTS antismash_version    TEXT;
