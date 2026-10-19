// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// Who a runner works for. The owner is the user_id tag the Worker attached after authenticating
// the connection against D1; it is the only runner identity dispatch, restart and listing may
// trust. A public-key string is not an identity: any user can type any key into their profile.

const USER_ID_TAG = 'user_id:';

export function getRunnerOwnerId(tags: string[]): string | null {
  const tag = tags.find(t => t.startsWith(USER_ID_TAG));
  const id = tag ? tag.substring(USER_ID_TAG.length) : '';
  return id || null;
}

export function isRunnerOwnedBy(tags: string[], userId: string | null | undefined): boolean {
  return !!userId && getRunnerOwnerId(tags) === userId;
}

// Marks a platform shared runner. Only the Worker adds it, and only after the connection presented
// the operator's SHARED_RUNNER_TOKEN; every other runner belongs to exactly one user.
export const SHARED_RUNNER_TAG = 'shared';

export function isSharedRunnerTags(tags: string[]): boolean {
  return tags.includes(SHARED_RUNNER_TAG);
}

/**
 * The scan config as a given runner may receive it. A shared runner sits on the operator's
 * network, so a tenant must not be able to switch off its SSRF guard: allow_private_ips is
 * forced off there unless the operator opted in with SHARED_RUNNERS_ALLOW_PRIVATE_IPS.
 */
export function configForRunner(config: any, tags: string[], env: { SHARED_RUNNERS_ALLOW_PRIVATE_IPS?: string }): any {
  if (!isSharedRunnerTags(tags) || env.SHARED_RUNNERS_ALLOW_PRIVATE_IPS === 'true') return config;
  if (!isPlainObject(config)) return config;
  // Every key the agent's decoder would read as "security" is folded into one object, and every
  // key it would read as "allow_private_ips" inside it is dropped, before the forced value is set.
  let security: Record<string, unknown> = {};
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (goJsonFold(key) === 'security') {
      if (isPlainObject(value)) security = { ...security, ...value };
    } else {
      rest[key] = value;
    }
  }
  const guarded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(security)) {
    if (goJsonFold(key) !== 'allow_private_ips') guarded[key] = value;
  }
  return { ...rest, security: { ...guarded, allow_private_ips: false } };
}

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Folds a JSON key the way Go's encoding/json matches it to a struct field: case-insensitively,
 * including the Unicode folds of 's' (U+017F) and 'k' (U+212A). The Go agent decodes the scan
 * config, so a key that differs from "security" only in case still lands in that field there.
 */
export function goJsonFold(key: string): string {
  return key.toUpperCase().toLowerCase();
}
