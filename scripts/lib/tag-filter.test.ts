// 🟢 Unit tests for scripts/lib/tag-filter.sh :: build_tag_filter_args.
//
// These tests lock in the safety-critical hardcoded tag filter used by the
// orphan-sweep step of app-down.sh. Any change to the emitted string is a
// change to the Orphan_Sweep's scope, which must be deliberate and reviewed.
//
// Validates: Requirements 8.3, 10.1, 11.1

import { describe, it, expect } from 'vitest';
import { spawnBash } from './test-helpers/spawn-bash';
import { repoRoot } from './test-helpers/repo-root';

const EXPECTED_TAG_FILTER =
  '--tag-filters Key=Project,Values=devops-demo Key=ManagedBy,Values=terraform';

describe('build_tag_filter_args', () => {
  it('emits the exact tag-filter CLI args for Project and ManagedBy on stdout', () => {
    const result = spawnBash({
      script: 'source scripts/lib/tag-filter.sh && build_tag_filter_args',
      cwd: repoRoot,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${EXPECTED_TAG_FILTER}\n`);
  });

  it('is sourceable without side effects (sourcing alone produces no output)', () => {
    // Sourcing the file must not execute any helper as a side effect — only
    // define functions. This guards R10.4 (sourceable in isolation).
    const result = spawnBash({
      script: 'source scripts/lib/tag-filter.sh',
      cwd: repoRoot,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });
});
