CREATE TABLE team_templates (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    latest_version integer NOT NULL DEFAULT 1 CHECK (latest_version BETWEEN 1 AND 50),
    archived_at timestamptz
);
CREATE INDEX team_templates_project ON team_templates(project_id, id);
CREATE TABLE team_template_versions (
    template_id uuid NOT NULL REFERENCES team_templates(id) ON DELETE CASCADE,
    version integer NOT NULL CHECK (version BETWEEN 1 AND 50),
    definition jsonb NOT NULL,
    origin jsonb NOT NULL,
    PRIMARY KEY(template_id, version)
);
CREATE TABLE prepared_team_plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id uuid NOT NULL REFERENCES tasks(id),
    request_id uuid NOT NULL,
    request_hash text NOT NULL,
    snapshot jsonb NOT NULL,
    hash text NOT NULL CHECK (hash ~ '^[a-f0-9]{64}$'),
    approved_at timestamptz,
    approval_hash text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(project_id, request_id),
    CHECK ((approved_at IS NULL) = (approval_hash IS NULL)),
    CHECK (approval_hash IS NULL OR approval_hash = hash)
);
