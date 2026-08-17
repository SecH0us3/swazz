// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Context, Next } from 'hono';
import { Env } from '../env';
import { getUserIdFromRequest } from '../utils/auth';
import { AuthRepository } from '../repositories/auth';
import { LicenseService } from '../services/license';

export const requireFeature = (feature: string) => {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const userId = await getUserIdFromRequest(c);
    if (!userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const licenseService = new LicenseService(c.env, new AuthRepository(c.env));
    const has = await licenseService.hasFeature(userId, feature);
    if (!has) {
      return c.json({ error: `feature requires a paid plan (feature: ${feature})` }, 403);
    }

    await next();
  };
};
