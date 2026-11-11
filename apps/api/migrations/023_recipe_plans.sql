CREATE TABLE recipe_plans (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id uuid NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    request_id uuid NOT NULL,
    request_hash text NOT NULL,
    hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),
    snapshot jsonb NOT NULL,
    job_id uuid UNIQUE REFERENCES coding_runs(job_id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(project_id,request_id)
);
CREATE INDEX recipe_plans_task ON recipe_plans(project_id,task_id,created_at DESC);
