// 🟢 Thin wrapper around child_process.spawnSync for invoking bash one-liners
// in tests. Keeps raw stdout/stderr bytes so callers can assert on exact
// output (no trimming).

import { spawnSync } from 'node:child_process';

export interface SpawnBashOptions {
  /** Bash source to execute (e.g., "source scripts/lib/tag-filter.sh && build_tag_filter_args"). */
  script: string;
  /** Optional stdin string. */
  input?: string;
  /** Env overrides merged on top of process.env. */
  env?: Record<string, string>;
  /** Optional working directory. */
  cwd?: string;
}

export interface SpawnBashResult {
  status: number;
  stdout: string;
  stderr: string;
}

/**
 * Run a bash one-liner via `bash -c` and return status/stdout/stderr verbatim.
 *
 * Signal termination (status === null from spawnSync) is surfaced as a thrown
 * error rather than silently coerced to a number, since it would otherwise
 * mask real crashes in the script-under-test.
 */
export function spawnBash(options: SpawnBashOptions): SpawnBashResult {
  const mergedEnv: NodeJS.ProcessEnv = {
    ...process.env,
    ...(options.env ?? {}),
  };

  const result = spawnSync('bash', ['-c', options.script], {
    input: options.input,
    env: mergedEnv,
    cwd: options.cwd,
    encoding: 'utf8',
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status === null) {
    throw new Error(
      `bash process terminated by signal ${result.signal ?? 'unknown'} (no exit status available)`,
    );
  }

  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  };
}
