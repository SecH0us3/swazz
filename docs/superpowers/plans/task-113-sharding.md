# D1 Vertical Sharding Architecture Implementation Plan (Task 113)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the groundwork for Cloudflare D1 vertical sharding by introducing a `getDB(env, routingKey?)` utility helper and routing all query sites in the edge coordinator through it, and documenting the sharding design strategy.

**Architecture:** A new utility `getDB` resolves the database binding from `env`. It currently returns `env.DB` for a single database setup but allows future dynamic routing to databases like `env.DB_SHARD_1` based on routing keys (e.g. `projectId`, `scanId`, `userId`) without breaking the codebase.

**Tech Stack:** TypeScript, Cloudflare Workers, Hono, Vitest

## Global Constraints

- Never use string concatenation or `fmt.Sprintf` for formatting URL query parameters (Go rule).
- Never use inline layout styles in React components (CSS rule).
- Keep E2E test usernames between 3 and 20 characters.
- Use `getDB` helper at all D1 query preparation and execution sites in the Cloudflare edge coordinator.

---

### Task 1: Define `getDB` Helper Utility

**Files:**
- Create: `packages/edge/src/utils/db.ts`
- Create: `packages/edge/src/utils/db.test.ts`

**Interfaces:**
- Produces: `getDB(env: Env, routingKey?: string | number): D1Database`

- [ ] **Step 1: Write tests for `getDB`**

Create `packages/edge/src/utils/db.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { getDB } from './db';
import { Env } from '../env';
import { D1Database } from '@cloudflare/workers-types';

describe('getDB Helper', () => {
  it('returns the default DB binding when no routingKey is provided', () => {
    const mockDB = {} as D1Database;
    const mockEnv = { DB: mockDB } as unknown as Env;
    expect(getDB(mockEnv)).toBe(mockDB);
  });

  it('returns the default DB binding even when routingKey is provided (current behavior)', () => {
    const mockDB = {} as D1Database;
    const mockEnv = { DB: mockDB } as unknown as Env;
    expect(getDB(mockEnv, 'user-123')).toBe(mockDB);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `rtk npm run test --workspace=packages/edge`
Expected: FAIL due to missing `getDB` module.

- [ ] **Step 3: Write minimal implementation**

Create `packages/edge/src/utils/db.ts`:
```typescript
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../env';

/**
 * Resolves the appropriate D1 database binding based on the environment and optional routing key.
 * Today it always returns env.DB, but in the future it can route to env.DB_SHARD_1, etc.
 */
export function getDB(env: Env, routingKey?: string | number): D1Database {
  return env.DB;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `rtk npm run test --workspace=packages/edge`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
rtk git add packages/edge/src/utils/db.ts packages/edge/src/utils/db.test.ts
rtk git commit -m "feat: define getDB helper for sharding"
```


### Task 2: Refactor Index & Coordinator to use `getDB`

**Files:**
- Modify: `packages/edge/src/index.ts`
- Modify: `packages/edge/src/Coordinator.ts`

- [ ] **Step 1: Import `getDB` in `packages/edge/src/index.ts` and `Coordinator.ts`**

Import statement:
```typescript
import { getDB } from './utils/db';
```

- [ ] **Step 2: Replace direct `env.DB` access with `getDB(env, routingKey)` in `packages/edge/src/index.ts`**

- [ ] **Step 3: Replace `this.env.DB` with `getDB(this.env, routingKey)` in `packages/edge/src/Coordinator.ts`**

- [ ] **Step 4: Run edge tests to ensure no regressions**

- [ ] **Step 5: Commit changes**


### Task 3: Refactor API Routes to use `getDB`

**Files:**
- Modify: `packages/edge/src/routes/*.ts`

- [ ] **Step 1: Import `getDB` in all route files**

- [ ] **Step 2: Replace direct `c.env.DB` references with `getDB(c.env, routingKey)`**

- [ ] **Step 3: Run edge unit tests**

- [ ] **Step 4: Commit changes**


### Task 4: Documentation & Roadmap Updates

**Files:**
- Create: `docs/sharding.md`
- Modify: `ROADMAP.md`

- [ ] **Step 1: Create `docs/sharding.md`**

- [ ] **Step 2: Mark Task 113 as in progress/completed in `ROADMAP.md`**

- [ ] **Step 3: Run the full verify script**

- [ ] **Step 4: Commit and generate walkthrough**
