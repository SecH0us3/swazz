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
  if (!config || typeof config !== 'object' || Array.isArray(config)) return config;
  const security = config.security && typeof config.security === 'object' && !Array.isArray(config.security) ? config.security : {};
  return { ...config, security: { ...security, allow_private_ips: false } };
}
