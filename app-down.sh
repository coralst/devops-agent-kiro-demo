#!/usr/bin/env bash
# 🟢 Top-level "app down" orchestrator. Five safety layers run in this
# order and NONE of them can be bypassed:
#
#   1. --yes argv gate (R3.2)     — NOTHING sourced, NO subprocess spawned
#                                    before this check. Missing --yes → exit 2.
#   2. Pre-flight checks (R4)     — aws/terraform present, creds valid, account
#                                    matches 684394110906. Any failure → exit 1.
#   3. S3 bucket empty (R5)       — resolve frontend bucket from tf output (or
#                                    state show fallback), then delete all
#                                    objects (+ versions). Any failure → exit 1.
#   4. terraform destroy (R6)     — record exit code but DO NOT exit on
#                                    failure; orphan sweep is the authority.
#   5. Orphan sweep (R7, R8)      — read-only tag-scoped query. Result feeds
#                                    the final exit-code truth table.
#
# Exit codes:
#   0 — clean teardown (orphan sweep = 0) OR destroy failed but sweep is clean
#   1 — pre-flight or S3 emptying failure
#   2 — --yes missing
#   3 — orphans remain after destroy
#   <other> — if the orphan sweep's `aws` CLI call itself fails, that exit
#             code propagates (this is NOT "orphans found" — it's an AWS
#             API error that prevents validating teardown success).
#
# Validates: Requirements 3.1–3.4, 4.1–4.8, 5.1–5.5, 6.1–6.4, 7.1–7.6, 8.1–8.3

set -euo pipefail

# ---------------------------------------------------------------------------
# Step 1: --yes argv gate (R3.2)
#
# This MUST be the first thing in the script. No sourcing, no SCRIPT_DIR
# resolution, no subprocess spawn before this branch — that is how we
# guarantee property P3: "argv without --yes never spawns aws/terraform."
# ---------------------------------------------------------------------------
yes_flag=0
for arg in "$@"; do
  if [[ "$arg" == "--yes" ]]; then
    yes_flag=1
  fi
done

if [[ $yes_flag -ne 1 ]]; then
  echo "ERROR: app-down.sh requires --yes to run. This will destroy all AWS resources tagged Project=devops-demo in account 684394110906. Usage: ./app-down.sh --yes" >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# Source helpers — safe now that the gate has passed.
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/scripts/lib/preflight.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/scripts/lib/s3-empty.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/scripts/lib/tag-filter.sh"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/scripts/lib/orphan-parse.sh"

TF_DIR="${SCRIPT_DIR}/terraform"

# ---------------------------------------------------------------------------
# Step 2: Pre-flight checks (R4.1–R4.8)
# ---------------------------------------------------------------------------
echo "==> [1/5] Pre-flight checks"
set +e
run_preflight_checks down
PREFLIGHT_RC=$?
set -e
if [[ $PREFLIGHT_RC -ne 0 ]]; then
  exit $PREFLIGHT_RC
fi

# ---------------------------------------------------------------------------
# Resolve Configured_Region from terraform/terraform.tfvars (R5.1, R7.1).
# Defaults to us-east-1 if the file is missing or the key is unset.
# ---------------------------------------------------------------------------
REGION="us-east-1"
if [[ -f "${TF_DIR}/terraform.tfvars" ]]; then
  region_from_tfvars="$(grep -E '^aws_region' "${TF_DIR}/terraform.tfvars" 2>/dev/null | head -1 | cut -d'"' -f2 || echo "")"
  if [[ -n "$region_from_tfvars" ]]; then
    REGION="$region_from_tfvars"
  fi
fi

# ---------------------------------------------------------------------------
# Step 3: Resolve S3 frontend bucket name (R5.1) and empty it (R5.3–R5.5).
#
# Primary: `terraform output -raw s3_bucket_name`.
# Fallback: parse `terraform state show aws_s3_bucket.frontend` for id.
# If neither yields a name, print R5.2 and skip emptying (destroy will
# then fail if the bucket actually contains objects — that's a Terraform
# concern, not this script's).
# ---------------------------------------------------------------------------
echo "==> [2/5] Resolving S3 frontend bucket"
BUCKET=""
set +e
BUCKET="$(cd "$TF_DIR" && terraform output -raw s3_bucket_name 2>/dev/null)"
set -e

if [[ -z "$BUCKET" ]]; then
  set +e
  STATE_SHOW_OUT="$(cd "$TF_DIR" && terraform state show aws_s3_bucket.frontend 2>/dev/null)"
  set -e
  # Extract the id = "<bucket>" line if present.
  BUCKET="$(echo "$STATE_SHOW_OUT" | grep -E '^[[:space:]]*id[[:space:]]*=' | head -1 | cut -d'"' -f2 || echo "")"
fi

echo "==> [3/5] Emptying S3 frontend bucket"
if [[ -z "$BUCKET" ]]; then
  echo "No S3 frontend bucket found in Terraform state; skipping bucket emptying."
else
  set +e
  empty_s3_bucket "$BUCKET" "$REGION"
  EMPTY_RC=$?
  set -e
  if [[ $EMPTY_RC -ne 0 ]]; then
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Step 4: terraform destroy (R6.1–R6.4).
#
# Record the exit code but DO NOT exit on non-zero — the orphan sweep is
# the authority on teardown success (R7.6: destroy-errored-but-sweep-clean
# is reconciled to exit 0).
# ---------------------------------------------------------------------------
echo "==> [4/5] terraform destroy"
destroy_rc=0
if [[ ! -f "${TF_DIR}/terraform.tfstate" ]]; then
  echo "No Terraform state found; skipping terraform destroy and running orphan sweep only."
else
  set +e
  (cd "$TF_DIR" && terraform destroy -auto-approve)
  destroy_rc=$?
  set -e
fi

# ---------------------------------------------------------------------------
# Step 5: Orphan sweep (R7.1, R8.3).
#
# The tag filter is a HARDCODED literal from build_tag_filter_args —
# ambient env can't widen the scope. If the `aws` call itself fails
# (network, permissions, service outage), propagate its exit code and
# print the failing command — this is NOT exit 3 (no orphans were
# confirmed; we couldn't check).
# ---------------------------------------------------------------------------
echo "==> [5/5] Orphan sweep"

# shellcheck disable=SC2046
set +e
sweep_out="$(aws resourcegroupstaggingapi get-resources --region "$REGION" $(build_tag_filter_args) 2>&1)"
sweep_rc=$?
set -e

if [[ $sweep_rc -ne 0 ]]; then
  echo "aws resourcegroupstaggingapi get-resources --region ${REGION} $(build_tag_filter_args) failed:" >&2
  echo "$sweep_out" >&2
  exit $sweep_rc
fi

# Parse ARNs; count non-empty lines.
orphans="$(echo "$sweep_out" | parse_orphan_arns)"
if [[ -z "$orphans" ]]; then
  orphan_count=0
else
  orphan_count=$(echo "$orphans" | wc -l | tr -d ' ')
fi

# ---------------------------------------------------------------------------
# Final exit-code truth table (R7.2, R7.3, R7.4, R7.5, R7.6).
#
# | destroy_rc | orphan_count | exit |
# |------------|--------------|------|
# | any        | > 0          | 3    |  — R7.3 header + ARNs to stderr
# | 0          | 0            | 0    |  — R7.2 clean message to stdout
# | non-zero   | 0            | 0    |  — R7.6 reconciliation to stdout
# ---------------------------------------------------------------------------
if [[ $orphan_count -gt 0 ]]; then
  echo "Orphan sweep: ${orphan_count} tagged resources still exist:" >&2
  echo "$orphans" >&2
  exit 3
fi

if [[ $destroy_rc -eq 0 ]]; then
  echo "Orphan sweep: 0 resources remain. Teardown complete."
  exit 0
else
  echo "terraform destroy reported errors but orphan sweep is clean; treating teardown as successful."
  exit 0
fi
