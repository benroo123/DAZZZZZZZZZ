#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
for env_file in "${REPO_ROOT}/.env" "${REPO_ROOT}/.env.local"; do
  if [[ -f "${env_file}" ]]; then
    set -a
    source "${env_file}"
    set +a
  fi
done

if [[ -z "${SUPABASE_DATABASE_URL:-}" ]]; then
  echo "SUPABASE_DATABASE_URL is required in .env.local" >&2
  exit 1
fi

schema_exists="$(psql "${SUPABASE_DATABASE_URL}" -v ON_ERROR_STOP=1 -Atc "select to_regclass('app.users') is not null")"
if [[ "${schema_exists}" != "t" ]]; then
  psql "${SUPABASE_DATABASE_URL}" -v ON_ERROR_STOP=1 \
    -f "${REPO_ROOT}/activity-social-app-product/database/schema.sql"
  psql "${SUPABASE_DATABASE_URL}" -v ON_ERROR_STOP=1 \
    -f "${REPO_ROOT}/infra/db/002-runtime.sql"
  if [[ "${SUPABASE_SEED_DEMO:-false}" == "true" ]]; then
    psql "${SUPABASE_DATABASE_URL}" -v ON_ERROR_STOP=1 \
      -f "${REPO_ROOT}/infra/db/003-seed.sql"
  fi
fi

psql "${SUPABASE_DATABASE_URL}" -v ON_ERROR_STOP=1 \
  -f "${REPO_ROOT}/infra/supabase/001-auth-bridge.sql"

echo "Supabase schema and Auth bridge are ready"
