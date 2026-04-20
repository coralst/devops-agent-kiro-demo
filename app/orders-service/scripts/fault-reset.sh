#!/usr/bin/env bash
# fault-reset.sh — Kills fio/dd processes and cleans up stress files.
# Usage: ./fault-reset.sh <mount-path>

set -euo pipefail

MOUNT_PATH="${1:?Usage: fault-reset.sh <mount-path>}"

# Kill fio processes
pkill -f "fio --name=ebs-stress" || true

# Kill dd processes
pkill -f "dd if=/dev/zero" || true

# Remove stress files
rm -f "${MOUNT_PATH}"/ebs-stress.* "${MOUNT_PATH}/fill.dat"

# Remove fault marker
rm -f "${MOUNT_PATH}/.fault-active"

echo "[fault-reset] Fault injection cleared."
