CREATE TABLE lab_cases (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    snapshot jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lab_tariffs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    snapshot jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE lab_batches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_id uuid NOT NULL,
    request_hash text NOT NULL,
    conditions jsonb NOT NULL,
    status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','running','completed','cancelled','interrupted')),
    cancel_requested boolean NOT NULL DEFAULT false,
    lease_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    started_at timestamptz,
    finished_at timestamptz,
    UNIQUE(project_id,request_id)
);
CREATE UNIQUE INDEX lab_one_active_project ON lab_batches(project_id) WHERE status='running';
CREATE TABLE lab_runs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    batch_id uuid NOT NULL REFERENCES lab_batches(id) ON DELETE CASCADE,
    case_id uuid NOT NULL REFERENCES lab_cases(id),
    target integer NOT NULL,
    repetition integer NOT NULL,
    ordinal integer NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','completed','incomplete','error','cancelled','interrupted','skipped')),
    response text NOT NULL DEFAULT '',
    reported_model text,
    catalog_revision text,
    started_at timestamptz,
    finished_at timestamptz,
    first_token_ms double precision,
    duration_ms double precision,
    usage jsonb NOT NULL,
    estimated_cost_usd double precision,
    cost_reason text NOT NULL DEFAULT 'not_run',
    automatic jsonb,
    error_code text,
    error_message text,
    review_version integer NOT NULL DEFAULT 0,
    UNIQUE(batch_id,ordinal)
);
CREATE TABLE lab_reviews (
    run_id uuid NOT NULL REFERENCES lab_runs(id) ON DELETE CASCADE,
    version integer NOT NULL,
    reviewer_id uuid NOT NULL REFERENCES app_users(id),
    assessment jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(run_id,version)
);
