---
inclusion: manual
---

# Code Review Checklist

Used by the master-agent during PR reviews. Invoke with `#review-checklist` in chat.

## Pre-Review: CI Status

- [ ] Does `npm run lint` (tsc --noEmit) pass?
- [ ] Does `npm test -- --run` pass with all tests green?
- [ ] Does `npm run build` succeed?
- [ ] If CI failed, has the agent pushed a fix?

## Contract Compliance

- [ ] Does the code implement the interfaces defined by system-architect?
- [ ] Are shared types imported from `src/shared/types/` (not redefined locally)?
- [ ] Does the API response shape match the contract?
- [ ] Are all required fields present and correctly typed?

## Test Coverage

- [ ] Are the test requirements from the PR description satisfied?
- [ ] Unit tests for business logic and utilities?
- [ ] Component tests for UI (render, interaction)?
- [ ] Edge cases covered (empty state, error state, boundary values)?
- [ ] Tests are deterministic (no flaky tests)?
- [ ] If tests are missing, post a ❌ blocking comment requesting them

## Quality Signal (TBD Red-Yellow-Green)

- [ ] What is the overall quality signal? (🟢/🟡/🔴)
- [ ] Are all `TODO(yellow)` items documented?
- [ ] Are there any 🔴 red items that block merge?

## Code Quality (Martin Fowler)

- [ ] No functions longer than 20 lines
- [ ] No parameter lists longer than 3 params
- [ ] No duplicated code blocks
- [ ] No feature envy (methods reaching into other classes)
- [ ] Refactoring commits separate from feature commits

## Security

- [ ] No hardcoded secrets, tokens, or API keys
- [ ] Input validation on external boundaries
- [ ] No PII in logs

## E2E Testing (QA Agent)

- [ ] Critical user flows covered by E2E tests?
- [ ] Cross-browser testing done (Chromium, Firefox, WebKit)?
- [ ] Keyboard navigation verified in E2E?
- [ ] QA-agent posted test results on the PR?
- [ ] No flaky tests in the suite?

## Accessibility

- [ ] Semantic HTML used
- [ ] Interactive elements keyboard accessible
- [ ] Form inputs have labels
- [ ] ARIA attributes where needed

## PR Hygiene

- [ ] Conventional commits used
- [ ] PR description has quality signal and test checklist
- [ ] Branch name follows convention
- [ ] No unrelated changes bundled
- [ ] Agent only modified files within their ownership boundary

## Review Comment Format

Post reviews as human-like conversation:

```
**[emoji] [Agent Name]** — Code Review

[Conversational opening]

✅ [Approval point]
⚠️ [Suggestion — not blocking]
❌ [Blocking — must fix before merge]

Overall: [🟢/🟡/🔴] [verdict]
```
