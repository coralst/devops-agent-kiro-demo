import { Pool, QueryResult, QueryResultRow } from 'pg';

/** Custom error for database connection failures. */
export class DatabaseConnectionError extends Error {
  readonly code = 'DB_CONNECTION_ERROR';

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'DatabaseConnectionError';
    this.cause = cause;
  }
}

/** Configuration for the PostgreSQL connection pool, read from environment variables. */
interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

function loadDbConfig(): DbConfig {
  return {
    host: process.env.DB_HOST ?? 'localhost',
    port: parseInt(process.env.DB_PORT ?? '5432', 10),
    database: process.env.DB_NAME ?? 'demo',
    user: process.env.DB_USER ?? 'postgres',
    password: process.env.DB_PASSWORD ?? '',
  };
}

const config = loadDbConfig();

export const pool = new Pool({
  host: config.host,
  port: config.port,
  database: config.database,
  user: config.user,
  password: config.password,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('[orders-service] Unexpected pool error:', err.message);
});

/**
 * Execute a parameterized SQL query with connection retry and exponential backoff.
 *
 * Retries up to {@link MAX_RETRIES} times on connection failures, doubling the
 * delay between each attempt (starting at {@link BASE_DELAY_MS} ms).
 */
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<QueryResult<T>> {
  let lastError: unknown;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await pool.query<T>(text, params);
    } catch (err: unknown) {
      lastError = err;
      const isConnectionError =
        err instanceof Error &&
        ('code' in err &&
          (err as Record<string, unknown>).code === 'ECONNREFUSED');

      if (!isConnectionError || attempt === MAX_RETRIES) {
        throw err;
      }

      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(
        `[orders-service] DB connection attempt ${attempt + 1} failed, retrying in ${delay}ms…`,
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  // Should never reach here, but satisfy the compiler
  throw new DatabaseConnectionError(
    'Failed to connect to database after retries',
    lastError,
  );
}
