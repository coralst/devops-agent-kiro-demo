#!/usr/bin/env bash
# fault-inject.sh — Launches fio and dd to degrade the EBS volume.
# Usage: ./fault-inject.sh <mount-path>
# All stress processes are fully detached so the calling process returns
# immediately (Node exec must not block on backgrounded children).

set -euo pipefail

MOUNT_PATH="${1:?Usage: fault-inject.sh <mount-path>}"

# Idempotent: exit early if fault is already active
if [ -f "${MOUNT_PATH}/.fault-active" ]; then
  echo "[fault-inject] Fault already active, skipping."
  exit 0
fi

# Launch fio to exhaust IOPS (fully detached — stdin/stdout/stderr closed)
nohup fio --name=ebs-stress --ioengine=libaio --rw=randwrite --bs=4k --direct=1 --numjobs=8 --iodepth=64 --directory="${MOUNT_PATH}" --size=2G --time_based --runtime=3600 </dev/null >/dev/null 2>&1 &

# Launch dd to fill disk (fully detached)
nohup dd if=/dev/zero of="${MOUNT_PATH}/fill.dat" bs=1M count=15000 </dev/null >/dev/null 2>&1 &

# Create marker with timestamp
date -u +"%Y-%m-%dT%H:%M:%SZ" > "${MOUNT_PATH}/.fault-active"

echo "[fault-inject] Fault injection started at $(cat "${MOUNT_PATH}/.fault-active")"
