// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect } from 'vitest';
import { DEFAULT_ROLES, isBuiltInRole, isReservedRoleId } from '../../../src/config/rbac';

// One predicate decides what a built-in role is; the role-assignment, permission-resolution and
// provisioning paths all call it instead of keeping their own lists, which had already drifted.
describe('built-in and reserved role ids', () => {
  it('treats exactly the DEFAULT_ROLES keys as built-in', () => {
    for (const id of Object.keys(DEFAULT_ROLES)) expect(isBuiltInRole(id)).toBe(true);
    for (const id of ['runner', 'c_01HXYZ', 'constructor', 'toString', '__proto__', '']) expect(isBuiltInRole(id)).toBe(false);
  });

  it('reserves the built-in ids and the retired runner pseudo-role', () => {
    expect(isReservedRoleId('owner')).toBe(true);
    expect(isReservedRoleId('runner')).toBe(true);
    expect(isReservedRoleId('c_01HXYZ')).toBe(false);
  });
});
