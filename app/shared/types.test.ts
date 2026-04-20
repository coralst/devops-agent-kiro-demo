import { describe, it, expect } from 'vitest';
import {
  isOrderStatus,
  isHealthCheckStatus,
  type Product,
  type Order,
  type CheckoutRequest,
  type CheckoutResponse,
  type HealthCheck,
  type FaultStatus,
  type ResetResponse,
  type AlarmConfig,
  type OrderStatus,
  type HealthCheckStatus,
} from './types';

// Compile-time verification: all interfaces and types are importable.
// If any export were missing, this file would fail to compile.

describe('isOrderStatus', () => {
  it('returns true for "pending"', () => {
    expect(isOrderStatus('pending')).toBe(true);
  });

  it('returns true for "confirmed"', () => {
    expect(isOrderStatus('confirmed')).toBe(true);
  });

  it('returns true for "failed"', () => {
    expect(isOrderStatus('failed')).toBe(true);
  });

  it('returns false for an invalid string', () => {
    expect(isOrderStatus('shipped')).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isOrderStatus(42)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isOrderStatus(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isOrderStatus(undefined)).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isOrderStatus('')).toBe(false);
  });
});

describe('isHealthCheckStatus', () => {
  it('returns true for "healthy"', () => {
    expect(isHealthCheckStatus('healthy')).toBe(true);
  });

  it('returns true for "degraded"', () => {
    expect(isHealthCheckStatus('degraded')).toBe(true);
  });

  it('returns true for "unhealthy"', () => {
    expect(isHealthCheckStatus('unhealthy')).toBe(true);
  });

  it('returns false for an invalid string', () => {
    expect(isHealthCheckStatus('unknown')).toBe(false);
  });

  it('returns false for a number', () => {
    expect(isHealthCheckStatus(0)).toBe(false);
  });

  it('returns false for null', () => {
    expect(isHealthCheckStatus(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isHealthCheckStatus(undefined)).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isHealthCheckStatus('')).toBe(false);
  });
});
