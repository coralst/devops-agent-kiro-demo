// 🟢 Unit tests for the top-level `app-down.sh` teardown orchestrator.
//
// Tests spawn the script inside a temporary repo-shaped directory that
// contains app-down.sh, scripts/lib/, and a fake terraform/ with a
// terraform.tfvars + terraform.tfstate. A PATH-stub harness shadows
// aws/terraform so no real AWS call is ever made; each stub logs its
// argv to a shared JSONL file that tests assert against.
//
// Tests are grouped by the five safety layers defined in design.md §
// app-down.sh, matching the spec's task layout (12.1, 14.2, 15.2, 16.2,
// 17.3):
//
//   Layer 0: --yes argv gate                   (task 12.1)
//   Layer 1: Pre-flight                         (task 14.2)
//   Layer 2: S3 bucket resolution + emptying    (task 15.2)
//   Layer 3: terraform destroy                  (task 16.2)
//   Layer 4: Orphan sweep + final exit code     (task 17.3)
//
// Validates: Requirements 3.1–3.4, 4.1–4.8, 5.1–5.5, 6.1–6.4, 7.1–7.6, 8.1–8.3

import { afterEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnBash } from './test-helpers/spawn-bash';
import { makeStubBin, type StubHarness } from './test-helpers/make-stub-bin';
import { repoRoot } from './test-helpers/repo-root';

// ---------------------------------------------------------------------------
// Harness + temp-repo lifecycle
// ---------------------------------------------------------------------------

const harnesses: StubHarness[] = [];
const tempDirs: string[] = [];

afterEach(() => {
  while (harnesses.length > 0) {
    const h = harnesses.pop();
    h?.cleanup();
  }
  while (tempDirs.length > 0) {
    const d = tempDirs.pop();
    if (d) rmSync(d, { recursive: true, force: true });
  }
});

/**
 * Build a PATH that puts the stubDir first, then /usr/bin:/bin so jq
 * (used by orphan-parse.sh and the stub preamble) is resolvable while
 * aws/terraform are shadowed by the stubs.
 */
function buildPath(stubDir: string): string {
  return `${stubDir}:/usr/bin:/bin`;
}

/**
 * Create a fresh repo-shaped temp directory containing only the bits
 * app-down.sh touches:
 *   - app-down.sh (copied + chmod 755)
 *   - scripts/lib/ (recursive copy, node_modules excluded)
 *   - terraform/terraform.tfvars (copy of .example, unless opted out)
 *   - terraform/terraform.tfstate (empty JSON, unless opted out)
 *
 * The two boolean options let tests exercise the "no tfvars" and
 * "no tfstate" fall-through paths without polluting the main repo.
 */
function createTempRepo(
  options: { withTfstate?: boolean; withTfvars?: boolean } = {},
): string {
  const { withTfstate = true, withTfvars = true } = options;

  const dir = mkdtempSync(join(tmpdir(), 'app-down-test-'));
  tempDirs.push(dir);

  cpSync(join(repoRoot, 'app-down.sh'), join(dir, 'app-down.sh'));
  chmodSync(join(dir, 'app-down.sh'), 0o755);

  cpSync(join(repoRoot, 'scripts'), join(dir, 'scripts'), {
    recursive: true,
    filter: (src) => !src.includes('node_modules'),
  });

  mkdirSync(join(dir, 'terraform'), { recursive: true });
  cpSync(
    join(repoRoot, 'terraform', 'terraform.tfvars.example'),
    join(dir, 'terraform', 'terraform.tfvars.example'),
  );
  if (withTfvars) {
    cpSync(
      join(repoRoot, 'terraform', 'terraform.tfvars.example'),
      join(dir, 'terraform', 'terraform.tfvars'),
    );
  }
  if (withTfstate) {
    // Empty JSON object is enough — the script only checks file presence,
    // not contents (it delegates content-dependent logic to terraform).
    writeFileSync(join(dir, 'terraform', 'terraform.tfstate'), '{}');
  }
  return dir;
}

/**
 * Default harness wiring for app-down.sh: stubs aws, terraform, brew
 * (for preflight's up-path — unused here but harmless), and passes jq
 * through to the real binary so orphan-parse.sh works.
 */
function defaultHarness(): StubHarness {
  const h = makeStubBin({
    commands: {
      aws: {},
      terraform: {},
      brew: {},
      jq: { passthrough: true },
    },
  });
  harnesses.push(h);
  return h;
}

/**
 * Run app-down.sh inside the given temp dir with an env overlay that
 * forces the stubs onto PATH. Takes argv as a separate parameter so
 * tests can exercise the --yes gate with arbitrary argv shapes.
 */
function runAppDown(
  tempDir: string,
  harness: StubHarness,
  argv: string[],
  extraEnv: Record<string, string> = {},
): ReturnType<typeof spawnBash> {
  const quoted = argv.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
  return spawnBash({
    script: `./app-down.sh ${quoted}`,
    cwd: tempDir,
    env: {
      PATH: buildPath(harness.stubDir),
      ...extraEnv,
    },
  });
}

/**
 * Write an orphan-sweep fixture JSON file and return its path. The
 * stub's `aws resourcegroupstaggingapi get-resources` handler cats this
 * file verbatim when STUB_ORPHAN_JSON_FILE points at it.
 */
function writeOrphanFixture(tempDir: string, arns: string[]): string {
  const fixturePath = join(tempDir, 'orphans.json');
  const body = {
    ResourceTagMappingList: arns.map((arn) => ({
      ResourceARN: arn,
      Tags: [
        { Key: 'Project', Value: 'devops-demo' },
        { Key: 'ManagedBy', Value: 'terraform' },
      ],
    })),
  };
  writeFileSync(fixturePath, JSON.stringify(body));
  return fixturePath;
}

// The exact R3.2 error string; kept here so the tests break loudly if
// anyone edits the message in app-down.sh without updating tests.
const MISSING_YES_ERR =
  'ERROR: app-down.sh requires --yes to run. This will destroy all AWS resources tagged Project=devops-demo in account 684394110906. Usage: ./app-down.sh --yes';

// ===========================================================================
// Layer 0: --yes argv gate (task 12.1)
// ===========================================================================
//
// Two positive cases (empty argv, wrong flag) must both exit 2 with the
// exact R3.2 message on stderr, AND produce zero entries in the stub
// call log — the gate must fire BEFORE any helper is sourced or any
// subprocess spawned. A third case confirms `--yes` alone lets the
// script proceed past the gate.
// ===========================================================================

describe('app-down.sh (--yes gate)', () => {
  it('empty argv → exit 2, R3.2 on stderr, zero stub invocations', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const result = runAppDown(tempDir, harness, []);

    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe(MISSING_YES_ERR);

    // Critical invariant: no stub was invoked. The gate MUST fire
    // before any sourcing or subprocess.
    expect(harness.readCallLog()).toHaveLength(0);
  });

  it('argv ["--no"] → exit 2, R3.2 on stderr, zero stub invocations', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const result = runAppDown(tempDir, harness, ['--no']);

    expect(result.status).toBe(2);
    expect(result.stderr.trim()).toBe(MISSING_YES_ERR);
    expect(harness.readCallLog()).toHaveLength(0);
  });

  it('argv ["--yes"] → gate passes (exit is NOT 2)', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const result = runAppDown(tempDir, harness, ['--yes']);

    // We don't assert the exact exit code here — pre-flight and later
    // stages might have their own verdict. The only guarantee of Layer
    // 0 is that --yes prevents exit 2.
    expect(result.status).not.toBe(2);
  });
});

// ===========================================================================
// Layer 1: Pre-flight (task 14.2)
// ===========================================================================
//
// Pre-flight failures must exit 1 with the exact R4.* error strings and
// must NOT invoke terraform destroy. A "missing aws CLI" case is tricky
// in the harness because jq (used for call-log recording) requires aws
// to exist for the same dispatch file — but we can simulate it by
// pointing the stub's aws at a script that fails preflight's check.
// The simpler and more robust approach: use STUB_AWS_ACCOUNT_ID to
// trigger R4.8, and use STUB_AWS_FAIL_GET_CALLER_IDENTITY=1 to trigger
// R4.6 (bad credentials, which proves pre-flight fails before destroy).
// ===========================================================================

describe('app-down.sh (pre-flight layer)', () => {
  it('wrong account ID → exit 1, R4.8 on stderr, no terraform destroy call', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const result = runAppDown(tempDir, harness, ['--yes'], {
      STUB_AWS_ACCOUNT_ID: '000000000000',
    });

    expect(result.status).toBe(1);
    // R4.8 error string:
    // "ERROR: Expected AWS account 684394110906 but got <actual>. Refusing to destroy resources in the wrong account."
    expect(result.stderr).toContain('Expected AWS account 684394110906');
    expect(result.stderr).toContain('got 000000000000');
    expect(result.stderr).toContain(
      'Refusing to destroy resources in the wrong account',
    );

    // No terraform destroy, and no aws delete/rm either — pre-flight
    // must block everything destructive.
    const log = harness.readCallLog();
    const destroyCalls = log.filter(
      (e) => e.cmd === 'terraform' && e.argv[0] === 'destroy',
    );
    const s3RmCalls = log.filter(
      (e) => e.cmd === 'aws' && e.argv[0] === 's3' && e.argv[1] === 'rm',
    );
    expect(destroyCalls).toHaveLength(0);
    expect(s3RmCalls).toHaveLength(0);
  });

  it('bad AWS credentials → exit 1, R4.6 on stderr, no terraform destroy call', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const result = runAppDown(tempDir, harness, ['--yes'], {
      STUB_AWS_FAIL_GET_CALLER_IDENTITY: '1',
    });

    expect(result.status).toBe(1);
    // R4.6: "ERROR: AWS credentials are not configured or are invalid."
    expect(result.stderr).toContain(
      'AWS credentials are not configured or are invalid',
    );

    const log = harness.readCallLog();
    const destroyCalls = log.filter(
      (e) => e.cmd === 'terraform' && e.argv[0] === 'destroy',
    );
    expect(destroyCalls).toHaveLength(0);
  });
});

// ===========================================================================
// Layer 2: S3 bucket resolution + emptying (task 15.2)
// ===========================================================================
//
// Three paths out of bucket resolution:
//   (a) terraform output -raw s3_bucket_name succeeds → use that name
//   (b) primary fails but state show fallback succeeds → use fallback
//   (c) both fail → print R5.2 and skip emptying (still run destroy)
//
// Plus a failure path: `aws s3 rm` returns non-zero → exit 1 and do NOT
// proceed to terraform destroy.
// ===========================================================================

describe('app-down.sh (S3 emptying layer)', () => {
  it('happy path: bucket resolved via `terraform output -raw` → aws s3 rm called, proceeds to destroy', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const result = runAppDown(tempDir, harness, ['--yes'], {
      STUB_TERRAFORM_OUTPUT_s3_bucket_name: 'frontend-devops-demo-xyz',
      STUB_S3_BUCKET_VERSIONING: 'Disabled',
    });

    // destroy_rc=0 + orphan_count=0 → exit 0
    expect(result.status).toBe(0);

    const log = harness.readCallLog();

    // `aws s3 rm s3://<bucket>/ --recursive --region <region>` call present.
    const rmCalls = log.filter(
      (e) => e.cmd === 'aws' && e.argv[0] === 's3' && e.argv[1] === 'rm',
    );
    expect(rmCalls).toHaveLength(1);
    expect(rmCalls[0].argv).toContain('s3://frontend-devops-demo-xyz/');
    expect(rmCalls[0].argv).toContain('--recursive');

    // terraform destroy was invoked.
    const destroyCalls = log.filter(
      (e) => e.cmd === 'terraform' && e.argv[0] === 'destroy',
    );
    expect(destroyCalls).toHaveLength(1);
  });

  it('primary `terraform output` fails → state show fallback is consulted', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const result = runAppDown(tempDir, harness, ['--yes'], {
      STUB_TERRAFORM_OUTPUT_EMPTY: '1',
      STUB_TERRAFORM_STATE_SHOW_BUCKET: 'fallback-bucket-name',
      STUB_S3_BUCKET_VERSIONING: 'Disabled',
    });

    expect(result.status).toBe(0);

    const log = harness.readCallLog();

    // `terraform state show aws_s3_bucket.frontend` was called.
    const stateShowCalls = log.filter(
      (e) =>
        e.cmd === 'terraform' &&
        e.argv[0] === 'state' &&
        e.argv[1] === 'show' &&
        e.argv[2] === 'aws_s3_bucket.frontend',
    );
    expect(stateShowCalls).toHaveLength(1);

    // `aws s3 rm` used the fallback bucket name.
    const rmCalls = log.filter(
      (e) => e.cmd === 'aws' && e.argv[0] === 's3' && e.argv[1] === 'rm',
    );
    expect(rmCalls).toHaveLength(1);
    expect(rmCalls[0].argv).toContain('s3://fallback-bucket-name/');
  });

  it('both resolution paths fail → R5.2 on stdout, no aws s3 rm, proceeds to destroy', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const result = runAppDown(tempDir, harness, ['--yes'], {
      STUB_TERRAFORM_OUTPUT_EMPTY: '1',
      STUB_TERRAFORM_STATE_SHOW_FAIL: '1',
    });

    expect(result.status).toBe(0);
    // R5.2: "No S3 frontend bucket found in Terraform state; skipping bucket emptying."
    expect(result.stdout).toContain(
      'No S3 frontend bucket found in Terraform state; skipping bucket emptying.',
    );

    const log = harness.readCallLog();

    // No `aws s3 rm` at all.
    const rmCalls = log.filter(
      (e) => e.cmd === 'aws' && e.argv[0] === 's3' && e.argv[1] === 'rm',
    );
    expect(rmCalls).toHaveLength(0);

    // destroy still ran.
    const destroyCalls = log.filter(
      (e) => e.cmd === 'terraform' && e.argv[0] === 'destroy',
    );
    expect(destroyCalls).toHaveLength(1);
  });

  it('`aws s3 rm` fails with AccessDenied → exit 1, no terraform destroy', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const result = runAppDown(tempDir, harness, ['--yes'], {
      STUB_TERRAFORM_OUTPUT_s3_bucket_name: 'frontend-devops-demo-xyz',
      STUB_AWS_S3_RM_FAIL: 'AccessDenied: not authorized',
    });

    expect(result.status).toBe(1);
    // The failing command + AccessDenied error should reach stderr.
    expect(result.stderr).toContain('AccessDenied');

    const log = harness.readCallLog();
    const destroyCalls = log.filter(
      (e) => e.cmd === 'terraform' && e.argv[0] === 'destroy',
    );
    expect(destroyCalls).toHaveLength(0);
  });
});

// ===========================================================================
// Layer 3: terraform destroy (task 16.2)
// ===========================================================================
//
// Three branches:
//   (a) tfstate missing → R6.4 message, skip destroy, still run sweep
//   (b) destroy succeeds → sweep runs after
//   (c) destroy fails → sweep STILL runs (script does NOT exit yet)
// ===========================================================================

describe('app-down.sh (terraform destroy layer)', () => {
  it('missing tfstate → R6.4 message, no destroy call, orphan sweep still runs', () => {
    const tempDir = createTempRepo({ withTfstate: false });
    const harness = defaultHarness();

    const result = runAppDown(tempDir, harness, ['--yes'], {
      STUB_TERRAFORM_OUTPUT_s3_bucket_name: 'frontend-devops-demo-xyz',
      STUB_S3_BUCKET_VERSIONING: 'Disabled',
    });

    expect(result.status).toBe(0);
    // R6.4: "No Terraform state found; skipping terraform destroy and running orphan sweep only."
    expect(result.stdout).toContain(
      'No Terraform state found; skipping terraform destroy and running orphan sweep only.',
    );

    const log = harness.readCallLog();
    const destroyCalls = log.filter(
      (e) => e.cmd === 'terraform' && e.argv[0] === 'destroy',
    );
    expect(destroyCalls).toHaveLength(0);

    // Orphan sweep still ran.
    const sweepCalls = log.filter(
      (e) =>
        e.cmd === 'aws' &&
        e.argv[0] === 'resourcegroupstaggingapi' &&
        e.argv[1] === 'get-resources',
    );
    expect(sweepCalls).toHaveLength(1);
  });

  it('destroy exit 0 → orphan sweep runs after destroy', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const result = runAppDown(tempDir, harness, ['--yes'], {
      STUB_TERRAFORM_OUTPUT_s3_bucket_name: 'frontend-devops-demo-xyz',
      STUB_S3_BUCKET_VERSIONING: 'Disabled',
      STUB_TERRAFORM_DESTROY_RC: '0',
    });

    expect(result.status).toBe(0);

    const log = harness.readCallLog();
    const destroyIdx = log.findIndex(
      (e) => e.cmd === 'terraform' && e.argv[0] === 'destroy',
    );
    const sweepIdx = log.findIndex(
      (e) =>
        e.cmd === 'aws' &&
        e.argv[0] === 'resourcegroupstaggingapi' &&
        e.argv[1] === 'get-resources',
    );
    expect(destroyIdx).toBeGreaterThanOrEqual(0);
    expect(sweepIdx).toBeGreaterThan(destroyIdx);
  });

  it('destroy exit 1 → orphan sweep STILL runs, script does NOT exit yet', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const result = runAppDown(tempDir, harness, ['--yes'], {
      STUB_TERRAFORM_OUTPUT_s3_bucket_name: 'frontend-devops-demo-xyz',
      STUB_S3_BUCKET_VERSIONING: 'Disabled',
      STUB_TERRAFORM_DESTROY_RC: '1',
    });

    // destroy_rc=1, orphan_count=0 → R7.6 reconciliation, exit 0.
    expect(result.status).toBe(0);

    const log = harness.readCallLog();
    const sweepCalls = log.filter(
      (e) =>
        e.cmd === 'aws' &&
        e.argv[0] === 'resourcegroupstaggingapi' &&
        e.argv[1] === 'get-resources',
    );
    expect(sweepCalls).toHaveLength(1);
  });
});

// ===========================================================================
// Layer 4: Orphan sweep + final exit-code truth table (task 17.3)
// ===========================================================================
//
// The four corners of the (destroy_rc, orphan_count) table:
//
//   destroy_rc=0, orphans=0 → exit 0, R7.2 on stdout
//   destroy_rc=0, orphans>0 → exit 3, R7.3 + ARNs on stderr
//   destroy_rc=1, orphans=0 → exit 0, R7.6 on stdout
//   destroy_rc=1, orphans>0 → exit 3, R7.3 + ARNs on stderr (destroy_rc shadowed)
//
// Plus a special case: the sweep `aws` call itself fails → propagate
// the aws exit code (NOT exit 3). This distinguishes "orphans found"
// from "couldn't even check for orphans."
// ===========================================================================

describe('app-down.sh (final exit-code truth table)', () => {
  it('destroy=0, orphans=0 → exit 0, R7.2 on stdout', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const result = runAppDown(tempDir, harness, ['--yes'], {
      STUB_TERRAFORM_OUTPUT_s3_bucket_name: 'frontend-devops-demo-xyz',
      STUB_S3_BUCKET_VERSIONING: 'Disabled',
      STUB_TERRAFORM_DESTROY_RC: '0',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'Orphan sweep: 0 resources remain. Teardown complete.',
    );
  });

  it('destroy=0, orphans=2 → exit 3, R7.3 header + both ARNs on stderr', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const arns = [
      'arn:aws:s3:::bucket-a',
      'arn:aws:rds:us-east-1:684394110906:db:mydb',
    ];
    const fixturePath = writeOrphanFixture(tempDir, arns);

    const result = runAppDown(tempDir, harness, ['--yes'], {
      STUB_TERRAFORM_OUTPUT_s3_bucket_name: 'frontend-devops-demo-xyz',
      STUB_S3_BUCKET_VERSIONING: 'Disabled',
      STUB_TERRAFORM_DESTROY_RC: '0',
      STUB_ORPHAN_JSON_FILE: fixturePath,
    });

    expect(result.status).toBe(3);
    // R7.3 header with exact count.
    expect(result.stderr).toContain(
      'Orphan sweep: 2 tagged resources still exist:',
    );
    // Both ARNs present on stderr.
    for (const arn of arns) {
      expect(result.stderr).toContain(arn);
    }
  });

  it('destroy=1, orphans=0 → exit 0, R7.6 reconciliation on stdout', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const result = runAppDown(tempDir, harness, ['--yes'], {
      STUB_TERRAFORM_OUTPUT_s3_bucket_name: 'frontend-devops-demo-xyz',
      STUB_S3_BUCKET_VERSIONING: 'Disabled',
      STUB_TERRAFORM_DESTROY_RC: '1',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'terraform destroy reported errors but orphan sweep is clean; treating teardown as successful.',
    );
    // R7.2 should NOT be printed in this branch.
    expect(result.stdout).not.toContain(
      'Orphan sweep: 0 resources remain. Teardown complete.',
    );
  });

  it('destroy=1, orphans=2 → exit 3, R7.3 on stderr (NOT R7.6)', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const arns = [
      'arn:aws:ec2:us-east-1:684394110906:instance/i-0abc123',
      'arn:aws:iam::684394110906:role/devops-demo-role',
    ];
    const fixturePath = writeOrphanFixture(tempDir, arns);

    const result = runAppDown(tempDir, harness, ['--yes'], {
      STUB_TERRAFORM_OUTPUT_s3_bucket_name: 'frontend-devops-demo-xyz',
      STUB_S3_BUCKET_VERSIONING: 'Disabled',
      STUB_TERRAFORM_DESTROY_RC: '1',
      STUB_ORPHAN_JSON_FILE: fixturePath,
    });

    expect(result.status).toBe(3);
    expect(result.stderr).toContain(
      'Orphan sweep: 2 tagged resources still exist:',
    );
    for (const arn of arns) {
      expect(result.stderr).toContain(arn);
    }
    // R7.6 reconciliation must NOT appear when orphans exist.
    expect(result.stdout).not.toContain(
      'terraform destroy reported errors but orphan sweep is clean',
    );
  });

  it('orphan-sweep aws call fails → propagate aws exit code (NOT 3), failing command on stderr', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const result = runAppDown(tempDir, harness, ['--yes'], {
      STUB_TERRAFORM_OUTPUT_s3_bucket_name: 'frontend-devops-demo-xyz',
      STUB_S3_BUCKET_VERSIONING: 'Disabled',
      STUB_TERRAFORM_DESTROY_RC: '0',
      STUB_AWS_GET_RESOURCES_FAIL: 'AccessDenied: not authorized',
    });

    // aws stub exits with 1 when STUB_AWS_GET_RESOURCES_FAIL is set.
    expect(result.status).toBe(1);
    // This is NOT the "orphans found" path: exit is not 3.
    expect(result.status).not.toBe(3);
    // The failing command and aws error should both be on stderr.
    expect(result.stderr).toContain(
      'aws resourcegroupstaggingapi get-resources',
    );
    expect(result.stderr).toContain('AccessDenied');
  });
});

// ===========================================================================
// Idempotency: re-run cases (task 18.1)
// ===========================================================================
//
// R9.2 and R9.3 require app-down.sh to be safe to re-run. Two shapes of
// prior state must both produce a defensible outcome:
//
//   1. CLEAN prior teardown — everything is already gone. The bucket
//      is no longer in Terraform state (neither `terraform output`
//      nor `terraform state show` resolves it), the local tfstate is
//      gone, and the orphan sweep finds nothing. All three mutating
//      steps (S3 emptying, terraform destroy, orphan sweep's AWS call)
//      must either be skipped cleanly (S3, destroy) or return zero
//      orphans (sweep). Final: exit 0 with R7.2 message. (R9.2)
//
//   2. PARTIAL prior teardown — a first run got stuck mid-pipeline
//      (e.g., terraform destroy errored, leaving tfstate and the bucket
//      still referenced). The re-run must reach every stage: S3
//      emptying, terraform destroy, and the orphan sweep. The call log
//      is the authoritative witness — we assert s3 rm, destroy, and
//      get-resources all appear in order. (R9.3)
//
// The third requested case (R9.1 "re-run app-up.sh after successful
// prior run → exit 0 with R9.1 message") is already covered by the
// `app-up.sh (no changes)` describe block in app-up.test.ts. No new
// test is needed there.
// ===========================================================================

describe('app-down.sh (idempotency)', () => {
  it('clean prior teardown → exit 0 with R7.2, no s3 rm, no terraform destroy (R9.2)', () => {
    // Clean prior state means: tfstate is gone (R6.4 skip), AND both
    // bucket-resolution paths fail because the bucket isn't tracked in
    // state anymore (R5.2 skip). The script falls straight through to
    // the orphan sweep, which finds nothing.
    const tempDir = createTempRepo({ withTfstate: false });
    const harness = defaultHarness();

    const result = runAppDown(tempDir, harness, ['--yes'], {
      STUB_TERRAFORM_OUTPUT_EMPTY: '1',
      STUB_TERRAFORM_STATE_SHOW_FAIL: '1',
      // No STUB_ORPHAN_JSON_FILE → stub returns empty ResourceTagMappingList.
    });

    expect(result.status).toBe(0);
    // R7.2 clean-sweep message on stdout.
    expect(result.stdout).toContain(
      'Orphan sweep: 0 resources remain. Teardown complete.',
    );
    // R5.2 skip message should also appear (bucket not resolved).
    expect(result.stdout).toContain(
      'No S3 frontend bucket found in Terraform state; skipping bucket emptying.',
    );
    // R6.4 skip message should also appear (no tfstate).
    expect(result.stdout).toContain(
      'No Terraform state found; skipping terraform destroy and running orphan sweep only.',
    );

    const log = harness.readCallLog();

    // No aws s3 rm call (bucket wasn't resolved).
    const rmCalls = log.filter(
      (e) => e.cmd === 'aws' && e.argv[0] === 's3' && e.argv[1] === 'rm',
    );
    expect(rmCalls).toHaveLength(0);

    // No terraform destroy call (tfstate absent).
    const destroyCalls = log.filter(
      (e) => e.cmd === 'terraform' && e.argv[0] === 'destroy',
    );
    expect(destroyCalls).toHaveLength(0);

    // Orphan sweep still ran — that's the authority on teardown success.
    const sweepCalls = log.filter(
      (e) =>
        e.cmd === 'aws' &&
        e.argv[0] === 'resourcegroupstaggingapi' &&
        e.argv[1] === 'get-resources',
    );
    expect(sweepCalls).toHaveLength(1);
  });

  it('partial prior teardown → re-runs s3 rm, terraform destroy, and sweep in order (R9.3)', () => {
    // Partial prior state means: tfstate still exists (prior destroy
    // didn't finish), the bucket still resolves, AND the orphan sweep
    // still finds zero tagged resources once destroy finally completes.
    // Every stage must re-attempt; the call log is the witness.
    const tempDir = createTempRepo({ withTfstate: true });
    const harness = defaultHarness();

    const result = runAppDown(tempDir, harness, ['--yes'], {
      STUB_TERRAFORM_OUTPUT_s3_bucket_name: 'frontend-devops-demo-xyz',
      STUB_S3_BUCKET_VERSIONING: 'Disabled',
      STUB_TERRAFORM_DESTROY_RC: '0',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'Orphan sweep: 0 resources remain. Teardown complete.',
    );

    const log = harness.readCallLog();

    // Locate each of the three mutating/terminal stages in the log.
    const s3RmIdx = log.findIndex(
      (e) => e.cmd === 'aws' && e.argv[0] === 's3' && e.argv[1] === 'rm',
    );
    const destroyIdx = log.findIndex(
      (e) => e.cmd === 'terraform' && e.argv[0] === 'destroy',
    );
    const sweepIdx = log.findIndex(
      (e) =>
        e.cmd === 'aws' &&
        e.argv[0] === 'resourcegroupstaggingapi' &&
        e.argv[1] === 'get-resources',
    );

    // All three must have run on the re-run...
    expect(s3RmIdx).toBeGreaterThanOrEqual(0);
    expect(destroyIdx).toBeGreaterThanOrEqual(0);
    expect(sweepIdx).toBeGreaterThanOrEqual(0);
    // ...and in the canonical order: empty bucket → destroy → sweep.
    expect(s3RmIdx).toBeLessThan(destroyIdx);
    expect(destroyIdx).toBeLessThan(sweepIdx);
  });
});
