import { Hono } from 'hono';
import { Env } from '../env';
import { getUserIdFromRequest, getClientIp } from '../utils/auth';
import { IAuthService, AuthService } from '../services/auth';
import { AuthRepository } from '../repositories/auth';

export function registerAuthRoutes(
  app: Hono<{ Bindings: Env }>,
  authServicesFactory: (env: Env) => IAuthService = (env) => new AuthService(env, new AuthRepository(env))
) {
  app.post('/api/auth/register', async (c) => {
    try {
      const body = await c.req.json();
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
      if (body.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(body.email.trim())) {
          return c.json({ error: 'Invalid email format' }, 400);
        }
      }

      const services = authServicesFactory(c.env);
      const turnstileToken = body['cf-turnstile-response'];
      const remoteip = c.req.header('CF-Connecting-IP') ?? undefined;

      const result = await services.register(body, turnstileToken, remoteip, c);
      return c.json(result);
    } catch (err: any) {
      const [msg, status] = err.message.split('|');
      return c.json({ error: msg }, parseInt(status) || 500);
    }
  });

  app.post('/api/auth/guest/step1', async (c) => {
    try {
      const services = authServicesFactory(c.env);
      const clientIp = getClientIp(c);
      
      let turnstileToken;
      if (c.env.TURNSTILE_SECRET && c.env.JWT_SECRET !== 'test-secret') {
        const body = await c.req.json();
        turnstileToken = body['cf-turnstile-response'];
      }
      const remoteip = c.req.header('CF-Connecting-IP') ?? undefined;

      const result = await services.registerGuestStep1(clientIp, turnstileToken, remoteip);
      return c.json(result);
    } catch (err: any) {
      const [msg, status] = err.message.split('|');
      return c.json({ error: msg }, parseInt(status) || 500);
    }
  });

  app.post('/api/auth/guest', async (c) => {
    try {
      const body = await c.req.json();
      if (!body.token || body.nonce === undefined) {
        return c.json({ error: 'Missing challenge token or nonce' }, 400);
      }
      const services = authServicesFactory(c.env);
      const turnstileToken = body['cf-turnstile-response'];
      const remoteip = c.req.header('CF-Connecting-IP') ?? undefined;

      const result = await services.registerGuest(body, turnstileToken, remoteip, c);
      return c.json(result);
    } catch (err: any) {
      const [msg, status] = err.message.split('|');
      return c.json({ error: msg }, parseInt(status) || 500);
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
      const [msg, status] = err.message.split('|');
      return c.json({ error: msg }, parseInt(status) || 500);
    }
  });

  app.post('/api/auth/public-key', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const body = await c.req.json();
      const publicKey = body.public_key;
      if (publicKey !== undefined && publicKey !== null && publicKey !== '') {
        if (!/^[0-9a-fA-F]{64}$/.test(publicKey)) {
          return c.json({ error: 'Invalid public key format. Must be a 64-character hex-encoded string.' }, 400);
        }
      }

      const services = authServicesFactory(c.env);
      const result = await services.updatePublicKey(userId, publicKey);
      return c.json(result);
    } catch (err: any) {
      return c.json({ error: err.message }, 500);
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
      const [msg, status] = err.message.split('|');
      return c.json({ error: msg }, parseInt(status) || 500);
    }
  });

  app.post('/api/auth/login/step1', async (c) => {
    try {
      const body = await c.req.json();
      if (!body.username) return c.json({ error: 'Missing username' }, 400);

      const clientIp = getClientIp(c);
      const turnstileToken = body['cf-turnstile-response'];
      const remoteip = c.req.header('CF-Connecting-IP') ?? undefined;

      const services = authServicesFactory(c.env);
      const result = await services.loginStep1(body, clientIp, turnstileToken, remoteip);
      return c.json(result);
    } catch (err: any) {
      const [msg, status] = err.message.split('|');
      return c.json({ error: msg }, parseInt(status) || 500);
    }
  });

  app.post('/api/auth/login', async (c) => {
    try {
      const body = await c.req.json();
      const isTestEnv = c.env.JWT_SECRET === 'test-secret';
      if (!isTestEnv) {
        if (!body.token || !body.password || body.nonce === undefined) {
          return c.json({ error: 'Missing token, password, or nonce' }, 400);
        }
      }

      const clientIp = getClientIp(c);
      const turnstileToken = body['cf-turnstile-response'];
      const remoteip = c.req.header('CF-Connecting-IP') ?? undefined;

      const services = authServicesFactory(c.env);
      const result = await services.login(body, clientIp, turnstileToken, remoteip, c);
      return c.json(result);
    } catch (err: any) {
      const [msg, status, retry_after] = err.message.split('|');
      const response: any = { error: msg };
      if (retry_after) response.retry_after = parseInt(retry_after);
      return c.json(response, parseInt(status) || 500);
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
      const [msg, status] = err.message.split('|');
      return c.json({ error: msg }, parseInt(status) || 500);
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
      const [msg, status] = err.message.split('|');
      return c.json({ error: msg }, parseInt(status) || 500);
    }
  });

  app.post('/api/auth/2fa/setup', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const body = await c.req.json();
      if (!body.password) return c.json({ error: 'Missing password verification' }, 400);

      const services = authServicesFactory(c.env);
      const result = await services.setup2FA(userId, body);
      return c.json(result);
    } catch (err: any) {
      const [msg, status] = err.message.split('|');
      return c.json({ error: msg }, parseInt(status) || 500);
    }
  });

  app.post('/api/auth/2fa/verify', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const body = await c.req.json();
      if (!body.code) return c.json({ error: 'Missing 2FA code' }, 400);
      if (!body.password) return c.json({ error: 'Missing password verification' }, 400);

      const services = authServicesFactory(c.env);
      const result = await services.verify2FA(userId, body);
      return c.json(result);
    } catch (err: any) {
      const [msg, status] = err.message.split('|');
      return c.json({ error: msg }, parseInt(status) || 500);
    }
  });

  app.post('/api/auth/2fa/disable', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const body = await c.req.json();
      if (!body.code) return c.json({ error: 'Missing 2FA code' }, 400);
      if (!body.password) return c.json({ error: 'Missing password verification' }, 400);

      const services = authServicesFactory(c.env);
      const result = await services.disable2FA(userId, body);
      return c.json(result);
    } catch (err: any) {
      const [msg, status] = err.message.split('|');
      return c.json({ error: msg }, parseInt(status) || 500);
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
      const [msg, status] = err.message.split('|');
      return c.json({ error: msg }, parseInt(status) || 500);
    }
  });

  app.post('/api/auth/passkeys/register/verify', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const body = await c.req.json();
      const requestOrigin = c.req.header('Origin') || new URL(c.req.url).origin;
      const expectedOrigin = requestOrigin;
      const rpID = new URL(requestOrigin).hostname;

      const services = authServicesFactory(c.env);
      const result = await services.verifyPasskeyRegistration(userId, body, expectedOrigin, rpID, c);
      return c.json(result);
    } catch (err: any) {
      const [msg, status] = err.message.split('|');
      return c.json({ error: msg }, parseInt(status) || 500);
    }
  });

  app.post('/api/auth/passkeys/login/generate-options', async (c) => {
    try {
      const body = await c.req.json();
      if (typeof body.username !== 'string') return c.json({ error: 'Invalid or missing username' }, 400);

      const clientIp = getClientIp(c);
      const requestOrigin = c.req.header('Origin') || new URL(c.req.url).origin;
      const rpID = new URL(requestOrigin).hostname;

      const services = authServicesFactory(c.env);
      const result = await services.generatePasskeyLoginOptions(body, clientIp, rpID, c);
      return c.json(result);
    } catch (err: any) {
      const [msg, status] = err.message.split('|');
      return c.json({ error: msg }, parseInt(status) || 500);
    }
  });

  app.post('/api/auth/passkeys/login/verify', async (c) => {
    try {
      const body = await c.req.json();
      if (typeof body.id !== 'string') return c.json({ error: 'Invalid or missing credential ID' }, 400);

      const clientIp = getClientIp(c);
      const requestOrigin = c.req.header('Origin') || new URL(c.req.url).origin;
      const expectedOrigin = requestOrigin;
      const rpID = new URL(requestOrigin).hostname;

      const services = authServicesFactory(c.env);
      const result = await services.verifyPasskeyLogin(body, clientIp, expectedOrigin, rpID, c);
      return c.json(result);
    } catch (err: any) {
      const [msg, status] = err.message.split('|');
      return c.json({ error: msg }, parseInt(status) || 500);
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
      const [msg, status] = err.message.split('|');
      return c.json({ error: msg }, parseInt(status) || 500);
    }
  });

  app.delete('/api/auth/passkeys/:id', async (c) => {
    try {
      const userId = await getUserIdFromRequest(c);
      if (!userId) return c.json({ error: 'Unauthorized' }, 401);

      const id = c.req.param('id');
      const services = authServicesFactory(c.env);
      const result = await services.deletePasskey(userId, id);
      return c.json(result);
    } catch (err: any) {
      const [msg, status] = err.message.split('|');
      return c.json({ error: msg }, parseInt(status) || 500);
    }
  });

  app.post('/api/admin/users/plan', async (c) => {
    try {
      const adminSecret = c.env.ADMIN_SECRET;
      if (!adminSecret) return c.json({ error: 'Unauthorized: Admin secret is not configured' }, 401);

      const authHeader = c.req.header('X-Admin-Secret') || c.req.header('Authorization');
      const providedSecret = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

      const body = await c.req.json();
      const services = authServicesFactory(c.env);
      const result = await services.updateAdminUserPlan(adminSecret, providedSecret, body);
      return c.json(result);
    } catch (err: any) {
      const [msg, status] = err.message.split('|');
      return c.json({ error: msg }, parseInt(status) || 500);
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
      const [msg, status] = err.message.split('|');
      return c.json({ error: msg }, parseInt(status) || 500);
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

  app.post('/api/auth/oauth/exchange', async (c) => {
    try {
      const body = await c.req.json();
      if (typeof body.code !== 'string') return c.json({ error: 'Missing code' }, 400);

      const services = authServicesFactory(c.env);
      const result = await services.exchangeOauthToken(body, c);
      return c.json(result);
    } catch (err: any) {
      const [msg, status] = err.message.split('|');
      return c.json({ error: msg }, parseInt(status) || 500);
    }
  });
}
