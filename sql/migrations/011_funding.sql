-- 011_funding.sql
-- Funding opportunities tracker (grants, accelerators, pitch competitions).

CREATE TABLE IF NOT EXISTS funding_opportunities (
    opportunity_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title              TEXT NOT NULL,
    stage              TEXT NOT NULL DEFAULT 'Applied',  -- Applied | Rejected | Won | Pending | Withdrawn
    deadline           DATE,
    tags               TEXT[]  DEFAULT '{}',
    funding_type       TEXT,           -- Non-Dilutive | Dilutive | Variable | —
    amount             TEXT,           -- kept as text: "€12,500", "Up to $100K", "Variable"
    decision_date      TEXT,           -- flexible: "04/13/2026", "Mid-July", "unknown"
    funding_dispersion TEXT,
    source_link        TEXT,           -- URL or descriptive label
    notes              TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_funding_stage    ON funding_opportunities (stage);
CREATE INDEX IF NOT EXISTS idx_funding_deadline ON funding_opportunities (deadline);

-- ── Seed data ─────────────────────────────────────────────────────────────────

INSERT INTO funding_opportunities
    (title, stage, deadline, tags, funding_type, amount, decision_date, funding_dispersion, source_link, notes)
VALUES
(
    'Next Heroes in Food & Agtech',
    'Applied',
    '2026-04-08',
    ARRAY['Pitch Competition', 'Grant'],
    'Non-Dilutive',
    '€12,500',
    '04/13/2026',
    NULL,
    'https://www.fanext.com/startups/next-heroes-in-food-and-agtech/',
    NULL
),
(
    'MassChallenge Accelerator (UK and Switzerland)',
    'Applied',
    '2026-03-06',
    ARRAY['Accelerator'],
    'Non-Dilutive',
    'Variable',
    '04/13/2026',
    NULL,
    'https://masschallenge.org/programs/switzerland/',
    'Benefits and potential cash as prizes in internal activities'
),
(
    'OPEN INNOVATION CHALLENGE | M4D',
    'Applied',
    '2026-03-30',
    ARRAY['Accelerator', 'Africa Funding'],
    'Non-Dilutive',
    'Up to $360K',
    'Unknown',
    NULL,
    'https://m4d.eu/open-innovation-challenge/',
    '4 stages / phases'
),
(
    'Colab Tech 2026',
    'Applied',
    '2026-03-31',
    ARRAY['Accelerator', 'Partnership'],
    NULL,
    NULL,
    'Unknown',
    NULL,
    'https://colab.pt/colab-tech-2026/',
    'Climate Resilience Track'
),
(
    'Pilot Small Business Growth Fund',
    'Applied',
    '2026-03-31',
    ARRAY['Grant'],
    'Non-Dilutive',
    'Up to $50K',
    '04/28/2026',
    NULL,
    'https://app.helloalice.com/grants/pilot-small-business-growth-fund',
    'Targets small businesses'
),
(
    'THRIVE Academy Cohort VIII',
    'Rejected',
    '2026-03-31',
    ARRAY['Accelerator'],
    NULL,
    NULL,
    'Unknown',
    NULL,
    'https://thriveagrifood.com/thrive-academy/',
    'Refine business models, sharpen go-to-market strategies, become investor-ready through expert-led workshops, mentorship, and pitch preparation'
),
(
    'Arch Grants 2026 Startup Competition',
    'Applied',
    '2026-03-31',
    ARRAY['Pitch Competition', 'Grant'],
    'Non-Dilutive',
    'Up to $100K',
    'Mid-July',
    'End of August',
    'https://archgrants.org/startup-competition/',
    'Likely requires willingness to relocate to or operate in St. Louis, MO area'
),
(
    'World Food Forum | Startup Innovation Awards',
    'Applied',
    '2026-04-01',
    ARRAY['Pitch Competition', 'Grant'],
    'Non-Dilutive',
    '$10K',
    '04/13/2026',
    NULL,
    'https://www.fao.org/world-food-forum/en/',
    'Linked to MassChallenge accelerator'
),
(
    'FoodTech Innovation Awards 2026 – Food 4 Future',
    'Applied',
    '2026-04-06',
    ARRAY['Pitch Competition'],
    NULL,
    NULL,
    'Unknown',
    NULL,
    'https://www.food4future.com/en/foodtech-innovation-awards/',
    NULL
);