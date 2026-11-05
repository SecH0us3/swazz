// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * Invitation links (/accept-invite?token=...) never accept anything by themselves: anyone can send
 * such a link, and accepting would silently move the visitor into the sender's project. The token
 * is only remembered so the matching invitation is shown first in the header, where the user
 * accepts or declines it explicitly.
 */

export const PENDING_INVITE_KEY = 'swazz_pending_invite';
export const ACCEPT_INVITE_PATH = '/accept-invite';
const INVITE_TOKEN_PATTERN = /^[0-9A-Za-z]{16,128}$/;

/**
 * Remembers the invitation token from an /accept-invite link and returns the URL with the token
 * removed (or null when there is nothing to change). Tokens on any other path are ignored.
 */
export function capturePendingInvite(href: string, storage: Pick<Storage, 'setItem'>): URL | null {
    const url = new URL(href);
    if (url.pathname !== ACCEPT_INVITE_PATH || !url.searchParams.has('token')) return null;
    const token = url.searchParams.get('token') ?? '';
    if (INVITE_TOKEN_PATTERN.test(token)) {
        storage.setItem(PENDING_INVITE_KEY, token);
    }
    url.searchParams.delete('token');
    return url;
}

/** Puts the invitation the user arrived for first, so the header banner offers that one. */
export function orderInvitations<T extends { token: string }>(invitations: T[], pendingToken: string | null): T[] {
    if (!pendingToken) return invitations;
    const match = invitations.find(i => i.token === pendingToken);
    return match ? [match, ...invitations.filter(i => i !== match)] : invitations;
}
