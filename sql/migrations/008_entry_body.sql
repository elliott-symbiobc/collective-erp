-- Migration 008: Add body column to eln_entries for plain-text note entries

BEGIN;

ALTER TABLE eln_entries
  ADD COLUMN IF NOT EXISTS body TEXT;

COMMIT;
