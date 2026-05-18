-- 064_cap_table.sql — Carta-style cap table: rounds, holders, securities, documents

CREATE TABLE IF NOT EXISTS cap_table_rounds (
    round_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name               TEXT        NOT NULL,
    round_type         TEXT        NOT NULL DEFAULT 'safe',    -- safe | convertible_note | priced | option_pool | founders | warrant
    status             TEXT        NOT NULL DEFAULT 'open',    -- planned | open | closed
    close_date         DATE,
    pre_money_val      NUMERIC(18,2),
    amount_raised      NUMERIC(18,2),
    share_price        NUMERIC(18,6),
    new_shares_issued  BIGINT,
    lead_investor      TEXT,
    safe_cap           NUMERIC(18,2),
    discount_pct       NUMERIC(5,2),
    interest_rate_pct  NUMERIC(5,2),
    maturity_date      DATE,
    mfn                BOOLEAN     NOT NULL DEFAULT FALSE,
    pro_rata_rights    BOOLEAN     NOT NULL DEFAULT FALSE,
    board_seat         BOOLEAN     NOT NULL DEFAULT FALSE,
    notes              TEXT,
    sort_order         INTEGER     NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cap_table_holders (
    holder_id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name               TEXT        NOT NULL,
    holder_type        TEXT        NOT NULL DEFAULT 'investor', -- founder | investor | advisor | employee | option_pool
    email              TEXT,
    entity_name        TEXT,
    notes              TEXT,
    sort_order         INTEGER     NOT NULL DEFAULT 0,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cap_table_securities (
    security_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    holder_id          UUID        NOT NULL REFERENCES cap_table_holders(holder_id) ON DELETE CASCADE,
    round_id           UUID        REFERENCES cap_table_rounds(round_id) ON DELETE SET NULL,
    security_type      TEXT        NOT NULL DEFAULT 'common',  -- common | preferred | safe | convertible_note | option | warrant
    share_class        TEXT,
    shares             BIGINT,
    investment_amount  NUMERIC(18,2),
    price_per_share    NUMERIC(18,6),
    grant_date         DATE,
    vesting_schedule   TEXT,
    cliff_months       INTEGER,
    fully_vested_date  DATE,
    safe_cap           NUMERIC(18,2),
    discount_pct       NUMERIC(5,2),
    notes              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cap_table_documents (
    document_id        UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    holder_id          UUID        REFERENCES cap_table_holders(holder_id) ON DELETE CASCADE,
    round_id           UUID        REFERENCES cap_table_rounds(round_id) ON DELETE CASCADE,
    doc_type           TEXT        NOT NULL DEFAULT 'safe',    -- safe | side_letter | term_sheet | subscription_agreement | voting_agreement | ipa | board_consent | pro_rata | other
    name               TEXT        NOT NULL,
    url                TEXT,
    drive_file_id      TEXT,
    signed_date        DATE,
    notes              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cap_securities_holder ON cap_table_securities (holder_id);
CREATE INDEX IF NOT EXISTS idx_cap_securities_round  ON cap_table_securities (round_id);
CREATE INDEX IF NOT EXISTS idx_cap_docs_holder        ON cap_table_documents  (holder_id);
CREATE INDEX IF NOT EXISTS idx_cap_docs_round         ON cap_table_documents  (round_id);
