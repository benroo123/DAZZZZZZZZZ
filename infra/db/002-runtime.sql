SET search_path TO app, public;

ALTER TABLE posts DROP CONSTRAINT IF EXISTS posts_status_check;
ALTER TABLE posts ADD CONSTRAINT posts_status_check
  CHECK (status IN ('draft', 'uploading', 'processing', 'pending_review', 'published', 'rejected', 'hidden', 'failed', 'deleted'));

CREATE TABLE media_upload_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_asset_id uuid NOT NULL UNIQUE REFERENCES media_assets(id) ON DELETE CASCADE,
  object_key varchar(512) NOT NULL UNIQUE,
  status varchar(20) NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'uploaded', 'processing', 'completed', 'failed')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE processed_events (
  consumer_name varchar(100) NOT NULL,
  event_id uuid NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (consumer_name, event_id)
);

CREATE TABLE model_invocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  capability varchar(60) NOT NULL,
  provider varchar(60) NOT NULL,
  model varchar(120) NOT NULL,
  prompt_hash varchar(64) NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('succeeded', 'failed')),
  latency_ms integer NOT NULL DEFAULT 0,
  token_usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX model_invocations_created_idx ON model_invocations (created_at DESC);
CREATE INDEX outbox_implementation_idx
  ON outbox_events ((payload ->> 'implementation'), occurred_at)
  WHERE published_at IS NULL;
