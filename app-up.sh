#!/usr/bin/env bash
# 🟢 Top-level "app up" orchestrator. Runs fail-closed pre-flight checks,
# ensures terraform.tfvars exists, then drives `terraform init` (if needed),
# `terraform plan -detailed-exitcode`, and `terraform apply`. On a no-change
# plan (exit code 0), prints the R9.1 idempotency message and exits 0. On
# apply failure, propagates the apply exit code and writes the failing
# command name to stderr (per R1.6).
#
# The script is a linear sequence — no functions, no early returns beyond
# the exit-on-check-fail pattern. All branching lives inside the helpers.
#
# Validates: Requirements 1.1–1.6, 2.1–2.10, 9.1

set -euo pipefail

# Resolve this script's directory so the script works regardless of the
# caller's cwd, as long as it's invoked via its path.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# shellcheck disable=SC1091
source "${SCRIPT_DIR}/scripts/lib/preflight.sh"

# ---------------------------------------------------------------------------
# Step 1: Pre-flight checks (R2.1–R2.9)
# ---------------------------------------------------------------------------
echo "==> [1/5] Pre-flight checks"
set +e
run_preflight_checks up
PREFLIGHT_RC=$?
set -e
if [[ $PREFLIGHT_RC -ne 0 ]]; then
  exit $PREFLIGHT_RC
fi

# ---------------------------------------------------------------------------
# Step 2: tfvars bootstrap (R2.10)
# ---------------------------------------------------------------------------
echo "==> [2/5] Configuration"
TFVARS_FILE="${SCRIPT_DIR}/terraform/terraform.tfvars"
TFVARS_EXAMPLE="${SCRIPT_DIR}/terraform/terraform.tfvars.example"
if [[ ! -f "$TFVARS_FILE" ]] && [[ -f "$TFVARS_EXAMPLE" ]]; then
  cp "$TFVARS_EXAMPLE" "$TFVARS_FILE"
  echo "Copied terraform/terraform.tfvars.example to terraform/terraform.tfvars. Edit it if you need non-default values."
fi

# ---------------------------------------------------------------------------
# Step 3: terraform init (R1.3) — only when .terraform/ missing
# ---------------------------------------------------------------------------
echo "==> [3/5] terraform init"
TF_DIR="${SCRIPT_DIR}/terraform"
if [[ ! -d "${TF_DIR}/.terraform" ]]; then
  (cd "$TF_DIR" && terraform init)
fi

# ---------------------------------------------------------------------------
# Step 4: terraform plan -detailed-exitcode (R9.1)
#   exit 0 → no changes; print idempotency message and exit 0
#   exit 2 → changes pending; continue to apply
#   anything else → plan itself failed; propagate its exit code
# ---------------------------------------------------------------------------
echo "==> [4/5] terraform plan"
set +e
(cd "$TF_DIR" && terraform plan -detailed-exitcode -out=tfplan)
PLAN_RC=$?
set -e

if [[ $PLAN_RC -eq 0 ]]; then
  echo "No infrastructure changes required."
  exit 0
elif [[ $PLAN_RC -eq 2 ]]; then
  :  # changes pending, continue
else
  echo "terraform plan" >&2
  exit $PLAN_RC
fi

# ---------------------------------------------------------------------------
# Step 5: terraform apply (R1.4, R1.6)
# ---------------------------------------------------------------------------
echo "==> [5/5] terraform apply"
set +e
(cd "$TF_DIR" && terraform apply -auto-approve tfplan)
APPLY_RC=$?
set -e

if [[ $APPLY_RC -ne 0 ]]; then
  echo "terraform apply" >&2
  exit $APPLY_RC
fi

# ---------------------------------------------------------------------------
# Success: print outputs (R1.5)
# ---------------------------------------------------------------------------
echo ""
echo "Deployment complete. Outputs:"
ALB=$(cd "$TF_DIR" && terraform output -raw alb_dns_name 2>/dev/null || echo "")
CF=$(cd "$TF_DIR" && terraform output -raw cloudfront_domain_name 2>/dev/null || echo "")
SNS=$(cd "$TF_DIR" && terraform output -raw sns_topic_arn 2>/dev/null || echo "")
echo "alb_dns_name:            ${ALB}"
echo "cloudfront_domain_name:  ${CF}"
echo "sns_topic_arn:            ${SNS}"
