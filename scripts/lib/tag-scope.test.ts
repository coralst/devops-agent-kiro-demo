// 🟢 Tag-scope safety audit. This test fails if anyone adds a forbidden
// direct AWS delete API call to app-up.sh, app-down.sh, or any helper
// in scripts/lib/. All destructive AWS work MUST flow through
// `terraform destroy` (which respects the tag-scoped state) or through
// `empty_s3_bucket` in s3-empty.sh (the only sanctioned direct-API
// deletion, scoped to the S3 frontend bucket identified from state).
//
// A second audit asserts that `--tag-filters` is only constructed by
// build_tag_filter_args in tag-filter.sh or called via
// $(build_tag_filter_args). Any other construction risks tag-scope
// drift — a compromised or misconfigured ambient environment must not
// be able to widen or narrow the sweep's scope.
//
// Validates: Requirements 8.1, 8.2, 8.3

import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { repoRoot } from './test-helpers/repo-root';

// Files audited by both tests. These are the only shell files that make
// AWS/Terraform calls; adding a new .sh helper means adding it here.
const AUDITED_FILES = [
  join(repoRoot, 'app-up.sh'),
  join(repoRoot, 'app-down.sh'),
  join(repoRoot, 'scripts/lib/tag-filter.sh'),
  join(repoRoot, 'scripts/lib/orphan-parse.sh'),
  join(repoRoot, 'scripts/lib/preflight.sh'),
  join(repoRoot, 'scripts/lib/s3-empty.sh'),
];

// The forbidden API patterns. If any of these appear in the scripts,
// the test fails and CI blocks the PR.
//
// Note on `s3api delete-bucket`: bucket deletion belongs to
// `terraform destroy`. The *objects* inside the bucket can be deleted
// via `aws s3 rm` + `aws s3api delete-objects` (inside empty_s3_bucket),
// but the bucket itself must not be destroyed by direct API call.
const FORBIDDEN_PATTERNS = [
  'ec2 terminate-instances',
  'rds delete-db-instance',
  'ec2 delete-volume',
  'iam delete-role',
  's3api delete-bucket',
  'ec2 delete-vpc',
  'elbv2 delete-load-balancer',
];

describe('tag-scope safety audit', () => {
  it('no script contains forbidden direct AWS delete API calls', () => {
    const pattern = FORBIDDEN_PATTERNS.join('|');
    const result = spawnSync(
      'grep',
      ['-nE', pattern, ...AUDITED_FILES],
      { encoding: 'utf8' },
    );

    // grep exit codes:
    //   0 → at least one match found (FAIL for us — forbidden pattern present)
    //   1 → no matches found (SUCCESS for us)
    //   2 → error (file missing, permission denied, etc.)
    if (result.status === 0) {
      throw new Error(
        `Forbidden AWS delete API calls found in scripts:\n\n${result.stdout}\n` +
          `All AWS resource deletion MUST flow through 'terraform destroy' ` +
          `or empty_s3_bucket(). Direct delete APIs violate R8.2.`,
      );
    }
    expect(result.status).toBe(1);
  });

  it('--tag-filters appears only inside build_tag_filter_args or via $(build_tag_filter_args)', () => {
    // Use `--` to stop grep's option parsing so `--tag-filters` isn't
    // mistaken for a grep flag. Also use `-e` explicitly for the same
    // reason — belt-and-suspenders against BSD vs GNU grep differences.
    const grepResult = spawnSync(
      'grep',
      ['-nE', '-e', '--tag-filters', '--', ...AUDITED_FILES],
      { encoding: 'utf8' },
    );

    if (grepResult.status === 1) {
      // No --tag-filters usage anywhere in the audited files; vacuously
      // safe. This branch exists so new repos with unused helpers don't
      // trip the assertion.
      return;
    }

    // status 0 = matches found; any other non-1 status is a grep error
    // and should surface loudly.
    expect(grepResult.status).toBe(0);

    // Every line with --tag-filters must either:
    //   1. Live inside tag-filter.sh (the hardcoded literal + its docs), OR
    //   2. Invoke build_tag_filter_args via $() substitution.
    const lines = grepResult.stdout
      .split('\n')
      .filter((l) => l.length > 0);

    for (const line of lines) {
      const isInTagFilterSh = line.includes('tag-filter.sh');
      const isViaFunctionCall = line.includes('$(build_tag_filter_args)');

      if (!isInTagFilterSh && !isViaFunctionCall) {
        throw new Error(
          `--tag-filters used outside of build_tag_filter_args:\n${line}\n\n` +
            `This risks tag-scope drift. Use $(build_tag_filter_args) instead.`,
        );
      }
    }
  });
});
