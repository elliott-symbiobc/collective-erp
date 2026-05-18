-- 044_notifications.sql
-- Task/project assignment notifications with approve/deny workflow
-- Notification preferences (email, SMS) stored on users table

BEGIN;

CREATE TABLE IF NOT EXISTS task_notifications (
    notification_id  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    sender_id        UUID REFERENCES users(user_id) ON DELETE SET NULL,
    notification_type TEXT NOT NULL CHECK (notification_type IN ('task_assigned', 'project_assigned', 'task_due', 'deadline')),
    entity_type      TEXT NOT NULL CHECK (entity_type IN ('task', 'project')),
    entity_id        UUID NOT NULL,
    title            TEXT NOT NULL,
    message          TEXT,           -- optional note from sender
    status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'read')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    read_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_task_notifications_recipient ON task_notifications (recipient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_notifications_entity ON task_notifications (entity_type, entity_id);

-- Add notification preference columns to users if not present
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_email BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_sms   BOOLEAN NOT NULL DEFAULT false;

COMMIT;
