-- Add explicit priority field to tasks (low / medium / high)
-- NULL means "auto" (inferred from due date on the client).
ALTER TABLE tasks
    ADD COLUMN IF NOT EXISTS priority TEXT CHECK (priority IN ('low', 'medium', 'high'));
