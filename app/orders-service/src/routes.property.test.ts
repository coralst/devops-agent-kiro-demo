import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import request from 'supertest';
import express from 'express';

/**
 * Property tests for Orders Service checkout route.
 *
 * Property 2: Valid checkout creates a confirmed order
 * Property 3: Invalid checkout requests are rejected
 */

// Mock the pg module before importing routes
vi.mock('pg', () => {
  const mockPool = {
    query: vi.fn(),
    on: vi.fn(),
  };
  return { Pool: vi.fn(() => mockPool) };
});

// Mock the query function from db module
const mockQuery = vi.fn();
vi.mock('./db', () => ({
  query: (...args: unknown[]) => mockQuery(...args),
  pool: { on: vi.fn() },
}));

// Mock the writeOrderLog function from order-log module
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

import { router } from './routes';
import { EbsWriteError } from './order-log';

// Create a minimal Express app for testing
function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof EbsWriteError) {
      res.status(500).json({ error: 'Service temporarily unavailable', code: 'EBS_IO_TIMEOUT' });
      return;
    }
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

const app = createTestApp();


/**
 * Property 2: Valid checkout creates a confirmed order
 *
 * For any valid checkout request (non-empty itemId referencing an existing
 * non-trigger product, positive quantity), the Orders Service SHALL create
 * an order record with status "confirmed" and return HTTP 200 with the order ID.
 *
 * **Validates: Requirements 2.1, 2.5**
 */
describe('Property 2: Valid checkout creates a confirmed order', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns HTTP 200 with orderId and status "confirmed" for any valid checkout', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          itemId: fc.uuid(),
          quantity: fc.integer({ min: 1, max: 100 }),
        }),
        async ({ itemId, quantity }) => {
          // Mock: product lookup returns a non-trigger product
          const productRow = {
            id: itemId,
            name: 'Test Product',
            description: 'A test product',
            price: 1000,
            image_url: '/images/test.png',
            category: 'general',
            is_trigger: false,
          };
          mockQuery.mockResolvedValueOnce({ rows: [productRow], rowCount: 1 });

          // Mock: INSERT order succeeds
          mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

          // Mock: writeOrderLog succeeds
          mockWriteOrderLog.mockResolvedValueOnce(undefined);

          // Mock: UPDATE order status to confirmed succeeds
          mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

          const res = await request(app)
            .post('/api/orders/checkout')
            .send({ itemId, quantity });

          expect(res.status).toBe(200);
          expect(res.body.orderId).toBeDefined();
          expect(typeof res.body.orderId).toBe('string');
          expect(res.body.status).toBe('confirmed');
          expect(res.body.faultInjected).toBeUndefined();
        },
      ),
      { numRuns: 50 },
    );
  });
});

/**
 * Property 3: Invalid checkout requests are rejected
 *
 * For any checkout request where the item ID is empty or composed entirely
 * of whitespace, or the quantity is zero or negative, the Orders Service
 * SHALL reject the request with HTTP 400 without creating any order record.
 *
 * **Validates: Requirement 2.2**
 */
describe('Property 3: Invalid checkout requests are rejected', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects requests with empty or whitespace-only itemId with HTTP 400', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('', ' ', '\t', '\n', '   ', '\t\n '),
        fc.integer({ min: 1, max: 100 }),
        async (itemId, quantity) => {
          const res = await request(app)
            .post('/api/orders/checkout')
            .send({ itemId, quantity });

          expect(res.status).toBe(400);
          expect(res.body.code).toBe('VALIDATION_ERROR');

          // No DB queries should have been made
          expect(mockQuery).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 30 },
    );
  });

  it('rejects requests with zero or negative quantity with HTTP 400', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ max: 0 }),
        async (itemId, quantity) => {
          const res = await request(app)
            .post('/api/orders/checkout')
            .send({ itemId, quantity });

          expect(res.status).toBe(400);
          expect(res.body.code).toBe('VALIDATION_ERROR');

          // No DB queries should have been made
          expect(mockQuery).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 50 },
    );
  });

  it('rejects requests with missing itemId with HTTP 400', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 100 }),
        async (quantity) => {
          const res = await request(app)
            .post('/api/orders/checkout')
            .send({ quantity });

          expect(res.status).toBe(400);
          expect(res.body.code).toBe('VALIDATION_ERROR');
          expect(mockQuery).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 20 },
    );
  });
});
