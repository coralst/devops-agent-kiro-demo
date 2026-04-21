import type { HealthCheck, FaultStatus } from '../../shared/types';
import { getCatalogHealth, getOrdersHealth, getOrdersFaultStatus } from './api';

/** Configuration for the health poller. */
export interface HealthPollerConfig {
  /** Interval in ms between health endpoint polls. Default: 5000. */
  healthIntervalMs: number;
  /** Interval in ms between fault-status polls. Default: 2000. */
  faultStatusIntervalMs: number;
  onCatalogHealth: (health: HealthCheck) => void;
  onOrdersHealth: (health: HealthCheck) => void;
  onFaultStatus: (status: FaultStatus) => void;
  onError: (service: string, error: Error) => void;
}

export interface HealthPoller {
  start(): void;
  stop(): void;
}

/** Create a health poller that fetches health and fault-status data at configured intervals. */
export function createHealthPoller(config: HealthPollerConfig): HealthPoller {
  let healthTimerId: ReturnType<typeof setInterval> | null = null;
  let faultStatusTimerId: ReturnType<typeof setInterval> | null = null;

  async function pollHealth(): Promise<void> {
    try {
      const health = await getCatalogHealth();
      config.onCatalogHealth(health);
    } catch (err) {
      config.onError('catalog', err instanceof Error ? err : new Error(String(err)));
    }

    try {
      const health = await getOrdersHealth();
      config.onOrdersHealth(health);
    } catch (err) {
      config.onError('orders', err instanceof Error ? err : new Error(String(err)));
    }
  }

  async function pollFaultStatus(): Promise<void> {
    try {
      const status = await getOrdersFaultStatus();
      config.onFaultStatus(status);
    } catch (err) {
      config.onError('fault-status', err instanceof Error ? err : new Error(String(err)));
    }
  }

  return {
    start() {
      // Immediate first poll before waiting for intervals
      pollHealth();
      pollFaultStatus();

      healthTimerId = setInterval(pollHealth, config.healthIntervalMs);
      faultStatusTimerId = setInterval(pollFaultStatus, config.faultStatusIntervalMs);
    },

    stop() {
      if (healthTimerId !== null) {
        clearInterval(healthTimerId);
        healthTimerId = null;
      }
      if (faultStatusTimerId !== null) {
        clearInterval(faultStatusTimerId);
        faultStatusTimerId = null;
      }
    },
  };
}
