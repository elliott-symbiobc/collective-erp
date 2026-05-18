CREATE TABLE IF NOT EXISTS fpa_qbo_expense_categories (
    id          SERIAL PRIMARY KEY,
    pulled_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    period_start DATE NOT NULL,
    period_end   DATE NOT NULL,
    categories  JSONB NOT NULL DEFAULT '[]'
);
