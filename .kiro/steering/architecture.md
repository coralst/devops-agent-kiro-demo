---
inclusion: fileMatch
fileMatchPattern: "src/shared/**,src/config/**,src/middleware/**,docs/adr/**"
---

# Architecture Guidelines

Loaded conditionally when touching core structure files. These rules supplement the system-architect agent's decisions.

## Project Structure

```
src/
├── api/              — Route handlers (backend-dev owns)
├── services/         — Business logic (backend-dev owns)
├── models/           — Database models & schemas (backend-dev owns)
├── middleware/        — Server middleware (backend-dev owns)
├── components/       — UI components (frontend-dev owns)
├── pages/            — Page-level components (frontend-dev owns)
├── hooks/            — Custom hooks/composables (frontend-dev owns)
├── stores/           — Client-side state (frontend-dev owns)
├── styles/           — Global styles & tokens (ui-designer owns)
├── design-system/    — Design token definitions (ui-designer owns)
├── shared/           — Shared types, constants, utils (system-architect owns)
│   ├── types/        — Interface contracts & shared types
│   ├── constants/    — Shared constants & enums
│   └── utils/        — Truly shared utility functions
├── config/           — App configuration (system-architect owns)
└── __tests__/        — Test files (owned by respective domain agent)
docs/
├── adr/              — Architecture Decision Records (system-architect owns)
└── design/           — Design specs (ui-designer owns)
```

## File Ownership Boundaries

Each agent has clear file ownership. Agents must NOT modify files outside their domain:

| Agent | Owns | Does NOT touch |
|-------|------|----------------|
| system-architect | `src/shared/`, `src/config/`, `docs/adr/` | Component files, route handlers, styles |
| frontend-dev | `src/components/`, `src/pages/`, `src/hooks/`, `src/stores/` | API routes, services, design tokens |
| backend-dev | `src/api/`, `src/services/`, `src/models/`, `src/middleware/` | Components, pages, design tokens |
| ui-designer | `src/styles/`, `src/design-system/`, `docs/design/` | API routes, services, component logic |
| qa-agent | `e2e/`, `playwright.config.ts` | Source code (`src/`), docs |

## Dependency Direction

```
pages → components → hooks/stores → shared/types
pages → api-client → shared/types
api/routes → services → models → shared/types
styles → design-system/tokens
```

Dependencies flow inward toward `shared/`. Never create circular dependencies.

## Interface Contract Rules

- All contracts live in `src/shared/types/`
- Backend and frontend both import from shared types — single source of truth
- Changing a contract requires system-architect approval
- Breaking changes to contracts must be documented in an ADR
- Use discriminated unions for API response types (success/error)

## Configuration

- Environment-specific config in `src/config/`
- Use environment variables for secrets (never commit them)
- Provide sensible defaults for development
- Validate config at startup — fail fast on missing required values
