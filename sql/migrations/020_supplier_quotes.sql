-- 020_supplier_quotes.sql
-- Supplier equipment quotes linked to flowsheet nodes

CREATE TABLE IF NOT EXISTS supplier_equipment_quotes (
    quote_id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    flowsheet_id    UUID REFERENCES bioprocess_flowsheets(flowsheet_id) ON DELETE CASCADE,
    node_id         TEXT NOT NULL,
    unit_type       TEXT NOT NULL,
    supplier_name   TEXT NOT NULL,
    equipment_model TEXT,
    capacity_value  DECIMAL(15,4),
    capacity_units  TEXT,
    purchase_price  DECIMAL(15,2),
    installed_price DECIMAL(15,2),
    currency        VARCHAR(10) DEFAULT 'USD',
    quote_date      DATE,
    valid_until     DATE,
    lead_time_weeks INTEGER,
    datasheet_notes TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    created_by      UUID REFERENCES users(user_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_supplier_quotes_flowsheet ON supplier_equipment_quotes(flowsheet_id);
CREATE INDEX IF NOT EXISTS idx_supplier_quotes_node ON supplier_equipment_quotes(flowsheet_id, node_id);
