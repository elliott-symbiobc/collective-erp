-- Migration: add est_value and price_ref_url to lab_equipment;
-- migrate misloaded data from prior bulk import
ALTER TABLE lab_equipment ADD COLUMN IF NOT EXISTS est_value NUMERIC;
ALTER TABLE lab_equipment ADD COLUMN IF NOT EXISTS price_ref_url TEXT;

-- Prior bulk import put estimated values in purchase_price and price refs in manual_url
UPDATE lab_equipment SET est_value = purchase_price, purchase_price = NULL WHERE purchase_price IS NOT NULL;
UPDATE lab_equipment SET price_ref_url = manual_url, manual_url = NULL WHERE manual_url IS NOT NULL;
