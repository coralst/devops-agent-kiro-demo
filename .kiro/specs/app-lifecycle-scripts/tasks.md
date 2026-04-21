# Implementation Plan: App Lifecycle Scripts

## Overview

This plan implements `app-up.sh` and `app-down.sh` by building small, pure bash helpers under `scripts/lib/` and composing them into the two top-level scripts. Every safety-critical primitive — the tag-filter constant, the orphan-ARN parser, and the `--yes` argv gate — is test-covered **before** the surrounding orchestrator wires it in. All tests run via TypeScript + Vitest + fast-check, shelling out to bash through `child_process.spawnSync` with a PATH-stubbed `aws`/`terraform`/`brew` harness (no real AWS calls, ever).

Build order is driven by four design rules:

- **Safety primitives first.** `build_tag_filter_args`, `parse_orphan_arns`, and the `--yes` gate get failing tests before implementation, so the guard conditions are provably enforced by code.
- **Fail-closed before destructive.** Pre-flight checks and the `--yes` gate are complete and tested before any `terraform apply`, `terraform destroy`, or `aws s3 rm` is wired.
- **Helpers before orchestrators.** Every `scripts/lib/*.sh` helper is done and tested before `app-up.sh` or `app-down.sh` uses it.
- **`app-up.sh` before `app-down.sh`.** Up is simpler (no gate, no sweep) and validates the pre-flight pattern on the less-dangerous path first.

Tasks marked `*` are optional — they can be skipped for a faster MVP. Every property test (P1–P7) is optional so the core pipeline can land quickly, but they're the only machine-checkable proofs of the safety invariants and should be completed for merge-to-trunk.

## Tasks

- [ ] 1. Bootstrap the scripts/lib test harness
  - [x] 1.1 Create `scripts/lib/package.json`
    - Mirror `app/orders-service/package.json` devDependencies: `vitest ^2.1.0`, `fast-check ^3.22.0`, `@types/node ^22.0.0`, `typescript ^5.5.0`, `tsx ^4.21.0`
    - Name the package `@demo/scripts-lib`, set `"private": true`
    - Add `"test": "vitest"` and `"typecheck": "tsc --noEmit"` scripts
    - _Requirements: 11.4_

  - [x] 1.2 Create `scripts/lib/vite.config.ts` and `scripts/lib/tsconfig.json`
    - Vite config matches `app/orders-service/vite.config.ts` exactly (`defineConfig` from `vitest/config`, `test: { globals: true }`)
    - tsconfig matches `app/orders-service/tsconfig.json` shape (strict mode, ES2022 target)
    - _Requirements: 11.4_

  - [x] 1.3 Add `test:scripts` entry to root `package.json`
    - Add `"test:scripts": "npm test --prefix scripts/lib -- --run"`
    - Update aggregate `"test"` to `"npm run test:catalog && npm run test:orders && npm run test:scripts"`
    - Do not touch any other root script
    - _Requirements: 11.4_

- [ ] 2. Build the PATH-stub test harness
  - [x] 2.1 Implement `scripts/lib/test-helpers/spawn-bash.ts`
    - Thin wrapper around `child_process.spawnSync('bash', ['-c', <script>], { input, env, encoding: 'utf8' })`
    - Accepts: bash source-line to execute, optional stdin string, optional env overrides
    - Returns `{ status, stdout, stderr }`
    - _Requirements: 10.4, 11.4_

  - [x] 2.2 Implement `scripts/lib/test-helpers/make-stub-bin.ts`
    - Exports `makeStubBin({ commands })` returning `{ stubDir, callLogPath, cleanup }`
    - Creates a tempdir, writes one executable bash script per command (`aws`, `terraform`, `brew`, optionally `jq`)
    - Each stub logs its argv + stdin as a JSON line to `callLogPath` before exiting
    - Stubs honor env knobs: `STUB_AWS_FAIL_GET_CALLER_IDENTITY`, `STUB_AWS_ACCOUNT_ID`, `STUB_TERRAFORM_DESTROY_RC`, `STUB_S3_BUCKET_VERSIONING`, `STUB_ORPHAN_JSON_FILE`
    - `passthrough: true` resolves to the real binary on the parent PATH (used for `jq`)
    - _Requirements: 10.4, 11.4_

  - [ ]* 2.3 Unit tests for the harness itself
    - Verify `makeStubBin` creates executable files, `callLogPath` records argv + stdin as JSON-per-line, env knobs flip exit codes, and `cleanup` removes the tempdir
    - _Requirements: 11.4_

- [ ] 3. Safety-critical primitive: tag filter (test-first)
  - [x] 3.1 Write failing tests in `scripts/lib/tag-filter.test.ts`
    - Sources the not-yet-existing `scripts/lib/tag-filter.sh` and asserts `build_tag_filter_args` emits exactly `--tag-filters Key=Project,Values=devops-demo Key=ManagedBy,Values=terraform` on stdout with empty stderr and exit 0
    - _Requirements: 8.3, 10.1, 11.1_

  - [x] 3.2 Implement `scripts/lib/tag-filter.sh`
    - `build_tag_filter_args()` writes the hardcoded literal string to stdout — no variable interpolation, no reading from tfvars, no arguments
    - File is safely sourceable with no side effects at source-time
    - Shebang `#!/usr/bin/env bash`, `set -euo pipefail`, Bash 3.2-compatible (macOS default)
    - _Requirements: 8.3, 10.1, 10.4_

  - [ ]* 3.3 Property test for `build_tag_filter_args` environment-independence
    - File: `scripts/lib/tag-filter.property.test.ts`
    - **Property 2: `build_tag_filter_args` environment-independence**
    - **Validates: Requirements 8.3, 10.1**
    - fast-check generates arbitrary env-var maps (including `PROJECT_NAME`, `AWS_REGION`, `AWS_PROFILE`, random pollution)
    - Asserts stdout is always the exact literal string regardless of env
    - At least 100 iterations
    - _Requirements: 8.3, 10.1_

- [ ] 4. Safety-critical primitive: orphan ARN parser (test-first)
  - [x] 4.1 Write failing tests in `scripts/lib/orphan-parse.test.ts`
    - Three example cases per R11.2: empty `ResourceTagMappingList`, single element, multi-element
    - Asserts one ARN per line, input order preserved, empty stdout for empty list, empty stderr on success
    - Additional case: malformed JSON → non-zero exit, jq error on stderr
    - _Requirements: 10.2, 11.2_

  - [x] 4.2 Implement `scripts/lib/orphan-parse.sh`
    - `parse_orphan_arns()` reads stdin and runs `jq -r '.ResourceTagMappingList[].ResourceARN'`
    - Propagates jq's non-zero exit on parse failure
    - No arguments, no side effects, safely sourceable
    - _Requirements: 10.2, 10.3, 10.4_

  - [ ]* 4.3 Property test for parse_orphan_arns round-trip
    - File: `scripts/lib/orphan-parse.property.test.ts`
    - **Property 1: `parse_orphan_arns` round-trip (count invariant)**
    - **Validates: Requirements 10.3, 11.3**
    - fast-check generates `{ResourceTagMappingList: Array<{ResourceARN, Tags}>}` with realistic ARN shapes (`arn:aws:<service>:<region>:<account>:<resource-id>`)
    - Asserts output line count equals input array length AND each line matches the corresponding `ResourceARN` in order
    - At least 100 iterations
    - _Requirements: 10.3, 11.3_

- [x] 5. Checkpoint — tag-scope primitives verified
  - Ensure all tests pass, ask the user if questions arise.
  - At this point the two purest safety primitives are locked in. Nothing downstream can silently widen the tag scope or miscount orphans.

- [ ] 6. Pre-flight checks (fail-closed)
  - [x] 6.1 Implement individual check functions in `scripts/lib/preflight.sh`
    - `readonly EXPECTED_ACCOUNT_ID="684394110906"` at top of file
    - `check_aws_cli()` — `command -v aws`, error string per R2.2 / R4.2
    - `check_terraform_cli(mode)` — `command -v terraform`; in `up` mode on Darwin with brew, run `brew tap hashicorp/tap && brew install hashicorp/tap/terraform`; in `down` mode NEVER auto-install; error strings per R2.5 / R4.4
    - `check_aws_credentials(mode)` — `aws sts get-caller-identity`; error strings per R2.7 / R4.6
    - `check_aws_account_id(mode)` — compare returned account to `EXPECTED_ACCOUNT_ID`; error strings per R2.9 / R4.8 with `<actual>` substituted
    - `check_jq()` — `command -v jq`; error string per design § Failure Modes
    - Each function writes exact error strings to stderr, returns 0/1, has no mutating side effects beyond the one optional brew install
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [x] 6.2 Implement `run_preflight_checks(mode)` orchestrator
    - Calls each check in fixed order: `check_aws_cli`, `check_terraform_cli $mode`, `check_aws_credentials $mode`, `check_aws_account_id $mode`, `check_jq`
    - Short-circuits on first non-zero return, propagates that return code
    - Never emits a "proceed" sentinel on failure (callers rely on exit code only)
    - _Requirements: 2.1–2.9, 4.1–4.8_

  - [x] 6.3 Unit tests in `scripts/lib/preflight.test.ts`
    - Per-check: exact stderr byte sequence, exit code, whether stub `aws`/`terraform`/`brew` was invoked
    - `up` mode + Darwin + brew → auto-install path called; `up` mode + Darwin + no brew → R2.5 error; `down` mode + missing terraform → R4.4 error with NO brew invocation
    - Account-mismatch case: `STUB_AWS_ACCOUNT_ID=000000000000` → error message contains that value
    - _Requirements: 2.1–2.10, 4.1–4.8_

  - [ ]* 6.4 Property test for pre-flight fail-closed behavior
    - File: `scripts/lib/preflight.property.test.ts`
    - **Property 4: Pre-flight checks fail-closed**
    - **Validates: Requirements 2.1–2.9, 4.1–4.8**
    - fast-check generates all 2^5 combinations of (aws-present, terraform-present, creds-valid, account-matches, jq-present) via env knobs
    - Asserts: whenever ANY sub-check is set to fail, `run_preflight_checks` returns non-zero
    - At least 100 iterations (fast-check shrinks the space)
    - _Requirements: 2.1–2.9, 4.1–4.8_

- [ ] 7. S3 bucket emptying helper
  - [x] 7.1 Implement `scripts/lib/s3-empty.sh`
    - `empty_s3_bucket(bucket_name, region)` — runs `aws s3 rm s3://<bucket>/ --recursive --region <region>`
    - Probe versioning via `aws s3api get-bucket-versioning`; if `Status` is `Enabled` or `Suspended`, run paginated `list-object-versions` + `delete-objects` loop with **batch size strictly ≤ 1000** (use `jq` to chunk the payload)
    - Treat `NoSuchBucket` response as success (already-deleted bucket is a valid terminal state)
    - Any other `aws` failure → return non-zero with failing command + its stderr surfaced
    - Does NOT delete the bucket itself — that's Terraform's job
    - _Requirements: 5.3, 5.4, 5.5_

  - [x] 7.2 Unit tests in `scripts/lib/s3-empty.test.ts`
    - Non-versioned bucket → single `aws s3 rm --recursive` call; no `delete-objects` calls
    - Versioned bucket with small object count → one `delete-objects` call with all versions
    - `NoSuchBucket` error from `aws s3 rm` → exit 0
    - `AccessDenied` error → non-zero exit, failing command on stderr
    - _Requirements: 5.3, 5.4, 5.5_

  - [ ]* 7.3 Property test for S3 version-deletion batch size bound
    - File: `scripts/lib/s3-empty.property.test.ts`
    - **Property 6: S3 version-deletion batch size ≤ 1000**
    - **Validates: Requirement 5.4**
    - fast-check generates object-version lists of arbitrary length N ∈ [0, 3500]; stub responds to `list-object-versions` with pages drawn from that list
    - Inspects call log: every `delete-objects` call's `Delete.Objects` array has length in [1, 1000]; union across calls equals the input list exactly
    - At least 100 iterations
    - _Requirements: 5.4_

- [ ] 8. Checkpoint — all helpers complete and green
  - Ensure all tests pass, ask the user if questions arise.
  - All four `scripts/lib/*.sh` files are implemented and independently tested. The next phase is composition.

- [ ] 9. Terraform outputs integration
  - [ ] 9.1 Add `s3_bucket_name` output to `terraform/outputs.tf`
    - `output "s3_bucket_name" { description = "..."; value = aws_s3_bucket.frontend.id }`
    - Keep all existing outputs unchanged
    - _Requirements: 5.1_

- [ ] 10. Implement `app-up.sh` (the simpler path first)
  - [ ] 10.1 Create `app-up.sh` with pre-flight + tfvars handling
    - Shebang `#!/usr/bin/env bash`, `set -euo pipefail`, executable bit set
    - Source `scripts/lib/preflight.sh`, call `run_preflight_checks up`
    - On pre-flight failure, exit 1 (propagate sub-check's return)
    - If `terraform/terraform.tfvars` missing and `terraform/terraform.tfvars.example` exists, copy and print the R2.10 message to stdout
    - Print labeled progress step prefixes per design § Observability (`==> [1/N] ...`)
    - _Requirements: 1.1, 1.2, 2.1–2.10_

  - [ ] 10.2 Wire terraform init/plan/apply into `app-up.sh`
    - If `terraform/.terraform` does not exist, run `terraform init` in `terraform/`
    - Run `terraform plan -detailed-exitcode`; on exit 0 (no changes), print R9.1 message and exit 0; on exit 2 (changes), continue; any other code fails
    - Run `terraform apply -auto-approve`; on non-zero, print `terraform apply` to stderr and exit with the apply's exit code
    - On success, print `alb_dns_name`, `s3_website_url`, `sns_topic_arn` as labeled lines to stdout
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 9.1_

  - [ ] 10.3 Unit tests in `scripts/lib/app-up.test.ts`
    - Pre-flight failure → exit 1, no `terraform` calls in log
    - tfvars-missing path → example copied, R2.10 message on stdout
    - `terraform plan` exit 0 → R9.1 message, no `apply` called
    - `terraform plan` exit 2 → `apply` called
    - Stub `STUB_TERRAFORM_APPLY_RC=7` → script exits 7, stderr contains `terraform apply`
    - Successful apply → labeled output lines present
    - _Requirements: 1.1–1.6, 2.10, 9.1_

  - [ ]* 10.4 Property test for terraform apply exit-code propagation
    - File: `scripts/lib/app-up.property.test.ts`
    - **Property 7: `terraform apply` exit code is propagated**
    - **Validates: Requirement 1.6**
    - fast-check generates arbitrary non-zero integers ∈ [1, 255] for `STUB_TERRAFORM_APPLY_RC`
    - Asserts `app-up.sh` exits with the same code AND stderr contains the string `terraform apply`
    - At least 100 iterations
    - _Requirements: 1.6_

- [ ] 11. Checkpoint — `app-up.sh` green
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Safety-critical: `--yes` argv gate (test-first, before `app-down.sh` does anything destructive)
  - [ ] 12.1 Write failing tests for the gate in `scripts/lib/app-down.test.ts`
    - Empty argv → exit 2, R3.2 error on stderr, zero `aws`/`terraform` calls in log
    - Argv `["--no"]` → exit 2, zero calls
    - Argv `["--yes"]` → gate passes (exit is NOT 2; other pre-flight failures may exit 1, that's fine here)
    - Gate check happens BEFORE any `source` of helpers (assert no helper-side-effect file is created when gate fails)
    - _Requirements: 3.2, 3.3, 8.1, 8.2_

  - [ ] 12.2 Create `app-down.sh` with ONLY the argv gate
    - Shebang + `set -euo pipefail`, executable bit set
    - Parse argv with a literal `for arg in "$@"; do [[ "$arg" == "--yes" ]] && yes_flag=1; done` — no getopt, no fuzzy matching, no `-y`
    - If gate fails, print R3.2 to stderr and exit 2 BEFORE sourcing any helper or spawning any subprocess
    - No destructive work yet — this task only lands the gate
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 8.1_

  - [ ]* 12.3 Property test for the `--yes` gate
    - File: `scripts/lib/app-down.property.test.ts`
    - **Property 3: `--yes` gate never allows destruction**
    - **Validates: Requirements 3.2, 8.1, 8.2**
    - fast-check generates argv arrays that do NOT contain the literal token `--yes` (positive: `app-down.sh` exits 2, no stub binary is invoked — verified by checking that `callLogPath` is empty)
    - Complementary property: argvs that DO contain `--yes` somewhere → exit code is NOT 2
    - At least 100 iterations
    - _Requirements: 3.2, 8.1, 8.2_

- [ ] 13. Checkpoint — `--yes` gate locked in
  - Ensure all tests pass, ask the user if questions arise.
  - From here on, every new layer is added AFTER the gate, so we can't regress the gate's placement.

- [ ] 14. Layer: pre-flight inside `app-down.sh`
  - [ ] 14.1 Add pre-flight invocation after the `--yes` gate
    - Source `scripts/lib/preflight.sh`, call `run_preflight_checks down`
    - On failure, exit 1 with the sub-check's return code
    - _Requirements: 4.1–4.8_

  - [ ] 14.2 Extend `app-down.test.ts` with pre-flight cases
    - `--yes` + missing aws CLI → exit 1, R4.2 error
    - `--yes` + wrong account → exit 1, R4.8 error containing the wrong account ID
    - `--yes` + all pre-flight passes → proceeds further (terraform/aws calls appear in log)
    - _Requirements: 4.1–4.8_

- [ ] 15. Layer: S3 bucket resolution + emptying inside `app-down.sh`
  - [ ] 15.1 Add bucket resolution + `empty_s3_bucket` invocation
    - Source `scripts/lib/s3-empty.sh`
    - Resolve bucket via `terraform output -raw s3_bucket_name` in `terraform/`
    - On resolution failure, fall back to `terraform state show aws_s3_bucket.frontend` parsing
    - If still unresolved, print R5.2 message and continue to destroy
    - Otherwise call `empty_s3_bucket <bucket> <region>`; on non-zero return, exit 1 with failing command on stderr
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

  - [ ] 15.2 Extend `app-down.test.ts` with S3 cases
    - Bucket resolved + empty succeeds → `aws s3 rm` call in log, proceeds to destroy
    - `terraform output` fails → fallback to `state show` path runs
    - Neither works → R5.2 message on stdout, no `aws s3 rm` call, proceeds to destroy
    - `aws s3 rm` fails with `AccessDenied` → exit 1, failing command on stderr, NO `terraform destroy` call in log
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

- [ ] 16. Layer: `terraform destroy` inside `app-down.sh`
  - [ ] 16.1 Add `terraform destroy` invocation
    - If `terraform/terraform.tfstate` does not exist, print R6.4 message and set `destroy_rc=0`
    - Otherwise run `terraform destroy -auto-approve` in `terraform/` and record exit code in `destroy_rc`
    - Do NOT exit on non-zero `destroy_rc` — orphan sweep must still run
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ] 16.2 Extend `app-down.test.ts` with destroy cases
    - Missing tfstate → R6.4 message, no `terraform destroy` call, orphan sweep still runs
    - `STUB_TERRAFORM_DESTROY_RC=0` → orphan sweep runs after destroy succeeds
    - `STUB_TERRAFORM_DESTROY_RC=1` → orphan sweep still runs, script does NOT exit yet
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [ ] 17. Layer: orphan sweep + final exit-code contract
  - [ ] 17.1 Wire orphan sweep into `app-down.sh`
    - Source `scripts/lib/tag-filter.sh` and `scripts/lib/orphan-parse.sh`
    - Call `aws resourcegroupstaggingapi get-resources --region <region> $(build_tag_filter_args)`
    - Pipe response to `parse_orphan_arns`, count lines into `orphan_count`
    - If the `aws` call itself fails (non-JSON response or non-zero exit), exit with that `aws` exit code and print the failing command to stderr (per design § Error Handling — this is NOT exit 3)
    - _Requirements: 7.1, 8.3_

  - [ ] 17.2 Implement the final exit-code truth table
    - `orphan_count > 0` → print R7.3 header + each ARN on its own line to stderr, exit 3 (regardless of `destroy_rc`)
    - `orphan_count == 0 && destroy_rc == 0` → print R7.2 message to stdout, exit 0
    - `orphan_count == 0 && destroy_rc != 0` → print R7.6 reconciliation message to stdout, exit 0
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ] 17.3 Extend `app-down.test.ts` with final-state cases
    - `(destroy_rc=0, orphans=0)` → exit 0, R7.2 message on stdout
    - `(destroy_rc=0, orphans=2)` → exit 3, R7.3 header + both ARNs on stderr
    - `(destroy_rc=1, orphans=0)` → exit 0, R7.6 message on stdout
    - `(destroy_rc=1, orphans=2)` → exit 3, R7.3 output on stderr
    - Orphan-sweep `aws` call itself fails → exit with `aws` exit code (not 3), failing command on stderr
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ]* 17.4 Property test for teardown exit-code determinism
    - File: `scripts/lib/app-down.exitcode.property.test.ts`
    - **Property 5: Teardown exit code is fully determined by (destroy_rc, orphan_count)**
    - **Validates: Requirements 7.4, 7.5, 7.6**
    - fast-check generates `(destroy_rc ∈ [0, 255], orphan_count ∈ [0, 50])` with pre-flight + S3 empty set to success
    - Asserts: `orphan_count > 0 → exit 3`; `orphan_count == 0 → exit 0` (regardless of `destroy_rc`)
    - At least 100 iterations
    - _Requirements: 7.4, 7.5, 7.6_

- [ ] 18. Idempotency tests
  - [ ] 18.1 Add re-run cases to `app-down.test.ts`
    - `--yes` run after a clean prior teardown (stubs: `destroy_rc=0`, `orphans=0` both runs) → exit 0, R7.2 message
    - `--yes` run after a partial prior teardown (stubs: first run fails mid-destroy, second run completes) → exit status follows R7 truth table; S3 empty + destroy + sweep all re-attempted in order
    - For `app-up.sh`: re-run with `terraform plan` exit 0 → exit 0, R9.1 message
    - _Requirements: 9.1, 9.2, 9.3_

- [ ] 19. Tag-scope safety audit (grep-based regression guard)
  - [ ] 19.1 Write `scripts/lib/tag-scope.test.ts`
    - Runs `grep -nE '(ec2 terminate-instances|rds delete-db-instance|ec2 delete-volume|iam delete-role|s3api delete-bucket)' app-up.sh app-down.sh scripts/lib/*.sh`
    - Asserts exit code is 1 (grep found nothing) — any match fails the test loudly with the offending line
    - This mechanically enforces R8.2 forever; any future contributor adding a forbidden direct-delete API breaks CI
    - _Requirements: 8.1, 8.2_

- [ ] 20. Checkpoint — full pipeline verified end-to-end under stubs
  - Ensure all tests pass, ask the user if questions arise.
  - Every requirement now has test coverage. Every safety invariant has either a property test or the grep audit behind it.

- [ ]* 21. Optional: LocalStack-gated integration test
  - Gated behind env var `LOCALSTACK_E2E=1` (skipped by default in CI)
  - Single test: spin up LocalStack, apply a tiny subset of the Terraform config (S3 only), run `app-down.sh --yes`, assert clean sweep
  - Out of scope for the core feature; include only if the team wants a real-API smoke test
  - _Requirements: none — supplemental coverage_

- [ ] 22. README update
  - [ ] 22.1 Add `## AWS Deployment (Scripted)` section to repo root `README.md`
    - Show `./app-up.sh` and `./app-down.sh --yes` as the primary flow
    - State the exact expected account (`684394110906`) and that `app-down.sh` requires `--yes`
    - Mention the three failure exit codes (1 = pre-flight/S3, 2 = missing `--yes`, 3 = orphans remain)
    - _Requirements: 12.1, 12.3_

  - [ ] 22.2 Rename the existing `## AWS Deployment (Terraform)` section to `## AWS Deployment (Manual Terraform)`
    - Keep all existing content for users who prefer direct Terraform control
    - _Requirements: 12.2_

## Notes

- Tasks marked `*` are optional (property tests P1–P7 + the LocalStack e2e). They're the machine-checkable proofs of the safety invariants; skip only for a deliberately fast MVP.
- Every property-test sub-task cites its P-number and the specific Requirements it validates, so traceability is explicit.
- Checkpoints (tasks 5, 8, 11, 13, 20) exist at the boundaries of the four safety layers: pure primitives → pre-flight/helpers → `app-up.sh` → `--yes` gate → destructive pipeline. If a regression is introduced, it's caught at the nearest checkpoint.
- No task runs real `terraform apply` or `terraform destroy` against real AWS. Remote state backend, multi-region teardown, `--dry-run`, cost estimation, and orphan auto-remediation are out of scope per the design.
- The workflow ends after task 22. Implementation starts when the user opens `tasks.md` and clicks "Start task" on item 1.
