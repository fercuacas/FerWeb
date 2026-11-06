CREATE TABLE project_memory_entries (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    current_revision integer NOT NULL DEFAULT 1 CHECK(current_revision BETWEEN 1 AND 50),
    request_id uuid NOT NULL,
    request_hash text NOT NULL,
    UNIQUE(project_id,request_id)
);
CREATE TABLE project_memory_revisions (
    entry_id uuid NOT NULL REFERENCES project_memory_entries(id) ON DELETE CASCADE,
    revision integer NOT NULL CHECK(revision BETWEEN 1 AND 50),
    previous_revision integer,
    data jsonb NOT NULL,
    evidence jsonb NOT NULL,
    origin jsonb NOT NULL,
    hash text NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    valid_until timestamptz,
    search_text tsvector NOT NULL,
    PRIMARY KEY(entry_id,revision),
    FOREIGN KEY(entry_id,previous_revision) REFERENCES project_memory_revisions(entry_id,revision),
    CHECK(previous_revision IS NOT DISTINCT FROM CASE WHEN revision=1 THEN NULL ELSE revision-1 END),
    CHECK(valid_until IS NULL OR valid_until>=recorded_at)
);
CREATE INDEX project_memory_search ON project_memory_revisions USING gin(search_text);
CREATE INDEX project_memory_project ON project_memory_entries(project_id);
CREATE TABLE project_memory_imports (
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    request_id uuid NOT NULL,
    hash text NOT NULL,
    selections jsonb NOT NULL,
    PRIMARY KEY(project_id,request_id)
);
ALTER TABLE coding_runs ADD COLUMN memory_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb;
