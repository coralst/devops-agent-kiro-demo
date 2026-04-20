import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import request from 'supertest';

/**
 * Property 6: Fault impact — Orders Service fails during active fault
 *
 * For any valid checkout request submitted while a fault is active on the
 * EBS volume, the Orders Service returns HTTP 500 for EBS-dependent operations.
 *
 * We simulate the fault by having writeOrderLog throw EbsWriteError.
 *
 * **Validates: Requirement 4.1**
 */

// Mock pg before importing app
vi.mock('pg', () => {
  const mockPool = {
    query: vi.fn(),
    on: vi.fn(),
  };
  return { Pool: vi.fn(() => mockPool) };
});

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

const mockWriteOrderLog = vi.fn();
vi.mock('./order-log', () => ({
  writeOrderLog: (...args: unknown[]) => mockWriteOrderLog(...args),
  EbsWriteError: class EbsWriteError extends Error {
    readonly code = 'EBS_IO_TIMEOUT';
    constructor(message: string) {
      super(message);
      this.name = 'EbsWriteError';
    }
  },
}));

// Mock fault-inject to prevent actual shell execution
vi.mock('./fault-inject', () => ({
  executeFaultInjection: vi.fn().mockResolvedValue(undefined),
  resetFault: vi.fn().mockResolvedValue({ success: true, message: 'Reset', diskUsagePercent: 10 }),
  getFaultStatus: vi.fn().mockResolvedValue({ active: false, volumePath: '/mnt/ebs-data', diskUsagePercent: 0, fioProcessRunning: false }),
}));

// Mock health module to prevent file system access
vi.mock('./health', () => ({
  checkOrdersHealth: vi.fn().mockResolvedValue({
    service: 'orders',
    status: 'degraded',
    timestamp: new Date().toISOString(),
    details: { database: true, ebsVolume: false },
  }),
}));

import { app } from './index';
import { EbsWriteError } from './order-log';

/** A non-trigger product row returned by the DB. */
function normalProductRow(id: string) {
  return {
    id,
    name: 'Test Product',
    description: 'A test product',
    price: 1000,
    image_url: '/images/test.png',
    category: 'test',
    is_trigger: false,
  };
}

describe('Property 6: Fault impact — Orders Service fails during active fault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns HTTP 500 for any valid checkout when EBS write fails (fault active)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 1, max: 100 }),
        async (itemId, quantity) => {
          const product = normalProductRow(itemId);

          // DB queries succeed (product lookup and order insert)
          mockQuery.mockResolvedValueOnce({ rows: [product], rowCount: 1 });
          mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

          // EBS write fails — simulating active fault on the volume
          mockWriteOrderLog.mockRejectedValueOnce(
            new EbsWriteError('EBS write timed out — volume degraded'),
          );

          const res = await request(app)
            .post('/api/orders/checkout')
            .send({ itemId, quantity });

          expect(res.status).toBe(500);
          expect(res.body.code).toBe('EBS_IO_TIMEOUT');
        },
      ),
      { numRuns: 20 },
    );
  });
});
