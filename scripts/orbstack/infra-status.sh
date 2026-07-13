#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_orbstack

if ! machine_exists; then
  echo "OrbStack machine ${ORBSTACK_MACHINE} does not exist" >&2
  exit 1
fi

run_as_root systemctl is-active --quiet postgresql redis-server rabbitmq-server minio
run_as_root bash -c "PGPASSWORD=dachang psql -h 127.0.0.1 -U dachang -d dachang -Atc 'select 1' >/dev/null"
run_as_root redis-cli -a dachang --no-auth-warning ping >/dev/null
run_as_root rabbitmq-diagnostics -q ping >/dev/null
curl -fsS "http://${ORBSTACK_HOST}:9000/minio/health/live" >/dev/null

echo "OrbStack machine: ${ORBSTACK_MACHINE} (${ORBSTACK_HOST})"
echo "PostgreSQL/PostGIS: ready :5432"
echo "Redis: ready :6379"
echo "RabbitMQ: ready :5672 (console :15672)"
echo "MinIO: ready :9000 (console :9001)"
