import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Unit tests for Orders Service health check.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.5
 */

// Mock the db module
const mockQuery = vi.fn();
vi.mock('./db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  pool: { on: vi.fn() },
  DatabaseConnectionError: class DatabaseConnectionError extends Error {
    readonly code = 'DB_CONNECTION_ERROR';
    constructor(message: string) {
      super(message);
      this.name = 'DatabaseConnectionError';
    }
  },
}));

// Mock fs/promises
const mockWriteFile = vi.fn();
const mockReadFile = vi.fn();
const mockUnlink = vi.fn();
vi.mock('node:fs/promises', () => ({
  default: {
    writeFile: (...args: unknown[]) => mockWriteFile(...args),
    readFile: (...args: unknown[]) => mockReadFile(...args),
    unlink: (...args: unknown[]) => mockUnlink(...args),
  },
}));

import { checkOrdersHealth } from './health';

const MOUNT = '/mnt/ebs-data';

describe('checkOrdersHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns "healthy" when DB and EBS both responsive', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 });
    mockWriteFile.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce('ok');
    mockUnlink.mockResolvedValueOnce(undefined);

    const result = await checkOrdersHealth(MOUNT);

    expect(result.status).toBe('healthy');
    expect(result.service).toBe('orders');
    expect(result.details.database).toBe(true);
    expect(result.details.ebsVolume).toBe(true);
    expect(result.timestamp).toBeDefined();
  });

  it('returns "degraded" when DB up but EBS I/O exceeds 5s', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 });

    // Simulate slow EBS by making writeFile delay past the 5s threshold
    const originalNow = Date.now;
    let callCount = 0;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      callCount++;
      // First call captures start time, second call returns start + 6000ms
      return callCount <= 1 ? originalNow() : originalNow() + 6000;
    });

    mockWriteFile.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce('ok');
    mockUnlink.mockResolvedValueOnce(undefined);

    const result = await checkOrdersHealth(MOUNT);

    expect(result.status).toBe('degraded');
    expect(result.details.database).toBe(true);
    expect(result.details.ebsVolume).toBe(false);

    vi.restoreAllMocks();
  });

  it('returns "degraded" when DB up but EBS write throws an error', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 });
    mockWriteFile.mockRejectedValueOnce(new Error('EIO: I/O error'));
    mockUnlink.mockResolvedValueOnce(undefined);

    const result = await checkOrdersHealth(MOUNT);

    expect(result.status).toBe('degraded');
    expect(result.details.database).toBe(true);
    expect(result.details.ebsVolume).toBe(false);
  });

  it('returns "unhealthy" when DB unreachable', async () => {
    mockQuery.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    mockWriteFile.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce('ok');
    mockUnlink.mockResolvedValueOnce(undefined);

    const result = await checkOrdersHealth(MOUNT);

    expect(result.status).toBe('unhealthy');
    expect(result.details.database).toBe(false);
  });

  it('returns "unhealthy" when DB unreachable even if EBS also fails', async () => {
    mockQuery.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    mockWriteFile.mockRejectedValueOnce(new Error('EIO'));
    mockUnlink.mockResolvedValueOnce(undefined);

    const result = await checkOrdersHealth(MOUNT);

    expect(result.status).toBe('unhealthy');
    expect(result.details.database).toBe(false);
    expect(result.details.ebsVolume).toBe(false);
  });

  it('cleans up health check test file after execution', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 });
    mockWriteFile.mockResolvedValueOnce(undefined);
    mockReadFile.mockResolvedValueOnce('ok');
    mockUnlink.mockResolvedValueOnce(undefined);

    await checkOrdersHealth(MOUNT);

    expect(mockUnlink).toHaveBeenCalledWith(`${MOUNT}/.health-check`);
  });

  it('cleans up test file even when EBS write fails', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 });
    mockWriteFile.mockRejectedValueOnce(new Error('EIO'));
    mockUnlink.mockResolvedValueOnce(undefined);

    await checkOrdersHealth(MOUNT);

    expect(mockUnlink).toHaveBeenCalledWith(`${MOUNT}/.health-check`);
  });
});
