-- 019_system_design_costs.sql
-- Cost indices table for equipment cost estimation (CEPCI, BLS PPI, etc.)

CREATE TABLE IF NOT EXISTS cost_indices (
    index_id    SERIAL PRIMARY KEY,
    source      TEXT NOT NULL,        -- 'BLS', 'historical', 'manual'
    series_id   TEXT,                 -- BLS series ID e.g. 'WPU117'
    index_name  TEXT NOT NULL,        -- 'CEPCI_est', 'BLS_WPU117'
    index_value DECIMAL(10,4) NOT NULL,
    period_year INTEGER NOT NULL,
    period_month INTEGER,             -- NULL for annual
    fetched_at  TIMESTAMPTZ DEFAULT NOW(),
    notes       TEXT
);

-- Seed with CEPCI historical data (from Chemical Engineering magazine)
INSERT INTO cost_indices (source, series_id, index_name, index_value, period_year, notes) VALUES
('historical','CEPCI','CEPCI',394.3,2001,'Base year reference'),
('historical','CEPCI','CEPCI',468.2,2005,'Chemical Engineering magazine'),
('historical','CEPCI','CEPCI',550.8,2010,'Chemical Engineering magazine'),
('historical','CEPCI','CEPCI',576.1,2014,'Chemical Engineering magazine'),
('historical','CEPCI','CEPCI',607.5,2019,'Chemical Engineering magazine'),
('historical','CEPCI','CEPCI',596.2,2020,'Chemical Engineering magazine'),
('historical','CEPCI','CEPCI',708.0,2021,'Chemical Engineering magazine'),
('historical','CEPCI','CEPCI',816.0,2022,'Chemical Engineering magazine'),
('historical','CEPCI','CEPCI',800.8,2023,'Chemical Engineering magazine'),
('historical','CEPCI','CEPCI',820.0,2024,'Estimate based on BLS WPU117 trend');
