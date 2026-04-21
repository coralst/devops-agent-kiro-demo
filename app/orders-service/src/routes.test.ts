import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';

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

// Create a minimal Express app for testing with error handling middleware
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

/** Helper: a standard non-trigger product DB row. */
function normalProductRow(id = 'abc-123') {
  return {
    id,
    name: 'Gift Card',
    description: 'A nice gift card',
    price: 2500,
    image_url: '/images/gift.png',
    category: 'gifts',
    is_trigger: false,
  };
}

/** Helper: the trigger product DB row. */
function triggerProductRow() {
  return {
    id: 'TRIGGER_ITEM',
    name: 'Mystery Box of Chaos',
    description: 'Triggers fault injection',
    price: 9999,
    image_url: '/images/mystery-box.png',
    category: 'special',
    is_trigger: true,
  };
}


describe('POST /api/orders/checkout', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('creates order and returns HTTP 200 with orderId for valid checkout', async () => {
    const product = normalProductRow();
    mockQuery.mockResolvedValueOnce({ rows: [product], rowCount: 1 }); // SELECT product
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });        // INSERT order
    mockWriteOrderLog.mockResolvedValueOnce(undefined);                // writeOrderLog
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });        // UPDATE confirmed

    const res = await request(app)
      .post('/api/orders/checkout')
      .send({ itemId: 'abc-123', quantity: 2 });

    expect(res.status).toBe(200);
    expect(res.body.orderId).toBeDefined();
    expect(typeof res.body.orderId).toBe('string');
    expect(res.body.status).toBe('confirmed');
    expect(res.body.message).toBe('Order placed successfully.');
    expect(res.body.faultInjected).toBeUndefined();
  });

  it('returns HTTP 400 for empty itemId', async () => {
    const res = await request(app)
      .post('/api/orders/checkout')
      .send({ itemId: '', quantity: 1 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns HTTP 400 for non-positive quantity', async () => {
    const res = await request(app)
      .post('/api/orders/checkout')
      .send({ itemId: 'abc-123', quantity: 0 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns HTTP 400 for negative quantity', async () => {
    const res = await request(app)
      .post('/api/orders/checkout')
      .send({ itemId: 'abc-123', quantity: -5 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('returns HTTP 404 for non-existent product', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // SELECT product — not found

    const res = await request(app)
      .post('/api/orders/checkout')
      .send({ itemId: 'does-not-exist', quantity: 1 });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('PRODUCT_NOT_FOUND');
    expect(res.body.error).toContain('does-not-exist');
  });

  it('sets faultInjected: true when trigger item is purchased', async () => {
    const product = triggerProductRow();
    mockQuery.mockResolvedValueOnce({ rows: [product], rowCount: 1 }); // SELECT product
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });        // INSERT order
    mockWriteOrderLog.mockResolvedValueOnce(undefined);                // writeOrderLog
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });        // UPDATE confirmed

    const res = await request(app)
      .post('/api/orders/checkout')
      .send({ itemId: 'TRIGGER_ITEM', quantity: 1 });

    expect(res.status).toBe(200);
    expect(res.body.faultInjected).toBe(true);
    expect(res.body.status).toBe('confirmed');
    expect(res.body.orderId).toBeDefined();
  });

  /**
   * Bug Condition Exploration Test
   * Validates: Requirements 1.1, 2.1
   *
   * This test encodes the EXPECTED behavior: trigger checkout should call
   * UPDATE orders SET status = 'confirmed'. On UNFIXED code, this test
   * FAILS because the trigger branch does an early return before the UPDATE.
   */
  it('trigger checkout calls UPDATE orders SET status to confirmed', async () => {
    const product = triggerProductRow();
    mockQuery.mockResolvedValueOnce({ rows: [product], rowCount: 1 }); // SELECT product
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });        // INSERT order
    mockWriteOrderLog.mockResolvedValueOnce(undefined);                // writeOrderLog
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });        // UPDATE confirmed

    const res = await request(app)
      .post('/api/orders/checkout')
      .send({ itemId: 'TRIGGER_ITEM', quantity: 1 });

    expect(res.status).toBe(200);
    expect(res.body.orderId).toBeDefined();

    const orderId = res.body.orderId;

    // The trigger branch should issue 3 queries: SELECT, INSERT, UPDATE
    expect(mockQuery).toHaveBeenCalledTimes(3);

    // The 3rd call (index 2) should be the UPDATE query
    const updateCall = mockQuery.mock.calls[2];
    expect(updateCall[0]).toContain('UPDATE orders SET status');
    expect(updateCall[1]).toEqual(['confirmed', orderId]);
  });

  it('updates non-trigger order status to "confirmed"', async () => {
    const product = normalProductRow();
    mockQuery.mockResolvedValueOnce({ rows: [product], rowCount: 1 }); // SELECT product
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });        // INSERT order
    mockWriteOrderLog.mockResolvedValueOnce(undefined);                // writeOrderLog
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });        // UPDATE confirmed

    const res = await request(app)
      .post('/api/orders/checkout')
      .send({ itemId: 'abc-123', quantity: 1 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('confirmed');

    // Verify the UPDATE query was called with 'confirmed'
    const updateCall = mockQuery.mock.calls[2]; // 3rd call is the UPDATE
    expect(updateCall[0]).toContain('UPDATE orders SET status');
    expect(updateCall[1][0]).toBe('confirmed');
  });

  it('returns HTTP 500 with EBS_IO_TIMEOUT when EBS write fails', async () => {
    const product = normalProductRow();
    mockQuery.mockResolvedValueOnce({ rows: [product], rowCount: 1 }); // SELECT product
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });        // INSERT order
    mockWriteOrderLog.mockRejectedValueOnce(new EbsWriteError('EBS write timed out'));

    const res = await request(app)
      .post('/api/orders/checkout')
      .send({ itemId: 'abc-123', quantity: 1 });

    expect(res.status).toBe(500);
    expect(res.body.code).toBe('EBS_IO_TIMEOUT');
    expect(res.body.error).toContain('Service temporarily unavailable');
  });
});

describe('GET /api/orders/:id', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns order with HTTP 200 for existing order', async () => {
    const orderRow = {
      id: 'order-001',
      product_id: 'abc-123',
      quantity: 2,
      total_price: 5000,
      status: 'confirmed',
      created_at: new Date('2025-01-01T00:00:00Z'),
    };
    mockQuery.mockResolvedValueOnce({ rows: [orderRow], rowCount: 1 });

    const res = await request(app).get('/api/orders/order-001');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('order-001');
    expect(res.body.productId).toBe('abc-123');
    expect(res.body.quantity).toBe(2);
    expect(res.body.totalPrice).toBe(5000);
    expect(res.body.status).toBe('confirmed');
  });

  it('returns HTTP 404 for non-existent order', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app).get('/api/orders/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('ORDER_NOT_FOUND');
  });
});
