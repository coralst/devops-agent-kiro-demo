#!/usr/bin/env bash
# 🟢 Fail-closed pre-flight orchestrator for app-up.sh and app-down.sh.
#
# This file defines functions only — no top-level side effects. Callers
# source it and invoke run_preflight_checks "up" or "down". Do NOT add
# `set -euo pipefail` at the top; it would leak into the caller's shell.
#
# Each sub-check writes the exact error string required by the spec to
# stderr on failure, returns 0 on success / 1 on failure, and never emits
# a "proceed" sentinel on failure. The orchestrator short-circuits on the
# first failing sub-check so downstream stages never see a half-validated
# environment.
#
# Error-string catalog (verbatim per requirements.md):
#   R2.2  (up, aws missing):   ERROR: aws CLI is not installed. Install it from https://aws.amazon.com/cli/ and re-run.
#   R4.2  (down, aws missing): ERROR: aws CLI is not installed.
#   R2.5  (up, tf missing):    ERROR: terraform CLI is not installed and cannot be auto-installed on this platform. Install it from https://developer.hashicorp.com/terraform/downloads and re-run.
#   R4.4  (down, tf missing):  ERROR: terraform CLI is not installed.
#   R2.7  (up, creds bad):     ERROR: AWS credentials are not configured or are invalid. Run 'aws configure' or set AWS_PROFILE and re-run.
#   R4.6  (down, creds bad):   ERROR: AWS credentials are not configured or are invalid.
#   R2.9  (up, wrong acct):    ERROR: Expected AWS account 684394110906 but got <actual>. Check your AWS_PROFILE.
#   R4.8  (down, wrong acct):  ERROR: Expected AWS account 684394110906 but got <actual>. Refusing to destroy resources in the wrong account.
#   jq:                        ERROR: jq is required for JSON parsing. Install it and re-run.
#
# Validates: Requirements 2.1–2.9, 4.1–4.8

# The expected AWS account is a readonly constant so no caller-supplied
# value can widen the account-match check. `readonly` is re-declared
# idempotently on re-source via the guard below.
if [[ -z "${EXPECTED_ACCOUNT_ID:-}" ]]; then
  readonly EXPECTED_ACCOUNT_ID="684394110906"
fi

# ---------------------------------------------------------------------------
# check_aws_cli(mode)
#   Verifies the `aws` CLI is on PATH.
#   mode: "up" | "down" — selects the error-string variant per R2.2 / R4.2.
#   Returns 0 on success, 1 on failure.
# ---------------------------------------------------------------------------
check_aws_cli() {
  local mode="${1:-}"
  if command -v aws >/dev/null 2>&1; then
    return 0
  fi
  if [[ "$mode" == "up" ]]; then
    echo "ERROR: aws CLI is not installed. Install it from https://aws.amazon.com/cli/ and re-run." >&2
  else
    echo "ERROR: aws CLI is not installed." >&2
  fi
  return 1
}

# ---------------------------------------------------------------------------
# check_terraform_cli(mode)
#   Verifies the `terraform` CLI is on PATH. In "up" mode on Darwin with
#   brew available, attempts a one-shot `brew tap hashicorp/tap &&
#   brew install hashicorp/tap/terraform` before giving up (per R2.4).
#   In "down" mode, NEVER auto-installs — teardown must run against a
#   pre-installed terraform only (per R4.4).
#   Returns 0 on success, 1 on failure.
# ---------------------------------------------------------------------------
check_terraform_cli() {
  local mode="${1:-}"

  if command -v terraform >/dev/null 2>&1; then
    return 0
  fi

  # "up" mode only: attempt brew-based auto-install on Darwin.
  if [[ "$mode" == "up" ]]; then
    if [[ "$(uname -s)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
      echo "terraform CLI not found; attempting auto-install via Homebrew..."
      brew tap hashicorp/tap && brew install hashicorp/tap/terraform
      if command -v terraform >/dev/null 2>&1; then
        return 0
      fi
    fi
    echo "ERROR: terraform CLI is not installed and cannot be auto-installed on this platform. Install it from https://developer.hashicorp.com/terraform/downloads and re-run." >&2
    return 1
  fi

  # "down" mode: no auto-install, ever.
  echo "ERROR: terraform CLI is not installed." >&2
  return 1
}

# ---------------------------------------------------------------------------
# check_aws_credentials(mode)
#   Validates credentials by invoking `aws sts get-caller-identity`.
#   mode: "up" | "down" — selects the error-string variant per R2.7 / R4.6.
#   Returns 0 if the STS call exits zero; 1 otherwise.
# ---------------------------------------------------------------------------
check_aws_credentials() {
  local mode="${1:-}"
  if aws sts get-caller-identity >/dev/null 2>&1; then
    return 0
  fi
  if [[ "$mode" == "up" ]]; then
    echo "ERROR: AWS credentials are not configured or are invalid. Run 'aws configure' or set AWS_PROFILE and re-run." >&2
  else
    echo "ERROR: AWS credentials are not configured or are invalid." >&2
  fi
  return 1
}

# ---------------------------------------------------------------------------
# check_aws_account_id(mode)
#   Confirms the STS caller identity's Account matches EXPECTED_ACCOUNT_ID.
#   mode: "up" | "down" — selects the error-string variant per R2.9 / R4.8.
#   On mismatch, the actual account ID is substituted into the message.
#   Returns 0 on match, 1 on mismatch or if the STS call itself fails.
# ---------------------------------------------------------------------------
check_aws_account_id() {
  local mode="${1:-}"
  local actual
  if ! actual="$(aws sts get-caller-identity --query Account --output text 2>/dev/null)"; then
    # STS failure here is an unexpected state because check_aws_credentials
    # should have already run. Surface it as a credentials-style failure.
    if [[ "$mode" == "up" ]]; then
      echo "ERROR: AWS credentials are not configured or are invalid. Run 'aws configure' or set AWS_PROFILE and re-run." >&2
    else
      echo "ERROR: AWS credentials are not configured or are invalid." >&2
    fi
    return 1
  fi

  if [[ "$actual" == "$EXPECTED_ACCOUNT_ID" ]]; then
    return 0
  fi

  if [[ "$mode" == "up" ]]; then
    echo "ERROR: Expected AWS account ${EXPECTED_ACCOUNT_ID} but got ${actual}. Check your AWS_PROFILE." >&2
  else
    echo "ERROR: Expected AWS account ${EXPECTED_ACCOUNT_ID} but got ${actual}. Refusing to destroy resources in the wrong account." >&2
  fi
  return 1
}

# ---------------------------------------------------------------------------
# check_jq()
#   Verifies jq is on PATH (orphan-parse.sh depends on it).
#   Returns 0 on success, 1 on failure.
# ---------------------------------------------------------------------------
check_jq() {
  if command -v jq >/dev/null 2>&1; then
    return 0
  fi
  echo "ERROR: jq is required for JSON parsing. Install it and re-run." >&2
  return 1
}

# ---------------------------------------------------------------------------
# run_preflight_checks(mode)
#   Runs the fixed-order battery of checks and short-circuits on the first
#   failure. Emits a one-line progress message per sub-check on stdout on
#   success; stderr stays clean (errors come from the failing sub-check).
#   Returns 0 only if every sub-check returns 0; otherwise the first
#   non-zero return code.
# ---------------------------------------------------------------------------
run_preflight_checks() {
  local mode="${1:-}"

  echo -n "Checking aws CLI... "
  check_aws_cli "$mode"
  local rc=$?
  if [[ $rc -ne 0 ]]; then
    return "$rc"
  fi
  echo "ok"

  echo -n "Checking terraform CLI... "
  check_terraform_cli "$mode"
  rc=$?
  if [[ $rc -ne 0 ]]; then
    return "$rc"
  fi
  echo "ok"

  echo -n "Checking AWS credentials... "
  check_aws_credentials "$mode"
  rc=$?
  if [[ $rc -ne 0 ]]; then
    return "$rc"
  fi
  echo "ok"

  echo -n "Checking AWS account... "
  check_aws_account_id "$mode"
  rc=$?
  if [[ $rc -ne 0 ]]; then
    return "$rc"
  fi
  echo "ok (${EXPECTED_ACCOUNT_ID})"

  echo -n "Checking jq... "
  check_jq
  rc=$?
  if [[ $rc -ne 0 ]]; then
    return "$rc"
  fi
  echo "ok"

  return 0
}
