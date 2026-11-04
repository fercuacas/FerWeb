ALTER TABLE jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check CHECK(kind IN ('simulation-v1','codex-v1'));
CREATE TABLE coding_runs (
    job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    task_id uuid NOT NULL REFERENCES tasks(id),
    task_snapshot jsonb NOT NULL,
    owner_id uuid NOT NULL REFERENCES app_users(id),
    repository_id bigint NOT NULL,
    repository text NOT NULL,
    commit_sha text NOT NULL,
    files jsonb NOT NULL,
    manifest jsonb NOT NULL,
    excluded jsonb NOT NULL,
    report jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
