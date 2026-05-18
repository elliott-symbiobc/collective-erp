-- One-time capital injections (e.g. investments) that should be excluded from burn rate
ALTER TABLE fpa_actuals
    ADD COLUMN IF NOT EXISTS capital_adjustment NUMERIC(15,2) NOT NULL DEFAULT 0;
