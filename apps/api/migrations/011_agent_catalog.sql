CREATE TABLE agent_roles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    latest_version integer NOT NULL DEFAULT 1 CHECK (latest_version > 0),
    archived_at timestamptz
);
CREATE INDEX agent_roles_project ON agent_roles(project_id, id);

CREATE TABLE agent_versions (
    role_id uuid NOT NULL REFERENCES agent_roles(id) ON DELETE CASCADE,
    version integer NOT NULL CHECK (version > 0),
    definition jsonb NOT NULL,
    origin jsonb NOT NULL,
    PRIMARY KEY(role_id, version)
);

ALTER TABLE coding_runs ADD COLUMN agent_snapshot jsonb;
