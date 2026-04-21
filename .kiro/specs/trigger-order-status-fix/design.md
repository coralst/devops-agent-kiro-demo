# Trigger Order Status Fix — Bugfix Design

## Overview

The `POST /api/orders/checkout` handler in `app/orders-service/src/routes.ts` has two branches: one for trigger items (`product.isTrigger === true`) and one for normal items. The normal branch correctly runs `UPDATE orders SET status = 'confirmed'` before responding. The trigger branch performs an early return after sending the response, skipping that UPDATE entirely. The order is inserted as `'pending'` and never transitions to `'confirmed'` in the database, even though the API response claims `status: 'confirmed'`.

The fix is surgical: add the same `UPDATE orders SET status = 'confirmed'` query to the trigger branch, before the early return. No other code paths change.

## Glossary

- **Bug_Condition (C)**: The checkout request involves a trigger item (`product.isTrigger === true`), causing the handler to take the early-return branch that skips the status UPDATE
- **Property (P)**: After checkout, the order row in the database has `status = 'confirmed'`, matching the `status: 'confirmed'` in the API response
- **Preservation**: All non-trigger checkout behavior, validation, error handling, fault injection execution, and order log writing remain unchanged
- **`checkout` (F)**: The original handler — trigger branch skips the UPDATE query
- **`checkout'` (F')**: The fixed handler — trigger branch includes the UPDATE query before the early return
- **`executeFaultInjection`**: Function in `fault-inject.ts` that runs the EBS stress script; called only in the trigger branch
- **`writeOrderLog`**: Function in `order-log.ts` that appends to the EBS-mounted log file; called for all orders before the trigger check

## Bug Details

### Bug Condition

The bug manifests when a user checks out with a trigger item (`product.isTrigger === true`). The handler inserts the order with `status = 'pending'`, writes the order log, runs fault injection, then returns a response with `status: 'confirmed'` — but never executes the `UPDATE orders SET status = 'confirmed'` query because the trigger branch does an early `return` at line ~98 of `routes.ts`, and the UPDATE is only on line ~102, after the `if (product.isTrigger)` block.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type { itemId: string, quantity: number } with resolved Product
  OUTPUT: boolean

  product ← lookupProduct(input.itemId)
  RETURN product IS NOT NULL
         AND product.isTrigger = true
         AND input.quantity > 0
END FUNCTION
```

### Examples

- **Trigger checkout**: `POST /api/orders/checkout { itemId: "TRIGGER_ITEM", quantity: 1 }` → Response says `status: "confirmed"`, but `SELECT status FROM orders WHERE id = <orderId>` returns `'pending'`
- **Subsequent GET**: `GET /api/orders/<orderId>` → Returns `status: "pending"`, contradicting the checkout response
- **Normal checkout (not affected)**: `POST /api/orders/checkout { itemId: "abc-123", quantity: 2 }` → Response says `status: "confirmed"`, and DB row also has `status = 'confirmed'`

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Non-trigger item checkouts must continue to INSERT the order as `'pending'`, write the order log, UPDATE to `'confirmed'`, and return `status: 'confirmed'`
- Trigger item checkouts must continue to call `executeFaultInjection`, return `faultInjected: true`, and return the message `'Order placed successfully. Fault injection activated.'`
- Input validation (HTTP 400 for missing/invalid itemId or non-positive quantity) must remain unchanged
- Product lookup (HTTP 404 for non-existent product) must remain unchanged
- EBS write failure propagation (`EbsWriteError` → HTTP 500) must remain unchanged
- The order log write (`writeOrderLog`) must still happen before the trigger check

**Scope:**
All inputs where `product.isTrigger === false` (or where the request fails validation/product lookup) are completely unaffected by this fix. The only change is adding one query call inside the `if (product.isTrigger)` block.

## Hypothesized Root Cause

The root cause is confirmed (not hypothesized) — the user has already diagnosed it:

1. **Missing UPDATE query in trigger branch**: In `routes.ts` lines ~86–98, the `if (product.isTrigger)` block runs fault injection, builds the response, calls `res.status(200).json(response)`, and returns. The `UPDATE orders SET status = $1 WHERE id = $2` query on line ~102 is only reached by the non-trigger (else/fallthrough) path. This is a straightforward control-flow omission — the trigger branch was written to return early for the fault injection response but forgot to include the status update that the normal path performs.

## Correctness Properties

Property 1: Bug Condition — Trigger order status persisted as 'confirmed'

_For any_ checkout request where the product is a trigger item (`isBugCondition` returns true), the fixed checkout handler SHALL execute `UPDATE orders SET status = 'confirmed' WHERE id = <orderId>` before returning the response, so that the database row's status matches the `status: 'confirmed'` in the API response.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation — Non-trigger checkout behavior unchanged

_For any_ checkout request where the product is NOT a trigger item (`isBugCondition` returns false) and the request passes validation and product lookup, the fixed checkout handler SHALL produce the same query sequence, the same response body, and the same HTTP status code as the original handler.

**Validates: Requirements 3.1, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

**File**: `app/orders-service/src/routes.ts`

**Function**: `router.post('/api/orders/checkout', ...)` — the anonymous async handler

**Specific Changes**:

1. **Add UPDATE query before early return in trigger branch**: Insert `await query('UPDATE orders SET status = $1 WHERE id = $2', ['confirmed', orderId]);` inside the `if (product.isTrigger)` block, before the `res.status(200).json(response)` call. This mirrors the same UPDATE that already exists in the non-trigger path (line ~102).

That's the entire fix — one line added.

**Before (lines ~86–98):**
```typescript
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
```

**After:**
```typescript
if (product.isTrigger) {
  try {
    await executeFaultInjection(process.env.EBS_MOUNT_PATH ?? '/mnt/ebs-data');
  } catch (err) {
    console.error('[orders-service] Fault injection failed:', err instanceof Error ? err.message : String(err));
  }

  await query('UPDATE orders SET status = $1 WHERE id = $2', ['confirmed', orderId]);

  const response: CheckoutResponse = {
    orderId,
    status: 'confirmed',
    message: 'Order placed successfully. Fault injection activated.',
    faultInjected: true,
  };
  res.status(200).json(response);
  return;
}
```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the bug on unfixed code, then verify the fix works correctly and preserves existing behavior.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm the root cause by observing that the trigger branch never calls the UPDATE query.

**Test Plan**: Write a test that checks out a trigger item and asserts the UPDATE query was called. Run on UNFIXED code to observe the failure.

**Test Cases**:
1. **Trigger checkout missing UPDATE**: Check out `TRIGGER_ITEM` and verify `mockQuery` was called with `UPDATE orders SET status` — will fail on unfixed code because the trigger branch skips it
2. **Trigger order GET returns pending**: After trigger checkout, mock a GET that returns the DB row — will show `status: 'pending'` on unfixed code

**Expected Counterexamples**:
- `mockQuery` is called 3 times (SELECT product, INSERT order, no UPDATE) instead of 4 times
- The UPDATE query with `['confirmed', orderId]` is never issued in the trigger path

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function issues the UPDATE query and the response status matches the DB status.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result ← checkout'(input)
  ASSERT mockQuery was called with 'UPDATE orders SET status' AND ['confirmed', orderId]
  ASSERT result.status = 'confirmed'
  ASSERT result.faultInjected = true
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT checkout(input) = checkout'(input)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many combinations of non-trigger products, quantities, and edge cases
- It catches regressions in the query sequence, response shape, and status codes
- It provides strong guarantees that the fix is truly surgical

**Test Plan**: Observe behavior on UNFIXED code for non-trigger checkouts (which already work correctly), then write property-based tests capturing that behavior to ensure it's preserved after the fix.

**Test Cases**:
1. **Non-trigger checkout preservation**: Generate random valid non-trigger products and quantities, verify the query sequence is SELECT → INSERT → UPDATE and the response has `status: 'confirmed'` without `faultInjected`
2. **Validation preservation**: Generate invalid inputs (empty itemId, zero/negative quantity), verify HTTP 400 with `VALIDATION_ERROR`
3. **Product-not-found preservation**: Generate requests for non-existent products, verify HTTP 404 with `PRODUCT_NOT_FOUND`

### Unit Tests

- Verify trigger checkout calls UPDATE query with `['confirmed', orderId]` (the core fix assertion)
- Verify trigger checkout still calls `executeFaultInjection` and returns `faultInjected: true`
- Verify the query call count is 4 for trigger checkout (SELECT, INSERT, UPDATE, not 3)
- Verify non-trigger checkout query sequence is unchanged (SELECT, INSERT, UPDATE)

### Property-Based Tests

- Generate random trigger-item checkouts with varying quantities and verify the UPDATE query is always issued with `'confirmed'` and the correct `orderId`
- Generate random non-trigger checkouts and verify the query sequence and response shape match the original behavior exactly
- Generate random invalid inputs and verify validation responses are unchanged

### Integration Tests

- Full trigger checkout flow: POST checkout → verify UPDATE was called → GET order → verify `status: 'confirmed'`
- Full non-trigger checkout flow: POST checkout → GET order → verify `status: 'confirmed'` (regression check)
- Trigger checkout with fault injection failure: verify order is still confirmed even if `executeFaultInjection` throws
