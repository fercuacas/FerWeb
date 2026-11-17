ALTER TABLE jobs ADD COLUMN last_heartbeat_at timestamptz;
ALTER TABLE prepared_team_plans ADD COLUMN changes_requested boolean NOT NULL DEFAULT false;
CREATE INDEX team_executions_project_task ON team_executions(project_id, (snapshot->'plan'->'task'->>'id'), created_at DESC);

CREATE TABLE canvas_entries (
    sequence integer GENERATED ALWAYS AS IDENTITY UNIQUE,
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    owner_id uuid NOT NULL REFERENCES app_users(id),
    kind text NOT NULL CHECK(kind IN ('plan','diff','recipe')),
    target_id uuid NOT NULL,
    hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),
    element text NOT NULL CHECK(length(element) BETWEEN 1 AND 240),
    action text NOT NULL CHECK(action IN ('comment','reply','request_changes','approve')),
    body text CHECK(length(body) BETWEEN 1 AND 2000),
    reply_to uuid REFERENCES canvas_entries(id),
    request_id uuid NOT NULL,
    request_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(project_id,request_id),
    CHECK ((action='reply') = (reply_to IS NOT NULL)),
    CHECK (body IS NOT NULL OR action='approve')
);
CREATE INDEX canvas_target ON canvas_entries(project_id,kind,target_id,sequence);
