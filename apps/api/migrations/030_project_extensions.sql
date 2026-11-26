CREATE TABLE project_extensions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    slug text NOT NULL,
    selected_version text NOT NULL,
    revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
    state text NOT NULL CHECK (state IN ('imported','configured','reviewed','enabled','withdrawn')),
    config jsonb,
    approval_hash text CHECK (approval_hash ~ '^[a-f0-9]{64}$'),
    UNIQUE (project_id,slug)
);
CREATE TABLE extension_versions (
    extension_id uuid NOT NULL REFERENCES project_extensions(id) ON DELETE CASCADE,
    version text NOT NULL,
    manifest jsonb NOT NULL,
    sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    PRIMARY KEY (extension_id,version)
);
ALTER TABLE project_extensions ADD FOREIGN KEY (id,selected_version)
    REFERENCES extension_versions(extension_id,version) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE extension_resources (
    extension_id uuid NOT NULL REFERENCES project_extensions(id) ON DELETE CASCADE,
    path text NOT NULL,
    content text NOT NULL,
    sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
    owner text NOT NULL CHECK (owner IN ('extension','project')),
    visible boolean NOT NULL,
    PRIMARY KEY (extension_id,path)
);
CREATE TABLE extension_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    extension_id uuid NOT NULL,
    version text NOT NULL,
    revision integer NOT NULL CHECK (revision > 0),
    action text NOT NULL CHECK (action IN ('import','select','configure','review','enable','withdraw','edit','run')),
    path text,
    resource_hash text CHECK (resource_hash ~ '^[a-f0-9]{64}$'),
    request_id uuid,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    FOREIGN KEY (extension_id,version) REFERENCES extension_versions(extension_id,version) ON DELETE CASCADE,
    UNIQUE (extension_id,request_id)
);
CREATE INDEX extension_events_history ON extension_events(extension_id,recorded_at DESC,id);
