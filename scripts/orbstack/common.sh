#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ -f "${ROOT_DIR}/.env" ]]; then
  set -a
  source "${ROOT_DIR}/.env"
  set +a
fi
ORBSTACK_MACHINE="${ORBSTACK_MACHINE:-dachang-dev}"
ORBSTACK_HOST="${ORBSTACK_HOST:-127.0.0.1}"
VM_ROOT="/mnt/mac${ROOT_DIR}"

require_orbstack() {
  if ! command -v orbctl >/dev/null 2>&1; then
    echo "OrbStack CLI not found. Install OrbStack first: https://orbstack.dev" >&2
    exit 1
  fi
  if ! orbctl status >/dev/null 2>&1; then
    orbctl start >/dev/null
  fi
}

machine_exists() {
  orbctl info "${ORBSTACK_MACHINE}" >/dev/null 2>&1
}

ensure_machine() {
  require_orbstack
  if ! machine_exists; then
    orbctl create --cpus 4 --memory 8G --disk 40G ubuntu:24.04 "${ORBSTACK_MACHINE}"
  else
    orbctl start "${ORBSTACK_MACHINE}" >/dev/null
  fi

  for _ in $(seq 1 60); do
    if orbctl run -m "${ORBSTACK_MACHINE}" true >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  echo "OrbStack machine ${ORBSTACK_MACHINE} did not become ready" >&2
  exit 1
}

run_as_root() {
  orbctl run -m "${ORBSTACK_MACHINE}" -u root "$@"
}
