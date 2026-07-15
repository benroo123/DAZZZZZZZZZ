BEGIN;

CREATE OR REPLACE FUNCTION app.handle_supabase_auth_user_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  generated_public_id text := 'DC' || upper(substr(replace(new.id::text, '-', ''), 1, 18));
  generated_display_name text := coalesce(
    nullif(new.raw_user_meta_data ->> 'display_name', ''),
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    '新用户'
  );
BEGIN
  INSERT INTO app.users (id, public_id, status, age_verified, real_name_status)
  VALUES (new.id, generated_public_id, 'active', false, 'unverified')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO app.profiles (user_id, display_name, completion_percent, extra_attributes)
  VALUES (new.id, generated_display_name, 10, '{}'::jsonb)
  ON CONFLICT (user_id) DO NOTHING;

  INSERT INTO app.user_identities (
    user_id,
    provider,
    provider_subject_hash,
    assurance_level,
    verified_at
  )
  VALUES (
    new.id,
    'supabase',
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(new.id::text, 'UTF8')), 'hex'),
    coalesce(nullif(new.raw_app_meta_data ->> 'aal', ''), 'basic'),
    CASE WHEN new.email_confirmed_at IS NOT NULL OR new.phone_confirmed_at IS NOT NULL THEN now() END
  )
  ON CONFLICT (provider, provider_subject_hash) DO NOTHING;

  RETURN new;
END;
$$;

REVOKE ALL ON FUNCTION app.handle_supabase_auth_user_created() FROM PUBLIC;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION app.handle_supabase_auth_user_created();

INSERT INTO app.users (id, public_id, status, age_verified, real_name_status)
SELECT
  id,
  'DC' || upper(substr(replace(id::text, '-', ''), 1, 18)),
  'active',
  false,
  'unverified'
FROM auth.users
ON CONFLICT (id) DO NOTHING;

INSERT INTO app.profiles (user_id, display_name, completion_percent, extra_attributes)
SELECT
  id,
  coalesce(
    nullif(raw_user_meta_data ->> 'display_name', ''),
    nullif(raw_user_meta_data ->> 'full_name', ''),
    '新用户'
  ),
  10,
  '{}'::jsonb
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO app.user_identities (
  user_id,
  provider,
  provider_subject_hash,
  assurance_level,
  verified_at
)
SELECT
  id,
  'supabase',
  pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(id::text, 'UTF8')), 'hex'),
  coalesce(nullif(raw_app_meta_data ->> 'aal', ''), 'basic'),
  CASE WHEN email_confirmed_at IS NOT NULL OR phone_confirmed_at IS NOT NULL THEN now() END
FROM auth.users
ON CONFLICT (provider, provider_subject_hash) DO NOTHING;

COMMIT;
