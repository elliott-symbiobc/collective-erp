-- 013_lab_chemicals.sql
-- Lab chemical & supply procurement tracker.

CREATE TABLE IF NOT EXISTS lab_chemicals (
    chemical_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_name            TEXT NOT NULL,
    cas_number           TEXT,
    catalog_number       TEXT,
    manufacturer         TEXT,
    supplier             TEXT,
    item_type            TEXT,   -- Chemical | General Supply | Protein | etc.
    comments             TEXT,
    grant_id             TEXT,
    requested_by         TEXT,
    quote_id             TEXT,
    purchase_order_number TEXT,
    requisition_number   TEXT,
    confirmation_number  TEXT,
    tracking_number      TEXT,
    invoice_number       TEXT,
    status               TEXT DEFAULT 'requested',  -- requested | approved | ordered | received | cancelled
    pack_size            TEXT,
    quantity             INTEGER DEFAULT 1,
    currency             TEXT DEFAULT 'USD',
    price                NUMERIC,
    tax                  NUMERIC,
    total                NUMERIC,
    url                  TEXT,
    shipping             NUMERIC,
    date_requested       DATE,
    date_approved        DATE,
    date_ordered         DATE,
    date_cancelled       DATE,
    date_received        DATE,
    approved_by          TEXT,
    ordered_by           TEXT,
    cancelled_by         TEXT,
    received_by          TEXT,
    approved_message     TEXT,
    ordered_message      TEXT,
    cancelled_message    TEXT,
    received_message     TEXT,
    archived             BOOLEAN DEFAULT FALSE,
    archived_at          TIMESTAMPTZ,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lab_chemicals_status    ON lab_chemicals (status);
CREATE INDEX IF NOT EXISTS idx_lab_chemicals_item_type ON lab_chemicals (item_type);
CREATE INDEX IF NOT EXISTS idx_lab_chemicals_supplier  ON lab_chemicals (supplier);

-- ── Seed data from Symbio Bioculinary order exports ────────────────────────

INSERT INTO lab_chemicals (
    item_name, cas_number, catalog_number, manufacturer, supplier, item_type,
    comments, grant_id, requested_by, quote_id, purchase_order_number,
    requisition_number, confirmation_number, tracking_number, invoice_number,
    status, pack_size, quantity, currency, price, tax, total, url, shipping,
    date_requested, date_approved, date_ordered, date_cancelled, date_received,
    approved_by, ordered_by, cancelled_by, received_by,
    approved_message, ordered_message, cancelled_message, received_message
) VALUES
(
    'Sodium Hydroxide, 0.1 M (0.4%), Aqueous, Laboratory Grade, 1 L',
    NULL, '889553', 'Carolina', 'Carolina', 'Chemical',
    NULL, 'General Grant', 'omar@symbiobc.com',
    NULL, '31455167', NULL, NULL, NULL, NULL,
    'received', 'L', 1, 'USD', 14.05, 2.71, 16.76,
    'https://www.carolina.com/acids-and-bases/sodium-hydroxide-pellets-laboratory-grade-30-g/889425.pr',
    13.73,
    '2026-03-04', NULL, NULL, NULL, '2026-03-09',
    NULL, NULL, NULL, 'omar@symbiobc.com',
    NULL, NULL, NULL, 'The item was received.'
),
(
    'Methanol 99.85% Lab Grade',
    NULL, 'MAL-1L', NULL, 'Lab Alley', 'General Supply',
    NULL, 'General Grant', 'omar@symbiobc.com',
    '204759', NULL, NULL, NULL, NULL, NULL,
    'received', '1 L', 1, 'USD', 55.99, 22.30, 78.29,
    'https://www.laballey.com/products/methanol-lab-grade?variant=36240544268443',
    0.00,
    '2025-10-08', NULL, NULL, NULL, '2025-10-13',
    NULL, NULL, NULL, 'omar@symbiobc.com',
    NULL, NULL, NULL, 'The item was received.'
),
(
    'Albumin, Bovine Serum, Fraction V, Low Heavy Metals',
    '9048-46-8', '12659-M', NULL, 'Sigma-Aldrich', 'General Supply',
    NULL, 'General Grant', 'elliott@symbiobc.com',
    NULL, 'CC/8222025/SANTOYO', NULL, NULL, NULL, NULL,
    'received', '25g', 1, 'USD', 76.60, 0.00, 76.60,
    'https://www.sigmaaldrich.com/US/en/product/mm/12659m',
    0.00,
    '2025-08-19', NULL, '2025-08-22', NULL, '2025-08-27',
    NULL, 'omar@symbiobc.com', NULL, 'omar@symbiobc.com',
    NULL, NULL, NULL, 'The item was received.'
),
(
    'Folin & Ciocalteu''s phenol reagent',
    NULL, '0219518690', 'Sigma-Aldrich', 'Sigma-Aldrich', 'Chemical',
    'The shipping cost will be given after an account is made.', 'General Grant', 'omar@symbiobc.com',
    NULL, 'CC/8222025/SANTOYO', NULL, NULL, NULL, NULL,
    'received', '500mL', 1, 'USD', 208.00, 0.00, 208.00,
    'https://www.sigmaaldrich.com/US/en/product/sial/f9252',
    0.00,
    '2025-08-19', NULL, '2025-08-22', NULL, '2025-08-27',
    NULL, 'omar@symbiobc.com', NULL, 'omar@symbiobc.com',
    NULL, NULL, NULL, 'The item was received.'
),
(
    'Methanol, 80% (v/v), HPLC Grad',
    '67-56-1', 'RCC-R4820800-1C', NULL, 'Lab Alley', 'Chemical',
    NULL, 'General Grant', 'omar@symbiobc.com',
    NULL, '198557', NULL, 'Z9GGRNJ5W', NULL, NULL,
    'received', '500mL', 1, 'USD', 40.00, 5.00, 45.00,
    'https://www.laballey.com/products/methanol-lab-grade',
    40.00,
    '2025-08-19', NULL, '2025-08-20', NULL, '2025-08-27',
    NULL, 'omar@symbiobc.com', NULL, 'omar@symbiobc.com',
    NULL, NULL, NULL, 'The item was received.'
),
(
    'Hexane',
    '110-54-3', 'HXL-1GAL', NULL, 'Lab Alley', 'General Supply',
    NULL, 'General Grant', 'elliott@symbiobc.com',
    NULL, '198557', NULL, NULL, NULL, NULL,
    'received', '1 gallon', 1, 'USD', 61.31, 0.00, 61.31,
    'https://www.laballey.com/products/hexanes-laboratory-grade',
    0.00,
    '2025-08-19', NULL, '2025-08-20', NULL, '2025-08-27',
    NULL, 'omar@symbiobc.com', NULL, 'omar@symbiobc.com',
    NULL, NULL, NULL, 'The item was received.'
),
(
    'Hydrochloric Acid 37% Solution, ACS Reagent Grade',
    '7647-01-0', 'HCLA37-1GAL', NULL, 'Lab Alley', 'General Supply',
    NULL, 'General Grant', 'elliott@symbiobc.com',
    NULL, '198557', NULL, NULL, NULL, NULL,
    'received', '1 gal', 1, 'USD', 93.13, 0.00, 93.13,
    'https://www.laballey.com/products/hydrochloric-acid-37-percent-solution-acs-grade',
    0.00,
    '2025-08-19', NULL, '2025-08-20', NULL, '2025-08-27',
    NULL, 'omar@symbiobc.com', NULL, 'omar@symbiobc.com',
    NULL, NULL, NULL, 'The item was received.'
),
(
    'Ethanol',
    '64-17-5', 'EAP190-1L', NULL, 'Lab Alley', 'Chemical',
    NULL, 'General Grant', 'omar@symbiobc.com',
    NULL, '198557', NULL, NULL, NULL, NULL,
    'received', '1L', 1, 'USD', 69.96, 8.31, 78.27,
    'https://www.laballey.com/products/ethanol-pure-190-proof-undenatured-acs-usp-grade',
    15.35,
    '2025-08-19', NULL, '2025-08-20', NULL, '2025-08-27',
    NULL, 'omar@symbiobc.com', NULL, 'omar@symbiobc.com',
    NULL, NULL, NULL, 'The item was received.'
),
(
    'Biuret Reagent TS',
    NULL, '848211', 'Carolina', 'Carolina', 'General Supply',
    NULL, 'General Grant', 'elliott@symbiobc.com',
    NULL, NULL, NULL, NULL, NULL, NULL,
    'received', '100 mL', 1, 'USD', 5.75, 0.00, 5.75,
    'https://www.carolina.com/specialty-chemicals-b-c/biuret-reagent-laboratory-grade-100-ml/848211.pr',
    0.00,
    '2025-08-19', NULL, '2025-08-20', NULL, '2025-08-22',
    NULL, 'omar@symbiobc.com', NULL, 'omar@symbiobc.com',
    NULL, NULL, NULL, 'The item was received.'
),
(
    'Cellulase',
    NULL, '853630', 'Carolina', 'Carolina', 'Protein',
    NULL, 'General Grant', 'omar@symbiobc.com',
    NULL, NULL, NULL, NULL, NULL, NULL,
    'received', '25g', 1, 'USD', 46.65, 5.54, 52.19,
    'https://www.carolina.com/specialty-chemicals-b-c/cellulase-laboratory-grade-25g/853630.pr',
    10.21,
    '2025-08-19', NULL, '2025-08-20', NULL, '2025-08-22',
    NULL, 'omar@symbiobc.com', NULL, 'omar@symbiobc.com',
    NULL, NULL, NULL, 'The item was received.'
),
(
    'Sodium Acetate, Anhydrous, Laboratory Chemical Grade, Powder',
    NULL, '888128', 'Carolina', 'Carolina', 'Chemical',
    NULL, 'General Grant', 'omar@symbiobc.com',
    NULL, NULL, NULL, NULL, NULL, NULL,
    'received', '100g', 1, 'USD', 8.80, 1.97, 10.77,
    'https://www.carolina.com/specialty-chemicals-s/sodium-acetate-anhydrous-powder-laboratory-grade-100-g/888128.pr',
    11.45,
    '2025-08-19', NULL, '2025-08-20', NULL, '2025-08-22',
    NULL, 'omar@symbiobc.com', NULL, 'omar@symbiobc.com',
    NULL, NULL, NULL, 'The item was received.'
),
(
    'Acetic Acid, 17.4 M (100% v/v), Glacial, ACS Grade',
    NULL, '841289', 'Carolina', 'Carolina', 'Chemical',
    NULL, 'General Grant', 'omar@symbiobc.com',
    NULL, NULL, NULL, NULL, NULL, NULL,
    'received', '30mL', 1, 'USD', 6.35, 1.73, 8.08,
    'https://www.carolina.com/specialty-chemicals-a/acetic-acid-174-m-100-vv-glacial-acs-grade-30-ml/841289.pr',
    11.37,
    '2025-08-19', NULL, '2025-08-20', NULL, '2025-08-22',
    NULL, 'omar@symbiobc.com', NULL, 'omar@symbiobc.com',
    NULL, NULL, NULL, 'The item was received.'
),
(
    'Sodium Carbonate, Anhydrous, Powder, Laboratory Grade',
    NULL, '888768', 'Carolina', 'Carolina', 'Chemical',
    NULL, 'General Grant', 'omar@symbiobc.com',
    NULL, NULL, NULL, NULL, NULL, NULL,
    'received', '100g', 1, 'USD', 5.30, 1.62, 6.92,
    'https://www.carolina.com/specialty-chemicals-s/sodium-carbonate-anhydrous-powder-laboratory-grade-100-g/888768.pr',
    11.34,
    '2025-08-19', NULL, '2025-08-20', NULL, '2025-08-22',
    NULL, 'omar@symbiobc.com', NULL, 'omar@symbiobc.com',
    NULL, NULL, NULL, 'The item was received.'
),
(
    'L-Hydroxyproline',
    '51-35-4', 'H54409-2.5G', 'Sigma-Aldrich', 'Sigma-Aldrich', 'General Supply',
    NULL, 'General Grant', 'elliott@symbiobc.com',
    NULL, 'JAMESENOTRICA/VC/081925', NULL, NULL, NULL, NULL,
    'received', '2.5 g', 1, 'USD', 40.40, 0.00, 40.40,
    'https://www.sigmaaldrich.com/US/en/product/aldrich/h54409',
    0.00,
    '2025-08-19', NULL, '2025-08-20', NULL, '2025-08-22',
    NULL, 'omar@symbiobc.com', NULL, 'omar@symbiobc.com',
    NULL, NULL, NULL, 'The item was received.'
),
(
    'Pectinase',
    NULL, '202380', 'Carolina', 'Carolina', 'Protein',
    NULL, 'General Grant', 'omar@symbiobc.com',
    NULL, NULL, NULL, NULL, NULL, NULL,
    'received', '100mL', 1, 'USD', 37.45, 0.00, 37.45,
    'https://www.carolina.com/cellular-physiology-enzymes/pectinase-100-ml/202380.pr',
    16.95,
    '2025-08-19', NULL, '2025-08-20', NULL, '2025-08-22',
    NULL, 'omar@symbiobc.com', NULL, 'omar@symbiobc.com',
    NULL, NULL, NULL, 'The item was received.'
),
(
    'Gallic acid, 98%',
    '149-91-7', 'AC410860050', 'Thermo Scientific Chemicals', 'Fisher Scientific', 'Chemical',
    'There is an additional $5.95 Shipping Fuel Surcharge.', 'General Grant', 'omar@symbiobc.com',
    NULL, 'JAMESENOTRICA/VC/081925', NULL, NULL, NULL, NULL,
    'received', '5g', 1, 'USD', 56.80, 6.38, 63.18,
    'https://www.fishersci.com/shop/products/gallic-acid-98-thermo-scientific/AC410860050',
    16.99,
    '2025-08-19', NULL, '2025-08-20', NULL, '2025-08-22',
    NULL, 'omar@symbiobc.com', NULL, 'omar@symbiobc.com',
    NULL, NULL, NULL, 'The item was received.'
);
