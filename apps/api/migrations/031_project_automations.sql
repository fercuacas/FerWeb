CREATE TABLE automation_schedules (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    plan_id uuid NOT NULL REFERENCES prepared_team_plans(id),
    request_id uuid NOT NULL,
    request_hash text NOT NULL,
    snapshot jsonb NOT NULL,
    hash text NOT NULL CHECK (hash ~ '^[a-f0-9]{64}$'),
    approval_hash text CHECK (approval_hash = hash),
    state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','active','paused','blocked','exhausted','cancelled')),
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    next_run_at timestamptz,
    observed_count integer NOT NULL DEFAULT 0 CHECK (observed_count BETWEEN 0 AND 100),
    reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (project_id, request_id),
    UNIQUE (id, project_id),
    CHECK ((next_run_at IS NOT NULL) = (state IN ('draft','active'))),
    CHECK (state NOT IN ('active','paused','blocked','exhausted') OR approval_hash IS NOT NULL)
);
CREATE INDEX automation_due ON automation_schedules(next_run_at,id) WHERE state='active';

CREATE TABLE automation_occurrences (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL,
    schedule_id uuid NOT NULL,
    due_at timestamptz NOT NULL,
    disposition text NOT NULL CHECK (disposition IN ('admitted','skipped','blocked')),
    reason text,
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (schedule_id,project_id) REFERENCES automation_schedules(id,project_id) ON DELETE CASCADE,
    UNIQUE (schedule_id,due_at),
    UNIQUE (id,project_id)
);
CREATE INDEX automation_occurrences_project ON automation_occurrences(project_id,created_at DESC,id);

ALTER TABLE team_executions ADD COLUMN automation_occurrence_id uuid;
ALTER TABLE team_executions
    ADD FOREIGN KEY (automation_occurrence_id,project_id) REFERENCES automation_occurrences(id,project_id);
DROP INDEX team_execution_plan;
CREATE UNIQUE INDEX team_execution_plan ON team_executions(plan_id) WHERE automation_occurrence_id IS NULL;
CREATE UNIQUE INDEX team_execution_automation ON team_executions(automation_occurrence_id) WHERE automation_occurrence_id IS NOT NULL;

CREATE TABLE automation_notifications (
    id text PRIMARY KEY,
    project_id uuid NOT NULL,
    occurrence_id uuid NOT NULL,
    kind text NOT NULL CHECK (kind IN ('completed','failed','blocked','action_required')),
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz,
    FOREIGN KEY (occurrence_id,project_id) REFERENCES automation_occurrences(id,project_id) ON DELETE CASCADE
);
CREATE INDEX automation_notifications_project ON automation_notifications(project_id,created_at DESC,id);
