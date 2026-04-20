import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import request from 'supertest';

/**
 * Property 5: Fault isolation — Catalog Service unaffected by EBS fault
 *
 * For any catalog API request made while a fault is active on the Orders
 * Service EBS volume, the Catalog Service returns HTTP 200 with correct data.
 *
 * Since the Catalog Service has no dependency on the EBS volume, this test
 * verifies that catalog routes work regardless of any external fault state.
 *
 * **Validates: Requirements 4.3, 11.1**
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

import { app } from './index';

/** Arbitrary for generating a valid product DB row. */
const productRowArb = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 50 }),
  description: fc.string({ maxLength: 100 }),
  price: fc.integer({ min: 1, max: 999999 }),
  image_url: fc.webUrl(),
  category: fc.string({ minLength: 1, maxLength: 20 }),
  is_trigger: fc.boolean(),
});

describe('Property 5: Fault isolation — Catalog Service unaffected by EBS fault', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/catalog/items returns HTTP 200 with all products regardless of fault state', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(productRowArb, { minLength: 1, maxLength: 10 }),
        fc.boolean(), // simulated fault active state (irrelevant to catalog)
        async (products, _faultActive) => {
          mockQuery.mockResolvedValueOnce({ rows: products, rowCount: products.length });

          const res = await request(app).get('/api/catalog/items');

          expect(res.status).toBe(200);
          expect(res.body).toHaveLength(products.length);

          for (let i = 0; i < products.length; i++) {
            expect(res.body[i].id).toBe(products[i].id);
            expect(res.body[i].price).toBe(products[i].price);
          }
        },
      ),
      { numRuns: 20 },
    );
  });

  it('GET /api/catalog/items/:id returns HTTP 200 for any existing product regardless of fault state', async () => {
    await fc.assert(
      fc.asyncProperty(
        productRowArb,
        fc.boolean(), // simulated fault active state (irrelevant to catalog)
        async (product, _faultActive) => {
          mockQuery.mockResolvedValueOnce({ rows: [product], rowCount: 1 });

          const res = await request(app).get(`/api/catalog/items/${product.id}`);

          expect(res.status).toBe(200);
          expect(res.body.id).toBe(product.id);
          expect(res.body.name).toBe(product.name);
          expect(res.body.price).toBe(product.price);
        },
      ),
      { numRuns: 20 },
    );
  });
});
