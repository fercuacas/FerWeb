CREATE TABLE execution_budgets (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_id uuid NOT NULL,
    request_hash text NOT NULL,
    name text NOT NULL,
    max_requests integer NOT NULL CHECK (max_requests BETWEEN 1 AND 20),
    timeout_ms integer NOT NULL CHECK (timeout_ms BETWEEN 10000 AND 1200000),
    concurrency integer NOT NULL DEFAULT 1 CHECK (concurrency = 1),
    deadline_at timestamptz,
    cancelled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(project_id, request_id)
);
CREATE TABLE execution_budget_steps (
    job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
    budget_id uuid NOT NULL REFERENCES execution_budgets(id) ON DELETE CASCADE,
    attribution text NOT NULL CHECK (attribution IN ('agent','coordinator','selection','summary','reviewer')),
    request_limit integer NOT NULL CHECK (request_limit BETWEEN 1 AND 20),
    fence uuid,
    released boolean NOT NULL DEFAULT false
);
CREATE INDEX execution_budget_steps_parent ON execution_budget_steps(budget_id);
CREATE TABLE execution_request_admissions (
    job_id uuid NOT NULL REFERENCES execution_budget_steps(job_id) ON DELETE CASCADE,
    request_id uuid NOT NULL,
    fence uuid NOT NULL,
    payload_hash text NOT NULL,
    usage jsonb,
    settled boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(job_id, request_id)
);
