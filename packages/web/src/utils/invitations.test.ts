// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi } from 'vitest';
import { capturePendingInvite, orderInvitations, PENDING_INVITE_KEY } from './invitations.js';

const TOKEN = '01HXYZABCDEFGHJKMNPQRSTVWX01HXYZABCDEFGHJKMNPQRSTVWX';

describe('capturePendingInvite', () => {
    it('remembers the token from /accept-invite and strips it from the URL', () => {
        const storage = { setItem: vi.fn() };
        const url = capturePendingInvite(`https://swazz.example/accept-invite?token=${TOKEN}&x=1`, storage);
        expect(storage.setItem).toHaveBeenCalledWith(PENDING_INVITE_KEY, TOKEN);
        expect(url?.search).toBe('?x=1');
    });

    it('ignores a token on any other path (no acceptance from arbitrary links)', () => {
        const storage = { setItem: vi.fn() };
        expect(capturePendingInvite(`https://swazz.example/?token=${TOKEN}`, storage)).toBeNull();
        expect(storage.setItem).not.toHaveBeenCalled();
    });

    it('drops a malformed token without remembering it', () => {
        const storage = { setItem: vi.fn() };
        const url = capturePendingInvite('https://swazz.example/accept-invite?token=<script>', storage);
        expect(storage.setItem).not.toHaveBeenCalled();
        expect(url?.searchParams.has('token')).toBe(false);
    });

    it('does nothing without a token', () => {
        const storage = { setItem: vi.fn() };
        expect(capturePendingInvite('https://swazz.example/accept-invite', storage)).toBeNull();
    });
});

describe('orderInvitations', () => {
    const invs = [{ token: 'a', project_name: 'A' }, { token: 'b', project_name: 'B' }, { token: 'c', project_name: 'C' }];

    it('moves the invitation the user arrived for to the front', () => {
        expect(orderInvitations(invs, 'b').map(i => i.token)).toEqual(['b', 'a', 'c']);
    });

    it('keeps the order when the token matches none of the user\'s invitations', () => {
        expect(orderInvitations(invs, 'zzz')).toEqual(invs);
        expect(orderInvitations(invs, null)).toEqual(invs);
    });
});
