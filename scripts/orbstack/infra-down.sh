#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
require_orbstack

if machine_exists; then
  run_as_root systemctl stop minio rabbitmq-server redis-server postgresql
  orbctl stop "${ORBSTACK_MACHINE}"
fi
