import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for fault injection and reset.
 *
 * Requirements: 3.3-3.6, 5.1-5.6, 13.3
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

import { executeFaultInjection, resetFault, getFaultStatus } from './fault-inject';

const MOUNT = '/mnt/ebs-data';

describe('executeFaultInjection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates marker file and launches processes when no fault is active', async () => {
    // getFaultStatus: marker does not exist, no fio running
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
    mockExec.mockImplementation((cmd: string) => {
      if (cmd.includes('pgrep')) return new Error('no process');
      if (cmd.includes('df --output=pcent')) return '  12%';
      // fault-inject.sh — succeeds
      return '';
    });

    await executeFaultInjection(MOUNT);

    // Verify the fault-inject.sh script was called
    const scriptCalls = mockExec.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('fault-inject.sh'),
    );
    expect(scriptCalls).toHaveLength(1);
    expect(scriptCalls[0][0]).toContain(MOUNT);
  });

  it('skips execution when fault is already active (idempotent)', async () => {
    // getFaultStatus: marker exists, fio running → active
    mockReadFile.mockResolvedValueOnce('2025-01-01T00:00:00Z');
    mockExec.mockImplementation((cmd: string) => {
      if (cmd.includes('pgrep')) return '12345';
      if (cmd.includes('df --output=pcent')) return '  85%';
      return '';
    });

    await executeFaultInjection(MOUNT);

    // Verify the fault-inject.sh script was NOT called
    const scriptCalls = mockExec.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('fault-inject.sh'),
    );
    expect(scriptCalls).toHaveLength(0);
  });

  it('gracefully handles missing fio binary (logs error, does not throw)', async () => {
    // getFaultStatus: no fault active
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockExec.mockImplementation((cmd: string) => {
      if (cmd.includes('pgrep')) return new Error('no process');
      if (cmd.includes('df --output=pcent')) return '  10%';
      // fault-inject.sh fails (fio not found)
      return new Error('fio: command not found');
    });

    // Should not throw
    await expect(executeFaultInjection(MOUNT)).resolves.toBeUndefined();

    // Should have logged the error
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[orders-service] Fault injection script failed:'),
      expect.any(String),
    );

    consoleSpy.mockRestore();
  });
});

describe('resetFault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('kills processes, removes files, and returns disk usage', async () => {
    mockExec.mockImplementation((cmd: string) => {
      if (cmd.includes('fault-reset.sh')) return '';
      if (cmd.includes('df --output=pcent')) return '  8%';
      return '';
    });

    const result = await resetFault(MOUNT);

    // Verify reset script was called
    const resetCalls = mockExec.mock.calls.filter(
      (call) => typeof call[0] === 'string' && call[0].includes('fault-reset.sh'),
    );
    expect(resetCalls).toHaveLength(1);
    expect(resetCalls[0][0]).toContain(MOUNT);

    // Verify response shape
    expect(result.success).toBe(true);
    expect(result.message).toBe('Fault injection cleared. Volume recovering.');
    expect(result.diskUsagePercent).toBe(8);
  });
});

describe('getFaultStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns active: true when marker exists and fio is running', async () => {
    mockReadFile.mockResolvedValueOnce('2025-06-15T10:30:00Z');
    mockExec.mockImplementation((cmd: string) => {
      if (cmd.includes('pgrep')) return '54321';
      if (cmd.includes('df --output=pcent')) return '  92%';
      return '';
    });

    const status = await getFaultStatus(MOUNT);

    expect(status.active).toBe(true);
    expect(status.startedAt).toBe('2025-06-15T10:30:00Z');
    expect(status.volumePath).toBe(MOUNT);
    expect(status.diskUsagePercent).toBe(92);
    expect(status.fioProcessRunning).toBe(true);
  });

  it('returns active: false when marker does not exist', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('ENOENT'));
    mockExec.mockImplementation((cmd: string) => {
      if (cmd.includes('pgrep')) return new Error('no process');
      if (cmd.includes('df --output=pcent')) return '  5%';
      return '';
    });

    const status = await getFaultStatus(MOUNT);

    expect(status.active).toBe(false);
    expect(status.startedAt).toBeUndefined();
    expect(status.volumePath).toBe(MOUNT);
    expect(status.diskUsagePercent).toBe(5);
    expect(status.fioProcessRunning).toBe(false);
  });

  it('returns active: false when marker exists but fio is not running', async () => {
    mockReadFile.mockResolvedValueOnce('2025-06-15T10:30:00Z');
    mockExec.mockImplementation((cmd: string) => {
      if (cmd.includes('pgrep')) return new Error('no process');
      if (cmd.includes('df --output=pcent')) return '  20%';
      return '';
    });

    const status = await getFaultStatus(MOUNT);

    expect(status.active).toBe(false);
    expect(status.startedAt).toBe('2025-06-15T10:30:00Z');
    expect(status.fioProcessRunning).toBe(false);
  });
});
