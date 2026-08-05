// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Env } from '../env';
import { getDB } from '../utils/db';
import type { D1Database } from '@cloudflare/workers-types';

export abstract class BaseService {
  protected db: D1Database;

  constructor(protected env: Env) {
    this.db = getDB(env);
  }
}
