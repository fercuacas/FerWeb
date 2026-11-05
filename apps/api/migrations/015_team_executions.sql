ALTER TABLE coding_runs ADD COLUMN output_files jsonb;
CREATE TABLE team_executions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    plan_id uuid NOT NULL REFERENCES prepared_team_plans(id),
    request_id uuid NOT NULL,
    request_hash text NOT NULL,
    snapshot jsonb NOT NULL,
    commit_sha text NOT NULL,
    repository_id bigint NOT NULL,
    repository text NOT NULL,
    link_version integer NOT NULL,
    budget_id uuid NOT NULL REFERENCES execution_budgets(id),
    state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','completed','failed','cancelled')),
    cancel_requested boolean NOT NULL DEFAULT false,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    event_sequence integer NOT NULL DEFAULT 0,
    UNIQUE(project_id,request_id)
);
CREATE UNIQUE INDEX team_execution_active ON team_executions(project_id) WHERE state IN ('pending','running');
CREATE UNIQUE INDEX team_execution_plan ON team_executions(plan_id);
ALTER TABLE prepared_team_plans ADD COLUMN execution_id uuid REFERENCES team_executions(id);
CREATE TABLE team_execution_steps (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id uuid NOT NULL REFERENCES team_executions(id) ON DELETE CASCADE,
    position integer NOT NULL CHECK(position BETWEEN 1 AND 6),
    step_key text NOT NULL,
    request_id uuid NOT NULL DEFAULT gen_random_uuid(),
    job_id uuid UNIQUE REFERENCES jobs(id),
    delivery jsonb,
    UNIQUE(execution_id,position)
);
CREATE TABLE team_execution_events (
    execution_id uuid NOT NULL REFERENCES team_executions(id) ON DELETE CASCADE,
    sequence integer NOT NULL,
    type text NOT NULL,
    message text NOT NULL,
    data jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(execution_id,sequence)
);
