-- 016_standalone_portals.sql — Allow portals without a project (data rooms)

-- Make project_id optional so a portal can exist independently
ALTER TABLE project_portals
  ALTER COLUMN project_id DROP NOT NULL;

-- Name for standalone portals (when no project is linked)
ALTER TABLE project_portals
  ADD COLUMN IF NOT EXISTS name TEXT;
