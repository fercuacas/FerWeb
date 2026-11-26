CREATE TABLE provider_comparisons (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    api_id uuid NOT NULL REFERENCES coding_runs(job_id) ON DELETE CASCADE,
    local_id uuid NOT NULL REFERENCES coding_runs(job_id) ON DELETE CASCADE,
    case_key text NOT NULL CHECK (case_key IN ('recorded', 'addition-v1')),
    evidence jsonb NOT NULL,
    evidence_hash text NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    CHECK (api_id <> local_id),
    UNIQUE (project_id,api_id,local_id,case_key)
);
CREATE INDEX provider_comparisons_project_created ON provider_comparisons(project_id,created_at DESC);
