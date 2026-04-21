# Implementation Plan

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** — Trigger checkout skips UPDATE query
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the trigger branch never calls `UPDATE orders SET status`
  - **Scoped PBT Approach**: Scope the property to the concrete failing case: checkout with `TRIGGER_ITEM` (isTrigger=true) and any positive quantity
  - In `app/orders-service/src/routes.test.ts`, add a test in the `POST /api/orders/checkout` describe block
  - Mock setup: SELECT returns `triggerProductRow()`, INSERT resolves, `writeOrderLog` resolves, add a 4th `mockQuery` resolve for the UPDATE call
  - POST `/api/orders/checkout` with `{ itemId: 'TRIGGER_ITEM', quantity: 1 }`
  - Assert `mockQuery` was called with a query containing `'UPDATE orders SET status'` and params `['confirmed', orderId]`
  - Assert the UPDATE call is the 3rd `mockQuery` call (index 2): SELECT(0) → INSERT(1) → UPDATE(2)
  - Run test on UNFIXED code with `npm test -- --run` from `app/orders-service/`
  - **EXPECTED OUTCOME**: Test FAILS — `mockQuery` is only called 2 times (SELECT, INSERT) in the trigger path, never reaching UPDATE. This confirms the bug exists.
  - Document counterexample: trigger checkout issues only 2 queries (SELECT product, INSERT order) instead of 3 — the UPDATE query is skipped due to early return at line ~98
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 2.1_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** — Non-trigger checkout behavior unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - In `app/orders-service/src/routes.property.test.ts`, add property-based tests using `fast-check`
  - Observe on UNFIXED code: non-trigger checkout (isTrigger=false) issues query sequence SELECT → INSERT → UPDATE and returns `{ status: 'confirmed', faultInjected: undefined }`
  - Observe on UNFIXED code: invalid inputs (empty itemId, quantity ≤ 0) return HTTP 400 with `code: 'VALIDATION_ERROR'` and `mockQuery` is never called
  - Observe on UNFIXED code: non-existent product returns HTTP 404 with `code: 'PRODUCT_NOT_FOUND'`
  - Write property: for all valid non-trigger products (arbitrary `id`, `name`, `price`, `is_trigger=false`) and positive integer quantities, the checkout handler calls `mockQuery` exactly 3 times (SELECT, INSERT, UPDATE), the 3rd call contains `'UPDATE orders SET status'` with `['confirmed', orderId]`, and the response has `status: 'confirmed'` without `faultInjected`
  - Write property: for all invalid inputs (empty/missing itemId OR non-positive quantity), the handler returns HTTP 400 with `VALIDATION_ERROR` and `mockQuery` is never called
  - Use `fc.record`, `fc.string`, `fc.integer` from `fast-check` to generate arbitrary product fields and quantities
  - Mock setup mirrors existing test patterns: mock `query` from `./db`, mock `writeOrderLog` from `./order-log`
  - Verify all property tests PASS on UNFIXED code
  - Run tests with `npm test -- --run` from `app/orders-service/`
  - **EXPECTED OUTCOME**: Tests PASS — non-trigger paths already work correctly on unfixed code
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [ ] 3. Fix trigger order status — add UPDATE query before early return

  - [ ] 3.1 Implement the fix
    - In `app/orders-service/src/routes.ts`, inside the `if (product.isTrigger)` block (around line 93)
    - Add `await query('UPDATE orders SET status = $1 WHERE id = $2', ['confirmed', orderId]);` after the fault injection try/catch and before the response construction
    - This is a single line addition — no other code changes
    - _Bug_Condition: isBugCondition(input) where input.product.isTrigger === true_
    - _Expected_Behavior: After checkout, UPDATE query is issued with ['confirmed', orderId] so DB row status matches response status_
    - _Preservation: Non-trigger checkout path, validation, product lookup, EBS error handling all remain untouched_
    - _Requirements: 1.1, 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** — Trigger checkout persists 'confirmed' status
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior (UPDATE query called with 'confirmed')
    - When this test passes, it confirms the expected behavior is satisfied
    - Run `npm test -- --run` from `app/orders-service/`
    - **EXPECTED OUTCOME**: Test PASSES — `mockQuery` is now called 3 times in the trigger path (SELECT, INSERT, UPDATE) and the UPDATE contains `['confirmed', orderId]`
    - _Requirements: 2.1, 2.2_

  - [ ] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** — Non-trigger checkout behavior unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - Run `npm test -- --run` from `app/orders-service/`
    - **EXPECTED OUTCOME**: Tests PASS — non-trigger paths, validation, and error handling are unaffected by the one-line addition
    - Confirm all property tests still pass after fix (no regressions)

- [ ] 4. Checkpoint — Ensure all tests pass
  - Run full test suite: `npm test -- --run` from `app/orders-service/`
  - Verify all existing tests in `routes.test.ts` still pass (especially the trigger item test that mocks only 3 query calls — it may need an additional mock resolve for the new UPDATE call)
  - Verify the new bug condition exploration test passes
  - Verify all preservation property tests pass
  - Ensure no regressions in any other test files
  - Ask the user if questions arise
