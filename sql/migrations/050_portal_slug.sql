ALTER TABLE project_portals
  ADD COLUMN IF NOT EXISTS slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS project_portals_slug_idx
  ON project_portals (slug)
  WHERE slug IS NOT NULL;
