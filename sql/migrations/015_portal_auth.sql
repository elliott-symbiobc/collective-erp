-- 015_portal_auth.sql — Portal password protection, investor viewers, and activity tracking

-- Add password protection to existing portals table
ALTER TABLE project_portals
  ADD COLUMN IF NOT EXISTS is_password_protected BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS password_hash TEXT;

-- Per-investor named viewer credentials (each gets their own password)
CREATE TABLE IF NOT EXISTS portal_viewers (
    viewer_id     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portal_id     UUID NOT NULL REFERENCES project_portals(portal_id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    email         TEXT,
    firm          TEXT,
    password_hash TEXT NOT NULL,
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Session tokens issued after successful password authentication
CREATE TABLE IF NOT EXISTS portal_sessions (
    session_token UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    portal_id     UUID NOT NULL REFERENCES project_portals(portal_id) ON DELETE CASCADE,
    viewer_id     UUID REFERENCES portal_viewers(viewer_id) ON DELETE CASCADE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at    TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days'
);

-- Full activity audit log for investor portal access
CREATE TABLE IF NOT EXISTS portal_access_log (
    log_id      BIGSERIAL PRIMARY KEY,
    portal_id   UUID NOT NULL REFERENCES project_portals(portal_id) ON DELETE CASCADE,
    viewer_id   UUID REFERENCES portal_viewers(viewer_id) ON DELETE SET NULL,
    viewer_name TEXT,
    event_type  TEXT NOT NULL,  -- login | page_visit | file_view | file_download
    file_id     TEXT,
    file_name   TEXT,
    section     TEXT,           -- overview | updates | documents
    ip_address  TEXT,
    user_agent  TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_portal_viewers_portal    ON portal_viewers(portal_id);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_token    ON portal_sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_portal_sessions_portal   ON portal_sessions(portal_id);
CREATE INDEX IF NOT EXISTS idx_portal_access_log_portal ON portal_access_log(portal_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_portal_access_log_viewer ON portal_access_log(viewer_id, created_at DESC);
