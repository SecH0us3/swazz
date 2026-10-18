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
