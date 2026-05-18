-- Migration 030: add normalized unit columns to staging_queue
-- These are populated by unit_normalizer.py and allow the review UI
-- to show canonical equivalents of non-standard LLM-extracted units.
-- When a row is promoted from staging_queue to fermentation_runs via
-- "Move to Training", the normalized values should be used.

ALTER TABLE staging_queue
    ADD COLUMN IF NOT EXISTS normalized_titer_value DOUBLE PRECISION,
    ADD COLUMN IF NOT EXISTS normalized_titer_unit  TEXT,
    ADD COLUMN IF NOT EXISTS normalization_method   TEXT,
    ADD COLUMN IF NOT EXISTS original_titer_unit    TEXT;

COMMENT ON COLUMN staging_queue.normalized_titer_value IS
    'Titer value converted to canonical unit (g_per_g_substrate or U/g). NULL if conversion not possible.';
COMMENT ON COLUMN staging_queue.normalized_titer_unit IS
    'Canonical unit: g_per_g_substrate or U/g. NULL if original unit could not be normalized.';
COMMENT ON COLUMN staging_queue.normalization_method IS
    'How normalization was achieved: direct_mapping, calculated_from_loading_Xg_per_l, or reason it was not possible.';
COMMENT ON COLUMN staging_queue.original_titer_unit IS
    'Original unit string before normalization, preserved for audit.';
