CREATE TABLE conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
    provider text NOT NULL CHECK (provider IN ('openai','ollama')),
    model text NOT NULL,
    configuration jsonb NOT NULL,
    catalog_revision text,
    version integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_project ON conversations(project_id,created_at DESC);
CREATE TABLE chat_turns (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    request_id uuid NOT NULL,
    sequence integer NOT NULL,
    prompt text NOT NULL,
    response text NOT NULL DEFAULT '',
    provider text NOT NULL,
    model text NOT NULL,
    reported_model text,
    configuration jsonb NOT NULL,
    context_turn_ids uuid[] NOT NULL DEFAULT '{}',
    catalog_revision text,
    status text NOT NULL CHECK (status IN ('streaming','completed','incomplete','cancelled','error','interrupted')),
    usage jsonb NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    first_token_ms double precision,
    duration_ms double precision,
    finish_reason text,
    error_code text,
    error_message text,
    cancel_requested boolean NOT NULL DEFAULT false,
    cancel_mode text NOT NULL DEFAULT 'not_requested',
    remote_cancellation_confirmed boolean,
    lease_until timestamptz,
    UNIQUE (conversation_id,request_id),
    UNIQUE (conversation_id,sequence)
);
CREATE UNIQUE INDEX chat_one_active_turn ON chat_turns(conversation_id) WHERE status='streaming';
