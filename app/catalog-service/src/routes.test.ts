import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

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

describe('GET /api/catalog/items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns product array with HTTP 200', async () => {
    const rows = [
      {
        id: 'abc-123',
        name: 'Gift Card',
        description: 'A nice gift card',
        price: 2500,
        image_url: '/images/gift.png',
        category: 'gifts',
        is_trigger: false,
      },
      {
        id: 'TRIGGER_ITEM',
        name: 'Mystery Box of Chaos',
        description: 'Triggers fault injection',
        price: 9999,
        image_url: '/images/mystery-box.png',
        category: 'special',
        is_trigger: true,
      },
    ];

    mockQuery.mockResolvedValueOnce({ rows, rowCount: 2 });

    const res = await request(app).get('/api/catalog/items');

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe('abc-123');
    expect(res.body[0].imageUrl).toBe('/images/gift.png');
    expect(res.body[0].isTrigger).toBe(false);
    expect(res.body[1].id).toBe('TRIGGER_ITEM');
    expect(res.body[1].isTrigger).toBe(true);
  });
});

describe('GET /api/catalog/items/:id', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns single product with HTTP 200', async () => {
    const row = {
      id: 'abc-123',
      name: 'Gift Card',
      description: 'A nice gift card',
      price: 2500,
      image_url: '/images/gift.png',
      category: 'gifts',
      is_trigger: false,
    };

    mockQuery.mockResolvedValueOnce({ rows: [row], rowCount: 1 });

    const res = await request(app).get('/api/catalog/items/abc-123');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('abc-123');
    expect(res.body.name).toBe('Gift Card');
    expect(res.body.price).toBe(2500);
    expect(res.body.imageUrl).toBe('/images/gift.png');
    expect(res.body.isTrigger).toBe(false);
  });

  it('returns HTTP 404 for non-existent ID', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const res = await request(app).get('/api/catalog/items/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error).toContain('does-not-exist');
    expect(res.body.code).toBe('PRODUCT_NOT_FOUND');
  });
});

describe('GET /api/catalog/health', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns healthy status when DB is connected', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 });

    const res = await request(app).get('/api/catalog/health');

    expect(res.status).toBe(200);
    expect(res.body.service).toBe('catalog');
    expect(res.body.status).toBe('healthy');
    expect(res.body.details.database).toBe(true);
    expect(res.body.timestamp).toBeDefined();
  });

  it('returns unhealthy status when DB is unreachable', async () => {
    mockQuery.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const res = await request(app).get('/api/catalog/health');

    expect(res.status).toBe(503);
    expect(res.body.service).toBe('catalog');
    expect(res.body.status).toBe('unhealthy');
    expect(res.body.details.database).toBe(false);
  });
});
