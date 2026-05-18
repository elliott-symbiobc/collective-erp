ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS activity_type TEXT;
-- email | call | document | meeting | todo
