import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getItems, checkout, resetFault } from './api';

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe('getItems', () => {
  it('returns product array on success', async () => {
    const products = [
      { id: '1', name: 'Widget', price: 999, isTrigger: false },
      { id: 'TRIGGER_ITEM', name: 'Mystery Box', price: 9999, isTrigger: true },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(products),
    });

    const result = await getItems();

    expect(mockFetch).toHaveBeenCalledWith('/api/catalog/items');
    expect(result).toEqual(products);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    await expect(getItems()).rejects.toThrow('Failed to fetch items: 500');
  });
});

describe('checkout', () => {
  it('sends correct POST body and returns response on success', async () => {
    const checkoutResponse = {
      orderId: 'order-1',
      status: 'confirmed',
      message: 'Order placed successfully.',
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(checkoutResponse),
    });

    const result = await checkout('item-1', 2);

    expect(mockFetch).toHaveBeenCalledWith('/api/orders/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: 'item-1', quantity: 2 }),
    });
    expect(result).toEqual(checkoutResponse);
  });

  it('throws with server error message on failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: () =>
        Promise.resolve({ error: 'Service temporarily unavailable' }),
    });

    await expect(checkout('item-1', 1)).rejects.toThrow(
      'Service temporarily unavailable',
    );
  });

  it('throws with status code when error body is unparseable', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 502,
      json: () => Promise.reject(new Error('invalid json')),
    });

    await expect(checkout('item-1', 1)).rejects.toThrow(
      'Checkout failed: 502',
    );
  });
});

describe('resetFault', () => {
  it('sends POST and returns reset response', async () => {
    const resetResponse = {
      success: true,
      message: 'Fault injection cleared.',
      diskUsagePercent: 12,
    };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(resetResponse),
    });

    const result = await resetFault();

    expect(mockFetch).toHaveBeenCalledWith('/api/orders/reset', {
      method: 'POST',
    });
    expect(result).toEqual(resetResponse);
  });

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 503 });

    await expect(resetFault()).rejects.toThrow('Reset failed: 503');
  });
});
