import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';

/**
 * Unit tests for error handling middleware in the Orders Service.
 *
 * Tests:
 * - EBS write timeout → HTTP 500 with "EBS_IO_TIMEOUT"
 * - DB connection error → HTTP 503 with "DB_CONNECTION_ERROR"
 * - Fault injection script failure → logs error, returns HTTP 200 with warning
 *
 * Requirements: 13.1, 13.2, 13.3
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
vi.mock('./db', () => {
  class DatabaseConnectionError extends Error {
    readonly code = 'DB_CONNECTION_ERROR';
    constructor(message: string) {
      super(message);
      this.name = 'DatabaseConnectionError';
    }
  }
  return {
    query: (...args: unknown[]) => mockQuery(...args),
    pool: { on: vi.fn() },
    DatabaseConnectionError,
  };
});

const mockWriteOrderLog = vi.fn();
vi.mock('./order-log', () => {
  class EbsWriteError extends Error {
    readonly code = 'EBS_IO_TIMEOUT';
    constructor(message: string) {
      super(message);
      this.name = 'EbsWriteError';
    }
  }
  return {
    writeOrderLog: (...args: unknown[]) => mockWriteOrderLog(...args),
    EbsWriteError,
  };
});

const mockExecuteFaultInjection = vi.fn();
vi.mock('./fault-inject', () => ({
  executeFaultInjection: (...args: unknown[]) => mockExecuteFaultInjection(...args),
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
import { EbsWriteError } from './order-log';
import { DatabaseConnectionError } from './db';

/** Helper: a standard non-trigger product DB row. */
function normalProductRow() {
  return {
    id: 'prod-001',
    name: 'Test Product',
    description: 'A test product',
    price: 1000,
    image_url: '/images/test.png',
    category: 'test',
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

describe('Error handling middleware — EBS write timeout', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns HTTP 500 with EBS_IO_TIMEOUT when EBS write fails during checkout', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [normalProductRow()], rowCount: 1 });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mockWriteOrderLog.mockRejectedValueOnce(
      new EbsWriteError('EBS write timed out after 10000ms'),
    );

    const res = await request(app)
      .post('/api/orders/checkout')
      .send({ itemId: 'prod-001', quantity: 1 });

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Service temporarily unavailable');
    expect(res.body.code).toBe('EBS_IO_TIMEOUT');
  });
});

describe('Error handling middleware — DB connection error', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns HTTP 503 with DB_CONNECTION_ERROR when database is unreachable during checkout', async () => {
    mockQuery.mockRejectedValueOnce(
      new DatabaseConnectionError('Failed to connect to database after retries'),
    );

    const res = await request(app)
      .post('/api/orders/checkout')
      .send({ itemId: 'prod-001', quantity: 1 });

    expect(res.status).toBe(503);
    expect(res.body.error).toBe('Database unavailable');
    expect(res.body.code).toBe('DB_CONNECTION_ERROR');
  });
});

describe('Error handling — fault injection script failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs error and returns HTTP 200 with faultInjected: true when fault script fails', async () => {
    const product = triggerProductRow();
    mockQuery.mockResolvedValueOnce({ rows: [product], rowCount: 1 });
    mockQuery.mockResolvedValueOnce({ rows: [], rowCount: 1 });
    mockWriteOrderLog.mockResolvedValueOnce(undefined);

    // Fault injection script throws (e.g., fio not installed)
    mockExecuteFaultInjection.mockRejectedValueOnce(
      new Error('fio: command not found'),
    );

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await request(app)
      .post('/api/orders/checkout')
      .send({ itemId: 'TRIGGER_ITEM', quantity: 1 });

    // The checkout still succeeds — fault injection failure is non-fatal
    expect(res.status).toBe(200);
    expect(res.body.orderId).toBeDefined();
    expect(res.body.faultInjected).toBe(true);
    expect(res.body.status).toBe('confirmed');

    // Verify the error was logged
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[orders-service] Fault injection failed:'),
      expect.any(String),
    );

    consoleSpy.mockRestore();
  });
});
