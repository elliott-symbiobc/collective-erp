-- Migration 005: Add paper summary and extraction columns to papers table
ALTER TABLE papers
    ADD COLUMN IF NOT EXISTS paper_summary    TEXT,
    ADD COLUMN IF NOT EXISTS key_findings     TEXT,
    ADD COLUMN IF NOT EXISTS research_gaps    TEXT,
    ADD COLUMN IF NOT EXISTS last_extracted_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS extraction_model  TEXT;
