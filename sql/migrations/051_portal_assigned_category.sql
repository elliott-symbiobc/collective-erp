ALTER TABLE project_portals
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES users(user_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category    TEXT NOT NULL DEFAULT 'client';

ALTER TABLE project_portals
  DROP CONSTRAINT IF EXISTS project_portals_category_check;
ALTER TABLE project_portals
  ADD CONSTRAINT project_portals_category_check
    CHECK (category IN ('client', 'investor', 'partner'));

-- Expand notification constraints to support portal view events
ALTER TABLE task_notifications
  DROP CONSTRAINT IF EXISTS task_notifications_notification_type_check;
ALTER TABLE task_notifications
  ADD CONSTRAINT task_notifications_notification_type_check
    CHECK (notification_type IN (
      'task_assigned', 'project_assigned', 'task_due', 'deadline', 'portal_view'
    ));

ALTER TABLE task_notifications
  DROP CONSTRAINT IF EXISTS task_notifications_entity_type_check;
ALTER TABLE task_notifications
  ADD CONSTRAINT task_notifications_entity_type_check
    CHECK (entity_type IN ('task', 'project', 'portal'));
