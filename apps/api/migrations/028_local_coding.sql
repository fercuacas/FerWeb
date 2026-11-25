-- Preserve historical Codex rows and validate the explicit local inference binding.
ALTER TABLE jobs ADD CONSTRAINT jobs_coding_engine_check CHECK (
  kind <> 'codex-v1' OR (
    COALESCE(configuration->>'executionId', 'codex-v1') IN ('codex-v1', 'codex-local-v1')
    AND CASE WHEN configuration->>'executionId' = 'codex-local-v1'
      THEN configuration ? 'modelRevision'
        AND jsonb_typeof(configuration->'modelRevision') = 'string'
        AND length(configuration->>'modelRevision') BETWEEN 1 AND 200
      ELSE NOT (configuration ? 'modelRevision') END
  )
);
