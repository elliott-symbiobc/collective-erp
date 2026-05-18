-- Track when the last advisor update email was sent per advisor
ALTER TABLE contact_advisors
    ADD COLUMN IF NOT EXISTS last_update_sent_at TIMESTAMPTZ;
