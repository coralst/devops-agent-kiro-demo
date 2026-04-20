import express, { Request, Response, NextFunction } from 'express';
import { router as ordersRouter } from './routes';
import { EbsWriteError } from './order-log';
import { DatabaseConnectionError } from './db';

const app = express();
const PORT = parseInt(process.env.PORT ?? '3001', 10);

// --- Middleware ---

app.use(express.json());

// CORS — allow all origins (demo environment)
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// --- Routes ---

app.use(ordersRouter);

// --- Error handling middleware ---

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof EbsWriteError) {
    console.error('[orders-service] EBS write error:', {
      message: (err as Error).message,
      code: err.code,
    });
    res.status(500).json({
      error: 'Service temporarily unavailable',
      code: 'EBS_IO_TIMEOUT',
    });
    return;
  }

  if (err instanceof DatabaseConnectionError) {
    console.error('[orders-service] Database connection error:', {
      message: (err as Error).message,
      code: err.code,
    });
    res.status(503).json({
      error: 'Database unavailable',
      code: 'DB_CONNECTION_ERROR',
    });
    return;
  }

  const message = err instanceof Error ? err.message : 'Unknown error';
  console.error('[orders-service] Unhandled error:', { message });
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
  });
});

// --- Start server ---

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`[orders-service] Listening on port ${PORT}`);
  });
}

export { app };
