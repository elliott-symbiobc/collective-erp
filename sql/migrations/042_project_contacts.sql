-- Multiple contacts per project with roles
CREATE TABLE IF NOT EXISTS project_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    contact_id UUID NOT NULL REFERENCES contacts(contact_id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'contact',
    is_primary BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_project_contacts_project ON project_contacts(project_id);
CREATE INDEX IF NOT EXISTS idx_project_contacts_contact ON project_contacts(contact_id);

-- Seed existing primary contacts into the junction table
INSERT INTO project_contacts (project_id, contact_id, role, is_primary)
SELECT project_id, contact_id, 'primary', TRUE
FROM projects
WHERE contact_id IS NOT NULL
ON CONFLICT (project_id, contact_id) DO NOTHING;

-- Allow editing contact_interactions (add updated_at column)
ALTER TABLE contact_interactions
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
