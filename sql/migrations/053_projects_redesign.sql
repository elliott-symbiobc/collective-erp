-- Migration 053: Projects module redesign
-- Adds: milestones, dependencies, multi-user assignees, resources,
--       templates, strategic goals, project detail configs, reminder templates
-- Modifies: projects (stage_config, template_id), tasks (milestone_id)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. PROJECT TEMPLATES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_templates (
    template_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT NOT NULL,
    description   TEXT,
    project_type  TEXT NOT NULL,  -- portfolio | partnership | grant | internal
    is_default    BOOLEAN NOT NULL DEFAULT false,
    is_shared     BOOLEAN NOT NULL DEFAULT true,
    created_by    UUID REFERENCES users(user_id) ON DELETE SET NULL,
    config        JSONB DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS template_milestones (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id           UUID NOT NULL REFERENCES project_templates(template_id) ON DELETE CASCADE,
    parent_id             UUID REFERENCES template_milestones(id) ON DELETE SET NULL,
    title                 TEXT NOT NULL,
    description           TEXT,
    milestone_type        TEXT NOT NULL DEFAULT 'objective',
    -- objective | checkpoint | deliverable | approval | external_wait | repeating
    sort_order            INTEGER NOT NULL DEFAULT 0,
    default_duration_days INTEGER,
    integrations          JSONB DEFAULT '{}',
    -- {protocols: true, lab: true, runs: true, invoices: true, portals: true, system_design: true}
    auto_reminder_config  JSONB DEFAULT '{}',
    -- {enabled: true, trigger_type: "waiting_response", days: 3, message_template: "..."}
    document_deliverable  BOOLEAN NOT NULL DEFAULT false,
    is_blocking           BOOLEAN NOT NULL DEFAULT false,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_template_milestones_template ON template_milestones(template_id);
CREATE INDEX IF NOT EXISTS idx_template_milestones_sort ON template_milestones(template_id, sort_order);

CREATE TABLE IF NOT EXISTS template_tasks (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_milestone_id  UUID NOT NULL REFERENCES template_milestones(id) ON DELETE CASCADE,
    title                  TEXT NOT NULL,
    description            TEXT,
    activity_type          TEXT,  -- email | call | document | meeting | todo
    sort_order             INTEGER NOT NULL DEFAULT 0,
    estimated_minutes      INTEGER,
    integrations           JSONB DEFAULT '{}',
    created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_template_tasks_milestone ON template_tasks(template_milestone_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. PROJECT MILESTONES (intermediate level: project → milestone → tasks)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_milestones (
    milestone_id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id            UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    parent_milestone_id   UUID REFERENCES project_milestones(milestone_id) ON DELETE SET NULL,
    template_milestone_id UUID REFERENCES template_milestones(id) ON DELETE SET NULL,
    title                 TEXT NOT NULL,
    description           TEXT,
    milestone_type        TEXT NOT NULL DEFAULT 'objective',
    status                TEXT NOT NULL DEFAULT 'pending',
    -- pending | in_progress | blocked | complete | skipped | waiting_external
    due_date              DATE,
    start_date            DATE,
    completed_at          TIMESTAMPTZ,
    owner_id              UUID REFERENCES users(user_id) ON DELETE SET NULL,
    sort_order            INTEGER NOT NULL DEFAULT 0,
    integration_refs      JSONB DEFAULT '{}',
    -- {run_id: "...", protocol_id: "...", portal_id: "...", invoice_id: "..."}
    auto_reminder_config  JSONB DEFAULT '{}',
    document_deliverable  BOOLEAN NOT NULL DEFAULT false,
    drive_file_id         TEXT,
    drive_file_name       TEXT,
    created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_milestones_project ON project_milestones(project_id);
CREATE INDEX IF NOT EXISTS idx_project_milestones_status ON project_milestones(project_id, status);
CREATE INDEX IF NOT EXISTS idx_project_milestones_due ON project_milestones(due_date) WHERE due_date IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. MILESTONE ASSIGNEES (many-to-many)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS milestone_assignees (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    milestone_id UUID NOT NULL REFERENCES project_milestones(milestone_id) ON DELETE CASCADE,
    user_id      UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role         TEXT NOT NULL DEFAULT 'assignee',  -- assignee | reviewer | observer
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (milestone_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_milestone_assignees_milestone ON milestone_assignees(milestone_id);
CREATE INDEX IF NOT EXISTS idx_milestone_assignees_user ON milestone_assignees(user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. MILESTONE DEPENDENCIES (blocking graph)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS milestone_dependencies (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    milestone_id              UUID NOT NULL REFERENCES project_milestones(milestone_id) ON DELETE CASCADE,
    depends_on_milestone_id   UUID NOT NULL REFERENCES project_milestones(milestone_id) ON DELETE CASCADE,
    dependency_type           TEXT NOT NULL DEFAULT 'finish_to_start',
    created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (milestone_id, depends_on_milestone_id),
    CHECK (milestone_id != depends_on_milestone_id)
);

CREATE INDEX IF NOT EXISTS idx_milestone_deps_milestone ON milestone_dependencies(milestone_id);
CREATE INDEX IF NOT EXISTS idx_milestone_deps_depends_on ON milestone_dependencies(depends_on_milestone_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. TASK ASSIGNEES (many-to-many, supplements existing tasks.assigned_to)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_assignees (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id    UUID NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    user_id    UUID NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role       TEXT NOT NULL DEFAULT 'assignee',  -- assignee | reviewer | observer
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (task_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_task_assignees_task ON task_assignees(task_id);
CREATE INDEX IF NOT EXISTS idx_task_assignees_user ON task_assignees(user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. TASK DEPENDENCIES (blocking graph)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS task_dependencies (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id             UUID NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    depends_on_task_id  UUID NOT NULL REFERENCES tasks(task_id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (task_id, depends_on_task_id),
    CHECK (task_id != depends_on_task_id)
);

CREATE INDEX IF NOT EXISTS idx_task_deps_task ON task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_deps_depends_on ON task_dependencies(depends_on_task_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. PROJECT RESOURCES (labor / capital / equipment / lab)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_resources (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id        UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    milestone_id      UUID REFERENCES project_milestones(milestone_id) ON DELETE SET NULL,
    resource_type     TEXT NOT NULL,
    -- labor | capital | equipment | lab_space | consumables | external
    label             TEXT NOT NULL,
    quantity          NUMERIC,
    unit              TEXT,
    start_date        DATE,
    end_date          DATE,
    cost_estimate     NUMERIC(14,2),
    assigned_user_id  UUID REFERENCES users(user_id) ON DELETE SET NULL,
    equipment_id      UUID,  -- soft FK to equipment table
    notes             TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_resources_project ON project_resources(project_id);
CREATE INDEX IF NOT EXISTS idx_project_resources_milestone ON project_resources(milestone_id) WHERE milestone_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. STRATEGIC GOALS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS strategic_goals (
    goal_id      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title        TEXT NOT NULL,
    description  TEXT,
    category     TEXT,  -- revenue | r_and_d | partnerships | funding | operations | regulatory
    target_date  DATE,
    status       TEXT NOT NULL DEFAULT 'active',  -- active | achieved | deferred | cancelled
    owner_id     UUID REFERENCES users(user_id) ON DELETE SET NULL,
    sort_order   INTEGER NOT NULL DEFAULT 0,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_goal_links (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id          UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    goal_id             UUID NOT NULL REFERENCES strategic_goals(goal_id) ON DELETE CASCADE,
    contribution_notes  TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, goal_id)
);

CREATE INDEX IF NOT EXISTS idx_project_goal_links_project ON project_goal_links(project_id);
CREATE INDEX IF NOT EXISTS idx_project_goal_links_goal ON project_goal_links(goal_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. PROJECT DETAIL CONFIGS (custom UI panel layouts, shared)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_detail_configs (
    config_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    project_type TEXT,  -- null = applies to all types
    is_default   BOOLEAN NOT NULL DEFAULT false,
    is_shared    BOOLEAN NOT NULL DEFAULT true,
    created_by   UUID REFERENCES users(user_id) ON DELETE SET NULL,
    config       JSONB NOT NULL DEFAULT '{}',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_detail_configs_type ON project_detail_configs(project_type) WHERE project_type IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 10. REMINDER TEMPLATES (auto follow-up messages)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS reminder_templates (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name              TEXT NOT NULL,
    project_type      TEXT,  -- null = all types
    trigger_type      TEXT NOT NULL,
    -- waiting_response | milestone_overdue | task_overdue | stage_stale | no_interaction
    trigger_days      INTEGER NOT NULL DEFAULT 3,
    subject_template  TEXT,
    message_template  TEXT,
    auto_send         BOOLEAN NOT NULL DEFAULT false,  -- false = prompt user, true = send automatically
    is_active         BOOLEAN NOT NULL DEFAULT true,
    created_by        UUID REFERENCES users(user_id) ON DELETE SET NULL,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ─────────────────────────────────────────────────────────────────────────────
-- 11. FP&A CONTRACT LINKS
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS project_fpa_links (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id       UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
    -- contract_entry_ref is the index into fpa_model.contract_pipeline JSONB array
    -- stored as a stable label/name since JSONB arrays don't have UUIDs
    contract_label   TEXT NOT NULL,
    contract_type    TEXT,
    link_notes       TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (project_id, contract_label)
);

CREATE INDEX IF NOT EXISTS idx_project_fpa_links_project ON project_fpa_links(project_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 12. ALTER EXISTING TABLES
-- ─────────────────────────────────────────────────────────────────────────────

-- Add milestone_id to personal tasks
ALTER TABLE tasks ADD COLUMN IF NOT EXISTS milestone_id UUID REFERENCES project_milestones(milestone_id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_milestone ON tasks(milestone_id) WHERE milestone_id IS NOT NULL;

-- Add template_id to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES project_templates(template_id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS template_applied_at TIMESTAMPTZ;

-- Add crm_deal_id to projects (for auto-create from CRM)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS crm_deal_id UUID REFERENCES crm_deals(deal_id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_crm_deal ON projects(crm_deal_id) WHERE crm_deal_id IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 13. SEED: DEFAULT PROJECT DETAIL CONFIGS
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO project_detail_configs (name, project_type, is_default, config) VALUES
(
    'Portfolio / Client Default',
    'portfolio',
    true,
    '{
        "panels": [
            {"id": "status_bar",        "label": "Status",              "visible": true,  "order": 0},
            {"id": "milestones",        "label": "Milestones",          "visible": true,  "order": 1},
            {"id": "active_tasks",      "label": "Active Tasks",        "visible": true,  "order": 2},
            {"id": "resources",         "label": "Resources",           "visible": true,  "order": 3},
            {"id": "communication",     "label": "Emails & Activity",   "visible": true,  "order": 4},
            {"id": "documents",         "label": "Document Deliverables","visible": true, "order": 5},
            {"id": "strategic",         "label": "Strategic Planning",  "visible": true,  "order": 6},
            {"id": "funding_agent",     "label": "Funding Agent",       "visible": true,  "order": 7},
            {"id": "contacts",          "label": "Contacts",            "visible": true,  "order": 8},
            {"id": "related",           "label": "Related Projects",    "visible": true,  "order": 9}
        ]
    }'::jsonb
),
(
    'Partnership Default',
    'partnership',
    true,
    '{
        "panels": [
            {"id": "status_bar",        "label": "Status",              "visible": true,  "order": 0},
            {"id": "contacts",          "label": "Contacts",            "visible": true,  "order": 1},
            {"id": "milestones",        "label": "Milestones",          "visible": true,  "order": 2},
            {"id": "communication",     "label": "Emails & Activity",   "visible": true,  "order": 3},
            {"id": "resources",         "label": "Resources",           "visible": true,  "order": 4},
            {"id": "documents",         "label": "Document Deliverables","visible": true, "order": 5},
            {"id": "strategic",         "label": "Strategic Planning",  "visible": false, "order": 6},
            {"id": "funding_agent",     "label": "Funding Agent",       "visible": false, "order": 7},
            {"id": "related",           "label": "Related Projects",    "visible": true,  "order": 8}
        ]
    }'::jsonb
),
(
    'Grant / Funding Default',
    'grant',
    true,
    '{
        "panels": [
            {"id": "status_bar",        "label": "Status",              "visible": true,  "order": 0},
            {"id": "milestones",        "label": "Milestones & Checklist","visible": true,"order": 1},
            {"id": "active_tasks",      "label": "Active Tasks",        "visible": true,  "order": 2},
            {"id": "funding_agent",     "label": "Funding Details",     "visible": true,  "order": 3},
            {"id": "documents",         "label": "Document Deliverables","visible": true, "order": 4},
            {"id": "communication",     "label": "Emails & Activity",   "visible": true,  "order": 5},
            {"id": "contacts",          "label": "Contacts",            "visible": true,  "order": 6},
            {"id": "strategic",         "label": "Strategic Planning",  "visible": true,  "order": 7}
        ]
    }'::jsonb
),
(
    'Internal R&D Default',
    'internal',
    true,
    '{
        "panels": [
            {"id": "status_bar",        "label": "Status",              "visible": true,  "order": 0},
            {"id": "milestones",        "label": "Milestones",          "visible": true,  "order": 1},
            {"id": "active_tasks",      "label": "Active Tasks",        "visible": true,  "order": 2},
            {"id": "resources",         "label": "Resources",           "visible": true,  "order": 3},
            {"id": "communication",     "label": "Experiments & Runs",  "visible": true,  "order": 4},
            {"id": "documents",         "label": "Reports & Deliverables","visible": true,"order": 5},
            {"id": "strategic",         "label": "Strategic Planning",  "visible": true,  "order": 6},
            {"id": "contacts",          "label": "Contacts",            "visible": false, "order": 7}
        ]
    }'::jsonb
)
ON CONFLICT DO NOTHING;


-- ─────────────────────────────────────────────────────────────────────────────
-- 14. SEED: PORTFOLIO PROJECT TEMPLATE
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
    v_template_id UUID;
    -- Phase milestone IDs
    m_discovery       UUID;
    m_assessment      UUID;
    m_portal          UUID;
    m_sample_setup    UUID;
    m_exp_work        UUID;
    m_tech_deliverable UUID;
    m_proposal_review UUID;
    m_legal           UUID;
    m_legal_cycle     UUID;
    m_contract_exec   UUID;
    m_rd_kickoff      UUID;
    m_rd_active       UUID;
    m_rd_poc          UUID;
    m_rd_lab_scale    UUID;
    m_rd_pilot        UUID;
    m_rd_commercial   UUID;
BEGIN
    -- Insert the template
    INSERT INTO project_templates (name, description, project_type, is_default, is_shared, config)
    VALUES (
        'Portfolio / Client Project',
        'Full lifecycle for client-facing R&D and portfolio projects from discovery through production.',
        'portfolio',
        true,
        true,
        '{"stage_sequence": ["Prospect","Qualified","Assessment","Proposal","Legal","Contracted","R&D","Pilot","Production"]}'::jsonb
    )
    ON CONFLICT DO NOTHING
    RETURNING template_id INTO v_template_id;

    IF v_template_id IS NULL THEN
        RETURN;  -- already seeded
    END IF;

    -- ── Phase 1: Discovery & Qualification ───────────────────────────────────
    INSERT INTO template_milestones (template_id, title, description, milestone_type, sort_order, default_duration_days, integrations)
    VALUES (v_template_id, 'Discovery & Qualification', 'CRM-driven. Log opportunity and qualify before advancing.', 'objective', 0, 14,
            '{"crm": true}'::jsonb)
    RETURNING id INTO m_discovery;

    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order) VALUES
    (m_discovery, 'Log opportunity in CRM', 'todo', 0),
    (m_discovery, 'Schedule initial meeting', 'meeting', 1),
    (m_discovery, 'Conduct initial meeting — determine interest', 'meeting', 2),
    (m_discovery, 'Qualify opportunity and document key parameters', 'document', 3),
    (m_discovery, 'Move CRM deal to Qualified stage', 'todo', 4);

    -- ── Phase 2: Initial Assessment ──────────────────────────────────────────
    INSERT INTO template_milestones (template_id, title, description, milestone_type, sort_order, default_duration_days, integrations)
    VALUES (v_template_id, 'Initial Assessment', 'Perform preliminary TEA and system design.', 'objective', 1, 21,
            '{"analyses": true, "system_design": true}'::jsonb)
    RETURNING id INTO m_assessment;

    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order, estimated_minutes) VALUES
    (m_assessment, 'Perform initial technoeconomic analysis (TEA)', 'document', 0, 240),
    (m_assessment, 'Draft initial system design (placeholder — System Design module)', 'document', 1, 180),
    (m_assessment, 'Internal review of TEA and system design', 'meeting', 2, 60);

    -- ── Phase 3: Proposal & Portal ───────────────────────────────────────────
    INSERT INTO template_milestones (template_id, title, description, milestone_type, sort_order, default_duration_days,
                                     integrations, auto_reminder_config)
    VALUES (v_template_id, 'Proposal & Portal', 'Create and send portal. Await client response.', 'external_wait', 2, 21,
            '{"portals": true}'::jsonb,
            '{"enabled": true, "trigger_type": "waiting_response", "days": 5,
              "subject_template": "Following up on our proposal — {{project_name}}",
              "message_template": "Hi {{contact_name}},\n\nI wanted to follow up on the proposal we sent for {{project_name}}. Please let me know if you have any questions or would like to schedule a call.\n\nBest regards"}'::jsonb)
    RETURNING id INTO m_portal;

    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order) VALUES
    (m_portal, 'Create client portal', 'todo', 0),
    (m_portal, 'Send portal link to client', 'email', 1),
    (m_portal, 'Follow up if no response within 5 days', 'email', 2),
    (m_portal, 'Record client response / feedback', 'todo', 3);

    -- ── Phase 4: Sample Analysis Setup ───────────────────────────────────────
    INSERT INTO template_milestones (template_id, title, description, milestone_type, sort_order, default_duration_days, integrations)
    VALUES (v_template_id, 'Sample Analysis Setup', 'Invoice for preliminary analysis, receive sample, set up protocols.', 'checkpoint', 3, 14,
            '{"invoices": true, "protocols": true}'::jsonb)
    RETURNING id INTO m_sample_setup;

    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order) VALUES
    (m_sample_setup, 'Generate and send invoice for preliminary sample analysis', 'todo', 0),
    (m_sample_setup, 'Receive and log sample', 'todo', 1),
    (m_sample_setup, 'Create sample analysis protocols', 'document', 2),
    (m_sample_setup, 'Prepare lab for sample receipt', 'todo', 3);

    -- ── Phase 5: Experimental Work ───────────────────────────────────────────
    INSERT INTO template_milestones (template_id, title, description, milestone_type, sort_order, default_duration_days, integrations)
    VALUES (v_template_id, 'Experimental Work', 'Execute sample analysis per protocols. Analyze and visualize data.', 'objective', 4, 30,
            '{"runs": true, "lab_inventory": true, "protocols": true}'::jsonb)
    RETURNING id INTO m_exp_work;

    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order) VALUES
    (m_exp_work, 'Set up lab inventory for experiment', 'todo', 0),
    (m_exp_work, 'Execute experimental runs per protocols', 'todo', 1),
    (m_exp_work, 'Log run data in Experiments module', 'todo', 2),
    (m_exp_work, 'Analyze experimental data', 'document', 3),
    (m_exp_work, 'Create data visualizations', 'document', 4);

    -- ── Phase 6: Technical Deliverables ──────────────────────────────────────
    INSERT INTO template_milestones (template_id, title, description, milestone_type, sort_order, default_duration_days, integrations,
                                     document_deliverable)
    VALUES (v_template_id, 'Technical Deliverables', 'Detailed TEA, system simulation, LCA, and Comprehensive Development Proposal.', 'deliverable', 5, 21,
            '{"analyses": true, "system_design": true}'::jsonb, true)
    RETURNING id INTO m_tech_deliverable;

    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order, estimated_minutes) VALUES
    (m_tech_deliverable, 'Perform detailed technoeconomic analysis', 'document', 0, 360),
    (m_tech_deliverable, 'Build system simulation (System Designer)', 'document', 1, 480),
    (m_tech_deliverable, 'Perform Life Cycle Assessment (LCA) — placeholder module', 'document', 2, 240),
    (m_tech_deliverable, 'Produce Comprehensive Development Proposal', 'document', 3, 480),
    (m_tech_deliverable, 'Internal review of all deliverables', 'meeting', 4, 90),
    (m_tech_deliverable, 'Send Comprehensive Development Proposal to client', 'email', 5, NULL);

    -- ── Phase 7: Proposal Review ─────────────────────────────────────────────
    INSERT INTO template_milestones (template_id, title, description, milestone_type, sort_order, default_duration_days,
                                     auto_reminder_config)
    VALUES (v_template_id, 'Proposal Review', 'Client reviews proposal. Schedule meeting if needed. Move toward contract.', 'external_wait', 6, 21,
            '{"enabled": true, "trigger_type": "waiting_response", "days": 7,
              "subject_template": "Following up on Development Proposal — {{project_name}}",
              "message_template": "Hi {{contact_name}},\n\nI wanted to check in on the Comprehensive Development Proposal we shared for {{project_name}}. We would love to schedule a call to walk through our findings and discuss next steps.\n\nBest regards"}'::jsonb)
    RETURNING id INTO m_proposal_review;

    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order) VALUES
    (m_proposal_review, 'Follow up if no response within 7 days', 'email', 0),
    (m_proposal_review, 'Client meeting to review proposal (if requested)', 'meeting', 1),
    (m_proposal_review, 'Address client questions / revisions', 'document', 2),
    (m_proposal_review, 'Prepare contract and Joint Development Agreement (JDA)', 'document', 3),
    (m_proposal_review, 'Send contract + JDA to client', 'email', 4);

    -- ── Phase 8: Legal Negotiation (repeating cycle) ──────────────────────────
    INSERT INTO template_milestones (template_id, title, description, milestone_type, sort_order, default_duration_days,
                                     auto_reminder_config)
    VALUES (v_template_id, 'Legal Negotiation', 'Iterative legal review cycle until both parties agree. May repeat.', 'approval', 7, 30,
            '{"enabled": true, "trigger_type": "waiting_response", "days": 10,
              "subject_template": "Following up on contract review — {{project_name}}",
              "message_template": "Hi {{contact_name}},\n\nI wanted to follow up on the contract documents we sent for {{project_name}}. Please let me know if your legal team has had a chance to review them.\n\nBest regards"}'::jsonb)
    RETURNING id INTO m_legal;

    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order) VALUES
    (m_legal, 'Client legal department reviews contract + JDA', 'todo', 0),
    (m_legal, 'Receive redlined version from client legal', 'email', 1),
    (m_legal, 'SBC drafts response to redlines', 'document', 2),
    (m_legal, 'Submit response to SBC legal advisor for review/approval', 'email', 3),
    (m_legal, 'Incorporate legal advisor edits', 'document', 4),
    (m_legal, 'Send revised contract to client', 'email', 5),
    (m_legal, '[Repeat cycle if needed] Await client response', 'todo', 6);

    -- ── Phase 9: Contract Execution ───────────────────────────────────────────
    INSERT INTO template_milestones (template_id, title, description, milestone_type, sort_order, default_duration_days,
                                     document_deliverable)
    VALUES (v_template_id, 'Contract Execution', 'Final e-signature and distribution of executed contract.', 'checkpoint', 8, 7, true)
    RETURNING id INTO m_contract_exec;

    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order) VALUES
    (m_contract_exec, 'Prepare final PDF for e-signature (DocuSign / external)', 'document', 0),
    (m_contract_exec, 'Send final contract via e-signature platform', 'email', 1),
    (m_contract_exec, 'Receive executed copy', 'todo', 2),
    (m_contract_exec, 'Distribute executed copies to all parties', 'email', 3),
    (m_contract_exec, 'File executed contract in Drive', 'todo', 4);

    -- ── Phase 10: R&D Kickoff ─────────────────────────────────────────────────
    INSERT INTO template_milestones (template_id, title, description, milestone_type, sort_order, default_duration_days,
                                     integrations, document_deliverable)
    VALUES (v_template_id, 'R&D Kickoff', 'Develop R&D Plan and Experimental Schedule. Connect with calendars and inventory.', 'deliverable', 9, 14,
            '{"lab_inventory": true, "calendar": true}'::jsonb, true)
    RETURNING id INTO m_rd_kickoff;

    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order) VALUES
    (m_rd_kickoff, 'Develop R&D Plan (document deliverable)', 'document', 0),
    (m_rd_kickoff, 'Build Experimental Schedule (link to employee calendars)', 'document', 1),
    (m_rd_kickoff, 'Allocate lab inventory and consumables', 'todo', 2),
    (m_rd_kickoff, 'Kick-off meeting with R&D team', 'meeting', 3),
    (m_rd_kickoff, 'Send kick-off summary to client', 'email', 4);

    -- ── Phase 11: Active R&D (recurring reporting) ────────────────────────────
    INSERT INTO template_milestones (template_id, title, description, milestone_type, sort_order, default_duration_days)
    VALUES (v_template_id, 'Active R&D — Ongoing Reporting', 'Recurring internal reports and client updates throughout R&D phase.', 'repeating', 10, NULL)
    RETURNING id INTO m_rd_active;

    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order) VALUES
    (m_rd_active, 'Prepare weekly internal R&D report', 'document', 0),
    (m_rd_active, 'Present weekly report to internal team', 'meeting', 1),
    (m_rd_active, 'Send weekly / monthly update to client', 'email', 2),
    (m_rd_active, 'Prepare milestone report at each R&D milestone', 'document', 3),
    (m_rd_active, 'Send milestone report to client with meeting request', 'email', 4),
    (m_rd_active, 'Client milestone meeting (termination / change / continuation decision)', 'meeting', 5);

    -- ── Phase 12: R&D — Proof of Concept ─────────────────────────────────────
    INSERT INTO template_milestones (template_id, title, description, milestone_type, sort_order, default_duration_days,
                                     integrations, document_deliverable)
    VALUES (v_template_id, 'R&D — Proof of Concept', 'Literature review, initial PoC experiments, regulatory evaluation, preliminary system design.', 'deliverable', 11, 60,
            '{"runs": true, "lab_inventory": true, "system_design": true, "protocols": true}'::jsonb, true)
    RETURNING id INTO m_rd_poc;

    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order, estimated_minutes) VALUES
    (m_rd_poc, 'Experimental & Resource Schedule', 'document', 0, 180),
    (m_rd_poc, 'Literature review', 'document', 1, 480),
    (m_rd_poc, 'Design initial PoC experiments (minimum scale, cheapest assays)', 'document', 2, 120),
    (m_rd_poc, 'Execute PoC experiments in Experiments module', 'todo', 3, NULL),
    (m_rd_poc, 'Log PoC run data', 'todo', 4, NULL),
    (m_rd_poc, 'Regulatory, safety & compliance evaluation', 'document', 5, 240),
    (m_rd_poc, 'Preliminary bioSTEAM system design (System Designer)', 'document', 6, 360),
    (m_rd_poc, 'Produce PoC Report + Initial System Design (document deliverable)', 'document', 7, 480),
    (m_rd_poc, 'Internal review of PoC report', 'meeting', 8, 60),
    (m_rd_poc, 'Send PoC report to client for approval', 'email', 9, NULL),
    (m_rd_poc, 'Client approval received', 'todo', 10, NULL);

    -- ── Phase 13: R&D — Lab-Scale ─────────────────────────────────────────────
    INSERT INTO template_milestones (template_id, title, description, milestone_type, sort_order, default_duration_days,
                                     integrations, document_deliverable)
    VALUES (v_template_id, 'R&D — Lab-Scale Testing & MVP', 'Lab-scale flask testing to generate small viable samples. Quote for pilot.', 'deliverable', 12, 60,
            '{"runs": true, "lab_inventory": true, "protocols": true}'::jsonb, true)
    RETURNING id INTO m_rd_lab_scale;

    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order, estimated_minutes) VALUES
    (m_rd_lab_scale, 'Design lab-scale flask testing protocols', 'document', 0, 180),
    (m_rd_lab_scale, 'Execute lab-scale experiments', 'todo', 1, NULL),
    (m_rd_lab_scale, 'Produce small viable samples (MVP)', 'todo', 2, NULL),
    (m_rd_lab_scale, 'Analyze lab-scale results', 'document', 3, 240),
    (m_rd_lab_scale, 'Produce Lab-Scale Results Report (document deliverable)', 'document', 4, 360),
    (m_rd_lab_scale, 'Generate quote for pilot-scale testing', 'document', 5, 120),
    (m_rd_lab_scale, 'Send lab results report + pilot quote to client', 'email', 6, NULL),
    (m_rd_lab_scale, 'Await client response on pilot testing', 'todo', 7, NULL);

    -- ── Phase 14: R&D — Pilot Scale ───────────────────────────────────────────
    INSERT INTO template_milestones (template_id, title, description, milestone_type, sort_order, default_duration_days,
                                     integrations, document_deliverable)
    VALUES (v_template_id, 'R&D — Pilot-Scale Testing & System Design', 'Pilot testing (internal or IBRL). Full system design. RFQ process.', 'deliverable', 13, 90,
            '{"runs": true, "system_design": true}'::jsonb, true)
    RETURNING id INTO m_rd_pilot;

    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order, estimated_minutes) VALUES
    (m_rd_pilot, 'Plan pilot-scale testing (internal vs IBRL decision)', 'meeting', 0, 60),
    (m_rd_pilot, 'Execute pilot-scale testing', 'todo', 1, NULL),
    (m_rd_pilot, 'Comprehensive system design (System Designer)', 'document', 2, 480),
    (m_rd_pilot, 'Send RFQ to suppliers, logistics, installers, integrators', 'email', 3, NULL),
    (m_rd_pilot, 'Evaluate RFQs and compare bids', 'document', 4, 240),
    (m_rd_pilot, 'Develop system quote and proposal (document deliverable)', 'document', 5, 360),
    (m_rd_pilot, 'Internal review', 'meeting', 6, 60),
    (m_rd_pilot, 'Send system quote and proposal to client', 'email', 7, NULL),
    (m_rd_pilot, 'Await client approval', 'todo', 8, NULL);

    -- ── Phase 15: Commercial Production ──────────────────────────────────────
    INSERT INTO template_milestones (template_id, title, description, milestone_type, sort_order, default_duration_days,
                                     integrations)
    VALUES (v_template_id, 'Commercial Production', 'Client approves. Invoice generated. Production begins. Ongoing client updates.', 'objective', 14, NULL,
            '{"invoices": true}'::jsonb)
    RETURNING id INTO m_rd_commercial;

    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order) VALUES
    (m_rd_commercial, 'Client approval received', 'todo', 0),
    (m_rd_commercial, 'Generate and send invoice', 'todo', 1),
    (m_rd_commercial, 'Invoice payment confirmed', 'todo', 2),
    (m_rd_commercial, 'Production begins', 'todo', 3),
    (m_rd_commercial, 'Send weekly update to client', 'email', 4),
    (m_rd_commercial, 'Monitor and report production progress', 'todo', 5);

    -- ── Dependency: Phase 9 (Contract) blocks Phase 10 (R&D Kickoff) ─────────
    -- NOTE: Dependencies are set at the project_milestones level when template is instantiated,
    -- not at the template level directly. The template sort_order implies sequence.

END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 15. SEED: PARTNERSHIP TEMPLATE
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
    v_template_id UUID;
    m1 UUID; m2 UUID; m3 UUID; m4 UUID; m5 UUID;
BEGIN
    INSERT INTO project_templates (name, description, project_type, is_default, is_shared, config)
    VALUES (
        'Partnership Project',
        'Standard flow for strategic partnerships from initial exploration through active collaboration.',
        'partnership', true, true,
        '{"stage_sequence": ["Exploring","Negotiating","Agreement","Active","Complete"]}'::jsonb
    )
    ON CONFLICT DO NOTHING
    RETURNING template_id INTO v_template_id;

    IF v_template_id IS NULL THEN RETURN; END IF;

    INSERT INTO template_milestones (template_id, title, milestone_type, sort_order, default_duration_days) VALUES
    (v_template_id, 'Initial Exploration', 'objective', 0, 14) RETURNING id INTO m1;
    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order) VALUES
    (m1, 'Research potential partner', 'todo', 0),
    (m1, 'Initial outreach / introductory meeting', 'meeting', 1),
    (m1, 'Document partnership opportunity and mutual interest', 'document', 2);

    INSERT INTO template_milestones (template_id, title, milestone_type, sort_order, default_duration_days) VALUES
    (v_template_id, 'Negotiation & Term Sheet', 'approval', 1, 21) RETURNING id INTO m2;
    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order) VALUES
    (m2, 'Define partnership terms and objectives', 'meeting', 0),
    (m2, 'Draft term sheet / MOU', 'document', 1),
    (m2, 'Negotiate terms', 'meeting', 2),
    (m2, 'Legal review', 'document', 3),
    (m2, 'Execute agreement', 'todo', 4);

    INSERT INTO template_milestones (template_id, title, milestone_type, sort_order, default_duration_days) VALUES
    (v_template_id, 'Partnership Launch', 'checkpoint', 2, 14) RETURNING id INTO m3;
    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order) VALUES
    (m3, 'Kick-off meeting with partner', 'meeting', 0),
    (m3, 'Assign responsibilities and set milestones', 'document', 1),
    (m3, 'Set up communication cadence', 'todo', 2);

    INSERT INTO template_milestones (template_id, title, milestone_type, sort_order, default_duration_days) VALUES
    (v_template_id, 'Active Collaboration', 'repeating', 3, NULL) RETURNING id INTO m4;
    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order) VALUES
    (m4, 'Regular progress meeting with partner', 'meeting', 0),
    (m4, 'Send progress update', 'email', 1),
    (m4, 'Review milestone completion', 'todo', 2);

    INSERT INTO template_milestones (template_id, title, milestone_type, sort_order, default_duration_days) VALUES
    (v_template_id, 'Partnership Review & Renewal', 'checkpoint', 4, 14) RETURNING id INTO m5;
    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order) VALUES
    (m5, 'Prepare partnership review report', 'document', 0),
    (m5, 'Review meeting with partner', 'meeting', 1),
    (m5, 'Decision: renew, expand, or close', 'todo', 2);
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 16. SEED: GRANT / FUNDING TEMPLATE
-- ─────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
    v_template_id UUID;
    m1 UUID; m2 UUID; m3 UUID; m4 UUID; m5 UUID;
BEGIN
    INSERT INTO project_templates (name, description, project_type, is_default, is_shared, config)
    VALUES (
        'Grant / Funding Application',
        'Standard grant and funding application lifecycle.',
        'grant', true, true,
        '{"stage_sequence": ["Identified","In Prep","Submitted","Under Review","Won","Lost"]}'::jsonb
    )
    ON CONFLICT DO NOTHING
    RETURNING template_id INTO v_template_id;

    IF v_template_id IS NULL THEN RETURN; END IF;

    INSERT INTO template_milestones (template_id, title, milestone_type, sort_order, default_duration_days) VALUES
    (v_template_id, 'Opportunity Identification', 'objective', 0, 7) RETURNING id INTO m1;
    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order) VALUES
    (m1, 'Log opportunity in Funding module', 'todo', 0),
    (m1, 'Review eligibility criteria', 'document', 1),
    (m1, 'Go/no-go decision', 'meeting', 2);

    INSERT INTO template_milestones (template_id, title, milestone_type, sort_order, default_duration_days, document_deliverable) VALUES
    (v_template_id, 'Application Preparation', 'deliverable', 1, 30, true) RETURNING id INTO m2;
    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order) VALUES
    (m2, 'Gather required documentation', 'document', 0),
    (m2, 'Draft narrative / technical sections', 'document', 1),
    (m2, 'Prepare budget and justification', 'document', 2),
    (m2, 'Internal review of application', 'meeting', 3),
    (m2, 'Finalize and format application', 'document', 4);

    INSERT INTO template_milestones (template_id, title, milestone_type, sort_order, default_duration_days,
                                     auto_reminder_config) VALUES
    (v_template_id, 'Submission', 'checkpoint', 2, 3,
     '{"enabled": true, "trigger_type": "deadline_approaching", "days": 2,
       "subject_template": "Action required: {{project_name}} deadline approaching",
       "message_template": "The submission deadline for {{project_name}} is in {{days_remaining}} days. Please ensure all materials are ready."}'::jsonb)
    RETURNING id INTO m3;
    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order) VALUES
    (m3, 'Final review and sign-off', 'document', 0),
    (m3, 'Submit application', 'todo', 1),
    (m3, 'Confirm submission receipt', 'todo', 2),
    (m3, 'Record submission confirmation number', 'todo', 3);

    INSERT INTO template_milestones (template_id, title, milestone_type, sort_order, default_duration_days) VALUES
    (v_template_id, 'Under Review — Awaiting Decision', 'external_wait', 3, 90) RETURNING id INTO m4;
    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order) VALUES
    (m4, 'Monitor for reviewer questions / requests', 'todo', 0),
    (m4, 'Respond to reviewer questions if any', 'email', 1),
    (m4, 'Record decision (Won / Lost)', 'todo', 2);

    INSERT INTO template_milestones (template_id, title, milestone_type, sort_order, default_duration_days) VALUES
    (v_template_id, 'Post-Award Compliance', 'objective', 4, 14) RETURNING id INTO m5;
    INSERT INTO template_tasks (template_milestone_id, title, activity_type, sort_order) VALUES
    (m5, 'Review award terms and conditions', 'document', 0),
    (m5, 'Set up reporting schedule', 'todo', 1),
    (m5, 'Link to project budget in FP&A', 'todo', 2);
END $$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 17. SEED: DEFAULT REMINDER TEMPLATES
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO reminder_templates (name, project_type, trigger_type, trigger_days, subject_template, message_template, auto_send) VALUES
(
    'Portfolio: No client response follow-up',
    'portfolio',
    'waiting_response',
    5,
    'Following up — {{project_name}}',
    'Hi {{contact_name}},\n\nI wanted to follow up on our recent communication regarding {{project_name}}. Please let me know if you have any questions or if there is anything I can help clarify.\n\nBest regards',
    false
),
(
    'Portfolio: Overdue milestone alert',
    'portfolio',
    'milestone_overdue',
    3,
    'Action needed: {{milestone_title}} is overdue — {{project_name}}',
    'This is a reminder that the milestone "{{milestone_title}}" for {{project_name}} is overdue by {{days_overdue}} days. Please update its status or adjust the timeline.',
    false
),
(
    'Grant: Submission deadline approaching',
    'grant',
    'stage_stale',
    7,
    'Deadline approaching: {{project_name}}',
    'The submission deadline for {{project_name}} is in {{days_remaining}} days. Please ensure all materials are finalized.',
    false
),
(
    'Any: No interaction in 2 weeks',
    NULL,
    'no_interaction',
    14,
    'Check in — {{project_name}}',
    'Hi {{contact_name}},\n\nJust checking in on {{project_name}}. Please let me know if there have been any updates or if you would like to schedule a call.\n\nBest regards',
    false
)
ON CONFLICT DO NOTHING;
