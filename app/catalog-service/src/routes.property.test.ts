import { describe, it, expect, vi, beforeEach } from 'vitest';
import fc from 'fast-check';
import request from 'supertest';

/**
 * Property 1: Catalog retrieval returns all stored products
 *
 * For any set of products in the database, GET /api/catalog/items returns
 * every product with HTTP 200, and GET /api/catalog/items/:id returns the
 * exact product.
 *
 * **Validates: Requirements 1.1, 1.2**
 */

// Mock the pg module before importing app
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
  DatabaseConnectionError: class DatabaseConnectionError extends Error {
    readonly code = 'DB_CONNECTION_ERROR';
    constructor(message: string) {
      super(message);
      this.name = 'DatabaseConnectionError';
    }
  },
}));

import { app } from './index';

/** Arbitrary generator for a single DB-row-shaped product (snake_case). */
const productRowArb = fc.record({
  id: fc.uuid(),
  name: fc.string({ minLength: 1, maxLength: 100 }),
  description: fc.string({ maxLength: 200 }),
  price: fc.integer({ min: 1, max: 999_999 }),
  image_url: fc.webUrl(),
  category: fc.string({ minLength: 1, maxLength: 50 }),
  is_trigger: fc.boolean(),
});

describe('Property 1: Catalog retrieval returns all stored products', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/catalog/items returns every product in the database with HTTP 200', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(productRowArb, { minLength: 0, maxLength: 20 }),
        async (productRows) => {
          mockQuery.mockResolvedValueOnce({ rows: productRows, rowCount: productRows.length });

          const res = await request(app).get('/api/catalog/items');

          expect(res.status).toBe(200);
          expect(res.body).toHaveLength(productRows.length);

          // Every product in the DB must appear in the response
          for (const row of productRows) {
            const found = res.body.find((p: Record<string, unknown>) => p.id === row.id);
            expect(found).toBeDefined();
            expect(found.name).toBe(row.name);
            expect(found.price).toBe(row.price);
            expect(found.category).toBe(row.category);
            expect(found.isTrigger).toBe(row.is_trigger);
            expect(found.imageUrl).toBe(row.image_url);
          }
        },
      ),
      { numRuns: 50 },
    );
  });

  it('GET /api/catalog/items/:id returns the exact product for each ID', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(productRowArb, { minLength: 1, maxLength: 10 }),
        async (productRows) => {
          // Pick a random product from the set to query by ID
          const target = productRows[0];

          mockQuery.mockResolvedValueOnce({ rows: [target], rowCount: 1 });

          const res = await request(app).get(`/api/catalog/items/${target.id}`);

          expect(res.status).toBe(200);
          expect(res.body.id).toBe(target.id);
          expect(res.body.name).toBe(target.name);
          expect(res.body.description).toBe(target.description);
          expect(res.body.price).toBe(target.price);
          expect(res.body.imageUrl).toBe(target.image_url);
          expect(res.body.category).toBe(target.category);
          expect(res.body.isTrigger).toBe(target.is_trigger);
        },
      ),
      { numRuns: 50 },
    );
  });
});
