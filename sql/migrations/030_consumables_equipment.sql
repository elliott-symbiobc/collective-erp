-- Migration: add lab_consumables and lab_equipment tables

CREATE TABLE IF NOT EXISTS lab_consumables (
    consumable_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name            TEXT NOT NULL,
    catalog_number  TEXT,
    manufacturer    TEXT,
    supplier        TEXT,
    category        TEXT,
    stock_quantity  NUMERIC DEFAULT 0,
    unit            TEXT DEFAULT 'each',
    reorder_level   NUMERIC,
    location        TEXT,
    expiry_date     DATE,
    price_per_unit  NUMERIC,
    currency        TEXT DEFAULT 'USD',
    url             TEXT,
    notes           TEXT,
    archived        BOOLEAN DEFAULT FALSE,
    archived_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consumables_category ON lab_consumables(category);
CREATE INDEX IF NOT EXISTS idx_consumables_archived  ON lab_consumables(archived);

CREATE TABLE IF NOT EXISTS lab_equipment (
    equipment_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT NOT NULL,
    model             TEXT,
    serial_number     TEXT,
    asset_tag         TEXT,
    manufacturer      TEXT,
    supplier          TEXT,
    category          TEXT,
    location          TEXT,
    status            TEXT DEFAULT 'operational',
    date_acquired     DATE,
    warranty_expiry   DATE,
    last_service_date DATE,
    next_service_date DATE,
    purchase_price    NUMERIC,
    currency          TEXT DEFAULT 'USD',
    notes             TEXT,
    manual_url        TEXT,
    archived          BOOLEAN DEFAULT FALSE,
    archived_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_equipment_category ON lab_equipment(category);
CREATE INDEX IF NOT EXISTS idx_equipment_status   ON lab_equipment(status);
CREATE INDEX IF NOT EXISTS idx_equipment_archived  ON lab_equipment(archived);
