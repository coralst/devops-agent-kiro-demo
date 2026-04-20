import { Router, Request, Response, NextFunction } from 'express';
import { Product, HealthCheck } from '../../shared/types';
import { query, DatabaseConnectionError } from './db';

export const router = Router();

/** Map a snake_case DB row to a camelCase Product. */
function toProduct(row: Record<string, unknown>): Product {
  return {
    id: row.id as string,
    name: row.name as string,
    description: row.description as string,
    price: row.price as number,
    imageUrl: row.image_url as string,
    category: row.category as string,
    isTrigger: row.is_trigger as boolean,
  };
}

/**
 * GET /api/catalog/items
 * Returns all products from the database.
 */
router.get('/api/catalog/items', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await query('SELECT * FROM products');
    const products: Product[] = result.rows.map(toProduct);
    res.status(200).json(products);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/catalog/items/:id
 * Returns a single product by ID, or 404 if not found.
 */
router.get('/api/catalog/items/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await query('SELECT * FROM products WHERE id = $1', [req.params.id]);

    if (result.rows.length === 0) {
      res.status(404).json({
        error: `Product with id "${req.params.id}" not found`,
        code: 'PRODUCT_NOT_FOUND',
      });
      return;
    }

    const product = toProduct(result.rows[0]);
    res.status(200).json(product);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/catalog/health
 * Verifies DB connectivity and returns health status.
 */
router.get('/api/catalog/health', async (_req: Request, res: Response) => {
  const health: HealthCheck = {
    service: 'catalog',
    status: 'healthy',
    timestamp: new Date().toISOString(),
    details: {
      database: false,
    },
  };

  try {
    await query('SELECT 1');
    health.details.database = true;
    health.status = 'healthy';
  } catch {
    health.details.database = false;
    health.status = 'unhealthy';
  }

  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});
