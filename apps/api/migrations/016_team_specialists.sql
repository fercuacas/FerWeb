ALTER TABLE projects ADD COLUMN team_parallelism integer NOT NULL DEFAULT 1 CHECK(team_parallelism BETWEEN 1 AND 2);
ALTER TABLE projects ADD COLUMN team_policy_version integer NOT NULL DEFAULT 1;
ALTER TABLE execution_budgets DROP CONSTRAINT execution_budgets_concurrency_check;
ALTER TABLE execution_budgets ADD CONSTRAINT execution_budgets_concurrency_check CHECK(concurrency BETWEEN 1 AND 2);
ALTER TABLE team_executions ADD COLUMN parallelism integer NOT NULL DEFAULT 1 CHECK(parallelism BETWEEN 1 AND 2);
ALTER TABLE team_executions ADD COLUMN message_sequence integer NOT NULL DEFAULT 0;
CREATE TABLE team_messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    execution_id uuid NOT NULL REFERENCES team_executions(id) ON DELETE CASCADE,
    sequence integer NOT NULL,
    request_id uuid NOT NULL,
    sender text NOT NULL CHECK(sender IN ('agent','coordinator')),
    sender_step_id uuid REFERENCES team_execution_steps(id),
    sender_job_id uuid REFERENCES jobs(id),
    recipient_step_id uuid REFERENCES team_execution_steps(id),
    kind text NOT NULL CHECK(kind IN ('handoff','query','response','completion','conflict')),
    text text NOT NULL CHECK(octet_length(text)<=8000),
    reply_to uuid REFERENCES team_messages(id),
    verified boolean NOT NULL DEFAULT false,
    payload_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE(execution_id,sequence),
    UNIQUE(execution_id,request_id)
);
