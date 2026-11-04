CREATE TABLE job_executors (
    id uuid PRIMARY KEY,
    started_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    stopped_at timestamptz
);
CREATE TABLE jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_id uuid NOT NULL,
    request_hash text NOT NULL,
    title text NOT NULL,
    kind text NOT NULL CHECK(kind='simulation-v1'),
    configuration jsonb NOT NULL,
    state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','running','completed','failed','cancelled')),
    attempt integer NOT NULL DEFAULT 0,
    completed_steps integer NOT NULL DEFAULT 0,
    used_units integer NOT NULL DEFAULT 0,
    used_cost_micros integer NOT NULL DEFAULT 0,
    cancel_requested boolean NOT NULL DEFAULT false,
    executor_id uuid REFERENCES job_executors(id),
    fence uuid,
    lease_until timestamptz,
    available_at timestamptz NOT NULL DEFAULT now(),
    first_started_at timestamptz,
    deadline_at timestamptz,
    finished_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    event_sequence integer NOT NULL DEFAULT 0,
    result jsonb,
    error_code text,
    error_message text,
    UNIQUE(project_id,request_id)
);
CREATE INDEX jobs_ready ON jobs(available_at,created_at,id) WHERE state='pending';
CREATE INDEX jobs_running ON jobs(lease_until) WHERE state='running';
CREATE INDEX jobs_project ON jobs(project_id,created_at DESC);
CREATE TABLE job_attempts (
    job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    attempt integer NOT NULL,
    executor_id uuid NOT NULL REFERENCES job_executors(id),
    state text NOT NULL DEFAULT 'running',
    process_pid integer,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    exit_code integer,
    exit_signal text,
    termination_confirmed boolean,
    error_code text,
    PRIMARY KEY(job_id,attempt)
);
CREATE TABLE job_events (
    job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    sequence integer NOT NULL,
    attempt integer NOT NULL,
    executor_id uuid,
    type text NOT NULL,
    message text NOT NULL,
    data jsonb NOT NULL DEFAULT '{}',
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(job_id,sequence)
);
CREATE TABLE job_charges (
    job_id uuid NOT NULL,
    attempt integer NOT NULL,
    step integer NOT NULL,
    units integer NOT NULL,
    cost_micros integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY(job_id,attempt) REFERENCES job_attempts(job_id,attempt) ON DELETE CASCADE,
    PRIMARY KEY(job_id,attempt,step)
);
CREATE TABLE job_effects (
    job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    step integer NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY(job_id,step)
);
