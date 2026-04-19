---
inclusion: always
---

# Testing Requirements

Every feature MUST include tests. No PR can be merged without tests passing in CI.

## Test Stack

- **Vitest** — test runner (configured in vite.config.ts)
- **React Testing Library** — component testing
- **@testing-library/jest-dom** — DOM matchers (toBeInTheDocument, toHaveAttribute, etc.)
- **@testing-library/user-event** — user interaction simulation

Run tests: `npm test -- --run` (single execution, no watch mode)

## Test Requirements by Agent

### system-architect (src/shared/)

Must test:
- All shared utility functions (pure function input/output)
- Solver/algorithm correctness (known solutions for small inputs)
- Edge cases: zero, negative, boundary values, max values
- Barrel exports work (types and utils are importable)

Example test file: `src/shared/utils/hanoi-solver.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { solveHanoi, createInitialState } from './hanoi-solver';

describe('solveHanoi', () => {
  it('returns empty array for 0 disks', () => { ... });
  it('returns 1 move for 1 disk', () => { ... });
  it('returns 2^n - 1 moves for n disks', () => { ... });
  it('moves all disks from peg A to peg C', () => { ... });
});
```

### frontend-dev (src/components/, src/hooks/)

Must test:
- Component renders without crashing
- User interactions trigger correct behavior
- Hook state transitions (initial state, after actions)
- Accessibility: ARIA attributes present, semantic elements used
- Loading, error, and empty states render correctly

Example test file: `src/components/Controls.test.tsx`

```typescript
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Controls from './Controls';

describe('Controls', () => {
  it('renders play button when not playing', () => { ... });
  it('disables prev button when at step 0', () => { ... });
  it('calls onPlay when play button clicked', () => { ... });
});
```

### backend-dev (src/api/, src/services/)

Must test:
- API endpoint responses (status codes, response shapes)
- Service layer business logic (happy path + edge cases)
- Input validation (reject bad input, accept good input)
- Error handling (correct error codes, no leaked internals)

### ui-designer (src/design-system/)

Must test:
- Design token exports are accessible and correctly typed
- All expected tokens exist (colors, spacing, typography, etc.)
- Token values are valid (colors are valid hex, spacing are valid CSS values)

Example test file: `src/design-system/tokens.test.ts`

```typescript
import { describe, it, expect } from 'vitest';
import { colors, spacing, typography } from './tokens';

describe('design tokens', () => {
  it('exports all color tokens', () => { ... });
  it('disk colors array has at least 8 colors', () => { ... });
  it('all colors are valid hex values', () => { ... });
});
```

## Test File Naming & Location

- Colocated: `ComponentName.test.tsx` next to `ComponentName.tsx`
- Or in `__tests__/` directory within the module
- Test files use kebab-case for .ts, match component name for .tsx

## Test Quality Rules

- Tests must be deterministic — no randomness, no timing dependencies
- Each test should test ONE thing (single assertion focus)
- Use descriptive test names: `it('disables submit when form is invalid')`
- No test should depend on another test's state
- Mock external dependencies, not internal modules
- Prefer `userEvent` over `fireEvent` for user interactions
- Always clean up after tests (React Testing Library does this automatically)

### qa-agent (e2e/)

Must test:
- Critical user flows end-to-end in a real browser (Playwright)
- Cross-browser behavior (Chromium, Firefox, WebKit)
- Keyboard navigation through interactive elements
- Responsive behavior at key breakpoints
- Error states visible to the user (network errors, validation)
- Page load basics (no infinite spinners, content appears)

Example test file: `e2e/tests/hanoi-game.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Hanoi Game', () => {
  test('user can start a new game', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading')).toBeVisible();
  });

  test('user can move a disk between pegs', async ({ page }) => {
    await page.goto('/');
    // interact with pegs and verify disk movement
  });

  test('keyboard navigation works through all pegs', async ({ page }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    // verify focus moves through interactive elements
  });
});
```

## E2E Test File Location

- All E2E tests live in `e2e/tests/` organized by feature
- Page objects and helpers in `e2e/fixtures/`
- Playwright config at `playwright.config.ts`

## CI Integration

Tests run in the CI pipeline on every push:
```
npm test -- --run
```

E2E tests run separately (typically after unit tests pass):
```
npx playwright test
```

If tests fail:
1. CI marks the check as failed
2. PR cannot be merged
3. Agent must fix and push again
