CREATE TABLE agent_evaluations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    solo_id uuid NOT NULL REFERENCES coding_runs(job_id) ON DELETE CASCADE,
    team_id uuid NOT NULL REFERENCES team_executions(id) ON DELETE CASCADE,
    case_key text NOT NULL,
    evidence jsonb NOT NULL,
    evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE (project_id,solo_id,team_id,case_key)
);
CREATE INDEX agent_evaluations_project_created ON agent_evaluations(project_id,created_at DESC);
CREATE TABLE agent_evaluation_reviews (
    evaluation_id uuid NOT NULL REFERENCES agent_evaluations(id) ON DELETE CASCADE,
    version integer NOT NULL CHECK(version >= 0),
    verdict text NOT NULL CHECK(verdict IN ('solo','team','tie','inconclusive')),
    note text NOT NULL CHECK(length(note) BETWEEN 1 AND 2000),
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (evaluation_id,version)
);
