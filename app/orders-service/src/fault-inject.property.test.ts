import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';

/**
 * Property 4: Fault injection is idempotent
 *
 * For any number of consecutive calls to `executeFaultInjection` while
 * fault is active, verify exactly one set of fio/dd processes running.
 * Mock shell execution and verify single invocation.
 *
 * **Validates: Requirements 3.3**
 */

// Mock child_process.exec
const mockExec = vi.fn();
vi.mock('node:child_process', () => ({
  exec: (...args: unknown[]) => {
    const cb = args[args.length - 1];
    const result = mockExec(args[0]);
    if (result instanceof Error) {
      (cb as (err: Error) => void)(result);
    } else {
      (cb as (err: null, result: { stdout: string; stderr: string }) => void)(null, {
        stdout: result ?? '',
        stderr: '',
      });
    }
  },
}));

// Mock fs.promises
const mockReadFile = vi.fn();
vi.mock('node:fs/promises', () => ({
  default: {
    readFile: (...args: unknown[]) => mockReadFile(...args),
  },
}));

import { executeFaultInjection } from './fault-inject';

describe('Property 4: Fault injection is idempotent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls the fault-inject script exactly once regardless of how many times executeFaultInjection is invoked', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 10 }),
        async (callCount) => {
          vi.clearAllMocks();

          // First call: getFaultStatus — marker does NOT exist (fault inactive)
          // pgrep fails (no fio running), df returns usage
          let firstStatusChecked = false;

          mockReadFile.mockImplementation(() => {
            if (!firstStatusChecked) {
              // First status check: no marker → fault not active
              firstStatusChecked = true;
              return Promise.reject(new Error('ENOENT'));
            }
            // Subsequent status checks: marker exists → fault active
            return Promise.resolve('2025-01-01T00:00:00Z');
          });

          mockExec.mockImplementation((cmd: string) => {
            if (typeof cmd === 'string' && cmd.includes('pgrep')) {
              if (!firstStatusChecked) {
                // First check: no fio running
                return new Error('no process');
              }
              // After injection: fio is running
              return '12345';
            }
            if (typeof cmd === 'string' && cmd.includes('df --output=pcent')) {
              return '  15%';
            }
            // fault-inject.sh execution — succeeds
            return '';
          });

          // Call executeFaultInjection N times
          for (let i = 0; i < callCount; i++) {
            await executeFaultInjection('/mnt/ebs-data');
          }

          // Count how many times the fault-inject.sh script was actually executed
          const scriptCalls = mockExec.mock.calls.filter(
            (call) => typeof call[0] === 'string' && call[0].includes('fault-inject.sh'),
          );

          // Exactly one script invocation regardless of callCount
          expect(scriptCalls).toHaveLength(1);
        },
      ),
      { numRuns: 30 },
    );
  });
});
