-- FP&A: Plaid bank connection tokens
CREATE TABLE IF NOT EXISTS fpa_plaid_tokens (
    id               SERIAL PRIMARY KEY,
    access_token     TEXT        NOT NULL,
    item_id          TEXT        NOT NULL UNIQUE,
    institution_name TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active        BOOLEAN     NOT NULL DEFAULT TRUE
);

-- FP&A: Daily actuals pulled from Plaid
CREATE TABLE IF NOT EXISTS fpa_actuals (
    id               SERIAL PRIMARY KEY,
    pulled_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    cash_balance     NUMERIC(15,2) NOT NULL,
    monthly_inflow   NUMERIC(15,2) NOT NULL,
    monthly_outflow  NUMERIC(15,2) NOT NULL,
    net_burn         NUMERIC(15,2) NOT NULL,
    source           TEXT         NOT NULL DEFAULT 'plaid'
);

-- QBO OAuth tokens
CREATE TABLE IF NOT EXISTS fpa_qbo_tokens (
    id            SERIAL PRIMARY KEY,
    realm_id      TEXT        NOT NULL,
    realm_name    TEXT,
    access_token  TEXT        NOT NULL,
    refresh_token TEXT        NOT NULL,
    expires_at    TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE
);

-- QBO P&L actuals by period
CREATE TABLE IF NOT EXISTS fpa_qbo_periods (
    id           SERIAL PRIMARY KEY,
    pulled_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    period_start DATE          NOT NULL,
    period_end   DATE          NOT NULL,
    period_type  TEXT          NOT NULL DEFAULT 'monthly',
    revenue      NUMERIC(15,2) NOT NULL DEFAULT 0,
    expenses     NUMERIC(15,2) NOT NULL DEFAULT 0,
    net_income   NUMERIC(15,2) NOT NULL DEFAULT 0,
    raw_json     JSONB
);
