ALTER TABLE tasks ADD CONSTRAINT tasks_project_identity UNIQUE(project_id,id);
CREATE TABLE task_coordination (
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    task_id uuid PRIMARY KEY,
    kind text NOT NULL DEFAULT 'task' CHECK(kind IN ('task','epic')),
    parent_epic_id uuid,
    blocker text CHECK(length(blocker) BETWEEN 1 AND 500),
    claimed_by uuid REFERENCES app_users(id),
    claimed_template_id uuid REFERENCES team_templates(id),
    claimed_template_version integer,
    FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,id) ON DELETE CASCADE,
    FOREIGN KEY(project_id,parent_epic_id) REFERENCES tasks(project_id,id),
    CHECK(task_id IS DISTINCT FROM parent_epic_id),
    CHECK(claimed_by IS NULL OR claimed_template_id IS NULL),
    CHECK((claimed_template_id IS NULL)=(claimed_template_version IS NULL))
);
CREATE TABLE task_dependencies (
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    dependency_id uuid NOT NULL,
    PRIMARY KEY(project_id,task_id,dependency_id),
    FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,id) ON DELETE CASCADE,
    FOREIGN KEY(project_id,dependency_id) REFERENCES tasks(project_id,id) ON DELETE CASCADE,
    CHECK(task_id<>dependency_id)
);
CREATE INDEX task_coordination_parent ON task_coordination(project_id,parent_epic_id);
CREATE TABLE task_remote_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    repository_id bigint NOT NULL,
    kind text NOT NULL CHECK(kind IN ('issue','pull')),
    item_id bigint NOT NULL,
    number bigint NOT NULL,
    origin text NOT NULL CHECK(origin IN ('linked','created')),
    observation jsonb,
    observed_at timestamptz,
    FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,id) ON DELETE CASCADE,
    UNIQUE(project_id,repository_id,kind,item_id)
);
CREATE TABLE github_issue_actions (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL,
    task_id uuid NOT NULL,
    repository_id bigint NOT NULL,
    request_id uuid NOT NULL,
    request_hash text NOT NULL,
    snapshot jsonb NOT NULL,
    hash text NOT NULL,
    state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','sending','uncertain','published')),
    approved_hash text,
    attempt_token uuid,
    lease_until timestamptz,
    attempted_at timestamptz,
    item jsonb,
    error_code text,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY(project_id,task_id) REFERENCES tasks(project_id,id) ON DELETE CASCADE,
    UNIQUE(project_id,request_id)
);
CREATE UNIQUE INDEX github_issue_action_attempt ON github_issue_actions(project_id,task_id,repository_id) WHERE state<>'prepared';
