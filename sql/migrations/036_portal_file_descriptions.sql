CREATE TABLE IF NOT EXISTS portal_file_descriptions (
    portal_id   uuid NOT NULL,
    file_id     text NOT NULL,
    description text NOT NULL DEFAULT '',
    updated_at  timestamp with time zone NOT NULL DEFAULT NOW(),
    PRIMARY KEY (portal_id, file_id)
);
