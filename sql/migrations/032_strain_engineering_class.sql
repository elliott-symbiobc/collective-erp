-- Migration 032: add strain_engineering_class to staging_queue
--
-- Classification of whether a strain is wild-type, classical mutant, or
-- recombinant (GMO). Used to weight training observations: recombinant
-- strains often report unusually high titers (overexpression artefacts)
-- that can mislead the compatibility model when predicting wild-type
-- fermentation outcomes.
--
-- Weight mapping (via engineering_class_weight function):
--   wild_type   → 1.0  (full confidence — reference behavior)
--   mutant      → 0.8  (classical mutagenesis, generally predictive)
--   recombinant → 0.6  (overexpression artefacts possible)
--   unknown     → 0.7  (conservative default for unclassified rows)

ALTER TABLE staging_queue
    ADD COLUMN IF NOT EXISTS strain_engineering_class TEXT NOT NULL DEFAULT 'unknown';

ALTER TABLE staging_queue
    ADD CONSTRAINT staging_queue_engineering_class_check
    CHECK (strain_engineering_class IN ('wild_type', 'mutant', 'recombinant', 'unknown'));

COMMENT ON COLUMN staging_queue.strain_engineering_class IS
    'Engineering status of the producing strain.
     wild_type:   unmodified isolate or standard lab strain
     mutant:      classical mutagenesis (UV, NTG, EMS) or targeted deletion without transgene
     recombinant: transgenic — overexpression cassette, reporter gene, or heterologous insertion
     unknown:     not determinable from paper text (default — conservative)';

-- SQL function: maps engineering class → confidence weight for ML training.
-- Weights are intentionally asymmetric: wild_type=1.0, unknown < wild_type
-- because unclassified rows might include recombinant strains.

CREATE OR REPLACE FUNCTION engineering_class_weight(class TEXT)
RETURNS FLOAT
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT CASE class
        WHEN 'wild_type'   THEN 1.0
        WHEN 'mutant'      THEN 0.8
        WHEN 'recombinant' THEN 0.6
        WHEN 'unknown'     THEN 0.7
        ELSE 0.7
    END
$$;

COMMENT ON FUNCTION engineering_class_weight(TEXT) IS
    'Returns the ML training confidence weight for a strain_engineering_class value.
     Multiplied by data_weight to produce confidence_weight in training_pairs.';
