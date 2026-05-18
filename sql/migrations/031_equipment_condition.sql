-- Migration: add condition field to lab_equipment (new/used price indicator)
ALTER TABLE lab_equipment ADD COLUMN IF NOT EXISTS condition TEXT;
