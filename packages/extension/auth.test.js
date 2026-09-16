import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import SwazzScope from './scope.js';
import background from './background.js';

describe('Auth & Origin Security (B6 fix)', () => {
    describe('isAuthOriginAllowed', () => {
        it('accepts localhost:5173 over http and https', () => {
            expect(SwazzScope.isAuthOriginAllowed('http://localhost:5173')).toBe(true);
            expect(SwazzScope.isAuthOriginAllowed('http://localhost:5173/')).toBe(true);
            expect(SwazzScope.isAuthOriginAllowed('http://localhost:5173/dashboard')).toBe(true);
            expect(SwazzScope.isAuthOriginAllowed('https://localhost:5173')).toBe(true);
        });

        it('accepts swazz.secmy.app and subdomains over https', () => {
            expect(SwazzScope.isAuthOriginAllowed('https://swazz.secmy.app')).toBe(true);
            expect(SwazzScope.isAuthOriginAllowed('https://swazz.secmy.app/')).toBe(true);
            expect(SwazzScope.isAuthOriginAllowed('https://app.swazz.secmy.app')).toBe(true);
            expect(SwazzScope.isAuthOriginAllowed('https://staging.swazz.secmy.app/auth')).toBe(true);
        });

        it('rejects swazz.secmy.app over plaintext http', () => {
            expect(SwazzScope.isAuthOriginAllowed('http://swazz.secmy.app')).toBe(false);
            expect(SwazzScope.isAuthOriginAllowed('http://app.swazz.secmy.app')).toBe(false);
        });

        it('rejects localhost with other ports', () => {
            expect(SwazzScope.isAuthOriginAllowed('http://localhost:3000')).toBe(false);
            expect(SwazzScope.isAuthOriginAllowed('http://localhost:8080')).toBe(false);
            expect(SwazzScope.isAuthOriginAllowed('http://localhost:51730')).toBe(false);
        });

        it('rejects arbitrary domains and spoofing attempts', () => {
            expect(SwazzScope.isAuthOriginAllowed('https://evil-swazz.secmy.app')).toBe(false);
            expect(SwazzScope.isAuthOriginAllowed('https://swazz.secmy.app.attacker.com')).toBe(false);
            expect(SwazzScope.isAuthOriginAllowed('https://attacker.com')).toBe(false);
            expect(SwazzScope.isAuthOriginAllowed('https://google.com')).toBe(false);
        });

        it('handles null, undefined, empty, and invalid URLs safely', () => {
            expect(SwazzScope.isAuthOriginAllowed(null)).toBe(false);
            expect(SwazzScope.isAuthOriginAllowed(undefined)).toBe(false);
            expect(SwazzScope.isAuthOriginAllowed('')).toBe(false);
            expect(SwazzScope.isAuthOriginAllowed('not-a-valid-url')).toBe(false);
        });
    });

    describe('auth_sync message handler in background.js', () => {
        let originalChrome;
        let storageSetSpy;

        beforeEach(() => {
            originalChrome = globalThis.chrome;
            storageSetSpy = vi.fn();
            globalThis.chrome = {
                storage: {
                    local: {
                        set: storageSetSpy
                    }
                }
            };
        });

        afterEach(() => {
            globalThis.chrome = originalChrome;
        });

        it('accepts auth_sync from localhost:5173 when swazzUrl matches sender origin', () => {
            const message = {
                source: 'swazz-detector',
                type: 'auth_sync',
                data: {
                    token: 'tok-123',
                    userProfile: { name: 'Alice' },
                    swazzUrl: 'http://localhost:5173'
                }
            };
            const sender = {
                tab: {
                    id: 1,
                    url: 'http://localhost:5173/dashboard'
                }
            };

            background.handleRuntimeMessage(message, sender);

            expect(storageSetSpy).toHaveBeenCalledWith({
                token: 'tok-123',
                userProfile: { name: 'Alice' },
                swazzUrl: 'http://localhost:5173'
            });
        });

        it('accepts auth_sync from https://swazz.secmy.app when swazzUrl matches sender origin', () => {
            const message = {
                source: 'swazz-detector',
                type: 'auth_sync',
                data: {
                    token: 'tok-cloud',
                    userProfile: { name: 'Bob' },
                    swazzUrl: 'https://swazz.secmy.app'
                }
            };
            const sender = {
                tab: {
                    id: 2,
                    url: 'https://swazz.secmy.app/settings'
                }
            };

            background.handleRuntimeMessage(message, sender);

            expect(storageSetSpy).toHaveBeenCalledWith({
                token: 'tok-cloud',
                userProfile: { name: 'Bob' },
                swazzUrl: 'https://swazz.secmy.app'
            });
        });

        it('rejects auth_sync when sender origin does not match swazzUrl', () => {
            const message = {
                source: 'swazz-detector',
                type: 'auth_sync',
                data: {
                    token: 'tok-spoofed',
                    userProfile: { name: 'Mallory' },
                    swazzUrl: 'https://attacker.com'
                }
            };
            const sender = {
                tab: {
                    id: 3,
                    url: 'https://swazz.secmy.app/settings'
                }
            };

            background.handleRuntimeMessage(message, sender);

            expect(storageSetSpy).not.toHaveBeenCalled();
        });

        it('rejects auth_sync from unauthorized origin even if swazzUrl matches sender origin', () => {
            const message = {
                source: 'swazz-detector',
                type: 'auth_sync',
                data: {
                    token: 'tok-evil',
                    userProfile: { name: 'Evil' },
                    swazzUrl: 'https://evil.example.com'
                }
            };
            const sender = {
                tab: {
                    id: 4,
                    url: 'https://evil.example.com/app'
                }
            };

            background.handleRuntimeMessage(message, sender);

            expect(storageSetSpy).not.toHaveBeenCalled();
        });

        it('rejects auth_sync when sender tab or tab.url is missing', () => {
            const message = {
                source: 'swazz-detector',
                type: 'auth_sync',
                data: {
                    token: 'tok-orphan',
                    userProfile: {},
                    swazzUrl: 'http://localhost:5173'
                }
            };

            background.handleRuntimeMessage(message, {});
            expect(storageSetSpy).not.toHaveBeenCalled();

            background.handleRuntimeMessage(message, { tab: {} });
            expect(storageSetSpy).not.toHaveBeenCalled();
        });
    });
});
