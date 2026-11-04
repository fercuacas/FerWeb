CREATE TABLE github_connections (
    owner_id uuid PRIMARY KEY REFERENCES app_users(id) ON DELETE CASCADE,
    github_user_id bigint NOT NULL,
    login text NOT NULL,
    encrypted_token text,
    expires_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE github_oauth_states (
    state_hash text PRIMARY KEY,
    session_hash text NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
    encrypted_verifier text NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE TABLE github_installations (
    owner_id uuid NOT NULL REFERENCES github_connections(owner_id) ON DELETE CASCADE,
    installation_id bigint NOT NULL,
    account text NOT NULL,
    active boolean NOT NULL DEFAULT true,
    PRIMARY KEY (owner_id, installation_id)
);
CREATE TABLE github_links (
    project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    owner_id uuid NOT NULL,
    installation_id bigint NOT NULL,
    repository_id bigint NOT NULL,
    full_name text NOT NULL,
    branch text NOT NULL,
    version integer NOT NULL DEFAULT 1,
    generation integer NOT NULL DEFAULT 0,
    stale boolean NOT NULL DEFAULT true,
    revoked boolean NOT NULL DEFAULT false,
    snapshot jsonb,
    synced_at timestamptz,
    FOREIGN KEY (owner_id, installation_id) REFERENCES github_installations(owner_id, installation_id) ON DELETE CASCADE
);
CREATE INDEX github_links_repository ON github_links (installation_id, repository_id);
CREATE TABLE github_deliveries (
    delivery_id uuid PRIMARY KEY,
    event text NOT NULL,
    payload_hash text NOT NULL,
    received_at timestamptz NOT NULL DEFAULT now(),
    outcome text NOT NULL CHECK (outcome IN ('processed', 'ignored'))
);
