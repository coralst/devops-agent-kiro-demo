import type { HealthCheck, FaultStatus } from '../../shared/types';

/** Base URL for API requests. Empty string means same origin (behind ALB).
 *  In production, VITE_API_BASE_URL is set to the ALB DNS at build time. */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

/** Product returned by the Catalog Service. */
export interface Product {
  id: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  category: string;
  isTrigger: boolean;
}

/** Response from a checkout request. */
export interface CheckoutResponse {
  orderId: string;
  status: string;
  message: string;
  faultInjected?: boolean;
}

/** Response from a fault reset request. */
export interface ResetResponse {
  success: boolean;
  message: string;
  diskUsagePercent: number;
}

/** Fetch all products from the Catalog Service. */
export async function getItems(): Promise<Product[]> {
  const response = await fetch(`${API_BASE_URL}/api/catalog/items`);
  if (!response.ok) {
    throw new Error(`Failed to fetch items: ${response.status}`);
  }
  return response.json();
}

/** Send a checkout request to the Orders Service. */
export async function checkout(
  itemId: string,
  quantity: number,
): Promise<CheckoutResponse> {
  const response = await fetch(`${API_BASE_URL}/api/orders/checkout`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, quantity }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const message =
      (body as Record<string, unknown>).error ?? `Checkout failed: ${response.status}`;
    throw new Error(String(message));
  }
  return response.json();
}

/** Send a fault reset request to the Orders Service. */
export async function resetFault(): Promise<ResetResponse> {
  const response = await fetch(`${API_BASE_URL}/api/orders/reset`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Reset failed: ${response.status}`);
  }
  return response.json();
}

/** Fetch health status from the Catalog Service. */
export async function getCatalogHealth(): Promise<HealthCheck> {
  const response = await fetch(`${API_BASE_URL}/api/catalog/health`);
  if (!response.ok) {
    throw new Error(`Catalog health failed: ${response.status}`);
  }
  return response.json();
}

/** Fetch health status from the Orders Service. */
export async function getOrdersHealth(): Promise<HealthCheck> {
  const response = await fetch(`${API_BASE_URL}/api/orders/health`);
  if (!response.ok) {
    throw new Error(`Orders health failed: ${response.status}`);
  }
  return response.json();
}

/** Fetch fault injection status from the Orders Service. */
export async function getOrdersFaultStatus(): Promise<FaultStatus> {
  const response = await fetch(`${API_BASE_URL}/api/orders/fault-status`);
  if (!response.ok) {
    throw new Error(`Fault status failed: ${response.status}`);
  }
  return response.json();
}
