import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { FaultStatus, ResetResponse } from '../../shared/types';

const exec = promisify(execCb);

const SCRIPTS_DIR = path.resolve(__dirname, '..', '..', 'scripts');

/**
 * Return the current disk usage percentage for the given mount path.
 * Uses platform-appropriate `df` invocation (Linux vs macOS).
 */
async function getDiskUsage(mountPath: string): Promise<number> {
  try {
    const cmd =
      os.platform() === 'darwin'
        ? `df -Pk ${mountPath} | tail -1 | awk '{print $5}'`
        : `df --output=pcent ${mountPath} | tail -1`;
    const { stdout } = await exec(cmd);
    const pct = parseInt(stdout.trim().replace('%', ''), 10);
    return Number.isNaN(pct) ? 0 : pct;
  } catch {
    return 0;
  }
}

/**
 * Check whether `fio` is available on this system.
 */
async function isFioAvailable(): Promise<boolean> {
  try {
    await exec('which fio');
    return true;
  } catch {
    return false;
  }
}

/**
 * Execute fault injection against the EBS volume (Algorithm 2).
 *
 * Idempotent — if a fault is already active the call is a no-op.
 *
 * On systems without `fio` (e.g. local macOS dev), falls back to a
 * software-only simulation: writes the `.fault-active` marker so the
 * health check and fault-status endpoints report degraded state.
 */
export async function executeFaultInjection(mountPath: string): Promise<void> {
  // Step 1: Check if fault is already active
  const status = await getFaultStatus(mountPath);
  if (status.active) {
    return; // Idempotent — don't stack faults
  }

  const hasFio = await isFioAvailable();

  if (hasFio) {
    // Production path: run the shell script that launches fio + dd
    const scriptPath = path.join(SCRIPTS_DIR, 'fault-inject.sh');
    try {
      await exec(`bash ${scriptPath} ${mountPath}`);
    } catch (err) {
      console.error(
        '[orders-service] Fault injection script failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  } else {
    // Local dev fallback: create the marker file so the service reports
    // degraded status without needing fio or dd.
    const markerPath = path.join(mountPath, '.fault-active');
    const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
    await fs.writeFile(markerPath, timestamp, 'utf-8');
    console.warn(
      '[orders-service] fio not found — using software-only fault simulation.',
    );
  }
}

/**
 * Reset the fault injection — kill processes, remove files (Algorithm 3).
 *
 * On systems without `fio`, simply removes the marker file.
 */
export async function resetFault(mountPath: string): Promise<ResetResponse> {
  const hasFio = await isFioAvailable();

  if (hasFio) {
    const scriptPath = path.join(SCRIPTS_DIR, 'fault-reset.sh');
    await exec(`bash ${scriptPath} ${mountPath}`);
  } else {
    // Local dev fallback: clean up marker and any leftover fill file
    const markerPath = path.join(mountPath, '.fault-active');
    try { await fs.unlink(markerPath); } catch { /* marker may not exist */ }
    const fillPath = path.join(mountPath, 'fill.dat');
    try { await fs.unlink(fillPath); } catch { /* fill may not exist */ }
  }

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
 * `active` is true when the `.fault-active` marker exists. On production
 * (Linux with fio), it also checks for a running fio process. On local
 * dev without fio, the marker alone is sufficient.
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

  // Active when marker exists AND either fio is running (production)
  // or fio is simply not installed (local dev simulation)
  const hasFio = await isFioAvailable();
  const active = markerExists && (fioProcessRunning || !hasFio);

  return {
    active,
    startedAt,
    volumePath: mountPath,
    diskUsagePercent,
    fioProcessRunning,
  };
}
