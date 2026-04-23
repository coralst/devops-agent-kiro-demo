import fs from 'node:fs/promises';
import { exec as execCb } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import { Order } from '../../shared/types';
import { isFaultActive } from './fault-inject';

const execAsync = promisify(execCb);

/** Custom error for EBS volume I/O failures. */
export class EbsWriteError extends Error {
  readonly code = 'EBS_IO_TIMEOUT';

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'EbsWriteError';
    this.cause = cause;
  }
}

/** Default timeout for EBS write operations (ms). */
const EBS_WRITE_TIMEOUT_MS = 10_000;

/** Disk usage threshold (%) above which writes are rejected immediately. */
const DISK_FULL_THRESHOLD = 95;

/**
 * Return the current disk usage percentage for the given mount path.
 * Uses platform-appropriate `df` invocation (Linux vs macOS).
 */
async function getDiskUsagePercent(mountPath: string): Promise<number> {
  try {
    const cmd =
      os.platform() === 'darwin'
        ? `df -Pk ${mountPath} | tail -1 | awk '{print $5}'`
        : `df --output=pcent ${mountPath} | tail -1`;
    const { stdout } = await execAsync(cmd);
    const pct = parseInt(stdout.trim().replace('%', ''), 10);
    return Number.isNaN(pct) ? 0 : pct;
  } catch {
    return 0;
  }
}

/**
 * Append an order log entry to the EBS-mounted orders.log file.
 *
 * Throws {@link EbsWriteError} if the disk is above 95% full, if the
 * write does not complete within the configured timeout, or if an I/O
 * error occurs.
 */
export async function writeOrderLog(order: Order, mountPath?: string): Promise<void> {
  const ebsPath = mountPath ?? process.env.EBS_MOUNT_PATH ?? '/mnt/ebs-data';
  const logFile = `${ebsPath}/orders.log`;
  const logLine = `${order.id} | ${order.productId} | ${order.createdAt} | ${order.status}\n`;

  // Fail fast if fault injection is active (simulates degraded EBS I/O)
  if (await isFaultActive(ebsPath)) {
    throw new EbsWriteError(
      'EBS write timed out — volume degraded (fault injection active)',
    );
  }

  // Fail fast if disk is nearly full
  const usage = await getDiskUsagePercent(ebsPath);
  if (usage >= DISK_FULL_THRESHOLD) {
    throw new EbsWriteError(
      `EBS write timed out — volume degraded (disk ${usage}% full, threshold ${DISK_FULL_THRESHOLD}%)`,
    );
  }

  try {
    await withTimeout(
      fs.appendFile(logFile, logLine, 'utf-8'),
      EBS_WRITE_TIMEOUT_MS,
    );
  } catch (err) {
    if (err instanceof EbsWriteError) {
      throw err;
    }
    throw new EbsWriteError(
      `Failed to write order log to ${logFile}: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }
}

/** Race a promise against a timeout, throwing EbsWriteError on expiry. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new EbsWriteError(`EBS write timed out after ${ms}ms`));
    }, ms);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
}
