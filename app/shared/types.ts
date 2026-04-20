// Shared type interfaces for the DevOps Agent Demo Environment
// Consumed by both backend services (Catalog, Orders) and the frontend

/**
 * Valid order statuses throughout the checkout lifecycle.
 * - 'pending': order created, awaiting confirmation
 * - 'confirmed': order successfully processed
 * - 'failed': order processing failed (e.g., EBS write timeout)
 */
export type OrderStatus = 'pending' | 'confirmed' | 'failed';

/**
 * Valid health check status values.
 * - 'healthy': all dependencies responsive
 * - 'degraded': partial failure (e.g., EBS slow but DB up)
 * - 'unhealthy': critical dependency unreachable (e.g., DB down)
 */
export type HealthCheckStatus = 'healthy' | 'degraded' | 'unhealthy';

/** A product in the e-commerce catalog. */
export interface Product {
  id: string;           // UUID, "TRIGGER_ITEM" for the fault trigger
  name: string;
  description: string;
  price: number;        // cents, integer
  imageUrl: string;
  category: string;
  isTrigger: boolean;   // true for the fault-injection item
}

/** An order created through the checkout flow. */
export interface Order {
  id: string;           // UUID
  productId: string;
  quantity: number;
  totalPrice: number;   // cents
  status: OrderStatus;
  createdAt: string;    // ISO 8601
}

/** Payload sent by the frontend to create an order. */
export interface CheckoutRequest {
  itemId: string;
  quantity: number;
}

/** Response returned after a checkout attempt. */
export interface CheckoutResponse {
  orderId: string;
  status: OrderStatus;
  message: string;
  faultInjected?: boolean;  // true when trigger item purchased
}

/** Health check response from a backend service. */
export interface HealthCheck {
  service: string;
  status: HealthCheckStatus;
  timestamp: string;
  details: {
    database: boolean;
    ebsVolume?: boolean;  // Orders Service only
  };
}

/** Current state of the fault injection mechanism. */
export interface FaultStatus {
  active: boolean;
  startedAt?: string;
  volumePath: string;
  diskUsagePercent: number;
  fioProcessRunning: boolean;
}

/** Response returned after a fault reset request. */
export interface ResetResponse {
  success: boolean;
  message: string;
  diskUsagePercent: number;
}

/** CloudWatch alarm configuration for the observability stack. */
export interface AlarmConfig {
  name: string;
  metric: string;
  namespace: string;
  statistic: string;
  period: number;         // seconds
  evaluationPeriods: number;
  threshold: number;
  comparisonOperator: string;
  dimensions: Record<string, string>;
  alarmActions: string[];   // SNS topic ARNs
  okActions: string[];
}

// --- Type Guards ---

const ORDER_STATUSES: ReadonlySet<string> = new Set<OrderStatus>([
  'pending',
  'confirmed',
  'failed',
]);

const HEALTH_CHECK_STATUSES: ReadonlySet<string> = new Set<HealthCheckStatus>([
  'healthy',
  'degraded',
  'unhealthy',
]);

/** Returns true if the value is a valid OrderStatus. */
export function isOrderStatus(value: unknown): value is OrderStatus {
  return typeof value === 'string' && ORDER_STATUSES.has(value);
}

/** Returns true if the value is a valid HealthCheckStatus. */
export function isHealthCheckStatus(value: unknown): value is HealthCheckStatus {
  return typeof value === 'string' && HEALTH_CHECK_STATUSES.has(value);
}
