import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import { FaultStatus, ResetResponse } from '../../shared/types';

const exec = promisify(execCb);

const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', 'scripts');

/**
 * Return the current disk usage percentage for the given mount path.
 * Parses the output of `df --output=pcent <path> | tail -1`.
 */
async function getDiskUsage(mountPath: string): Promise<number> {
  try {
    const { stdout } = await exec(`df --output=pcent ${mountPath} | tail -1`);
    const pct = parseInt(stdout.trim().replace('%', ''), 10);
    return Number.isNaN(pct) ? 0 : pct;
  } catch {
    return 0;
  }
}

/**
 * Execute fault injection against the EBS volume (Algorithm 2).
 *
 * Idempotent — if a fault is already active the call is a no-op.
 */
export async function executeFaultInjection(mountPath: string): Promise<void> {
  // Step 1: Check if fault is already active
  const status = await getFaultStatus(mountPath);
  if (status.active) {
    return; // Idempotent — don't stack faults
  }

  // Step 2 & 3: Run the fault injection shell script
  const scriptPath = path.join(SCRIPTS_DIR, 'fault-inject.sh');
  try {
    await exec(`bash ${scriptPath} ${mountPath}`);
  } catch (err) {
    console.error(
      '[orders-service] Fault injection script failed:',
      err instanceof Error ? err.message : String(err),
    );
  }
}

/**
 * Reset the fault injection — kill processes, remove files (Algorithm 3).
 */
export async function resetFault(mountPath: string): Promise<ResetResponse> {
  const scriptPath = path.join(SCRIPTS_DIR, 'fault-reset.sh');
  await exec(`bash ${scriptPath} ${mountPath}`);

  const diskUsagePercent = await getDiskUsage(mountPath);

  return {
    success: true,
    message: 'Fault injection cleared. Volume recovering.',
    diskUsagePercent,
  };
}

/**
 * Return the current fault status for the given mount path.
 *
 * `active` is true iff the `.fault-active` marker exists AND an fio
 * process is running.
 */
export async function getFaultStatus(mountPath: string): Promise<FaultStatus> {
  const markerPath = path.join(mountPath, '.fault-active');

  let markerExists = false;
  let startedAt: string | undefined;
  try {
    const content = await fs.readFile(markerPath, 'utf-8');
    markerExists = true;
    startedAt = content.trim();
  } catch {
    markerExists = false;
  }

  let fioProcessRunning = false;
  try {
    await exec('pgrep -f "fio --name=ebs-stress"');
    fioProcessRunning = true;
  } catch {
    fioProcessRunning = false;
  }

  const diskUsagePercent = await getDiskUsage(mountPath);

  return {
    active: markerExists && fioProcessRunning,
    startedAt,
    volumePath: mountPath,
    diskUsagePercent,
    fioProcessRunning,
  };
}
