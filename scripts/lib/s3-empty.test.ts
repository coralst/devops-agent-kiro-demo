// 🟢 Unit tests for scripts/lib/s3-empty.sh :: empty_s3_bucket. Tests
// shell out to bash via spawnBash and use the PATH-stub harness
// (makeStubBin) to inject a fake aws binary so no real AWS call is made.
//
// Cases:
//   1. Non-versioned bucket → single `aws s3 rm` call, no delete-objects
//      call, exit 0.
//   2. Versioned bucket with a small object count → `list-object-versions`
//      returns a fixture JSON, exactly one `delete-objects` call follows,
//      exit 0.
//   3. `aws s3 rm` fails with NoSuchBucket → exit 0 (already-gone is OK).
//   4. `aws s3 rm` fails with AccessDenied → non-zero exit, failing
//      command echoed to stderr.
//
// Validates: Requirements 5.3, 5.4, 5.5

import { afterEach, describe, expect, it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnBash } from './test-helpers/spawn-bash';
import { makeStubBin, type StubHarness } from './test-helpers/make-stub-bin';
import { repoRoot } from './test-helpers/repo-root';

const harnesses: StubHarness[] = [];

afterEach(() => {
  while (harnesses.length > 0) {
    const h = harnesses.pop();
    h?.cleanup();
  }
});

function buildPath(stubDir: string): string {
  return `${stubDir}:/usr/bin:/bin`;
}

const CALL =
  'source scripts/lib/s3-empty.sh && empty_s3_bucket test-bucket us-east-1';

// ---------------------------------------------------------------------------
// Case 1: Non-versioned bucket
// ---------------------------------------------------------------------------

describe('empty_s3_bucket (non-versioned)', () => {
  it('makes exactly one aws s3 rm call and no delete-objects calls', () => {
    const harness = makeStubBin({
      commands: { aws: {}, jq: { passthrough: true } },
    });
    harnesses.push(harness);

    const result = spawnBash({
      script: CALL,
      cwd: repoRoot,
      env: {
        PATH: buildPath(harness.stubDir),
        STUB_S3_BUCKET_VERSIONING: 'Disabled',
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    const log = harness.readCallLog();
    const rmCalls = log.filter(
      (e) => e.cmd === 'aws' && e.argv[0] === 's3' && e.argv[1] === 'rm',
    );
    const deleteObjectsCalls = log.filter(
      (e) =>
        e.cmd === 'aws' &&
        e.argv[0] === 's3api' &&
        e.argv[1] === 'delete-objects',
    );

    expect(rmCalls).toHaveLength(1);
    expect(rmCalls[0].argv).toEqual([
      's3',
      'rm',
      's3://test-bucket/',
      '--recursive',
      '--region',
      'us-east-1',
    ]);
    expect(deleteObjectsCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Case 2: Versioned bucket with small object count
// ---------------------------------------------------------------------------

describe('empty_s3_bucket (versioned, small)', () => {
  it('issues exactly one delete-objects call with all versions merged', () => {
    const harness = makeStubBin({
      commands: { aws: {}, jq: { passthrough: true } },
    });
    harnesses.push(harness);

    // Fixture: two versions + one delete marker, no NextToken (single page).
    const fixture = {
      Versions: [
        { Key: 'index.html', VersionId: 'v1' },
        { Key: 'assets/app.js', VersionId: 'v2' },
      ],
      DeleteMarkers: [{ Key: 'stale.html', VersionId: 'vdm1' }],
    };
    const fixturePath = join(harness.stubDir, 'versions.json');
    writeFileSync(fixturePath, JSON.stringify(fixture));

    const result = spawnBash({
      script: CALL,
      cwd: repoRoot,
      env: {
        PATH: buildPath(harness.stubDir),
        STUB_S3_BUCKET_VERSIONING: 'Enabled',
        STUB_S3_LIST_OBJECT_VERSIONS_JSON_FILE: fixturePath,
      },
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');

    const log = harness.readCallLog();
    const deleteObjectsCalls = log.filter(
      (e) =>
        e.cmd === 'aws' &&
        e.argv[0] === 's3api' &&
        e.argv[1] === 'delete-objects',
    );

    expect(deleteObjectsCalls).toHaveLength(1);

    // The --delete flag is immediately followed by the JSON payload.
    const deleteIdx = deleteObjectsCalls[0].argv.indexOf('--delete');
    expect(deleteIdx).toBeGreaterThan(-1);
    const payload = JSON.parse(deleteObjectsCalls[0].argv[deleteIdx + 1]);

    // All three entries (2 versions + 1 delete marker) should be present.
    expect(payload.Objects).toHaveLength(3);
    expect(payload.Objects).toEqual(
      expect.arrayContaining([
        { Key: 'index.html', VersionId: 'v1' },
        { Key: 'assets/app.js', VersionId: 'v2' },
        { Key: 'stale.html', VersionId: 'vdm1' },
      ]),
    );
    expect(payload.Quiet).toBe(true);
  });

  it('skips delete-objects when versioned bucket has zero versions', () => {
    const harness = makeStubBin({
      commands: { aws: {}, jq: { passthrough: true } },
    });
    harnesses.push(harness);

    // Empty fixture: no versions, no delete markers.
    const fixturePath = join(harness.stubDir, 'versions.json');
    writeFileSync(
      fixturePath,
      JSON.stringify({ Versions: [], DeleteMarkers: [] }),
    );

    const result = spawnBash({
      script: CALL,
      cwd: repoRoot,
      env: {
        PATH: buildPath(harness.stubDir),
        STUB_S3_BUCKET_VERSIONING: 'Enabled',
        STUB_S3_LIST_OBJECT_VERSIONS_JSON_FILE: fixturePath,
      },
    });

    expect(result.status).toBe(0);

    const log = harness.readCallLog();
    const deleteObjectsCalls = log.filter(
      (e) =>
        e.cmd === 'aws' &&
        e.argv[0] === 's3api' &&
        e.argv[1] === 'delete-objects',
    );
    expect(deleteObjectsCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Case 3: NoSuchBucket → exit 0
// ---------------------------------------------------------------------------

describe('empty_s3_bucket (NoSuchBucket)', () => {
  it('treats a NoSuchBucket error from aws s3 rm as success', () => {
    const harness = makeStubBin({
      commands: { aws: {}, jq: { passthrough: true } },
    });
    harnesses.push(harness);

    const result = spawnBash({
      script: CALL,
      cwd: repoRoot,
      env: {
        PATH: buildPath(harness.stubDir),
        STUB_AWS_S3_RM_FAIL:
          'An error occurred (NoSuchBucket) when calling the ListObjects operation: The specified bucket does not exist',
      },
    });

    expect(result.status).toBe(0);

    const log = harness.readCallLog();
    // No versioning probe or delete-objects should happen after NoSuchBucket.
    const probeCalls = log.filter(
      (e) =>
        e.cmd === 'aws' &&
        e.argv[0] === 's3api' &&
        e.argv[1] === 'get-bucket-versioning',
    );
    expect(probeCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Case 4: AccessDenied → non-zero with failing command on stderr
// ---------------------------------------------------------------------------

describe('empty_s3_bucket (AccessDenied)', () => {
  it('exits non-zero and echoes the failing command and stderr from aws', () => {
    const harness = makeStubBin({
      commands: { aws: {}, jq: { passthrough: true } },
    });
    harnesses.push(harness);

    const result = spawnBash({
      script: CALL,
      cwd: repoRoot,
      env: {
        PATH: buildPath(harness.stubDir),
        STUB_AWS_S3_RM_FAIL:
          'An error occurred (AccessDenied) when calling the ListObjects operation: Access Denied',
      },
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      'aws s3 rm s3://test-bucket/ --recursive --region us-east-1 failed',
    );
    expect(result.stderr).toContain('AccessDenied');
  });
});
