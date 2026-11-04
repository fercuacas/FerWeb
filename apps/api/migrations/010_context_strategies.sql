ALTER TABLE lab_runs ADD COLUMN context_metrics jsonb;
ALTER TABLE chat_turns ADD COLUMN context_plan jsonb;
ALTER TABLE chat_turns ADD COLUMN context_metrics jsonb;
CREATE TABLE context_results (
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    scope_id uuid NOT NULL,
    cache_key text NOT NULL,
    origin_id uuid NOT NULL,
    response text NOT NULL,
    sources jsonb NOT NULL,
    reported_model text,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(project_id, scope_id, cache_key)
);
CREATE TABLE context_policies (
    project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    version integer NOT NULL DEFAULT 1,
    selection jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
);
