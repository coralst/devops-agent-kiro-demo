import { Router, Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { Order, Product, CheckoutResponse, ResetResponse } from '../../shared/types';
import { query } from './db';
import { writeOrderLog } from './order-log';
import { resetFault, executeFaultInjection } from './fault-inject';
import { checkOrdersHealth } from './health';

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

/** Map a snake_case DB row to a camelCase Order. */
function toOrder(row: Record<string, unknown>): Order {
  return {
    id: row.id as string,
    productId: row.product_id as string,
    quantity: row.quantity as number,
    totalPrice: row.total_price as number,
    status: row.status as Order['status'],
    createdAt: (row.created_at as Date).toISOString(),
  };
}

/**
 * POST /api/orders/checkout
 * Algorithm 1: validate → lookup → create → write log → check trigger → confirm
 */
router.post(
  '/api/orders/checkout',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { itemId, quantity } = req.body as { itemId?: string; quantity?: number };

      // Step 1: Validate input
      if (!itemId || typeof itemId !== 'string' || itemId.trim() === '') {
        res.status(400).json({ error: 'Invalid checkout request: itemId is required', code: 'VALIDATION_ERROR' });
        return;
      }
      if (quantity === undefined || quantity === null || typeof quantity !== 'number' || quantity <= 0) {
        res.status(400).json({ error: 'Invalid checkout request: quantity must be a positive number', code: 'VALIDATION_ERROR' });
        return;
      }

      // Step 2: Look up product
      const productResult = await query('SELECT * FROM products WHERE id = $1', [itemId]);
      if (productResult.rows.length === 0) {
        res.status(404).json({ error: `Product ${itemId} not found`, code: 'PRODUCT_NOT_FOUND' });
        return;
      }
      const product = toProduct(productResult.rows[0]);

      // Step 3: Create order record
      const orderId = uuidv4();
      const totalPrice = product.price * quantity;
      const createdAt = new Date().toISOString();

      await query(
        'INSERT INTO orders (id, product_id, quantity, total_price, status, created_at) VALUES ($1, $2, $3, $4, $5, $6)',
        [orderId, itemId, quantity, totalPrice, 'pending', createdAt],
      );

      // Step 4: Write order log to EBS volume
      const order: Order = {
        id: orderId,
        productId: itemId,
        quantity,
        totalPrice,
        status: 'pending',
        createdAt,
      };
      await writeOrderLog(order);

      // Step 5: Check if trigger item
      if (product.isTrigger) {
        try {
          await executeFaultInjection(process.env.EBS_MOUNT_PATH ?? '/mnt/ebs-data');
        } catch (err) {
          console.error('[orders-service] Fault injection failed:', err instanceof Error ? err.message : String(err));
        }

        const response: CheckoutResponse = {
          orderId,
          status: 'confirmed',
          message: 'Order placed successfully. Fault injection activated.',
          faultInjected: true,
        };
        res.status(200).json(response);
        return;
      }

      // Step 6: Confirm order
      await query('UPDATE orders SET status = $1 WHERE id = $2', ['confirmed', orderId]);

      const response: CheckoutResponse = {
        orderId,
        status: 'confirmed',
        message: 'Order placed successfully.',
      };
      res.status(200).json(response);
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/orders/:id
 * Returns a single order by ID, or 404 if not found.
 */
router.get('/api/orders/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await query('SELECT * FROM orders WHERE id = $1', [req.params.id]);

    if (result.rows.length === 0) {
      res.status(404).json({
        error: `Order with id "${req.params.id}" not found`,
        code: 'ORDER_NOT_FOUND',
      });
      return;
    }

    const order = toOrder(result.rows[0]);
    res.status(200).json(order);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/orders/health
 * Returns the current health status of the Orders Service.
 */
router.get('/api/orders/health', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const health = await checkOrdersHealth();
    res.status(200).json(health);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/orders/reset
 * Resets the fault injection — kills stress processes, removes files, returns disk usage.
 */
router.post('/api/orders/reset', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const mountPath = process.env.EBS_MOUNT_PATH ?? '/mnt/ebs-data';
    const result: ResetResponse = await resetFault(mountPath);
    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
});
