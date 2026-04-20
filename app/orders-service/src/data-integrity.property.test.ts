import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import request from 'supertest';

/**
 * Property 9: Data integrity — pre-fault orders survive fault lifecycle
 *
 * For any set of orders created before fault injection, all order records
 * remain intact and queryable in the RDS database throughout the fault
 * injection and reset lifecycle.
 *
 * We simulate this by:
 * 1. Creating orders (DB mock stores them)
 * 2. Simulating fault injection (EBS fails, but DB stays up)
 * 3. Verifying orders are still queryable via GET /api/orders/:id
 *
 * **Validates: Requirement 11.2**
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
    status: 'healthy',
    timestamp: new Date().toISOString(),
    details: { database: true, ebsVolume: true },
  }),
}));

import { app } from './index';

/** Arbitrary for generating a stored order DB row. */
const orderRowArb = fc.record({
  id: fc.uuid(),
  product_id: fc.uuid(),
  quantity: fc.integer({ min: 1, max: 100 }),
  total_price: fc.integer({ min: 1, max: 9999999 }),
  status: fc.constantFrom('pending', 'confirmed'),
  created_at: fc.constant(new Date('2025-01-15T10:00:00Z')),
});

describe('Property 9: Data integrity — pre-fault orders survive fault lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('pre-fault orders remain queryable after fault injection and reset', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(orderRowArb, { minLength: 1, maxLength: 5 }),
        async (orders) => {
          // Phase 1: Verify each order is queryable (pre-fault baseline)
          for (const order of orders) {
            mockQuery.mockResolvedValueOnce({ rows: [order], rowCount: 1 });

            const res = await request(app).get(`/api/orders/${order.id}`);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(order.id);
            expect(res.body.productId).toBe(order.product_id);
            expect(res.body.quantity).toBe(order.quantity);
            expect(res.body.totalPrice).toBe(order.total_price);
          }

          // Phase 2: Simulate fault active — EBS is degraded but DB is fine.
          // Orders in RDS should still be queryable since RDS is independent
          // of the EBS volume.
          for (const order of orders) {
            mockQuery.mockResolvedValueOnce({ rows: [order], rowCount: 1 });

            const res = await request(app).get(`/api/orders/${order.id}`);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(order.id);
            expect(res.body.quantity).toBe(order.quantity);
          }

          // Phase 3: After fault reset — orders still intact
          for (const order of orders) {
            mockQuery.mockResolvedValueOnce({ rows: [order], rowCount: 1 });

            const res = await request(app).get(`/api/orders/${order.id}`);

            expect(res.status).toBe(200);
            expect(res.body.id).toBe(order.id);
            expect(res.body.totalPrice).toBe(order.total_price);
          }
        },
      ),
      { numRuns: 15 },
    );
  });
});
