-- 052_messaging_and_suggestions.sql
-- Internal messaging (channels, members, messages) + task suggestion upgrades
-- Portal messaging enable flag

BEGIN;

-- ── Internal messaging ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS message_channels (
    channel_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT,                    -- null for DMs
    channel_type  TEXT NOT NULL DEFAULT 'group'
                  CHECK (channel_type IN ('direct', 'group', 'announcement')),
    created_by    UUID REFERENCES users(user_id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS channel_members (
    channel_id  UUID NOT NULL REFERENCES message_channels(channel_id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    joined_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_read_at TIMESTAMPTZ,
    PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS channel_messages (
    message_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id      UUID NOT NULL REFERENCES message_channels(channel_id) ON DELETE CASCADE,
    sender_id       UUID REFERENCES users(user_id) ON DELETE SET NULL,
    sender_name     TEXT,                   -- denorm for portal senders who have no user row
    body            TEXT NOT NULL,
    is_announcement BOOLEAN NOT NULL DEFAULT false,
    portal_token    TEXT,                   -- set when message comes from a portal viewer
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_channel_messages_channel ON channel_messages (channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_channel_members_user     ON channel_members (user_id);

-- ── Portal messaging flag ─────────────────────────────────────────────────────

ALTER TABLE project_portals
  ADD COLUMN IF NOT EXISTS messaging_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS messaging_channel_id UUID REFERENCES message_channels(channel_id) ON DELETE SET NULL;

-- ── Upgrade email_followup_suggestions ────────────────────────────────────────
-- Add richer task metadata so suggestions can become proper typed tasks

ALTER TABLE email_followup_suggestions
  ADD COLUMN IF NOT EXISTS task_type TEXT DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS title     TEXT,
  ADD COLUMN IF NOT EXISTS priority  TEXT DEFAULT 'medium';

-- phone column on users (may already exist — safe with IF NOT EXISTS path)
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;

-- Expand notification types to include messaging
ALTER TABLE task_notifications
  DROP CONSTRAINT IF EXISTS task_notifications_notification_type_check;
ALTER TABLE task_notifications
  ADD CONSTRAINT task_notifications_notification_type_check
    CHECK (notification_type IN (
      'task_assigned', 'project_assigned', 'task_due', 'deadline',
      'portal_view', 'new_message'
    ));

COMMIT;
