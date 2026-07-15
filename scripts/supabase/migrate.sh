#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "${SCRIPT_DIR}/../orbstack/common.sh"

ensure_machine

orbctl run -m "${ORBSTACK_MACHINE}" bash "${VM_ROOT}/scripts/supabase/migrate-inside.sh"
