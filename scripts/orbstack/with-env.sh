#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"

export DATABASE_URL="${DATABASE_URL:-postgresql://dachang:dachang@${ORBSTACK_HOST}:5432/dachang}"
export REDIS_URL="${REDIS_URL:-redis://:dachang@${ORBSTACK_HOST}:6379/0}"
export RABBITMQ_URL="${RABBITMQ_URL:-amqp://dachang:dachang@${ORBSTACK_HOST}:5672}"
export S3_ENDPOINT="${S3_ENDPOINT:-${ORBSTACK_HOST}}"
export S3_PORT="${S3_PORT:-9000}"
export S3_ACCESS_KEY="${S3_ACCESS_KEY:-dachang}"
export S3_SECRET_KEY="${S3_SECRET_KEY:-dachang-local-secret}"
export S3_BUCKET="${S3_BUCKET:-media}"
export S3_USE_SSL="${S3_USE_SSL:-false}"
export PYTHONPATH="${PYTHONPATH:-${ROOT_DIR}/services/api-python}"

exec "$@"
