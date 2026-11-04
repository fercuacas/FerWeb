ALTER TABLE coding_runs ADD COLUMN base_branch text;
ALTER TABLE coding_runs ADD COLUMN source_tree jsonb;
ALTER TABLE coding_runs ADD COLUMN environment jsonb;
ALTER TABLE coding_runs ADD COLUMN baseline_job_id uuid REFERENCES coding_runs(job_id);

CREATE TABLE coding_reviews (
    job_id uuid PRIMARY KEY REFERENCES coding_runs(job_id),
    project_id uuid NOT NULL REFERENCES projects(id),
    repository_id bigint NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    branch text NOT NULL,
    approved boolean NOT NULL,
    notes text NOT NULL,
    report_hash text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','publishing','failed','published')),
    attempt_token uuid,
    lease_until timestamptz,
    attempted_at timestamptz,
    commit_sha text,
    pull_number integer,
    pull_url text,
    base_changed boolean,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(repository_id, branch)
);
CREATE INDEX coding_runs_task ON coding_runs(task_id, created_at DESC);
