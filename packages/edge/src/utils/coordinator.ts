// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Env } from '../env';

// There is one coordinator Durable Object for the whole deployment: every runner connection,
// dashboard stream, MCP session and scan dispatch goes through it. Every caller reaches it here, so
// that splitting it (docs/sharding.md#coordinator) changes one place.
export const COORDINATOR_NAME = 'global-coordinator';

export function coordinatorStub(env: Pick<Env, 'COORDINATOR_DO'>): DurableObjectStub {
  return env.COORDINATOR_DO.get(env.COORDINATOR_DO.idFromName(COORDINATOR_NAME));
}
