import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { registerAuthRoutes } from '../../../src/routes/auth';

describe('Auth Routes Unit Tests', () => {
  let app: Hono<any>;
  let mockAuthService: any;

  beforeEach(() => {
    app = new Hono();

    // Mock the AuthService to intercept calls
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
      generatePasskeyRegistrationOptions: vi.fn(),
      verifyPasskeyRegistration: vi.fn(),
      generatePasskeyLoginOptions: vi.fn(),
      verifyPasskeyLogin: vi.fn(),
      getPasskeys: vi.fn(),
      deletePasskey: vi.fn(),
      updateAdminUserPlan: vi.fn(),
      handleGithubLogin: vi.fn(),
      handleGithubCallback: vi.fn(),
      exchangeOauthToken: vi.fn(),
      registerGuestStep1: vi.fn(),
      registerGuest: vi.fn()
    };

    const mockFactory = () => mockAuthService;
    
    // Stub env
    app.use('*', async (c, next) => {
      if (!c.env) c.env = {} as any;
      if (!c.env.JWT_SECRET) c.env.JWT_SECRET = 'test-secret';
      if (!c.env.TURNSTILE_SECRET) c.env.TURNSTILE_SECRET = 'test-turnstile';
      await next();
    });

    registerAuthRoutes(app, mockFactory);
  });

  describe('POST /api/auth/register', () => {
    it('should reject missing username or password', async () => {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'testuser' }) // Missing password
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Missing username or password');
    });

    it('should reject usernames that are too short', async () => {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'ab', password: 'securepassword123' })
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Username must be 3-20 characters long');
    });

    it('should reject malicious usernames with special characters (SQL/XSS attempt)', async () => {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: "admin' OR 1=1--", password: 'securepassword123' })
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('only letters, numbers, underscores, or hyphens');
    });

    it('should reject passwords shorter than 12 characters', async () => {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'testuser', password: 'shortpass' })
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toContain('Password must be at least 12 characters long');
    });

    it('should reject invalid email format', async () => {
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'testuser', password: 'securepassword123', email: 'invalid-email' })
      });
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Invalid email format');
    });

    it('should call service register on valid payload', async () => {
      mockAuthService.register.mockResolvedValue({ status: 'ok', id: '123' });
      const res = await app.request('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'testuser', password: 'securepassword123' })
      });
      expect(res.status).toBe(200);
      expect(mockAuthService.register).toHaveBeenCalled();
    });
  });

  describe('POST /api/auth/login', () => {
    it('should reject missing token, password or nonce (if not test env)', async () => {
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'securepassword123' }) // missing token/nonce
      }, { JWT_SECRET: 'live-secret', TURNSTILE_SECRET: 'test-turnstile' });
      
      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBe('Missing token, password, or nonce');
    });

    it('should properly format error responses from the service (e.g. rate limit)', async () => {
      mockAuthService.login.mockRejectedValue(new Error('Account temporarily locked due to too many failed attempts|429|120'));
      const res = await app.request('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'testuser', token: 'token', password: 'pw', nonce: 1 })
      });
      expect(res.status).toBe(429);
      const json = await res.json();
      expect(json.error).toBe('Account temporarily locked due to too many failed attempts');
      expect(json.retry_after).toBe(120);
    });
  });
});
