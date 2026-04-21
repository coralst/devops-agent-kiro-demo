// 🟢 Unit tests for the top-level `app-up.sh` orchestrator. Tests spawn
// the script in a temporary repo-shaped directory (copying app-up.sh,
// scripts/lib/, and terraform/terraform.tfvars.example) with a PATH
// stub that shadows `aws` and `terraform` so no real CLI is ever
// invoked. Each test creates a fresh temp dir to avoid cross-test
// contamination.
//
// Cases:
//   1. Pre-flight failure (wrong account) → exit 1, no terraform calls.
//   2. tfvars missing → example is copied, R2.10 message on stdout.
//   3. `terraform plan` exit 0 → R9.1 message, no apply call.
//   4. `terraform plan` exit 2 → `terraform apply` appears in the log.
//   5. `terraform apply` exit 7 → script exits 7, stderr echoes
//      `terraform apply`.
//   6. Successful apply → labeled output lines present on stdout.
//
// Validates: Requirements 1.1–1.6, 2.10, 9.1

import { afterEach, describe, expect, it } from 'vitest';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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
 * Build a PATH that puts the stubDir first, then /usr/bin:/bin so jq and
 * other utilities remain resolvable but aws/terraform are shadowed by
 * the stub binaries.
 */
function buildPath(stubDir: string): string {
  return `${stubDir}:/usr/bin:/bin`;
}

/**
 * Create a fresh temp directory shaped like the repo root, containing
 * the bits app-up.sh touches:
 *   - app-up.sh (copied + chmod 755)
 *   - scripts/lib/preflight.sh and its siblings (copied recursively)
 *   - terraform/terraform.tfvars.example
 *   - terraform/.terraform/ (empty dir so `terraform init` is skipped)
 *
 * The caller can opt out of the tfvars.example copy by passing
 * `{ withTfvarsExample: false }` to exercise the R2.10 copy-from-example
 * path.
 */
function createTempRepo(
  options: { withTfvarsExample?: boolean; withDotTerraform?: boolean } = {},
): string {
  const { withTfvarsExample = true, withDotTerraform = true } = options;

  const dir = mkdtempSync(join(tmpdir(), 'app-up-test-'));
  tempDirs.push(dir);

  // app-up.sh at the root (executable).
  cpSync(join(repoRoot, 'app-up.sh'), join(dir, 'app-up.sh'));
  chmodSync(join(dir, 'app-up.sh'), 0o755);

  // scripts/lib/ — recursive copy. node_modules are excluded via filter
  // to keep the copy fast.
  cpSync(join(repoRoot, 'scripts'), join(dir, 'scripts'), {
    recursive: true,
    filter: (src) => !src.includes('node_modules'),
  });

  // terraform/ with tfvars.example (unless we want to test the
  // "example missing" path; currently unused but parametrized).
  mkdirSync(join(dir, 'terraform'), { recursive: true });
  if (withTfvarsExample) {
    cpSync(
      join(repoRoot, 'terraform', 'terraform.tfvars.example'),
      join(dir, 'terraform', 'terraform.tfvars.example'),
    );
  }

  // Pretend `terraform init` has already run so step 3 is skipped and
  // the stub's `terraform init` path is not relied upon in these tests.
  if (withDotTerraform) {
    mkdirSync(join(dir, 'terraform', '.terraform'), { recursive: true });
  }

  return dir;
}

function runAppUp(
  tempDir: string,
  harness: StubHarness,
  extraEnv: Record<string, string> = {},
): ReturnType<typeof spawnBash> {
  return spawnBash({
    script: './app-up.sh',
    cwd: tempDir,
    env: {
      PATH: buildPath(harness.stubDir),
      ...extraEnv,
    },
  });
}

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

// ---------------------------------------------------------------------------
// Case 1: Pre-flight failure → exit 1, no terraform calls
// ---------------------------------------------------------------------------

describe('app-up.sh (pre-flight failure)', () => {
  it('exits non-zero and never calls terraform when account ID is wrong', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const result = runAppUp(tempDir, harness, {
      STUB_AWS_ACCOUNT_ID: '000000000000',
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'Expected AWS account 684394110906 but got 000000000000',
    );

    const log = harness.readCallLog();
    const terraformCalls = log.filter((e) => e.cmd === 'terraform');
    expect(terraformCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Case 2: tfvars missing → example is copied (R2.10)
// ---------------------------------------------------------------------------

describe('app-up.sh (tfvars bootstrap)', () => {
  it('copies terraform.tfvars.example to terraform.tfvars and prints R2.10 message', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    // Use STUB_TERRAFORM_PLAN_RC=0 so the script exits cleanly after
    // the plan-no-changes branch, keeping the test focused on the tfvars
    // copy side effect without also needing to stub apply.
    const result = runAppUp(tempDir, harness, {
      STUB_TERRAFORM_PLAN_RC: '0',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'Copied terraform/terraform.tfvars.example to terraform/terraform.tfvars. Edit it if you need non-default values.',
    );
    // The file must actually exist after the run.
    const tfvarsPath = join(tempDir, 'terraform', 'terraform.tfvars');
    expect(existsSync(tfvarsPath)).toBe(true);
    const copied = readFileSync(tfvarsPath, 'utf8');
    const example = readFileSync(
      join(repoRoot, 'terraform', 'terraform.tfvars.example'),
      'utf8',
    );
    expect(copied).toBe(example);
  });
});

// ---------------------------------------------------------------------------
// Case 3: `terraform plan` exit 0 → R9.1 message, no apply call
// ---------------------------------------------------------------------------

describe('app-up.sh (no changes)', () => {
  it('prints "No infrastructure changes required." and skips apply on plan exit 0', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const result = runAppUp(tempDir, harness, {
      STUB_TERRAFORM_PLAN_RC: '0',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('No infrastructure changes required.');

    const log = harness.readCallLog();
    const applyCalls = log.filter(
      (e) => e.cmd === 'terraform' && e.argv[0] === 'apply',
    );
    expect(applyCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Case 4: `terraform plan` exit 2 → apply runs
// ---------------------------------------------------------------------------

describe('app-up.sh (changes pending)', () => {
  it('calls `terraform apply -auto-approve` when plan signals changes', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const result = runAppUp(tempDir, harness, {
      STUB_TERRAFORM_PLAN_RC: '2',
    });

    expect(result.status).toBe(0);

    const log = harness.readCallLog();
    const applyCalls = log.filter(
      (e) => e.cmd === 'terraform' && e.argv[0] === 'apply',
    );
    expect(applyCalls).toHaveLength(1);
    expect(applyCalls[0].argv).toContain('-auto-approve');
  });
});

// ---------------------------------------------------------------------------
// Case 5: apply fails with exit 7 → script exits 7, stderr has failing cmd
// ---------------------------------------------------------------------------

describe('app-up.sh (apply failure)', () => {
  it('propagates the apply exit code and echoes "terraform apply" to stderr', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const result = runAppUp(tempDir, harness, {
      STUB_TERRAFORM_PLAN_RC: '2',
      STUB_TERRAFORM_APPLY_RC: '7',
    });

    expect(result.status).toBe(7);
    expect(result.stderr).toContain('terraform apply');
  });
});

// ---------------------------------------------------------------------------
// Case 6: successful apply → labeled outputs on stdout (R1.5)
// ---------------------------------------------------------------------------

describe('app-up.sh (successful apply)', () => {
  it('prints alb_dns_name, s3_website_url, and sns_topic_arn on stdout', () => {
    const tempDir = createTempRepo();
    const harness = defaultHarness();

    const result = runAppUp(tempDir, harness, {
      STUB_TERRAFORM_PLAN_RC: '2',
      STUB_TERRAFORM_APPLY_RC: '0',
      STUB_TERRAFORM_OUTPUT_alb_dns_name: 'demo-alb.example.com',
      STUB_TERRAFORM_OUTPUT_s3_website_url:
        'http://demo-frontend.s3-website-us-east-1.amazonaws.com',
      STUB_TERRAFORM_OUTPUT_sns_topic_arn:
        'arn:aws:sns:us-east-1:684394110906:demo-alarms',
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('alb_dns_name: demo-alb.example.com');
    expect(result.stdout).toContain(
      's3_website_url: http://demo-frontend.s3-website-us-east-1.amazonaws.com',
    );
    expect(result.stdout).toContain(
      'sns_topic_arn: arn:aws:sns:us-east-1:684394110906:demo-alarms',
    );

    // Sanity: `terraform output -raw` was invoked three times (once per
    // output).
    const log = harness.readCallLog();
    const outputCalls = log.filter(
      (e) => e.cmd === 'terraform' && e.argv[0] === 'output',
    );
    expect(outputCalls).toHaveLength(3);
    for (const c of outputCalls) {
      expect(c.argv).toEqual(expect.arrayContaining(['output', '-raw']));
    }
  });
});
