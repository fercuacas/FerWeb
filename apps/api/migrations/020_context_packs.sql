ALTER TABLE repository_chunks ADD COLUMN search_text tsvector GENERATED ALWAYS AS (to_tsvector('simple',content)) STORED;
CREATE INDEX repository_chunks_lexical ON repository_chunks USING gin(search_text);
CREATE TABLE project_context_maps (
    project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    version integer NOT NULL CHECK(version>0),
    hash text NOT NULL,
    markdown text NOT NULL,
    sources jsonb NOT NULL,
    recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE project_context_pack_policies (
    project_id uuid PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    version integer NOT NULL CHECK(version>0),
    hash text NOT NULL,
    rules jsonb NOT NULL
);
CREATE TABLE context_pack_receipts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    owner_id uuid NOT NULL REFERENCES app_users(id),
    request_id uuid NOT NULL,
    request_hash text NOT NULL,
    hash text NOT NULL,
    snapshot jsonb NOT NULL,
    parent_id uuid REFERENCES context_pack_receipts(id),
    job_id uuid UNIQUE REFERENCES jobs(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(project_id,request_id)
);
CREATE INDEX context_pack_project ON context_pack_receipts(project_id,created_at DESC);
CREATE TABLE context_pack_expansions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    receipt_id uuid NOT NULL REFERENCES context_pack_receipts(id) ON DELETE CASCADE,
    request_id uuid NOT NULL,
    request_hash text NOT NULL,
    selector jsonb NOT NULL,
    status text NOT NULL CHECK(status IN ('pending','completed','error')),
    result jsonb NOT NULL DEFAULT '{}',
    error_code text,
    reserved_bytes integer NOT NULL CHECK(reserved_bytes>0),
    bytes integer NOT NULL DEFAULT 0 CHECK(bytes>=0),
    elapsed_ms double precision,
    started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    UNIQUE(receipt_id,request_id)
);
ALTER TABLE coding_runs ADD COLUMN context_receipt_id uuid REFERENCES context_pack_receipts(id);
