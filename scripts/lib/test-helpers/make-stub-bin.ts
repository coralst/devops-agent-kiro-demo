// 🟢 PATH-stub harness. Creates a tempdir of fake executables (aws, terraform,
// brew, etc.) that log every invocation to a shared JSON-lines call log. Tests
// prepend stubDir to PATH and assert against readCallLog() to verify the
// script-under-test issued the expected commands — no real AWS calls, ever.
//
// Env-driven stub behavior (see design § Test Harness Architecture):
//   STUB_AWS_FAIL_GET_CALLER_IDENTITY=1
//   STUB_AWS_ACCOUNT_ID=<id>
//   STUB_TERRAFORM_APPLY_RC=<n>
//   STUB_TERRAFORM_DESTROY_RC=<n>
//   STUB_TERRAFORM_PLAN_RC=<n>
//   STUB_S3_BUCKET_VERSIONING=<Enabled|Suspended|Disabled>
//   STUB_ORPHAN_JSON_FILE=<path>
//   STUB_AWS_S3_RM_FAIL=<error-string>

import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface StubCommand {
  /** Custom bash source for the stub. If omitted, a default record-and-exit-0 stub is used. */
  script?: string;
  /** If true, delegate to the real binary on the parent PATH (used for jq, cat, etc.). */
  passthrough?: boolean;
}

export interface CallLogEntry {
  /** basename of the stub (e.g., "aws"). */
  cmd: string;
  /** All args passed to the stub. */
  argv: string[];
  /** Full stdin content (may be empty). */
  stdin: string;
  /** Working directory at invocation time. */
  cwd: string;
}

export interface StubHarness {
  /** Path to prepend to PATH so the stubs shadow real binaries. */
  stubDir: string;
  /** File holding one JSON object per line, one per stub invocation. */
  callLogPath: string;
  /** Remove the tempdir (idempotent). */
  cleanup: () => void;
  /** Parse callLogPath into an array of CallLogEntry. */
  readCallLog: () => CallLogEntry[];
}

export interface MakeStubBinOptions {
  commands: Record<string, StubCommand>;
}

/**
 * Create a tempdir of stub executables.
 *
 * Each stub is a bash script that:
 *   1. Appends a JSON line {cmd, argv, stdin, cwd} to $CALL_LOG_PATH
 *   2. Dispatches on env knobs to emulate the requested behavior
 *   3. Exits with the appropriate code
 *
 * Passthrough stubs exec the real binary from the *original* PATH (the PATH
 * minus the stubDir) so tests can mix real tools (jq) with fakes (aws).
 */
export function makeStubBin(options: MakeStubBinOptions): StubHarness {
  const stubDir = mkdtempSync(join(tmpdir(), 'stub-bin-'));
  const callLogPath = join(stubDir, 'call-log.jsonl');

  // Touch the call log so stubs can append to it unconditionally.
  writeFileSync(callLogPath, '');

  for (const [name, cmd] of Object.entries(options.commands)) {
    const stubPath = join(stubDir, name);
    const script = cmd.passthrough
      ? renderPassthroughStub(name, stubDir, callLogPath)
      : renderBehaviorStub(name, callLogPath, cmd.script);
    writeFileSync(stubPath, script);
    chmodSync(stubPath, 0o755);
  }

  let cleaned = false;
  const cleanup = (): void => {
    if (cleaned) return;
    cleaned = true;
    rmSync(stubDir, { recursive: true, force: true });
  };

  const readCallLog = (): CallLogEntry[] => {
    const raw = readFileSync(callLogPath, 'utf8');
    return raw
      .split('\n')
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as CallLogEntry);
  };

  return { stubDir, callLogPath, cleanup, readCallLog };
}

/**
 * Render a stub that records the invocation and then applies either a
 * caller-supplied bash snippet or the default env-driven dispatcher.
 */
function renderBehaviorStub(name: string, callLogPath: string, customScript?: string): string {
  const dispatch = customScript ?? renderDefaultDispatch(name);
  // The recording preamble uses jq to build a JSON object safely (handles
  // quoting, newlines, embedded characters in argv). jq is required on the
  // host; it is declared as a pre-flight dep in the main pipeline.
  return `#!/usr/bin/env bash
set -u
CALL_LOG_PATH=${shellQuote(callLogPath)}
CMD_NAME=${shellQuote(name)}
STUB_STDIN="$(cat)"
CWD="$(pwd)"
# Build JSON line via jq (handles escaping for us).
jq -cn \\
  --arg cmd "$CMD_NAME" \\
  --arg stdin "$STUB_STDIN" \\
  --arg cwd "$CWD" \\
  --args \\
  '{cmd: $cmd, argv: $ARGS.positional, stdin: $stdin, cwd: $cwd}' \\
  -- "$@" >> "$CALL_LOG_PATH"

${dispatch}
`;
}

/**
 * Default env-driven dispatcher. Each supported command has a small case
 * block; unknown commands just exit 0 after recording.
 */
function renderDefaultDispatch(name: string): string {
  switch (name) {
    case 'aws':
      return renderAwsDispatch();
    case 'terraform':
      return renderTerraformDispatch();
    case 'brew':
      return 'exit 0';
    default:
      return 'exit 0';
  }
}

function renderAwsDispatch(): string {
  return `# aws stub: dispatch on the first two positional args.
SUB1="\${1:-}"
SUB2="\${2:-}"
SUB3="\${3:-}"

if [[ "$SUB1" == "sts" && "$SUB2" == "get-caller-identity" ]]; then
  if [[ "\${STUB_AWS_FAIL_GET_CALLER_IDENTITY:-}" == "1" ]]; then
    echo "Unable to locate credentials" >&2
    exit 255
  fi
  ACCOUNT_ID="\${STUB_AWS_ACCOUNT_ID:-684394110906}"
  # Honor --query Account --output text by emitting just the account id.
  # Scan remaining args for the --query/--output pair.
  QUERY=""
  OUTPUT=""
  shift 2 || true
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --query)  QUERY="\${2:-}"; shift 2;;
      --output) OUTPUT="\${2:-}"; shift 2;;
      *)        shift;;
    esac
  done
  if [[ "$QUERY" == "Account" && "$OUTPUT" == "text" ]]; then
    printf '%s\\n' "$ACCOUNT_ID"
  else
    printf '{"UserId":"AIDASTUB","Account":"%s","Arn":"arn:aws:iam::%s:user/stub"}\\n' \\
      "$ACCOUNT_ID" "$ACCOUNT_ID"
  fi
  exit 0
fi

if [[ "$SUB1" == "s3api" && "$SUB2" == "get-bucket-versioning" ]]; then
  STATUS="\${STUB_S3_BUCKET_VERSIONING:-Disabled}"
  if [[ "$STATUS" == "Disabled" ]]; then
    # Disabled versioning returns an empty JSON object.
    echo '{}'
  else
    printf '{"Status":"%s"}\\n' "$STATUS"
  fi
  exit 0
fi

if [[ "$SUB1" == "s3api" && "$SUB2" == "list-object-versions" ]]; then
  # If a JSON fixture file is supplied, return its contents verbatim.
  # Tests that need pagination can supply a single-page fixture and
  # rely on the absence of NextToken to terminate the loop.
  if [[ -n "\${STUB_S3_LIST_OBJECT_VERSIONS_JSON_FILE:-}" \\
        && -f "\${STUB_S3_LIST_OBJECT_VERSIONS_JSON_FILE}" ]]; then
    cat "\${STUB_S3_LIST_OBJECT_VERSIONS_JSON_FILE}"
  else
    # Default: empty bucket with no versions or delete markers.
    echo '{"Versions":[],"DeleteMarkers":[]}'
  fi
  exit 0
fi

if [[ "$SUB1" == "s3api" && "$SUB2" == "delete-objects" ]]; then
  # Just record the call via the preamble and exit 0. Tests inspect the
  # call log for the --delete payload to verify batch size / contents.
  exit 0
fi

if [[ "$SUB1" == "s3" && "$SUB2" == "rm" ]]; then
  if [[ -n "\${STUB_AWS_S3_RM_FAIL:-}" ]]; then
    echo "$STUB_AWS_S3_RM_FAIL" >&2
    exit 1
  fi
  exit 0
fi

if [[ "$SUB1" == "resourcegroupstaggingapi" && "$SUB2" == "get-resources" ]]; then
  if [[ -n "\${STUB_ORPHAN_JSON_FILE:-}" && -f "\${STUB_ORPHAN_JSON_FILE}" ]]; then
    cat "\${STUB_ORPHAN_JSON_FILE}"
  else
    echo '{"ResourceTagMappingList":[]}'
  fi
  exit 0
fi

# Unhandled aws subcommand: exit 0 silently. Tests assert via call-log.
exit 0
`;
}

function renderTerraformDispatch(): string {
  return `# terraform stub: dispatch on first positional arg.
SUB1="\${1:-}"
SUB2="\${2:-}"
SUB3="\${3:-}"

case "$SUB1" in
  apply)
    exit "\${STUB_TERRAFORM_APPLY_RC:-0}"
    ;;
  destroy)
    exit "\${STUB_TERRAFORM_DESTROY_RC:-0}"
    ;;
  plan)
    exit "\${STUB_TERRAFORM_PLAN_RC:-0}"
    ;;
  output)
    # Support 'terraform output -raw <name>'. Emits deterministic values
    # so app-up.sh can print them after a successful apply. Tests can
    # override per-output via STUB_TERRAFORM_OUTPUT_<NAME>.
    if [[ "$SUB2" == "-raw" ]]; then
      VAR_NAME="STUB_TERRAFORM_OUTPUT_\${SUB3}"
      if [[ -n "\${!VAR_NAME:-}" ]]; then
        printf '%s' "\${!VAR_NAME}"
      else
        printf 'stub-%s' "$SUB3"
      fi
      exit 0
    fi
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`;
}

/**
 * Render a passthrough stub: record the invocation, then exec the real binary
 * from the original PATH (PATH with stubDir stripped out).
 */
function renderPassthroughStub(name: string, stubDir: string, callLogPath: string): string {
  return `#!/usr/bin/env bash
set -u
CALL_LOG_PATH=${shellQuote(callLogPath)}
CMD_NAME=${shellQuote(name)}
STUB_DIR=${shellQuote(stubDir)}

# Capture stdin once so we can both log it and forward it to the real binary.
STUB_STDIN="$(cat)"
CWD="$(pwd)"

# Try to log via jq if it is itself resolvable outside the stub dir. If jq is
# the command being passthroughed, we still log first because jq resolution
# happens below after we strip stubDir from PATH.
ORIGINAL_PATH=""
IFS=':' read -ra _PATH_PARTS <<< "$PATH"
for _p in "\${_PATH_PARTS[@]}"; do
  if [[ "$_p" != "$STUB_DIR" ]]; then
    if [[ -z "$ORIGINAL_PATH" ]]; then
      ORIGINAL_PATH="$_p"
    else
      ORIGINAL_PATH="$ORIGINAL_PATH:$_p"
    fi
  fi
done

REAL_JQ="$(PATH="$ORIGINAL_PATH" command -v jq || true)"
if [[ -n "$REAL_JQ" ]]; then
  "$REAL_JQ" -cn \\
    --arg cmd "$CMD_NAME" \\
    --arg stdin "$STUB_STDIN" \\
    --arg cwd "$CWD" \\
    --args \\
    '{cmd: $cmd, argv: $ARGS.positional, stdin: $stdin, cwd: $cwd}' \\
    -- "$@" >> "$CALL_LOG_PATH"
fi

REAL_BIN="$(PATH="$ORIGINAL_PATH" command -v "$CMD_NAME" || true)"
if [[ -z "$REAL_BIN" ]]; then
  echo "passthrough stub: real '$CMD_NAME' not found on original PATH" >&2
  exit 127
fi

# Forward captured stdin + argv to the real binary.
printf '%s' "$STUB_STDIN" | PATH="$ORIGINAL_PATH" exec "$REAL_BIN" "$@"
`;
}

/**
 * Shell-quote a string for inclusion inside a bash single-quoted literal.
 * Used only for paths we control (tempdir, command name), so the
 * transformation is safe and deterministic.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
