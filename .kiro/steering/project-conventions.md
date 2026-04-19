---
inclusion: always
---

# Project Conventions

These conventions apply to ALL agents and ALL code in this project.

## Language & Framework

- TypeScript is the primary language (strict mode enabled)
- Use explicit types — avoid `any` unless absolutely necessary and documented
- Prefer `interface` over `type` for object shapes (extendability)
- Use `const` by default, `let` only when reassignment is needed, never `var`

## TBD Red-Yellow-Green Code Quality Methodology

All code must be tagged with a quality signal following Trunk-Based Development principles:

- 🟢 **Green** — Production-ready. Clean, tested, follows all conventions. Safe to merge to trunk.
- 🟡 **Yellow** — Works but incomplete. Mark shortcuts with `// TODO(yellow): <reason>`. Acceptable only on short-lived feature branches. Must be resolved before merge to trunk.
- 🔴 **Red** — Broken or dangerous. Structural issues, security gaps, contract violations. Must be fixed immediately. Never merge red code.

Every PR description must include the overall quality signal and list any yellow items.

## Martin Fowler's Refactoring Principles

When modifying existing code, follow these principles:

1. **Never refactor and change behavior in the same commit** — separate refactoring commits from feature commits
2. **Small steps** — each refactoring should be a single, safe transformation
3. **Run tests after each step** — if tests break, the refactoring introduced a bug
4. **Common refactorings to apply**:
   - Extract Function/Method — when code does more than one thing
   - Inline Function — when the body is as clear as the name
   - Rename Variable/Function — when the name doesn't communicate intent
   - Introduce Explaining Variable — when an expression is complex
   - Replace Temp with Query — when a temp is used only once after assignment
   - Encapsulate Variable — when a variable is accessed widely
   - Decompose Conditional — when a conditional is complex
5. **Code smells to watch for**: duplicated code, long functions (>20 lines is a smell), large classes, long parameter lists, divergent change, shotgun surgery, feature envy, data clumps

## File & Folder Naming

- Files: `kebab-case.ts` (e.g., `user-service.ts`, `auth-middleware.ts`)
- Components: `PascalCase.tsx` (e.g., `LoginForm.tsx`, `UserCard.tsx`)
- Test files: colocated as `<name>.test.ts` or in `__tests__/` directory
- Types/interfaces: `PascalCase` (e.g., `UserProfile`, `ApiResponse`)

## Error Handling

- Use custom error classes that extend `Error`
- Always include error codes for API errors
- Log errors with context (what was being attempted, relevant IDs)
- Never swallow errors silently — at minimum, log them

## Imports

- Use absolute imports from project root (configure path aliases)
- Group imports: external libs → internal shared → local modules
- No circular dependencies

## Comments

- Code should be self-documenting — prefer clear names over comments
- Use comments for "why", not "what"
- JSDoc for public API functions and complex utilities
- TODO format: `// TODO(yellow): <description>` for tracked items
