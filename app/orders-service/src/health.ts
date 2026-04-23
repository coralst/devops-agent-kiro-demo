import fs from 'node:fs/promises';
import path from 'node:path';
import { HealthCheck } from '../../shared/types';
import { query } from './db';

/**
 * Check whether the `.fault-active` marker exists on the volume.
 * When present, the volume is considered degraded regardless of
 * actual I/O latency — this makes the demo work on local dev
 * where `/tmp` is always fast.
 */
async function isFaultMarkerPresent(mountPath: string): Promise<boolean> {
  try {
    await fs.access(path.join(mountPath, '.fault-active'));
    return true;
  } catch {
    return false;
  }
}

/**
 * Check the health of the Orders Service (Algorithm 4).
 *
 * Checks DB connectivity (SELECT 1) and EBS I/O (write/read/delete test file).
 * Also checks for the `.fault-active` marker — if present the volume is
 * reported as degraded even when raw I/O is fast (software-level simulation).
 *
 * Returns "healthy" (both OK), "degraded" (DB OK, EBS slow/failing or fault
 * active), or "unhealthy" (DB unreachable).
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
    try {
      await fs.unlink(testFile);
    } catch {
      // Ignore cleanup errors — file may not have been created
    }
  }

  // Step 2b: If the fault marker is present, override EBS to degraded.
  // This ensures the demo works on local dev where /tmp I/O is always fast.
  if (await isFaultMarkerPresent(mountPath)) {
    health.details.ebsVolume = false;
  }

  // Step 3: Determine overall status
  if (!health.details.database) {
    health.status = 'unhealthy';
  } else if (!health.details.ebsVolume) {
    health.status = 'degraded';
  }

  return health;
}
