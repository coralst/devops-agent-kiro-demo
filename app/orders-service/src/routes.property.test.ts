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

/**
 * Preservation Property: Non-trigger checkout query sequence and response shape
 *
 * For any valid non-trigger product (arbitrary id, name, price, is_trigger=false)
 * and positive integer quantity, the checkout handler calls mockQuery exactly 3 times
 * (SELECT, INSERT, UPDATE), the 3rd call contains 'UPDATE orders SET status' with
 * ['confirmed', orderId], and the response has status: 'confirmed' without faultInjected.
 *
 * **Validates: Requirements 3.1, 3.3, 3.4**
 */
describe('Preservation: Non-trigger checkout query sequence and response', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('issues exactly 3 queries (SELECT, INSERT, UPDATE) and returns confirmed without faultInjected for any valid non-trigger product', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          id: fc.uuid(),
          name: fc.string({ minLength: 1, maxLength: 50 }),
          price: fc.integer({ min: 1, max: 100000 }),
        }),
        fc.integer({ min: 1, max: 100 }),
        async (product, quantity) => {
          // Reset mocks between property iterations to prevent accumulation
          mockQuery.mockReset();
          mockWriteOrderLog.mockReset();

          const productRow = {
            id: product.id,
            name: product.name,
            description: 'Generated product',
            price: product.price,
            image_url: '/images/test.png',
            category: 'general',
            is_trigger: false,
          };

          // Mock: SELECT product
          mockQuery.mockResolvedValueOnce({ rows: [productRow], rowCount: 1 });
          // Mock: INSERT order
          mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
          // Mock: writeOrderLog
          mockWriteOrderLog.mockResolvedValueOnce(undefined);
          // Mock: UPDATE order status
          mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });

          const res = await request(app)
            .post('/api/orders/checkout')
            .send({ itemId: product.id, quantity });

          // Response shape
          expect(res.status).toBe(200);
          expect(res.body.status).toBe('confirmed');
          expect(res.body.orderId).toBeDefined();
          expect(typeof res.body.orderId).toBe('string');
          expect(res.body.faultInjected).toBeUndefined();

          // Query sequence: exactly 3 calls (SELECT, INSERT, UPDATE)
          expect(mockQuery).toHaveBeenCalledTimes(3);

          // 3rd call (index 2) is the UPDATE query
          const updateCall = mockQuery.mock.calls[2];
          expect(updateCall[0]).toContain('UPDATE orders SET status');
          expect(updateCall[1]).toEqual(['confirmed', res.body.orderId]);
        },
      ),
      { numRuns: 50 },
    );
  });
});

/**
 * Preservation Property: Invalid inputs rejected with no DB interaction
 *
 * For any invalid input (empty/missing itemId OR non-positive quantity),
 * the handler returns HTTP 400 with VALIDATION_ERROR and mockQuery is never called.
 *
 * **Validates: Requirements 3.3**
 */
describe('Preservation: Invalid inputs rejected with no DB queries', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns HTTP 400 with VALIDATION_ERROR and never calls mockQuery for empty itemId or non-positive quantity', async () => {
    // Generate either an invalid itemId (empty/whitespace) with valid quantity,
    // or a valid itemId with non-positive quantity
    const invalidItemIdArb = fc.record({
      itemId: fc.constantFrom('', ' ', '\t', '\n', '   '),
      quantity: fc.integer({ min: 1, max: 100 }),
    });
    const invalidQuantityArb = fc.record({
      itemId: fc.uuid(),
      quantity: fc.integer({ max: 0 }),
    });

    await fc.assert(
      fc.asyncProperty(
        fc.oneof(invalidItemIdArb, invalidQuantityArb),
        async ({ itemId, quantity }) => {
          // Reset mocks between property iterations to prevent accumulation
          mockQuery.mockReset();
          mockWriteOrderLog.mockReset();

          const res = await request(app)
            .post('/api/orders/checkout')
            .send({ itemId, quantity });

          expect(res.status).toBe(400);
          expect(res.body.code).toBe('VALIDATION_ERROR');
          expect(mockQuery).not.toHaveBeenCalled();
        },
      ),
      { numRuns: 50 },
    );
  });
});

/**
 * Preservation Property: Non-existent product returns 404
 *
 * For any valid input where the product does not exist (SELECT returns empty rows),
 * the handler returns HTTP 404 with PRODUCT_NOT_FOUND.
 *
 * **Validates: Requirements 3.4**
 */
describe('Preservation: Non-existent product returns 404', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns HTTP 404 with PRODUCT_NOT_FOUND when product does not exist', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.uuid(),
        fc.integer({ min: 1, max: 100 }),
        async (itemId, quantity) => {
          // Reset mocks between property iterations to prevent accumulation
          mockQuery.mockReset();
          mockWriteOrderLog.mockReset();

          // Mock: SELECT product returns empty rows (product not found)
          mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

          const res = await request(app)
            .post('/api/orders/checkout')
            .send({ itemId, quantity });

          expect(res.status).toBe(404);
          expect(res.body.code).toBe('PRODUCT_NOT_FOUND');

          // Only 1 query should have been made (the SELECT)
          expect(mockQuery).toHaveBeenCalledTimes(1);
        },
      ),
      { numRuns: 50 },
    );
  });
});
