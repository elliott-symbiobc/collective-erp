-- Tracks individual advisor update emails for open-rate monitoring
CREATE TABLE IF NOT EXISTS advisor_email_sends (
    send_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    advisor_id      UUID NOT NULL REFERENCES contact_advisors(advisor_id) ON DELETE CASCADE,
    contact_id      UUID NOT NULL,
    subject         TEXT NOT NULL,
    sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    first_opened_at TIMESTAMPTZ,
    open_count      INT NOT NULL DEFAULT 0,
    gmail_message_id TEXT
);

CREATE INDEX IF NOT EXISTS advisor_email_sends_advisor_idx ON advisor_email_sends(advisor_id);
