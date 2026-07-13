#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/common.sh"
ensure_machine
run_as_root bash "${VM_ROOT}/scripts/orbstack/bootstrap.sh" reset "${VM_ROOT}"
"${ROOT_DIR}/scripts/orbstack/infra-status.sh"
