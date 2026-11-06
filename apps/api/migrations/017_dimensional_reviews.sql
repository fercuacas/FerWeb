ALTER TABLE coding_reviews ADD COLUMN dimension_hash text;
CREATE INDEX team_review_target_idx ON team_executions(project_id, ((snapshot->'plan'->'reviewTarget'->>'jobId')));
