# Bugfix Requirements Document

## Introduction

When a user purchases the trigger item ("Mystery Box of Chaos" / `TRIGGER_ITEM`), the checkout endpoint at `POST /api/orders/checkout` returns `status: 'confirmed'` in the HTTP response, but the order's status is never updated from `'pending'` to `'confirmed'` in the database. This creates a data inconsistency where the API tells the user the order is confirmed, but the database record permanently remains in `'pending'` state. Non-trigger item purchases are unaffected — their orders are correctly updated to `'confirmed'` in the database.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a user checks out with the trigger item (`product.isTrigger === true`) THEN the system returns `status: 'confirmed'` in the response but leaves the order row in the database with `status = 'pending'` because the trigger branch performs an early return before executing the `UPDATE orders SET status = 'confirmed'` query

1.2 WHEN a user later queries the trigger item order via `GET /api/orders/:id` THEN the system returns `status: 'pending'` even though the checkout response indicated `'confirmed'`, because the database was never updated

### Expected Behavior (Correct)

2.1 WHEN a user checks out with the trigger item (`product.isTrigger === true`) THEN the system SHALL update the order's status to `'confirmed'` in the database before returning the response, so that the database state matches the `status: 'confirmed'` returned in the checkout response

2.2 WHEN a user later queries the trigger item order via `GET /api/orders/:id` THEN the system SHALL return `status: 'confirmed'`, consistent with the original checkout response

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a user checks out with a non-trigger item (`product.isTrigger === false`) THEN the system SHALL CONTINUE TO update the order's status to `'confirmed'` in the database and return `status: 'confirmed'` in the response

3.2 WHEN a user checks out with the trigger item THEN the system SHALL CONTINUE TO execute fault injection, return `faultInjected: true` in the response, and return the message `'Order placed successfully. Fault injection activated.'`

3.3 WHEN a user checks out with invalid input (missing itemId, non-positive quantity) THEN the system SHALL CONTINUE TO return HTTP 400 with `code: 'VALIDATION_ERROR'`

3.4 WHEN a user checks out with a non-existent product THEN the system SHALL CONTINUE TO return HTTP 404 with `code: 'PRODUCT_NOT_FOUND'`

3.5 WHEN the EBS write fails during checkout THEN the system SHALL CONTINUE TO propagate the `EbsWriteError` to the error handler

---

### Bug Condition (Formal)

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type CheckoutRequest with resolved Product
  OUTPUT: boolean

  // The bug triggers when the purchased product is the trigger item
  RETURN X.product.isTrigger = true
END FUNCTION
```

### Fix Checking Property

```pascal
// Property: Fix Checking — Trigger order status is persisted as 'confirmed'
FOR ALL X WHERE isBugCondition(X) DO
  result ← checkout'(X)
  order_row ← SELECT status FROM orders WHERE id = result.orderId
  ASSERT result.status = 'confirmed'
    AND order_row.status = 'confirmed'
END FOR
```

### Preservation Checking Property

```pascal
// Property: Preservation Checking — Non-trigger orders behave identically
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT checkout(X) = checkout'(X)
END FOR
```

**Key Definitions:**
- **F (checkout)**: The original checkout handler — trigger branch skips the UPDATE query
- **F' (checkout')**: The fixed checkout handler — trigger branch includes the UPDATE query before the early return
