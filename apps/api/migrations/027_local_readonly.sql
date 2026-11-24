ALTER TABLE jobs DROP CONSTRAINT jobs_kind_check;
ALTER TABLE jobs ADD CONSTRAINT jobs_kind_check CHECK(kind IN ('simulation-v1','codex-v1','local-readonly-v1'));
CREATE TABLE local_read_runs (
    job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    task_id uuid NOT NULL REFERENCES tasks(id),
    owner_id uuid NOT NULL REFERENCES app_users(id),
    repository_id bigint NOT NULL,
    snapshot jsonb NOT NULL,
    input_hash text NOT NULL,
    context_receipt_id uuid REFERENCES context_pack_receipts(id),
    report jsonb
);
