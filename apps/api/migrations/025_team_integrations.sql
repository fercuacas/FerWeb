ALTER TABLE coding_runs ADD COLUMN integration_base jsonb;
CREATE TABLE team_integrations (
    execution_id uuid NOT NULL REFERENCES team_executions(id) ON DELETE CASCADE,
    version integer NOT NULL CHECK(version BETWEEN 1 AND 2),
    artifact jsonb NOT NULL,
    hash text NOT NULL CHECK(hash ~ '^[a-f0-9]{64}$'),
    state text NOT NULL CHECK(state IN ('conflict','ready','verified','failed')),
    base_files jsonb NOT NULL,
    branches jsonb NOT NULL,
    merged_files jsonb,
    verifier_job_id uuid REFERENCES jobs(id),
    report_hash text CHECK(report_hash ~ '^[a-f0-9]{64}$'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY(execution_id,version)
);
