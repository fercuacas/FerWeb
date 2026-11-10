CREATE TABLE learning_proposals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    evaluation_id uuid NOT NULL REFERENCES agent_evaluations(id) ON DELETE CASCADE,
    request_id uuid NOT NULL,
    request_hash text NOT NULL,
    draft jsonb NOT NULL,
    evidence jsonb NOT NULL,
    state text NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','approved','rejected','adopted','reverted')),
    version integer NOT NULL DEFAULT 1 CHECK(version BETWEEN 1 AND 4),
    memory jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(project_id,request_id)
);
CREATE INDEX learning_project ON learning_proposals(project_id,created_at DESC);
CREATE TABLE learning_events (
    proposal_id uuid NOT NULL REFERENCES learning_proposals(id) ON DELETE CASCADE,
    version integer NOT NULL CHECK(version BETWEEN 1 AND 4),
    action text NOT NULL CHECK(action IN ('propose','approve','reject','adopt','revert')),
    memory jsonb,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    PRIMARY KEY (proposal_id,version)
);
