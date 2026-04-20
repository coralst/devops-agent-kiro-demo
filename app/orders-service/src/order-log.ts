import fs from 'node:fs/promises';
import { Order } from '../../shared/types';

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

/**
 * Append an order log entry to the EBS-mounted orders.log file.
 *
 * Throws {@link EbsWriteError} if the write does not complete within
 * the configured timeout or encounters an I/O error.
 */
export async function writeOrderLog(order: Order, mountPath?: string): Promise<void> {
  const ebsPath = mountPath ?? process.env.EBS_MOUNT_PATH ?? '/mnt/ebs-data';
  const logFile = `${ebsPath}/orders.log`;
  const logLine = `${order.id} | ${order.productId} | ${order.createdAt} | ${order.status}\n`;

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
