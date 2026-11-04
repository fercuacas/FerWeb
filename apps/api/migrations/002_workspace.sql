CREATE TABLE app_users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL UNIQUE CHECK (email = lower(btrim(email))),
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
    token_hash text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE login_attempts (
    key text PRIMARY KEY,
    window_started_at timestamptz NOT NULL DEFAULT now(),
    attempts integer NOT NULL DEFAULT 1
);
CREATE INDEX login_attempts_expiry_idx ON login_attempts (window_started_at);

CREATE TABLE projects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES app_users(id),
    name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120),
    description text NOT NULL DEFAULT '' CHECK (length(description) <= 4000),
    archived_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE INDEX projects_owner_idx ON projects (owner_id, created_at DESC);

CREATE TABLE tasks (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
    description text NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
    priority text NOT NULL CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    status text NOT NULL CHECK (status IN ('todo', 'in_progress', 'done')),
    acceptance_criteria jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(acceptance_criteria) = 'array'),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE INDEX tasks_project_idx ON tasks (project_id, created_at);
