// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Hono } from 'hono';
import { Env, AppEnv } from '../env';
import { getUserIdFromRequest, getClientIp } from '../utils/auth';
import { errorStatus } from '../utils/http';
import { IAuthService, AuthService } from '../services/auth';
import { AuthRepository } from '../repositories/auth';
import { LicenseService } from '../services/license';
import { ValidationError, isValidId, isValidCredentialId, LIMITS, readJsonBody, reqString, optString } from '../utils/validation';

export function registerAuthRoutes(
  app: Hono<AppEnv>,
  authServicesFactory: (env: Env) => IAuthService = (env) => new AuthService(env, new AuthRepository(env)),
  licenseServiceFactory: (env: Env) => { verifyToken(token: string): Promise<any> } = (env) => new LicenseService(env, new AuthRepository(env))
) {
  app.post('/api/auth/register', async (c) => {
    try {
      const body = await readJsonBody(c);
      if (typeof body.username !== 'string' || typeof body.password !== 'string') {
        return c.json({ error: 'Missing username or password' }, 400);
      }

      const usernameRegex = /^[a-zA-Z0-9_\-]{3,20}$/;
      if (!usernameRegex.test(body.username.trim())) {
        return c.json({ error: 'Username must be 3-20 characters long and contain only letters, numbers, underscores, or hyphens' }, 400);
      }
      if (body.password.length < 12) {
        return c.json({ error: 'Password must be at least 12 characters long' }, 400);
      }
      reqString(body.password, 'password', LIMITS.PASSWORD, 12);
      if (body.email) {
        optString(body.email, 'email', LIMITS.EMAIL);
        if (typeof body.email === 'string') {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(body.email.trim())) {
            return c.json({ error: 'Invalid email format' }, 400);
          }
        }
      }
      optString(body['cf-turnstile-response'], 'cf-turnstile-response', LIMITS.SHORT_TEXT);

      const services = authServicesFactory(c.env);
      const turnstileToken = body['cf-turnstile-response'] as string | undefined;
      const remoteip = c.req.header('CF-Connecting-IP') ?? undefined;

      const result = await services.register(body, turnstileToken, remoteip, c);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('register error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.get('/api/auth/verify-email', async (c) => {
    const frontendBase = 'https://swazz.secmy.app';
    try {
      const token = c.req.query('token');
      if (!token) {
        return c.redirect(`${frontendBase}/verify-email?error=${encodeURIComponent('Missing verification token')}`);
      }
      optString(token, 'token', LIMITS.SHORT_TEXT);
      const services = authServicesFactory(c.env);
      const result = await services.verifyEmail(token);
      return c.redirect(`${frontendBase}/verify-email?status=verified&email=${encodeURIComponent(result.email || '')}`);
    } catch (err: any) {
      const [msg] = (err instanceof Error ? err.message : String(err)).split('|');
      return c.redirect(`${frontendBase}/verify-email?error=${encodeURIComponent(msg || 'Verification failed')}`);
    }
  });

  app.post('/api/auth/resend-verification', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) {
        return c.json({ error: 'Unauthorized' }, 401);
      }

      const body = await readJsonBody(c, { optional: true });
      optString(body['cf-turnstile-response'], 'cf-turnstile-response', LIMITS.SHORT_TEXT);
      const turnstileToken = body['cf-turnstile-response'] as string | undefined;
      const remoteip = c.req.header('CF-Connecting-IP') ?? undefined;

      const services = authServicesFactory(c.env);
      const result = await services.resendVerificationEmail(userId, turnstileToken, remoteip);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('resendVerificationEmail error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.post('/api/auth/guest/step1', async (c) => {
    try {
      const services = authServicesFactory(c.env);
      const clientIp = getClientIp(c);
      
      let turnstileToken: string | undefined;
      if (c.env.TURNSTILE_SECRET && c.env.JWT_SECRET !== 'test-secret') {
        const body = await readJsonBody(c, { optional: true });
        optString(body['cf-turnstile-response'], 'cf-turnstile-response', LIMITS.SHORT_TEXT);
        turnstileToken = body['cf-turnstile-response'] as string | undefined;
      }
      const remoteip = c.req.header('CF-Connecting-IP') ?? undefined;

      const result = await services.registerGuestStep1(clientIp, turnstileToken, remoteip);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('registerGuestStep1 error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.post('/api/auth/guest', async (c) => {
    try {
      const body = await readJsonBody(c);
      if (!body.token || body.nonce === undefined) {
        return c.json({ error: 'Missing challenge token or nonce' }, 400);
      }
      reqString(body.token, 'token', LIMITS.SHORT_TEXT);
      optString(body['cf-turnstile-response'], 'cf-turnstile-response', LIMITS.SHORT_TEXT);

      const services = authServicesFactory(c.env);
      const turnstileToken = body['cf-turnstile-response'] as string | undefined;
      const remoteip = c.req.header('CF-Connecting-IP') ?? undefined;

      const result = await services.registerGuest(body, turnstileToken, remoteip, c);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('registerGuest error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.get('/api/auth/me', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const services = authServicesFactory(c.env);
      const result = await services.getMe(userId);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('getMe error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.post('/api/auth/public-key', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const body = await readJsonBody(c);
      optString(body.public_key, 'public_key', LIMITS.SHORT_TEXT);
      const publicKey = body.public_key as string | undefined;
      if (typeof publicKey === 'string' && publicKey !== '') {
        if (!/^[0-9a-fA-F]{64}$/.test(publicKey)) {
          return c.json({ error: 'Invalid public key format. Must be a 64-character hex-encoded string.' }, 400);
        }
      }

      const services = authServicesFactory(c.env);
      const result = await services.updatePublicKey(userId, publicKey);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      console.error('updatePublicKey error:', err);
      return c.json({ error: 'Internal Server Error' }, 500);
    }
  });

  app.post('/api/auth/regenerate-key', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const services = authServicesFactory(c.env);
      const result = await services.regenerateApiKey(userId, c);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('regenerateApiKey error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.post('/api/auth/login/step1', async (c) => {
    try {
      const body = await readJsonBody(c);
      if (!body.username) return c.json({ error: 'Missing username' }, 400);
      reqString(body.username, 'username', LIMITS.USERNAME);
      optString(body['cf-turnstile-response'], 'cf-turnstile-response', LIMITS.SHORT_TEXT);

      const clientIp = getClientIp(c);
      const turnstileToken = body['cf-turnstile-response'] as string | undefined;
      const remoteip = c.req.header('CF-Connecting-IP') ?? undefined;

      const services = authServicesFactory(c.env);
      const result = await services.loginStep1(body, clientIp, turnstileToken, remoteip);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('loginStep1 error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.post('/api/auth/login', async (c) => {
    try {
      const body = await readJsonBody(c);
      const isTestEnv = c.env.JWT_SECRET === 'test-secret';
      if (!isTestEnv) {
        if (!body.token || !body.password || body.nonce === undefined) {
          return c.json({ error: 'Missing token, password, or nonce' }, 400);
        }
      }
      optString(body.token, 'token', LIMITS.SHORT_TEXT);
      optString(body.username, 'username', LIMITS.USERNAME);
      optString(body.password, 'password', LIMITS.PASSWORD);
      optString(body['cf-turnstile-response'], 'cf-turnstile-response', LIMITS.SHORT_TEXT);

      const clientIp = getClientIp(c);
      const turnstileToken = body['cf-turnstile-response'] as string | undefined;
      const remoteip = c.req.header('CF-Connecting-IP') ?? undefined;

      const services = authServicesFactory(c.env);
      const result = await services.login(body, clientIp, turnstileToken, remoteip, c);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status, retry_after] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('login error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      const response: any = { error: msg };
      if (retry_after) response.retry_after = parseInt(retry_after);
      return c.json(response, s);
    }
  });

  app.delete('/api/users/me', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const services = authServicesFactory(c.env);
      const result = await services.deleteUser(userId, c);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('deleteUser error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.post('/api/users/me/cancel-deletion', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const services = authServicesFactory(c.env);
      const result = await services.cancelDeleteUser(userId);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('cancelDeleteUser error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.post('/api/auth/2fa/setup', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const body = await readJsonBody(c);
      if (!body.password) return c.json({ error: 'Missing password verification' }, 400);
      reqString(body.password, 'password', LIMITS.PASSWORD);

      const services = authServicesFactory(c.env);
      const result = await services.setup2FA(userId, body);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('setup2FA error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.post('/api/auth/2fa/verify', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const body = await readJsonBody(c);
      if (!body.code) return c.json({ error: 'Missing 2FA code' }, 400);
      if (!body.password) return c.json({ error: 'Missing password verification' }, 400);
      reqString(body.code, 'code', 32);
      reqString(body.password, 'password', LIMITS.PASSWORD);

      const services = authServicesFactory(c.env);
      const result = await services.verify2FA(userId, body);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('verify2FA error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.post('/api/auth/2fa/disable', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const body = await readJsonBody(c);
      if (!body.code) return c.json({ error: 'Missing 2FA code' }, 400);
      if (!body.password) return c.json({ error: 'Missing password verification' }, 400);
      reqString(body.code, 'code', 32);
      reqString(body.password, 'password', LIMITS.PASSWORD);

      const services = authServicesFactory(c.env);
      const result = await services.disable2FA(userId, body);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('disable2FA error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.post('/api/auth/passkeys/register/generate-options', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const requestOrigin = c.req.header('Origin') || new URL(c.req.url).origin;
      const rpID = new URL(requestOrigin).hostname;

      const services = authServicesFactory(c.env);
      const result = await services.generatePasskeyRegistrationOptions(userId, rpID, c);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('generatePasskeyRegistrationOptions error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.post('/api/auth/passkeys/register/verify', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const body = await readJsonBody(c);
      const requestOrigin = c.req.header('Origin') || new URL(c.req.url).origin;
      const expectedOrigin = requestOrigin;
      const rpID = new URL(requestOrigin).hostname;

      const services = authServicesFactory(c.env);
      const result = await services.verifyPasskeyRegistration(userId, body, expectedOrigin, rpID, c);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('verifyPasskeyRegistration error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  const handleGeneratePasskeyOptions = async (c: any) => {
    try {
      const body = await readJsonBody(c, { optional: true });
      optString(body.username, 'username', LIMITS.USERNAME);

      const clientIp = getClientIp(c);
      const requestOrigin = c.req.header('Origin') || new URL(c.req.url).origin;
      const rpID = new URL(requestOrigin).hostname;

      const services = authServicesFactory(c.env);
      const result = await services.generatePasskeyLoginOptions(body, clientIp, rpID, c);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('generatePasskeyLoginOptions error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  };

  app.post('/api/auth/passkeys/login/generate-options', handleGeneratePasskeyOptions);
  app.post('/api/auth/passkeys/login/options', handleGeneratePasskeyOptions);

  app.post('/api/auth/passkeys/login/verify', async (c) => {
    try {
      const body = await readJsonBody(c);
      if (typeof body.id !== 'string') return c.json({ error: 'Invalid or missing credential ID' }, 400);
      reqString(body.id, 'id', LIMITS.SHORT_TEXT);

      const clientIp = getClientIp(c);
      const requestOrigin = c.req.header('Origin') || new URL(c.req.url).origin;
      const expectedOrigin = requestOrigin;
      const rpID = new URL(requestOrigin).hostname;

      const services = authServicesFactory(c.env);
      const result = await services.verifyPasskeyLogin(body, clientIp, expectedOrigin, rpID, c);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('verifyPasskeyLogin error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.get('/api/auth/passkeys', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const services = authServicesFactory(c.env);
      const result = await services.getPasskeys(userId);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('getPasskeys error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.delete('/api/auth/passkeys/:id', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const id = c.req.param('id');
      if (!isValidCredentialId(id)) return c.json({ error: 'Passkey not found' }, 404);

      const services = authServicesFactory(c.env);
      const result = await services.deletePasskey(userId, id);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('deletePasskey error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.post('/api/admin/users/plan', async (c) => {
    try {
      const adminSecret = c.env.ADMIN_SECRET;
      if (!adminSecret) return c.json({ error: 'Unauthorized: Admin secret is not configured' }, 401);

      const authHeader = c.req.header('X-Admin-Secret') || c.req.header('Authorization');
      const providedSecret = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

      const body = await readJsonBody(c);
      optString(body.userId, 'userId', LIMITS.SHORT_TEXT);
      optString(body.plan, 'plan', LIMITS.SHORT_TEXT);

      const services = authServicesFactory(c.env);
      const result = await services.updateAdminUserPlan(adminSecret, providedSecret, body);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('updateAdminUserPlan error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.get('/api/auth/login/github', async (c) => {
    try {
      let userId: string | null = null;
      try {
        userId = await getUserIdFromRequest(c);
      } catch {}

      const requestUrl = new URL(c.req.url);
      const redirectUri = c.env.GITHUB_REDIRECT_URI || `${requestUrl.origin}/api/auth/callback/github`;

      const services = authServicesFactory(c.env);
      const url = await services.handleGithubLogin(userId, redirectUri);
      return c.redirect(url);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('handleGithubLogin error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.get('/api/auth/callback/github', async (c) => {
    try {
      const code = c.req.query('code');
      const state = c.req.query('state');

      const requestUrl = new URL(c.req.url);
      let frontendUrl = c.env.ALLOWED_ORIGINS && c.env.ALLOWED_ORIGINS !== '*' ? c.env.ALLOWED_ORIGINS.split(',')[0].trim() : '';
      if (!frontendUrl) {
        if (c.env.JWT_SECRET === 'test-secret' || requestUrl.hostname === 'localhost' || requestUrl.hostname === '127.0.0.1' || requestUrl.hostname === '[::1]' || requestUrl.hostname === '::1' || requestUrl.port === '8787') {
          frontendUrl = 'http://localhost:5173';
        } else {
          frontendUrl = requestUrl.origin;
        }
      }
      frontendUrl = frontendUrl.replace(/\/$/, '');

      if (!code || !state) {
        return c.redirect(`${frontendUrl}/?error=${encodeURIComponent('Missing code or state')}`);
      }

      const services = authServicesFactory(c.env);
      const result = await services.handleGithubCallback(code, state, frontendUrl, c);
      return c.redirect(result.redirectUrl);
    } catch (err: any) {
      return c.redirect(`/?error=${encodeURIComponent('Authentication failed. Please try again later.')}`);
    }
  });

  app.get('/api/auth/login/gitlab', async (c) => {
    try {
      let userId: string | null = null;
      try {
        userId = await getUserIdFromRequest(c);
      } catch {}

      const requestUrl = new URL(c.req.url);
      const redirectUri = c.env.GITLAB_REDIRECT_URI || `${requestUrl.origin}/api/auth/callback/gitlab`;

      const services = authServicesFactory(c.env);
      const url = await services.handleGitlabLogin(userId, redirectUri);
      return c.redirect(url);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('handleGitlabLogin error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.get('/api/auth/callback/gitlab', async (c) => {
    try {
      const code = c.req.query('code');
      const state = c.req.query('state');

      const requestUrl = new URL(c.req.url);
      let frontendUrl = c.env.ALLOWED_ORIGINS && c.env.ALLOWED_ORIGINS !== '*' ? c.env.ALLOWED_ORIGINS.split(',')[0].trim() : '';
      if (!frontendUrl) {
        if (c.env.JWT_SECRET === 'test-secret' || requestUrl.hostname === 'localhost' || requestUrl.hostname === '127.0.0.1' || requestUrl.hostname === '[::1]' || requestUrl.hostname === '::1' || requestUrl.port === '8787') {
          frontendUrl = 'http://localhost:5173';
        } else {
          frontendUrl = requestUrl.origin;
        }
      }
      frontendUrl = frontendUrl.replace(/\/$/, '');

      if (!code || !state) {
        return c.redirect(`${frontendUrl}/?error=${encodeURIComponent('Missing code or state')}`);
      }

      const services = authServicesFactory(c.env);
      const result = await services.handleGitlabCallback(code, state, frontendUrl, c);
      return c.redirect(result.redirectUrl);
    } catch (err: any) {
      return c.redirect(`/?error=${encodeURIComponent('Authentication failed. Please try again later.')}`);
    }
  });

  app.post('/api/auth/oauth/exchange', async (c) => {
    try {
      const body = await readJsonBody(c);
      if (typeof body.code !== 'string') return c.json({ error: 'Missing code' }, 400);
      reqString(body.code, 'code', LIMITS.SHORT_TEXT);

      const services = authServicesFactory(c.env);
      const result = await services.exchangeOauthToken(body, c);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('exchangeOauthToken error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.get('/api/user/license', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const licenseService = new LicenseService(c.env, new AuthRepository(c.env));
      const result = await licenseService.getStatus(userId);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('getStatus error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.post('/api/user/license', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const body = await readJsonBody(c);
      if (typeof body.license_key !== 'string' || body.license_key.trim() === '') {
        return c.json({ error: 'Missing license_key' }, 400);
      }
      reqString(body.license_key, 'license_key', LIMITS.SHORT_TEXT);

      const licenseService = new LicenseService(c.env, new AuthRepository(c.env));
      const result = await licenseService.activate(userId, body.license_key);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('activate error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.delete('/api/user/license', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const licenseService = new LicenseService(c.env, new AuthRepository(c.env));
      const result = await licenseService.deactivate(userId);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('deactivate error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.get('/api/user/trial-status', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const licenseService = new LicenseService(c.env, new AuthRepository(c.env));
      const result = await licenseService.getTrialStatus(userId);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('getTrialStatus error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.post('/api/user/trial-license', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const authRepo = new AuthRepository(c.env);
      const user = await authRepo.getUserById(userId);
      if (!user) return c.json({ error: 'User not found' }, 404);
      if (user.is_guest) return c.json({ error: 'Trial licenses are only available for registered accounts' }, 403);

      const licenseService = new LicenseService(c.env, authRepo);
      const result = await licenseService.claimTrial(userId, user.username);
      return c.json(result);
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      const s = errorStatus(status);
      if (s >= 500) {
        console.error('claimTrial error:', err);
        return c.json({ error: 'Internal Server Error' }, 500);
      }
      return c.json({ error: msg }, s);
    }
  });

  app.post('/api/license/verify', async (c) => {
    try {
      const body = await readJsonBody(c);
      if (!body || typeof body.license_key !== 'string' || !body.license_key.trim()) {
        return c.json({ error: 'Missing license_key' }, 400);
      }
      reqString(body.license_key, 'license_key', LIMITS.SHORT_TEXT);

      const licenseService = licenseServiceFactory(c.env);
      const license = await licenseService.verifyToken(body.license_key);
      return c.json({ valid: true, license });
    } catch (err: any) {
      if (err instanceof ValidationError) return c.json({ valid: false, error: err.message }, err.status);
      const [msg, status] = (err instanceof Error ? err.message : String(err)).split('|');
      return c.json({ valid: false, error: msg }, errorStatus(status, 400));
    }
  });
}

