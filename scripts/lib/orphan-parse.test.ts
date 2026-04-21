// 🟢 Unit tests for scripts/lib/orphan-parse.sh :: parse_orphan_arns.
//
// parse_orphan_arns reads a JSON document of the shape emitted by
//   aws resourcegroupstaggingapi get-resources
// on stdin and writes one ResourceARN per line on stdout. On malformed
// input, the underlying jq call fails and its non-zero exit code is
// propagated. Tests cover the three R11.2 cases plus malformed input.
//
// Validates: Requirements 10.2, 10.3, 11.2

import { describe, it, expect } from 'vitest';
import { spawnBash } from './test-helpers/spawn-bash';
import { repoRoot } from './test-helpers/repo-root';

const SOURCE_AND_CALL =
  'source scripts/lib/orphan-parse.sh && parse_orphan_arns';

describe('parse_orphan_arns', () => {
  it('emits empty stdout for an empty ResourceTagMappingList', () => {
    const result = spawnBash({
      script: SOURCE_AND_CALL,
      input: JSON.stringify({ ResourceTagMappingList: [] }),
      cwd: repoRoot,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('emits a single ARN followed by a newline for a one-element list', () => {
    const result = spawnBash({
      script: SOURCE_AND_CALL,
      input: JSON.stringify({
        ResourceTagMappingList: [
          { ResourceARN: 'arn:aws:s3:::my-bucket', Tags: [] },
        ],
      }),
      cwd: repoRoot,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe('arn:aws:s3:::my-bucket\n');
  });

  it('emits ARNs one per line in input order for a multi-element list', () => {
    const arns = [
      'arn:aws:s3:::frontend-devops-demo',
      'arn:aws:ec2:us-east-1:684394110906:instance/i-0abc123',
      'arn:aws:rds:us-east-1:684394110906:db:orders-primary',
    ];
    const result = spawnBash({
      script: SOURCE_AND_CALL,
      input: JSON.stringify({
        ResourceTagMappingList: arns.map((arn) => ({
          ResourceARN: arn,
          Tags: [
            { Key: 'Project', Value: 'devops-demo' },
            { Key: 'ManagedBy', Value: 'terraform' },
          ],
        })),
      }),
      cwd: repoRoot,
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).toBe(`${arns.join('\n')}\n`);
  });

  it('propagates a non-zero exit with a jq error on stderr for malformed JSON', () => {
    const result = spawnBash({
      script: SOURCE_AND_CALL,
      input: '{',
      cwd: repoRoot,
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('is sourceable without side effects (sourcing alone produces no output)', () => {
    const result = spawnBash({
      script: 'source scripts/lib/orphan-parse.sh',
      cwd: repoRoot,
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });
});
