CREATE TABLE repository_indexes (
    project_id uuid PRIMARY KEY REFERENCES github_links(project_id) ON DELETE CASCADE,
    repository_id bigint NOT NULL,
    link_version integer NOT NULL,
    commit_sha text NOT NULL,
    embedding_space text NOT NULL,
    indexed_at timestamptz NOT NULL DEFAULT now(),
    skipped jsonb NOT NULL DEFAULT '[]',
    partial boolean NOT NULL DEFAULT false
);
CREATE TABLE repository_documents (
    id uuid PRIMARY KEY,
    project_id uuid NOT NULL REFERENCES repository_indexes(project_id) ON DELETE CASCADE,
    path text NOT NULL,
    kind text NOT NULL,
    fingerprint text NOT NULL,
    commit_sha text NOT NULL,
    observed_at text,
    UNIQUE(project_id,path)
);
CREATE TABLE repository_chunks (
    id uuid PRIMARY KEY,
    document_id uuid NOT NULL REFERENCES repository_documents(id) ON DELETE CASCADE,
    ordinal integer NOT NULL,
    start_line integer NOT NULL,
    end_line integer NOT NULL,
    content text NOT NULL,
    UNIQUE(document_id,ordinal)
);
ALTER TABLE chat_turns ADD COLUMN sources jsonb NOT NULL DEFAULT '[]';
ALTER TABLE chat_turns ADD COLUMN grounding text NOT NULL DEFAULT 'disabled';

CREATE FUNCTION invalidate_repository_index() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.revoked OR NEW.snapshot IS NULL OR NEW.repository_id <> OLD.repository_id OR NEW.installation_id <> OLD.installation_id THEN
        DELETE FROM repository_indexes WHERE project_id=NEW.project_id;
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER github_index_invalidation AFTER UPDATE ON github_links
FOR EACH ROW EXECUTE FUNCTION invalidate_repository_index();
