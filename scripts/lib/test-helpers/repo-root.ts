// 🟢 Shared constant for locating the repo root from test files under
// scripts/lib/. Tests shell out to bash with cwd=repoRoot so that
// `source scripts/lib/<helper>.sh` resolves the same way in tests as it
// does when the helpers are sourced from app-up.sh / app-down.sh at the
// repo root.

import { resolve } from 'node:path';

// This file lives at scripts/lib/test-helpers/repo-root.ts, so three
// directories up from __dirname is the repository root. scripts/lib
// compiles as CommonJS (no "type": "module" in package.json), so
// __dirname is a real Node global here and works under both tsc and
// Vitest/esbuild without extra ceremony.
export const repoRoot = resolve(__dirname, '..', '..', '..');
