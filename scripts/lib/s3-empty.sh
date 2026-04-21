#!/usr/bin/env bash
# 🟢 Helper: empties the S3 frontend bucket before `terraform destroy` runs.
#
# This file defines functions only — no top-level side effects. Callers
# source it and invoke empty_s3_bucket <bucket_name> <region>. Do NOT add
# `set -euo pipefail` at the top; it would leak into the caller's shell.
#
# Behavior:
#   1. Runs `aws s3 rm s3://<bucket>/ --recursive --region <region>` to
#      delete all current objects. If the bucket does not exist
#      (NoSuchBucket), treats that as success (a bucket that is already
#      gone is a valid terminal state for a teardown script).
#   2. Probes versioning via `aws s3api get-bucket-versioning`. If the
#      response contains "Status": "Enabled" or "Status": "Suspended"
#      (suspended buckets can still hold existing versions), runs a
#      paginated list-object-versions + delete-objects loop with a batch
#      size strictly ≤ 1000.
#   3. Does NOT delete the bucket itself — that's `terraform destroy`'s
#      job. This helper only empties it.
#
# Arguments:
#   $1 — bucket name (no s3:// prefix)
#   $2 — AWS region
#
# Returns:
#   0 on success OR when the bucket does not exist (NoSuchBucket)
#   non-zero on any other aws CLI failure, with failing command + stderr
#   surfaced to stderr
#
# Validates: Requirements 5.3, 5.4, 5.5

# Upper bound on objects per delete-objects call per R5.4. The AWS API
# caps this at 1000; we enforce it explicitly for safety.
readonly S3_DELETE_BATCH_MAX=1000

# ---------------------------------------------------------------------------
# empty_s3_bucket(bucket_name, region)
# ---------------------------------------------------------------------------
empty_s3_bucket() {
  local bucket="${1:-}"
  local region="${2:-}"

  if [[ -z "$bucket" || -z "$region" ]]; then
    echo "ERROR: empty_s3_bucket requires bucket_name and region arguments." >&2
    return 2
  fi

  echo "Emptying bucket ${bucket} in ${region}..."

  # Step 1: delete current objects. Capture stderr to distinguish
  # NoSuchBucket (treated as success) from other failures.
  local rm_stderr rm_rc
  rm_stderr="$(aws s3 rm "s3://${bucket}/" --recursive --region "$region" 2>&1 1>/dev/null)"
  rm_rc=$?

  if [[ $rm_rc -ne 0 ]]; then
    if [[ "$rm_stderr" == *"NoSuchBucket"* ]]; then
      echo "Bucket ${bucket} does not exist; treating as already empty."
      return 0
    fi
    echo "ERROR: aws s3 rm s3://${bucket}/ --recursive --region ${region} failed:" >&2
    echo "$rm_stderr" >&2
    return "$rm_rc"
  fi

  # Step 2: probe versioning.
  local versioning_json versioning_rc
  versioning_json="$(aws s3api get-bucket-versioning --bucket "$bucket" --region "$region" 2>&1)"
  versioning_rc=$?

  if [[ $versioning_rc -ne 0 ]]; then
    if [[ "$versioning_json" == *"NoSuchBucket"* ]]; then
      echo "Bucket ${bucket} does not exist; treating as already empty."
      return 0
    fi
    echo "ERROR: aws s3api get-bucket-versioning --bucket ${bucket} --region ${region} failed:" >&2
    echo "$versioning_json" >&2
    return "$versioning_rc"
  fi

  local status
  status="$(echo "$versioning_json" | jq -r '.Status // empty')"

  if [[ "$status" != "Enabled" && "$status" != "Suspended" ]]; then
    # Non-versioned bucket — current-object delete is sufficient.
    echo "Bucket ${bucket} is not versioned; done."
    return 0
  fi

  echo "Bucket ${bucket} has versioning ${status}; deleting non-current versions..."

  # Step 3: paginate through list-object-versions, batch into
  # delete-objects calls of at most S3_DELETE_BATCH_MAX entries per call.
  _empty_versioned_bucket "$bucket" "$region"
}

# ---------------------------------------------------------------------------
# _empty_versioned_bucket(bucket, region)
#   Paginates list-object-versions and issues delete-objects calls with
#   batch size strictly ≤ S3_DELETE_BATCH_MAX. Returns 0 on success,
#   non-zero on any aws failure.
# ---------------------------------------------------------------------------
_empty_versioned_bucket() {
  local bucket="$1"
  local region="$2"
  local next_token=""
  local list_output list_rc delete_payload delete_count delete_rc delete_stderr

  while true; do
    # Build list-object-versions invocation. When next_token is set, pass
    # it via --starting-token for pagination.
    if [[ -n "$next_token" ]]; then
      list_output="$(aws s3api list-object-versions \
        --bucket "$bucket" \
        --region "$region" \
        --max-items "$S3_DELETE_BATCH_MAX" \
        --starting-token "$next_token" 2>&1)"
    else
      list_output="$(aws s3api list-object-versions \
        --bucket "$bucket" \
        --region "$region" \
        --max-items "$S3_DELETE_BATCH_MAX" 2>&1)"
    fi
    list_rc=$?

    if [[ $list_rc -ne 0 ]]; then
      echo "ERROR: aws s3api list-object-versions --bucket ${bucket} --region ${region} failed:" >&2
      echo "$list_output" >&2
      return "$list_rc"
    fi

    # Build the Delete payload: merge Versions[] and DeleteMarkers[] into
    # a single {Objects: [...], Quiet: true} envelope. jq handles missing
    # or null arrays gracefully via // [].
    delete_payload="$(echo "$list_output" | jq -c '{
      Objects: (((.Versions // []) + (.DeleteMarkers // []))
                | map({Key: .Key, VersionId: .VersionId})),
      Quiet: true
    }')"
    delete_count="$(echo "$delete_payload" | jq '.Objects | length')"

    if [[ "$delete_count" -gt 0 ]]; then
      # Defensive: enforce batch bound even though --max-items caps input.
      if [[ "$delete_count" -gt "$S3_DELETE_BATCH_MAX" ]]; then
        echo "ERROR: delete batch size ${delete_count} exceeds max ${S3_DELETE_BATCH_MAX}" >&2
        return 1
      fi

      delete_stderr="$(aws s3api delete-objects \
        --bucket "$bucket" \
        --region "$region" \
        --delete "$delete_payload" 2>&1 1>/dev/null)"
      delete_rc=$?

      if [[ $delete_rc -ne 0 ]]; then
        echo "ERROR: aws s3api delete-objects --bucket ${bucket} --region ${region} failed:" >&2
        echo "$delete_stderr" >&2
        return "$delete_rc"
      fi
    fi

    # Extract the pagination token; jq returns the string "null" when
    # absent, which we normalize to empty to end the loop.
    next_token="$(echo "$list_output" | jq -r '.NextToken // ""')"
    if [[ -z "$next_token" || "$next_token" == "null" ]]; then
      break
    fi
  done

  return 0
}
