-- 搭场 PostgreSQL 16 + PostGIS schema baseline
-- Sensitive values such as phone numbers and identity references must be encrypted
-- by the application with KMS-backed envelope encryption.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE SCHEMA IF NOT EXISTS app;
SET search_path TO app, public;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id varchar(20) NOT NULL UNIQUE,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('pending', 'active', 'restricted', 'suspended', 'deleted')),
  phone_ciphertext bytea,
  phone_hash varchar(128) UNIQUE,
  age_verified boolean NOT NULL DEFAULT false,
  real_name_status varchar(20) NOT NULL DEFAULT 'unverified' CHECK (real_name_status IN ('unverified', 'pending', 'verified', 'failed', 'expired')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE TABLE user_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider varchar(40) NOT NULL,
  provider_subject_hash varchar(160) NOT NULL,
  provider_reference_ciphertext bytea,
  assurance_level varchar(20) NOT NULL DEFAULT 'basic',
  verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subject_hash)
);

CREATE TABLE user_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  platform varchar(16) NOT NULL CHECK (platform IN ('ios', 'android')),
  device_fingerprint_hash varchar(160) NOT NULL,
  push_token_ciphertext bytea,
  app_version varchar(32),
  trust_level varchar(20) NOT NULL DEFAULT 'unknown',
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_fingerprint_hash)
);

CREATE TABLE profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name varchar(40) NOT NULL,
  birth_date date,
  gender varchar(20),
  gender_visibility varchar(20) NOT NULL DEFAULT 'matches' CHECK (gender_visibility IN ('public', 'matches', 'activity_members', 'private')),
  bio varchar(500),
  city_code varchar(20),
  district_code varchar(20),
  coarse_location geography(Point, 4326),
  occupation varchar(80),
  personality_label varchar(32),
  preferred_group_min smallint CHECK (preferred_group_min BETWEEN 2 AND 50),
  preferred_group_max smallint CHECK (preferred_group_max BETWEEN 2 AND 50),
  availability jsonb NOT NULL DEFAULT '{}'::jsonb,
  extra_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  completion_percent smallint NOT NULL DEFAULT 0 CHECK (completion_percent BETWEEN 0 AND 100),
  attendance_rate numeric(5,2),
  rating numeric(3,2),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (preferred_group_min IS NULL OR preferred_group_max IS NULL OR preferred_group_min <= preferred_group_max)
);
CREATE INDEX profiles_city_idx ON profiles (city_code, district_code);
CREATE INDEX profiles_coarse_location_gist ON profiles USING gist (coarse_location);

CREATE TABLE privacy_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  allow_personalized_recommendations boolean NOT NULL DEFAULT true,
  allow_match_discovery boolean NOT NULL DEFAULT true,
  allow_search_by_public_id boolean NOT NULL DEFAULT true,
  exact_location_consent_at timestamptz,
  agent_data_access varchar(20) NOT NULL DEFAULT 'none' CHECK (agent_data_access IN ('none', 'selected', 'delegated')),
  field_visibility jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  purpose varchar(32) NOT NULL CHECK (purpose IN ('profile', 'post', 'activity', 'message', 'verification', 'ai_cover')),
  storage_key varchar(512) NOT NULL UNIQUE,
  mime_type varchar(80) NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  width integer,
  height integer,
  sha256 varchar(64) NOT NULL,
  moderation_status varchar(20) NOT NULL DEFAULT 'pending' CHECK (moderation_status IN ('pending', 'approved', 'rejected', 'quarantined')),
  ai_generated boolean NOT NULL DEFAULT false,
  ai_label_version varchar(32),
  provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  exif_removed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX media_owner_created_idx ON media_assets (owner_user_id, created_at DESC);
CREATE INDEX media_sha256_idx ON media_assets (sha256);

CREATE TABLE profile_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_asset_id uuid NOT NULL REFERENCES media_assets(id),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 5),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, position),
  UNIQUE (user_id, media_asset_id)
);
CREATE UNIQUE INDEX one_primary_profile_photo_idx ON profile_photos (user_id) WHERE is_primary;

CREATE TABLE interests (
  id bigserial PRIMARY KEY,
  slug varchar(60) NOT NULL UNIQUE,
  name varchar(60) NOT NULL,
  category varchar(60) NOT NULL,
  active boolean NOT NULL DEFAULT true
);

CREATE TABLE profile_interests (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  interest_id bigint NOT NULL REFERENCES interests(id),
  weight smallint NOT NULL DEFAULT 1 CHECK (weight BETWEEN 1 AND 5),
  PRIMARY KEY (user_id, interest_id)
);

CREATE TABLE follows (
  follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followed_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status varchar(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'muted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followed_id),
  CHECK (follower_id <> followed_id)
);
CREATE INDEX follows_followed_created_idx ON follows (followed_id, created_at DESC);

CREATE TABLE blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode varchar(20) NOT NULL DEFAULT 'standard' CHECK (mode IN ('standard', 'silent')),
  reason_code varchar(40),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX blocks_blocked_idx ON blocks (blocked_id, blocker_id);

CREATE TABLE posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES users(id),
  status varchar(20) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'published', 'rejected', 'hidden', 'deleted')),
  body varchar(5000) NOT NULL,
  city_code varchar(20),
  location geography(Point, 4326),
  visibility varchar(20) NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'followers', 'activity_members', 'private')),
  moderation_status varchar(20) NOT NULL DEFAULT 'pending',
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE INDEX posts_public_feed_idx ON posts (city_code, published_at DESC) WHERE status = 'published' AND visibility = 'public';

CREATE TABLE post_media (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_asset_id uuid NOT NULL REFERENCES media_assets(id),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 8),
  PRIMARY KEY (post_id, position),
  UNIQUE (post_id, media_asset_id)
);

CREATE TABLE comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id),
  parent_id uuid REFERENCES comments(id) ON DELETE CASCADE,
  body varchar(1000) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'published' CHECK (status IN ('pending_review', 'published', 'hidden', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_post_created_idx ON comments (post_id, created_at, id);

CREATE TABLE reactions (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type varchar(20) NOT NULL CHECK (target_type IN ('post', 'comment', 'message')),
  target_id uuid NOT NULL,
  reaction_type varchar(20) NOT NULL DEFAULT 'like',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_type, target_id, reaction_type)
);
CREATE INDEX reactions_target_idx ON reactions (target_type, target_id, created_at DESC);

CREATE TABLE activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organizer_id uuid NOT NULL REFERENCES users(id),
  title varchar(120) NOT NULL,
  description varchar(5000) NOT NULL,
  category varchar(60) NOT NULL,
  status varchar(24) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_review', 'published', 'full', 'ongoing', 'completed', 'cancelled', 'rejected', 'suspended')),
  join_policy varchar(24) NOT NULL DEFAULT 'approval' CHECK (join_policy IN ('open', 'approval', 'invite_only')),
  min_participants smallint NOT NULL,
  max_participants smallint NOT NULL,
  approved_count smallint NOT NULL DEFAULT 1 CHECK (approved_count BETWEEN 0 AND 50),
  waitlist_enabled boolean NOT NULL DEFAULT true,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  application_deadline timestamptz,
  timezone varchar(40) NOT NULL DEFAULT 'Asia/Shanghai',
  city_code varchar(20) NOT NULL,
  district_code varchar(20),
  venue_name varchar(120),
  public_location geography(Point, 4326),
  exact_location_ciphertext bytea,
  coordinate_system varchar(16) NOT NULL DEFAULT 'WGS84',
  cost_type varchar(20) NOT NULL DEFAULT 'free' CHECK (cost_type IN ('free', 'aa', 'fixed', 'organizer_pays')),
  cost_amount_cents integer CHECK (cost_amount_cents >= 0),
  currency char(3) NOT NULL DEFAULT 'CNY',
  moderation_status varchar(20) NOT NULL DEFAULT 'pending',
  published_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz,
  CHECK (min_participants BETWEEN 2 AND 50),
  CHECK (max_participants BETWEEN 2 AND 50),
  CHECK (min_participants <= max_participants),
  CHECK (ends_at > starts_at),
  CHECK (application_deadline IS NULL OR application_deadline <= starts_at)
);
CREATE INDEX activities_public_city_time_idx ON activities (city_code, starts_at, id) WHERE status IN ('published', 'full');
CREATE INDEX activities_organizer_idx ON activities (organizer_id, created_at DESC);
CREATE INDEX activities_location_gist ON activities USING gist (public_location);

CREATE TABLE activity_media (
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  media_asset_id uuid NOT NULL REFERENCES media_assets(id),
  position smallint NOT NULL CHECK (position BETWEEN 0 AND 8),
  PRIMARY KEY (activity_id, position),
  UNIQUE (activity_id, media_asset_id)
);

CREATE TABLE activity_tags (
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  interest_id bigint NOT NULL REFERENCES interests(id),
  PRIMARY KEY (activity_id, interest_id)
);

CREATE TABLE activity_members (
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(20) NOT NULL DEFAULT 'participant' CHECK (role IN ('organizer', 'cohost', 'participant')),
  status varchar(24) NOT NULL CHECK (status IN ('applied', 'waitlisted', 'approved', 'joined', 'rejected', 'cancelled', 'removed', 'checked_in', 'completed', 'no_show')),
  application_note varchar(500),
  organizer_note varchar(500),
  decision_by uuid REFERENCES users(id),
  decision_at timestamptz,
  joined_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (activity_id, user_id)
);
CREATE INDEX activity_members_review_idx ON activity_members (activity_id, status, created_at);
CREATE INDEX activity_members_user_idx ON activity_members (user_id, updated_at DESC);

CREATE TABLE activity_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  inviter_id uuid NOT NULL REFERENCES users(id),
  invitee_id uuid NOT NULL REFERENCES users(id),
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'revoked', 'expired')),
  token_hash varchar(128) UNIQUE,
  expires_at timestamptz NOT NULL,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (activity_id, invitee_id)
);

CREATE TABLE activity_checkins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method varchar(20) NOT NULL CHECK (method IN ('qr', 'organizer', 'geofence')),
  checked_in_at timestamptz NOT NULL DEFAULT now(),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (activity_id, user_id)
);

CREATE TABLE activity_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES users(id),
  reviewee_id uuid NOT NULL REFERENCES users(id),
  rating smallint NOT NULL CHECK (rating BETWEEN 1 AND 5),
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  body varchar(500),
  visible_after timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (activity_id, reviewer_id, reviewee_id),
  CHECK (reviewer_id <> reviewee_id)
);

CREATE TABLE match_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  min_age smallint CHECK (min_age BETWEEN 18 AND 99),
  max_age smallint CHECK (max_age BETWEEN 18 AND 99),
  max_distance_km smallint CHECK (max_distance_km BETWEEN 1 AND 100),
  preferred_genders jsonb NOT NULL DEFAULT '[]'::jsonb,
  interest_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  availability jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (min_age IS NULL OR max_age IS NULL OR min_age <= max_age)
);

CREATE TABLE swipes (
  actor_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  decision varchar(16) NOT NULL CHECK (decision IN ('pass', 'like', 'super_like')),
  context_activity_id uuid REFERENCES activities(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id, target_id),
  CHECK (actor_id <> target_id)
);
CREATE INDEX swipes_target_like_idx ON swipes (target_id, created_at DESC) WHERE decision IN ('like', 'super_like');

CREATE TABLE matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_low_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_high_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'unmatched', 'blocked', 'expired')),
  matched_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  UNIQUE (user_low_id, user_high_id),
  CHECK (user_low_id < user_high_id)
);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type varchar(20) NOT NULL CHECK (type IN ('direct', 'activity_group', 'system')),
  activity_id uuid UNIQUE REFERENCES activities(id) ON DELETE SET NULL,
  title varchar(120),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'closed')),
  last_message_id uuid,
  last_message_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((type = 'activity_group' AND activity_id IS NOT NULL) OR type <> 'activity_group')
);

CREATE TABLE conversation_members (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(20) NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  muted_until timestamptz,
  hidden_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  last_read_message_id uuid,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX conversation_members_user_idx ON conversation_members (user_id, joined_at DESC) WHERE left_at IS NULL;

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES users(id) ON DELETE SET NULL,
  client_message_id varchar(80),
  type varchar(20) NOT NULL CHECK (type IN ('text', 'image', 'activity_card', 'system', 'location')),
  body_ciphertext bytea,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  moderation_status varchar(20) NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  deleted_at timestamptz,
  UNIQUE (sender_id, client_message_id)
);
CREATE INDEX messages_conversation_cursor_idx ON messages (conversation_id, created_at DESC, id DESC);
ALTER TABLE conversations ADD CONSTRAINT conversations_last_message_fk FOREIGN KEY (last_message_id) REFERENCES messages(id) DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE message_receipts (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_at timestamptz,
  read_at timestamptz,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type varchar(60) NOT NULL,
  title varchar(120) NOT NULL,
  body varchar(500) NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_unread_idx ON notifications (user_id, created_at DESC) WHERE read_at IS NULL;

CREATE TABLE ai_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  purpose varchar(32) NOT NULL CHECK (purpose IN ('activity_cover', 'post_cover', 'summary', 'moderation_assist')),
  status varchar(20) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  model_provider varchar(60) NOT NULL,
  model_name varchar(120) NOT NULL,
  model_filing_reference varchar(160),
  prompt_redacted text NOT NULL,
  input_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  output_media_id uuid REFERENCES media_assets(id),
  parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_code varchar(80),
  human_confirmed_by uuid REFERENCES users(id),
  human_confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);
CREATE INDEX ai_jobs_user_created_idx ON ai_generation_jobs (user_id, created_at DESC);
CREATE INDEX ai_jobs_worker_idx ON ai_generation_jobs (status, created_at) WHERE status IN ('queued', 'running');

CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES users(id) ON DELETE SET NULL,
  target_type varchar(24) NOT NULL CHECK (target_type IN ('user', 'post', 'comment', 'activity', 'message', 'conversation')),
  target_id uuid NOT NULL,
  reason_code varchar(60) NOT NULL,
  details varchar(1000),
  evidence_media_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'triaged', 'resolved', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX reports_queue_idx ON reports (status, created_at);

CREATE TABLE moderation_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_type varchar(24) NOT NULL CHECK (source_type IN ('automated', 'report', 'appeal', 'audit')),
  source_id uuid,
  target_type varchar(24) NOT NULL,
  target_id uuid NOT NULL,
  risk_level smallint NOT NULL CHECK (risk_level BETWEEN 1 AND 5),
  status varchar(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'assigned', 'resolved', 'escalated')),
  assigned_to uuid,
  policy_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  decision jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);
CREATE INDEX moderation_queue_idx ON moderation_cases (status, risk_level DESC, created_at);

CREATE TABLE user_penalties (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  case_id uuid REFERENCES moderation_cases(id),
  type varchar(32) NOT NULL CHECK (type IN ('warning', 'feature_limit', 'content_ban', 'temporary_suspension', 'permanent_ban')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  ends_at timestamptz,
  reason_code varchar(60) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_penalties_active_idx ON user_penalties (user_id, starts_at, ends_at);

CREATE TABLE agent_principals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  name varchar(80) NOT NULL,
  agent_type varchar(24) NOT NULL CHECK (agent_type IN ('first_party', 'personal', 'organizer', 'venue', 'service')),
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'revoked')),
  public_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE agent_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agent_principals(id) ON DELETE CASCADE,
  granted_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scopes text[] NOT NULL,
  resource_constraints jsonb NOT NULL DEFAULT '{}'::jsonb,
  spending_limit_cents integer,
  valid_from timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX agent_grants_active_idx ON agent_grants (agent_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id uuid NOT NULL REFERENCES agent_principals(id),
  on_behalf_of uuid REFERENCES users(id),
  goal varchar(1000) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'awaiting_approval', 'succeeded', 'failed', 'cancelled')),
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE agent_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  sequence_no integer NOT NULL,
  operation_id varchar(120) NOT NULL,
  risk_level varchar(20) NOT NULL CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  dry_run boolean NOT NULL DEFAULT false,
  request_redacted jsonb NOT NULL,
  response_redacted jsonb,
  status varchar(24) NOT NULL CHECK (status IN ('planned', 'awaiting_approval', 'executing', 'succeeded', 'failed', 'denied')),
  idempotency_key varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (run_id, sequence_no)
);

CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action_id uuid NOT NULL UNIQUE REFERENCES agent_actions(id) ON DELETE CASCADE,
  requested_from uuid NOT NULL REFERENCES users(id),
  summary varchar(500) NOT NULL,
  diff jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied', 'expired', 'cancelled')),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  decision_reason varchar(500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approvals_user_pending_idx ON approvals (requested_from, created_at DESC) WHERE status = 'pending';

CREATE TABLE idempotency_keys (
  principal_type varchar(20) NOT NULL CHECK (principal_type IN ('user', 'agent', 'service')),
  principal_id uuid NOT NULL,
  operation_id varchar(120) NOT NULL,
  idempotency_key varchar(120) NOT NULL,
  request_hash varchar(64) NOT NULL,
  response_status integer,
  response_body jsonb,
  resource_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (principal_type, principal_id, operation_id, idempotency_key)
);

CREATE TABLE outbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  aggregate_type varchar(60) NOT NULL,
  aggregate_id uuid NOT NULL,
  event_type varchar(120) NOT NULL,
  event_version integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);
CREATE INDEX outbox_unpublished_idx ON outbox_events (occurred_at, id) WHERE published_at IS NULL;

CREATE TABLE webhook_endpoints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_type varchar(20) NOT NULL CHECK (owner_type IN ('user', 'agent', 'partner')),
  owner_id uuid NOT NULL,
  url_ciphertext bytea NOT NULL,
  secret_ciphertext bytea NOT NULL,
  subscribed_events text[] NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id uuid NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_id uuid NOT NULL REFERENCES outbox_events(id) ON DELETE CASCADE,
  attempt integer NOT NULL DEFAULT 1,
  status varchar(20) NOT NULL CHECK (status IN ('pending', 'succeeded', 'failed', 'dead_letter')),
  response_code integer,
  next_attempt_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (endpoint_id, event_id, attempt)
);

CREATE TABLE audit_logs (
  id bigserial PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_type varchar(20) NOT NULL CHECK (actor_type IN ('user', 'agent', 'admin', 'service')),
  actor_id uuid,
  delegated_by uuid,
  action varchar(120) NOT NULL,
  resource_type varchar(60),
  resource_id uuid,
  outcome varchar(20) NOT NULL CHECK (outcome IN ('allowed', 'denied', 'failed')),
  correlation_id uuid,
  request_hash varchar(64),
  metadata_redacted jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX audit_resource_idx ON audit_logs (resource_type, resource_id, occurred_at DESC);
CREATE INDEX audit_actor_idx ON audit_logs (actor_type, actor_id, occurred_at DESC);

