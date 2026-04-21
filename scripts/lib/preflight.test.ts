// 🟢 Unit tests for scripts/lib/preflight.sh :: run_preflight_checks and its
// individual sub-checks. Tests shell out to bash via spawnBash and use the
// PATH-stub harness (makeStubBin) to inject fake aws/terraform/brew binaries
// so no real AWS call is ever made.
//
// Key invariants under test:
//   - Exact error-string bytes on stderr per R2.2 / R2.5 / R2.7 / R2.9
//     (up mode) and R4.2 / R4.4 / R4.6 / R4.8 (down mode).
//   - run_preflight_checks short-circuits on first failure and returns
//     non-zero.
//   - down mode NEVER invokes brew (no auto-install of terraform).
//
// Validates: Requirements 2.1–2.9, 4.1–4.8

import { afterEach, describe, expect, it } from 'vitest';
import { spawnBash } from './test-helpers/spawn-bash';
import { makeStubBin, type StubHarness } from './test-helpers/make-stub-bin';
import { repoRoot } from './test-helpers/repo-root';

// ---------------------------------------------------------------------------
// Harness helpers
// ---------------------------------------------------------------------------

// We track every harness we create so afterEach can tear them down even if
// a test throws before cleanup.
const harnesses: StubHarness[] = [];

afterEach(() => {
  while (harnesses.length > 0) {
    const h = harnesses.pop();
    h?.cleanup();
  }
});

/**
 * Build a PATH that puts stubDir first, then /usr/bin:/bin. This excludes
 * /usr/local/bin and /opt/homebrew/bin so real aws/terraform on a developer
 * machine can't leak in during "missing CLI" tests. jq lives at /usr/bin/jq
 * on standard installs, so stubs that record via jq still work.
 *
 * Callers can omit specific commands to simulate a missing tool — for
 * example, omitting `terraform` from `commands` leaves the stubDir without
 * a `terraform` binary, and `command -v terraform` resolves false.
 */
function buildPath(stubDir: string): string {
  return `${stubDir}:/usr/bin:/bin`;
}

const RUN_PREFLIGHT = (mode: 'up' | 'down'): string =>
  `source scripts/lib/preflight.sh && run_preflight_checks ${mode}`;

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('run_preflight_checks (happy path)', () => {
  it('exits 0 in "up" mode with all stubs succeeding and prints ok for each step', () => {
    const harness = makeStubBin({
      commands: {
        aws: {},
        terraform: {},
        brew: {},
        jq: { passthrough: true },
      },
    });
    harnesses.push(harness);

    const result = spawnBash({
      script: RUN_PREFLIGHT('up'),
      cwd: repoRoot,
      env: { PATH: buildPath(harness.stubDir) },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(
      [
        'Checking aws CLI... ok',
        'Checking terraform CLI... ok',
        'Checking AWS credentials... ok',
        'Checking AWS account... ok (684394110906)',
        'Checking jq... ok',
        '',
      ].join('\n'),
    );
  });

  it('exits 0 in "down" mode with all stubs succeeding', () => {
    const harness = makeStubBin({
      commands: {
        aws: {},
        terraform: {},
        brew: {},
        jq: { passthrough: true },
      },
    });
    harnesses.push(harness);

    const result = spawnBash({
      script: RUN_PREFLIGHT('down'),
      cwd: repoRoot,
      env: { PATH: buildPath(harness.stubDir) },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
  });
});

// ---------------------------------------------------------------------------
// aws CLI missing
// ---------------------------------------------------------------------------

describe('run_preflight_checks (aws CLI missing)', () => {
  it('exits non-zero in "up" mode with R2.2 exact error on stderr', () => {
    const harness = makeStubBin({
      commands: {
        // no `aws` stub → command -v aws returns 1
        terraform: {},
        brew: {},
        jq: { passthrough: true },
      },
    });
    harnesses.push(harness);

    const result = spawnBash({
      script: RUN_PREFLIGHT('up'),
      cwd: repoRoot,
      env: { PATH: buildPath(harness.stubDir) },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe(
      'ERROR: aws CLI is not installed. Install it from https://aws.amazon.com/cli/ and re-run.\n',
    );
  });

  it('exits non-zero in "down" mode with R4.2 exact error on stderr', () => {
    const harness = makeStubBin({
      commands: {
        terraform: {},
        brew: {},
        jq: { passthrough: true },
      },
    });
    harnesses.push(harness);

    const result = spawnBash({
      script: RUN_PREFLIGHT('down'),
      cwd: repoRoot,
      env: { PATH: buildPath(harness.stubDir) },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe('ERROR: aws CLI is not installed.\n');
  });
});

// ---------------------------------------------------------------------------
// terraform CLI missing
// ---------------------------------------------------------------------------

describe('run_preflight_checks (terraform CLI missing)', () => {
  it('exits non-zero in "down" mode with R4.4 exact error and NEVER invokes brew', () => {
    const harness = makeStubBin({
      commands: {
        aws: {},
        // no `terraform` stub
        brew: {},
        jq: { passthrough: true },
      },
    });
    harnesses.push(harness);

    const result = spawnBash({
      script: RUN_PREFLIGHT('down'),
      cwd: repoRoot,
      env: { PATH: buildPath(harness.stubDir) },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe('ERROR: terraform CLI is not installed.\n');

    // down mode must NEVER auto-install terraform — brew must not appear
    // in the call log regardless of OS or brew availability.
    const callLog = harness.readCallLog();
    const brewCalls = callLog.filter((entry) => entry.cmd === 'brew');
    expect(brewCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Credentials invalid
// ---------------------------------------------------------------------------

describe('run_preflight_checks (credentials invalid)', () => {
  it('exits non-zero in "up" mode with R2.7 exact error when sts call fails', () => {
    const harness = makeStubBin({
      commands: {
        aws: {},
        terraform: {},
        brew: {},
        jq: { passthrough: true },
      },
    });
    harnesses.push(harness);

    const result = spawnBash({
      script: RUN_PREFLIGHT('up'),
      cwd: repoRoot,
      env: {
        PATH: buildPath(harness.stubDir),
        STUB_AWS_FAIL_GET_CALLER_IDENTITY: '1',
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe(
      "ERROR: AWS credentials are not configured or are invalid. Run 'aws configure' or set AWS_PROFILE and re-run.\n",
    );
  });
});

// ---------------------------------------------------------------------------
// Account mismatch
// ---------------------------------------------------------------------------

describe('run_preflight_checks (account mismatch)', () => {
  it('exits non-zero in "up" mode with R2.9 error containing the wrong account ID', () => {
    const harness = makeStubBin({
      commands: {
        aws: {},
        terraform: {},
        brew: {},
        jq: { passthrough: true },
      },
    });
    harnesses.push(harness);

    const result = spawnBash({
      script: RUN_PREFLIGHT('up'),
      cwd: repoRoot,
      env: {
        PATH: buildPath(harness.stubDir),
        STUB_AWS_ACCOUNT_ID: '000000000000',
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe(
      'ERROR: Expected AWS account 684394110906 but got 000000000000. Check your AWS_PROFILE.\n',
    );
  });

  it('exits non-zero in "down" mode with R4.8 error (refuses to destroy in wrong account)', () => {
    const harness = makeStubBin({
      commands: {
        aws: {},
        terraform: {},
        brew: {},
        jq: { passthrough: true },
      },
    });
    harnesses.push(harness);

    const result = spawnBash({
      script: RUN_PREFLIGHT('down'),
      cwd: repoRoot,
      env: {
        PATH: buildPath(harness.stubDir),
        STUB_AWS_ACCOUNT_ID: '999999999999',
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toBe(
      'ERROR: Expected AWS account 684394110906 but got 999999999999. Refusing to destroy resources in the wrong account.\n',
    );
  });
});

// ---------------------------------------------------------------------------
// jq missing
// ---------------------------------------------------------------------------

describe('run_preflight_checks (jq missing)', () => {
  it('exits non-zero with the jq error when jq is not on PATH', () => {
    // The default aws/terraform stubs use jq internally to record calls,
    // which would make them fail before check_jq ever runs. Use jq-free
    // custom scripts here — we only care that check_aws_cli,
    // check_terraform_cli, check_aws_credentials, and check_aws_account_id
    // all pass so the sequence reaches check_jq, which must find jq
    // absent. PATH is limited to stubDir so no system jq is resolvable.
    const harness = makeStubBin({
      commands: {
        aws: {
          script: `
SUB1="\${1:-}"
SUB2="\${2:-}"
if [[ "$SUB1" == "sts" && "$SUB2" == "get-caller-identity" ]]; then
  # Mimic success + return the expected account when --query Account is used.
  if [[ "\${3:-}" == "--query" ]]; then
    echo "684394110906"
  else
    echo '{"Account":"684394110906"}'
  fi
  exit 0
fi
exit 0
`,
        },
        terraform: { script: 'exit 0' },
        brew: { script: 'exit 0' },
        // jq intentionally omitted; PATH scoped to stubDir so no system
        // jq is resolvable either.
      },
    });
    harnesses.push(harness);

    const result = spawnBash({
      script: RUN_PREFLIGHT('up'),
      cwd: repoRoot,
      // PATH includes /bin so Node can locate bash and bash builtins work,
      // but excludes /usr/bin where jq lives on standard installs.
      env: { PATH: `${harness.stubDir}:/bin` },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'ERROR: jq is required for JSON parsing. Install it and re-run.',
    );
  });
});
