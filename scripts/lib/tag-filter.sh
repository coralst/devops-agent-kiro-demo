#!/usr/bin/env bash
# 🟢 Pure helper: emits the hardcoded AWS Resource Groups Tagging API
# --tag-filters args used by the orphan-sweep step of app-down.sh.
#
# Safety invariant: the emitted string is a LITERAL. No variable
# interpolation, no reading from tfvars, no env-var lookups. This is
# deliberate — a compromised or misconfigured ambient environment must
# not be able to widen or narrow the sweep's scope. See
# design.md § Tag Scope Safety Model.
#
# This file is safely sourceable: it defines functions only, with no
# top-level side effects. Callers (app-down.sh) source it and then call
# build_tag_filter_args where needed. Do NOT add `set -euo pipefail`
# at the top of this file — that would leak into the caller's shell.
#
# Validates: Requirements 8.3, 10.1, 10.4

build_tag_filter_args() {
  echo '--tag-filters Key=Project,Values=devops-demo Key=ManagedBy,Values=terraform'
}
