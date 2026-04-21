#!/usr/bin/env bash
# 🟢 Pure helper: reads a `aws resourcegroupstaggingapi get-resources` JSON
# response on stdin and emits one ResourceARN per line on stdout.
#
# Contract:
#   stdin:   JSON document of shape
#              {"ResourceTagMappingList":[{"ResourceARN":"arn:...","Tags":[...]}, ...]}
#   stdout:  one ResourceARN per line, in input-array order; empty for
#            an empty list
#   stderr:  empty on success; jq's error output on malformed JSON
#   return:  0 on success; propagates jq's non-zero exit on parse failure
#
# Notes:
#   - The transformation is delegated entirely to jq so that behavior is
#     deterministic and well-specified. jq is a required pre-flight
#     dependency (see preflight.sh).
#   - This file is safely sourceable: it defines a function only, with no
#     top-level side effects. Do NOT add `set -euo pipefail` at the top —
#     that would leak into the caller's shell.
#
# Validates: Requirements 10.2, 10.3, 10.4, 11.2

parse_orphan_arns() {
  jq -r '.ResourceTagMappingList[].ResourceARN'
}
