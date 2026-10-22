// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/// <reference types="vite/client" />

import { describe, it, expect, vi } from 'vitest';
import { coordinatorStub, COORDINATOR_NAME } from '../../../src/utils/coordinator';

describe('coordinatorStub', () => {
  it('reaches the one coordinator by its name', () => {
    const stub = { fetch: vi.fn() };
    const ns = { idFromName: vi.fn(() => 'the-id'), get: vi.fn(() => stub) };
    expect(coordinatorStub({ COORDINATOR_DO: ns as any })).toBe(stub);
    expect(ns.idFromName).toHaveBeenCalledWith(COORDINATOR_NAME);
    expect(ns.get).toHaveBeenCalledWith('the-id');
  });

  // Splitting the coordinator must stay a change in one place.
  it('is the only way the code addresses the coordinator', () => {
    const sources = import.meta.glob('../../../src/**/*.ts', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
    expect(Object.keys(sources).length).toBeGreaterThan(20);
    const offenders = Object.entries(sources)
      .filter(([path, src]) => !path.endsWith('/utils/coordinator.ts') && !path.endsWith('/env.ts') && /\bCOORDINATOR_DO\b/.test(src))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
