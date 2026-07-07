import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { registerAuthRoutes } from '../../../src/routes/auth';
import { Env } from '../../../src/env';

// Mock getUserIdFromRequest so we can test authenticated routes easily
vi.mock('../../../src/utils/auth', async (importOriginal) => {
  const actual = await importOriginal<any>();
  return {
    ...actual,
    getUserIdFromRequest: vi.fn(async (c: any) => {
      const auth = c.req.header('Authorization');
      if (auth === 'Bearer valid') return 'user_123';
      return null;
    }),
  };
});

describe('Auth Routes Unit Tests', () => {
  let app: Hono<{ Bindings: Env }>;
  let mockAuthService: any;

  beforeEach(() => {
    app = new Hono<{ Bindings: Env }>();

    mockAuthService = {
      register: vi.fn(),
      loginStep1: vi.fn(),
      login: vi.fn(),
      getMe: vi.fn(),
      updatePublicKey: vi.fn(),
      regenerateApiKey: vi.fn(),
      deleteUser: vi.fn(),
      cancelDeleteUser: vi.fn(),
      setup2FA: vi.fn(),
      verify2FA: vi.fn(),
      disable2FA: vi.fn(),
      get2FAStatus: vi.fn(),
      require2FA: vi.fn(),
      generatePasskeyRegistrationOptions: vi.fn(),
      verifyPasskeyRegistration: vi.fn(),
      generatePasskeyLoginOptions: vi.fn(),
      verifyPasskeyLogin: vi.fn(),
      deletePasskey: vi.fn(),
      getPasskeys: vi.fn(),
      handleGithubLogin: vi.fn(),
      handleGithubCallback: vi.fn(),
      exchangeOauthToken: vi.fn(),
      registerGuestStep1: vi.fn(),
      registerGuest: vi.fn(),
      updateAdminUserPlan: vi.fn()
    };

    app.use('*', async (c, next) => {
      c.env = { JWT_SECRET: 'test-secret', TURNSTILE_SECRET: 'test-turnstile' } as unknown as Env;
      await next();
    });

    registerAuthRoutes(app, () => mockAuthService);
  });

  // POST /api/auth/register
  describe('POST /api/auth/register', () => {
    it('missing username or password', async () => {
      const res = await app.request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'u' }) });
      expect(res.status).toBe(400);
    });
    it('invalid username chars', async () => {
      const res = await app.request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: '!!', password: 'securepassword123' }) });
      expect(res.status).toBe(400);
    });
    it('short password', async () => {
      const res = await app.request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'user', password: 'pw' }) });
      expect(res.status).toBe(400);
    });
    it('invalid email', async () => {
      const res = await app.request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'user', password: 'securepassword123', email: 'e' }) });
      expect(res.status).toBe(400);
    });
    it('handles service error', async () => {
      mockAuthService.register.mockRejectedValue(new Error('err|409'));
      const res = await app.request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'user', password: 'securepassword123' }) });
      expect(res.status).toBe(409);
    });
    it('handles service internal error', async () => {
      mockAuthService.register.mockRejectedValue(new Error('err'));
      const res = await app.request('/api/auth/register', { method: 'POST', body: JSON.stringify({ username: 'user', password: 'securepassword123' }) });
      expect(res.status).toBe(500);
    });
  });

  // POST /api/auth/guest/step1
  describe('POST /api/auth/guest/step1', () => {
    it('handles valid request', async () => {
      mockAuthService.registerGuestStep1.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/auth/guest/step1', { method: 'POST' });
      expect(res.status).toBe(200);
    });
    it('reads turnstile token if configured', async () => {
      const liveApp = new Hono<{ Bindings: Env }>();
      liveApp.use('*', async (c, next) => { c.env = { TURNSTILE_SECRET: 'a', JWT_SECRET: 'live' } as any; await next(); });
      registerAuthRoutes(liveApp, () => mockAuthService);
      mockAuthService.registerGuestStep1.mockResolvedValue({ status: 'ok' });
      const res = await liveApp.request('/api/auth/guest/step1', { method: 'POST', body: JSON.stringify({ 'cf-turnstile-response': 'tok' }) });
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockAuthService.registerGuestStep1.mockRejectedValue(new Error('err|500'));
      const res = await app.request('/api/auth/guest/step1', { method: 'POST' });
      expect(res.status).toBe(500);
    });
  });

  // POST /api/auth/guest
  describe('POST /api/auth/guest', () => {
    it('missing token/nonce', async () => {
      const res = await app.request('/api/auth/guest', { method: 'POST', body: JSON.stringify({}) });
      expect(res.status).toBe(400);
    });
    it('handles valid request', async () => {
      mockAuthService.registerGuest.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/auth/guest', { method: 'POST', body: JSON.stringify({ token: 't', nonce: 1 }) });
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockAuthService.registerGuest.mockRejectedValue(new Error('err|500'));
      const res = await app.request('/api/auth/guest', { method: 'POST', body: JSON.stringify({ token: 't', nonce: 1 }) });
      expect(res.status).toBe(500);
    });
  });

  // GET /api/auth/me
  describe('GET /api/auth/me', () => {
    it('returns 401 if unauthorized', async () => {
      const res = await app.request('/api/auth/me');
      expect(res.status).toBe(401);
    });
    it('returns 200 with user data', async () => {
      mockAuthService.getMe.mockResolvedValue({ id: 'user_123' });
      const res = await app.request('/api/auth/me', { headers: { 'Authorization': 'Bearer valid' } });
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockAuthService.getMe.mockRejectedValue(new Error('err|500'));
      const res = await app.request('/api/auth/me', { headers: { 'Authorization': 'Bearer valid' } });
      expect(res.status).toBe(500);
    });
  });

  // POST /api/auth/public-key
  describe('POST /api/auth/public-key', () => {
    it('returns 401 if unauthorized', async () => {
      const res = await app.request('/api/auth/public-key', { method: 'POST' });
      expect(res.status).toBe(401);
    });
    it('returns 400 if public key format invalid', async () => {
      const res = await app.request('/api/auth/public-key', { method: 'POST', headers: { 'Authorization': 'Bearer valid' }, body: JSON.stringify({ public_key: 'invalid' }) });
      expect(res.status).toBe(400);
    });
    it('returns 200 on success', async () => {
      mockAuthService.updatePublicKey.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/auth/public-key', { method: 'POST', headers: { 'Authorization': 'Bearer valid' }, body: JSON.stringify({ public_key: '0'.repeat(64) }) });
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockAuthService.updatePublicKey.mockRejectedValue(new Error('err'));
      const res = await app.request('/api/auth/public-key', { method: 'POST', headers: { 'Authorization': 'Bearer valid' }, body: JSON.stringify({ public_key: '0'.repeat(64) }) });
      expect(res.status).toBe(500);
    });
  });

  // POST /api/auth/regenerate-key
  describe('POST /api/auth/regenerate-key', () => {
    it('returns 401 if unauthorized', async () => {
      const res = await app.request('/api/auth/regenerate-key', { method: 'POST' });
      expect(res.status).toBe(401);
    });
    it('returns 200 on success', async () => {
      mockAuthService.regenerateApiKey.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/auth/regenerate-key', { method: 'POST', headers: { 'Authorization': 'Bearer valid' } });
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockAuthService.regenerateApiKey.mockRejectedValue(new Error('err|500'));
      const res = await app.request('/api/auth/regenerate-key', { method: 'POST', headers: { 'Authorization': 'Bearer valid' } });
      expect(res.status).toBe(500);
    });
  });

  // POST /api/auth/login/step1
  describe('POST /api/auth/login/step1', () => {
    it('missing username', async () => {
      const res = await app.request('/api/auth/login/step1', { method: 'POST', body: JSON.stringify({}) });
      expect(res.status).toBe(400);
    });
    it('success', async () => {
      mockAuthService.loginStep1.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/auth/login/step1', { method: 'POST', body: JSON.stringify({ username: 'u' }) });
      expect(res.status).toBe(200);
    });
    it('error', async () => {
      mockAuthService.loginStep1.mockRejectedValue(new Error('err|500'));
      const res = await app.request('/api/auth/login/step1', { method: 'POST', body: JSON.stringify({ username: 'u' }) });
      expect(res.status).toBe(500);
    });
  });

  // POST /api/auth/login
  describe('POST /api/auth/login', () => {
    it('missing properties in live env', async () => {
      const liveApp = new Hono<{ Bindings: Env }>();
      liveApp.use('*', async (c, next) => { c.env = { JWT_SECRET: 'live' } as any; await next(); });
      registerAuthRoutes(liveApp, () => mockAuthService);
      const res = await liveApp.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: 'pw' }) });
      expect(res.status).toBe(400);
    });
    it('success', async () => {
      mockAuthService.login.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'u', password: 'p' }) });
      expect(res.status).toBe(200);
    });
    it('error with retry_after', async () => {
      mockAuthService.login.mockRejectedValue(new Error('err|429|120'));
      const res = await app.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: 'u', password: 'p' }) });
      expect(res.status).toBe(429);
      expect((await res.json()).retry_after).toBe(120);
    });
  });

  // DELETE /api/users/me
  describe('DELETE /api/users/me', () => {
    it('returns 401 if unauthorized', async () => {
      const res = await app.request('/api/users/me', { method: 'DELETE' });
      expect(res.status).toBe(401);
    });
    it('returns 200 on success', async () => {
      mockAuthService.deleteUser.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/users/me', { method: 'DELETE', headers: { 'Authorization': 'Bearer valid' } });
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockAuthService.deleteUser.mockRejectedValue(new Error('err|500'));
      const res = await app.request('/api/users/me', { method: 'DELETE', headers: { 'Authorization': 'Bearer valid' } });
      expect(res.status).toBe(500);
    });
  });

  // POST /api/users/me/cancel-deletion
  describe('POST /api/users/me/cancel-deletion', () => {
    it('returns 401 if unauthorized', async () => {
      const res = await app.request('/api/users/me/cancel-deletion', { method: 'POST' });
      expect(res.status).toBe(401);
    });
    it('returns 200 on success', async () => {
      mockAuthService.cancelDeleteUser.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/users/me/cancel-deletion', { method: 'POST', headers: { 'Authorization': 'Bearer valid' } });
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockAuthService.cancelDeleteUser.mockRejectedValue(new Error('err|500'));
      const res = await app.request('/api/users/me/cancel-deletion', { method: 'POST', headers: { 'Authorization': 'Bearer valid' } });
      expect(res.status).toBe(500);
    });
  });

  // POST /api/auth/2fa/setup
  describe('POST /api/auth/2fa/setup', () => {
    it('returns 401 if unauthorized', async () => {
      const res = await app.request('/api/auth/2fa/setup', { method: 'POST' });
      expect(res.status).toBe(401);
    });
    it('missing password', async () => {
      const res = await app.request('/api/auth/2fa/setup', { method: 'POST', headers: { 'Authorization': 'Bearer valid' }, body: JSON.stringify({}) });
      expect(res.status).toBe(400);
    });
    it('returns 200 on success', async () => {
      mockAuthService.setup2FA.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/auth/2fa/setup', { method: 'POST', headers: { 'Authorization': 'Bearer valid' }, body: JSON.stringify({ password: 'pw' }) });
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockAuthService.setup2FA.mockRejectedValue(new Error('err|500'));
      const res = await app.request('/api/auth/2fa/setup', { method: 'POST', headers: { 'Authorization': 'Bearer valid' }, body: JSON.stringify({ password: 'pw' }) });
      expect(res.status).toBe(500);
    });
  });

  // POST /api/auth/2fa/verify
  describe('POST /api/auth/2fa/verify', () => {
    it('returns 401 if unauthorized', async () => {
      const res = await app.request('/api/auth/2fa/verify', { method: 'POST' });
      expect(res.status).toBe(401);
    });
    it('missing token', async () => {
      const res = await app.request('/api/auth/2fa/verify', { method: 'POST', headers: { 'Authorization': 'Bearer valid' }, body: JSON.stringify({}) });
      expect(res.status).toBe(400);
    });
    it('success', async () => {
      mockAuthService.verify2FA.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/auth/2fa/verify', { method: 'POST', headers: { 'Authorization': 'Bearer valid' }, body: JSON.stringify({ code: '123', password: 'pw' }) });
      expect(res.status).toBe(200);
    });
    it('error', async () => {
      mockAuthService.verify2FA.mockRejectedValue(new Error('err|500'));
      const res = await app.request('/api/auth/2fa/verify', { method: 'POST', headers: { 'Authorization': 'Bearer valid' }, body: JSON.stringify({ code: '123', password: 'pw' }) });
      expect(res.status).toBe(500);
    });
  });

  // POST /api/auth/2fa/disable
  describe('POST /api/auth/2fa/disable', () => {
    it('returns 401 if unauthorized', async () => {
      const res = await app.request('/api/auth/2fa/disable', { method: 'POST' });
      expect(res.status).toBe(401);
    });
    it('missing token', async () => {
      const res = await app.request('/api/auth/2fa/disable', { method: 'POST', headers: { 'Authorization': 'Bearer valid' }, body: JSON.stringify({}) });
      expect(res.status).toBe(400);
    });
    it('success', async () => {
      mockAuthService.disable2FA.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/auth/2fa/disable', { method: 'POST', headers: { 'Authorization': 'Bearer valid' }, body: JSON.stringify({ code: '123', password: 'pw' }) });
      expect(res.status).toBe(200);
    });
    it('error', async () => {
      mockAuthService.disable2FA.mockRejectedValue(new Error('err|500'));
      const res = await app.request('/api/auth/2fa/disable', { method: 'POST', headers: { 'Authorization': 'Bearer valid' }, body: JSON.stringify({ code: '123', password: 'pw' }) });
      expect(res.status).toBe(500);
    });
  });



  // GET /api/auth/passkeys/register/generate-options
  describe('POST /api/auth/passkeys/register/generate-options', () => {
    it('returns 401 if unauthorized', async () => {
      const res = await app.request('/api/auth/passkeys/register/generate-options', { method: 'POST' });
      expect(res.status).toBe(401);
    });
    it('returns 200 on success', async () => {
      mockAuthService.generatePasskeyRegistrationOptions.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/auth/passkeys/register/generate-options', { method: 'POST', headers: { 'Authorization': 'Bearer valid' } });
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockAuthService.generatePasskeyRegistrationOptions.mockRejectedValue(new Error('err|500'));
      const res = await app.request('/api/auth/passkeys/register/generate-options', { method: 'POST', headers: { 'Authorization': 'Bearer valid' } });
      expect(res.status).toBe(500);
    });
  });

  // POST /api/auth/passkeys/register/verify
  describe('POST /api/auth/passkeys/register/verify', () => {
    it('returns 401 if unauthorized', async () => {
      const res = await app.request('/api/auth/passkeys/register/verify', { method: 'POST' });
      expect(res.status).toBe(401);
    });
    it('success', async () => {
      mockAuthService.verifyPasskeyRegistration.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/auth/passkeys/register/verify', { method: 'POST', headers: { 'Authorization': 'Bearer valid' }, body: JSON.stringify({}) });
      expect(res.status).toBe(200);
    });
    it('error', async () => {
      mockAuthService.verifyPasskeyRegistration.mockRejectedValue(new Error('err|500'));
      const res = await app.request('/api/auth/passkeys/register/verify', { method: 'POST', headers: { 'Authorization': 'Bearer valid' }, body: JSON.stringify({}) });
      expect(res.status).toBe(500);
    });
  });

  // POST /api/auth/passkeys/login/generate-options
  describe('POST /api/auth/passkeys/login/generate-options', () => {
    it('missing username', async () => {
      const res = await app.request('/api/auth/passkeys/login/generate-options', { method: 'POST', body: JSON.stringify({}) });
      expect(res.status).toBe(400);
    });
    it('success', async () => {
      mockAuthService.generatePasskeyLoginOptions.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/auth/passkeys/login/generate-options', { method: 'POST', body: JSON.stringify({ username: 'u' }) });
      expect(res.status).toBe(200);
    });
    it('error', async () => {
      mockAuthService.generatePasskeyLoginOptions.mockRejectedValue(new Error('err|500'));
      const res = await app.request('/api/auth/passkeys/login/generate-options', { method: 'POST', body: JSON.stringify({ username: 'u' }) });
      expect(res.status).toBe(500);
    });
  });

  // POST /api/auth/passkeys/login/verify
  describe('POST /api/auth/passkeys/login/verify', () => {
    it('missing username', async () => {
      const res = await app.request('/api/auth/passkeys/login/verify', { method: 'POST', body: JSON.stringify({}) });
      expect(res.status).toBe(400);
    });
    it('success', async () => {
      mockAuthService.verifyPasskeyLogin.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/auth/passkeys/login/verify', { method: 'POST', body: JSON.stringify({ id: 'c', response: {} }) });
      expect(res.status).toBe(200);
    });
    it('error', async () => {
      mockAuthService.verifyPasskeyLogin.mockRejectedValue(new Error('err|500'));
      const res = await app.request('/api/auth/passkeys/login/verify', { method: 'POST', body: JSON.stringify({ id: 'c', response: {} }) });
      expect(res.status).toBe(500);
    });
  });

  // GET /api/auth/passkeys
  describe('GET /api/auth/passkeys', () => {
    it('returns 401 if unauthorized', async () => {
      const res = await app.request('/api/auth/passkeys');
      expect(res.status).toBe(401);
    });
    it('returns 200 on success', async () => {
      mockAuthService.getPasskeys.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/auth/passkeys', { headers: { 'Authorization': 'Bearer valid' } });
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockAuthService.getPasskeys.mockRejectedValue(new Error('err|500'));
      const res = await app.request('/api/auth/passkeys', { headers: { 'Authorization': 'Bearer valid' } });
      expect(res.status).toBe(500);
    });
  });

  // DELETE /api/auth/passkeys/:id
  describe('DELETE /api/auth/passkeys/:id', () => {
    it('returns 401 if unauthorized', async () => {
      const res = await app.request('/api/auth/passkeys/123', { method: 'DELETE' });
      expect(res.status).toBe(401);
    });
    it('returns 200 on success', async () => {
      mockAuthService.deletePasskey.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/auth/passkeys/123', { method: 'DELETE', headers: { 'Authorization': 'Bearer valid' } });
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      mockAuthService.deletePasskey.mockRejectedValue(new Error('err|500'));
      const res = await app.request('/api/auth/passkeys/123', { method: 'DELETE', headers: { 'Authorization': 'Bearer valid' } });
      expect(res.status).toBe(500);
    });
  });

  describe('POST /api/admin/users/plan', () => {
    it('returns 401 if missing admin secret in env', async () => {
      const liveApp = new Hono<{ Bindings: Env }>();
      liveApp.use('*', async (c, next) => { c.env = {} as any; await next(); });
      registerAuthRoutes(liveApp, () => mockAuthService);
      const res = await liveApp.request('/api/admin/users/plan', { method: 'POST' });
      expect(res.status).toBe(401);
    });
    it('handles success', async () => {
      const liveApp = new Hono<{ Bindings: Env }>();
      liveApp.use('*', async (c, next) => { c.env = { ADMIN_SECRET: 'admin' } as any; await next(); });
      registerAuthRoutes(liveApp, () => mockAuthService);
      mockAuthService.updateAdminUserPlan.mockResolvedValue({ status: 'ok' });
      const res = await liveApp.request('/api/admin/users/plan', { method: 'POST', headers: { 'X-Admin-Secret': 'admin' }, body: JSON.stringify({}) });
      expect(res.status).toBe(200);
    });
    it('handles error', async () => {
      const liveApp = new Hono<{ Bindings: Env }>();
      liveApp.use('*', async (c, next) => { c.env = { ADMIN_SECRET: 'admin' } as any; await next(); });
      registerAuthRoutes(liveApp, () => mockAuthService);
      mockAuthService.updateAdminUserPlan.mockRejectedValue(new Error('err|500'));
      const res = await liveApp.request('/api/admin/users/plan', { method: 'POST', headers: { 'Authorization': 'Bearer admin' }, body: JSON.stringify({}) });
      expect(res.status).toBe(500);
    });
  });

  describe('Github Auth', () => {
    it('GET /api/auth/login/github success', async () => {
      mockAuthService.handleGithubLogin.mockResolvedValue('https://github.com/login');
      const res = await app.request('/api/auth/login/github');
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('https://github.com/login');
    });
    it('GET /api/auth/login/github with token', async () => {
      mockAuthService.handleGithubLogin.mockResolvedValue('https://github.com/login');
      const res = await app.request('/api/auth/login/github', { headers: { 'Authorization': 'Bearer valid' } });
      expect(res.status).toBe(302);
    });
    it('GET /api/auth/login/github error', async () => {
      mockAuthService.handleGithubLogin.mockRejectedValue(new Error('err|500'));
      const res = await app.request('/api/auth/login/github');
      expect(res.status).toBe(500);
    });
    
    it('GET /api/auth/callback/github success', async () => {
      mockAuthService.handleGithubCallback.mockResolvedValue({ redirectUrl: 'http://localhost:5173' });
      const res = await app.request('/api/auth/callback/github?code=123&state=state123');
      expect(res.status).toBe(302);
      expect(res.headers.get('Location')).toBe('http://localhost:5173');
    });
    it('GET /api/auth/callback/github live origin', async () => {
      const liveApp = new Hono<{ Bindings: Env }>();
      liveApp.use('*', async (c, next) => { c.env = { JWT_SECRET: 'live' } as any; await next(); });
      registerAuthRoutes(liveApp, () => mockAuthService);
      mockAuthService.handleGithubCallback.mockResolvedValue({ redirectUrl: 'http://example.com' });
      const res = await liveApp.request('http://example.com/api/auth/callback/github?code=123&state=state123');
      expect(res.status).toBe(302);
    });
    it('GET /api/auth/callback/github missing code', async () => {
      const res = await app.request('/api/auth/callback/github');
      expect(res.status).toBe(302); // Redirects to /?error=...
    });
    it('GET /api/auth/callback/github error', async () => {
      mockAuthService.handleGithubCallback.mockRejectedValue(new Error('err|500'));
      const res = await app.request('/api/auth/callback/github?code=123&state=state123');
      expect(res.status).toBe(302);
    });

    it('POST /api/auth/oauth/exchange success', async () => {
      mockAuthService.exchangeOauthToken.mockResolvedValue({ status: 'ok' });
      const res = await app.request('/api/auth/oauth/exchange', { method: 'POST', body: JSON.stringify({ code: 't' }) });
      expect(res.status).toBe(200);
    });
    it('POST /api/auth/oauth/exchange missing token', async () => {
      const res = await app.request('/api/auth/oauth/exchange', { method: 'POST', body: JSON.stringify({}) });
      expect(res.status).toBe(400);
    });
    it('POST /api/auth/oauth/exchange error', async () => {
      mockAuthService.exchangeOauthToken.mockRejectedValue(new Error('err|500'));
      const res = await app.request('/api/auth/oauth/exchange', { method: 'POST', body: JSON.stringify({ code: 't' }) });
      expect(res.status).toBe(500);
    });
  });
});
