import fs from 'node:fs/promises';
import { HealthCheck } from '../../shared/types';
import { query } from './db';

/**
 * Check the health of the Orders Service (Algorithm 4).
 *
 * Checks DB connectivity (SELECT 1) and EBS I/O (write/read/delete test file).
 * Returns "healthy" (both OK), "degraded" (DB OK, EBS slow/failing),
 * or "unhealthy" (DB unreachable).
 */
export async function checkOrdersHealth(
  mountPath: string = process.env.EBS_MOUNT_PATH ?? '/mnt/ebs-data',
): Promise<HealthCheck> {
  const health: HealthCheck = {
    service: 'orders',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    details: { database: false, ebsVolume: false },
  };

  // Step 1: Check database connectivity
  try {
    await query('SELECT 1');
    health.details.database = true;
  } catch {
    health.status = 'unhealthy';
  }

  // Step 2: Check EBS volume I/O
  const testFile = `${mountPath}/.health-check`;
  try {
    const start = Date.now();
    await fs.writeFile(testFile, 'ok', 'utf-8');
    await fs.readFile(testFile, 'utf-8');
    const latency = Date.now() - start;

    if (latency > 5000) {
      health.details.ebsVolume = false;
    } else {
      health.details.ebsVolume = true;
    }
  } catch {
    health.details.ebsVolume = false;
  } finally {
    // Always clean up the test file
    try {
      await fs.unlink(testFile);
    } catch {
      // Ignore cleanup errors — file may not have been created
    }
  }

  // Step 3: Determine overall status
  if (!health.details.database) {
    health.status = 'unhealthy';
  } else if (!health.details.ebsVolume) {
    health.status = 'degraded';
  }

  return health;
}
