import { Env } from '../env';
import { ulid } from 'ulidx';
import { sign, verify } from 'hono/jwt';
import { Context } from 'hono';
import { IAuthRepository, LoginHistoryMeta } from '../repositories/auth';
import {
  hashPassword, verifyPassword, hashApiKey, getClientIp,
  hashUsername, verifyDummyPassword, verifyTurnstile, deletionCache,
  safeCompare
} from '../utils/auth';
import { generateTOTPSecret, verifyTOTP, encryptTOTPSecret, decryptTOTPSecret } from '../utils/totp';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';

function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array) {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64: string) {
  const binary_string = atob(base64);
  const len = binary_string.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes;
}

export interface IAuthService {
  register(body: any, turnstileToken: string | undefined, remoteIp: string | undefined, c: Context<{ Bindings: Env }>): Promise<any>;
  registerGuestStep1(clientIp: string, turnstileToken: string | undefined, remoteIp: string | undefined): Promise<any>;
  registerGuest(body: any, turnstileToken: string | undefined, remoteIp: string | undefined, c: Context<{ Bindings: Env }>): Promise<any>;
  getMe(userId: string): Promise<any>;
  updatePublicKey(userId: string, publicKey: string | undefined | null): Promise<any>;
  regenerateApiKey(userId: string, c: Context<{ Bindings: Env }>): Promise<any>;
  loginStep1(body: any, clientIp: string, turnstileToken: string | undefined, remoteIp: string | undefined): Promise<any>;
  login(body: any, clientIp: string, turnstileToken: string | undefined, remoteIp: string | undefined, c: Context<{ Bindings: Env }>): Promise<any>;
  deleteUser(userId: string, c: Context<{ Bindings: Env }>): Promise<any>;
  cancelDeleteUser(userId: string): Promise<any>;
  setup2FA(userId: string, body: any): Promise<any>;
  verify2FA(userId: string, body: any): Promise<any>;
  disable2FA(userId: string, body: any): Promise<any>;
  generatePasskeyRegistrationOptions(userId: string, rpID: string, c: Context<{ Bindings: Env }>): Promise<any>;
  verifyPasskeyRegistration(userId: string, body: any, expectedOrigin: string, rpID: string, c: Context<{ Bindings: Env }>): Promise<any>;
  generatePasskeyLoginOptions(body: any, clientIp: string, rpID: string, c: Context<{ Bindings: Env }>): Promise<any>;
  verifyPasskeyLogin(body: any, clientIp: string, expectedOrigin: string, rpID: string, c: Context<{ Bindings: Env }>): Promise<any>;
  getPasskeys(userId: string): Promise<any>;
  deletePasskey(userId: string, id: string): Promise<any>;
  updateAdminUserPlan(adminSecret: string, providedSecret: string | undefined, body: any): Promise<any>;
  handleGithubLogin(userId: string | null, redirectUri: string): Promise<string>;
  handleGithubCallback(code: string, state: string, frontendUrl: string, c: Context<{ Bindings: Env }>): Promise<{ redirectUrl: string }>;
  exchangeOauthToken(body: any, c: Context<{ Bindings: Env }>): Promise<any>;
}

export class AuthService implements IAuthService {
  constructor(private env: Env, private authRepo: IAuthRepository) {}

  private extractLoginMeta(c: Context<{ Bindings: Env }>): LoginHistoryMeta {
    const cf = (c.req.raw as any).cf;
    return {
      ipAddress: getClientIp(c),
      userAgent: c.req.header('User-Agent') || null,
      cfRay: c.req.header('CF-Ray') || null,
      country: cf?.country || c.req.header('CF-IPCountry') || null,
      city: cf?.city || null,
      region: cf?.region || null,
      timezone: cf?.timezone || null,
    };
  }

  async register(body: any, turnstileToken: string | undefined, remoteIp: string | undefined, c: Context<{ Bindings: Env }>): Promise<any> {
    const username = body.username.trim();
    const password = body.password;
    const email = typeof body.email === 'string' ? body.email.trim() : null;
    
    // Closed Beta registration limit check
    const betaModeEnabled = this.env.BETA_MODE_ENABLED !== 'false';
    if (betaModeEnabled) {
      const inviteCode = typeof body.inviteCode === 'string' ? body.inviteCode.trim() : '';
      let totalUsers = 0;
      try {
        totalUsers = await this.authRepo.getUserCount();
      } catch (err) {
        console.error("Failed to query user count for beta limit check:", err);
      }

      const rawLimit = this.env.BETA_USER_LIMIT;
      if (rawLimit && isNaN(parseInt(rawLimit, 10))) {
        throw new TypeError("BETA_USER_LIMIT must be a valid integer");
      }
      const betaLimit = rawLimit ? parseInt(rawLimit, 10) : 50;
      if (totalUsers >= betaLimit) {
        let isBypassValid = false;
        
        // 1. Check if it's the global bypass code
        if (this.env.BETA_BYPASS_CODE && safeCompare(inviteCode, this.env.BETA_BYPASS_CODE)) {
          isBypassValid = true;
        }

        // 2. Check if it's a valid project invitation token
        if (!isBypassValid && inviteCode) {
          try {
            isBypassValid = await this.authRepo.checkInvitationTokenValid(inviteCode);
          } catch (err) {
            console.error("Failed to check invitation token validity:", err);
          }
        }

        if (!isBypassValid) {
          throw new Error('Beta registration limit reached. Please provide a valid invite code to signup.|403');
        }
      }
    }

    const turnstileSecret = this.env.TURNSTILE_SECRET;
    if (turnstileSecret && this.env.JWT_SECRET !== 'test-secret') {
      if (!turnstileToken) throw new Error('Missing Turnstile token|403');
      const valid = await verifyTurnstile(turnstileToken, turnstileSecret, remoteIp);
      if (!valid) throw new Error('Turnstile verification failed|403');
    }

    let usernameHash: string;
    try {
      usernameHash = await hashUsername(username);
      const exists = await this.authRepo.checkUsernameExists(usernameHash);
      if (exists) throw new Error('Username already exists|400');
    } catch (err: any) {
      if (err.message.includes('|')) throw err;
      throw new Error('Registration failed due to an internal server error|500');
    }

    const hash = await hashPassword(password);
    const apiKey = 'swazz_live_' + crypto.randomUUID().replace(/-/g, '');
    const hashedApiKey = await hashApiKey(apiKey);

    try {
      const { id } = await this.authRepo.createUser(username, usernameHash, hash, email, hashedApiKey);
      await this.authRepo.recordLoginHistory(id, 'success', 'password', false, this.extractLoginMeta(c));
      
      const payload = { sub: id, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 };
      const secret = this.env.JWT_SECRET;
      if (!secret) throw new Error('Internal server error: auth not configured|500');
      const jwtToken = await sign(payload, secret);

      return { status: 'ok', id, token: jwtToken, api_key: apiKey };
    } catch (err: any) {
      if (String(err?.message || err).includes('UNIQUE constraint failed')) {
        throw new Error('Username already exists|400');
      }
      throw new Error('Registration failed due to an internal server error|500');
    }
  }

  async registerGuestStep1(clientIp: string, turnstileToken: string | undefined, remoteIp: string | undefined): Promise<any> {
    const ipRateLimit = await this.authRepo.checkIpRateLimit(`ip-guest:${clientIp}`, 30, 60);
    if (ipRateLimit.limited) throw new Error('Too many requests. Please try again later.|429');

    const turnstileSecret = this.env.TURNSTILE_SECRET;
    let isVerified = false;
    if (turnstileSecret && this.env.JWT_SECRET !== 'test-secret') {
      if (!turnstileToken) throw new Error('Missing Turnstile token|403');
      const valid = await verifyTurnstile(turnstileToken, turnstileSecret, remoteIp);
      if (!valid) throw new Error('Turnstile verification failed|403');
      isVerified = true;
    } else {
      isVerified = true;
    }

    const token = (isVerified ? 'verified_' : '') + crypto.randomUUID();
    const challenge = crypto.randomUUID();
    const difficulty = 3;
    const expiry = new Date(Date.now() + 5 * 60 * 1000);
    const expiryStr = expiry.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];

    await this.authRepo.createLoginChallenge(token, 'guest_temp', challenge, difficulty, expiryStr);

    return { status: 'ok', token, challenge, difficulty };
  }

  async registerGuest(body: any, turnstileToken: string | undefined, remoteIp: string | undefined, c: Context<{ Bindings: Env }>): Promise<any> {
    try {
      this.authRepo.cleanupExpiredGuests().catch(() => {});
    } catch {}

    const challengeToken = body.token;
    const nonce = body.nonce;

    const turnstileSecret = this.env.TURNSTILE_SECRET;
    if (turnstileSecret && this.env.JWT_SECRET !== 'test-secret' && !challengeToken.startsWith('verified_')) {
      if (!turnstileToken) throw new Error('Missing Turnstile token|403');
      const valid = await verifyTurnstile(turnstileToken, turnstileSecret, remoteIp);
      if (!valid) throw new Error('Turnstile verification failed|403');
    }

    const challengeRow = await this.authRepo.getAndConsumeChallenge(challengeToken, 'guest_temp');
    if (!challengeRow) throw new Error('Invalid or expired challenge token|400');

    const expiresAt = new Date(challengeRow.expires_at + 'Z');
    if (expiresAt.getTime() < Date.now()) throw new Error('Invalid or expired challenge token|400');

    const targetPrefix = '0'.repeat(challengeRow.difficulty);
    const dataText = challengeRow.challenge + nonce;
    const encoder = new TextEncoder();
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(dataText));
    const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    if (!hashHex.startsWith(targetPrefix)) throw new Error('Invalid Proof of Work solution|403');

    const username = "g_" + crypto.randomUUID().replace(/-/g, "").substring(0, 12);
    const password = `guest_pass_${crypto.randomUUID().replace(/-/g, '')}`;
    const hash = await hashPassword(password);
    const apiKey = 'swazz_live_' + crypto.randomUUID().replace(/-/g, '');
    const hashedApiKey = await hashApiKey(apiKey);

    try {
      const { id } = await this.authRepo.createGuestUser(username, hash, hashedApiKey);
      const payload = { sub: id, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 };
      const secret = this.env.JWT_SECRET;
      if (!secret) throw new Error('Internal server error: auth not configured|500');
      const token = await sign(payload, secret);

      return { status: 'ok', token, username, expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() };
    } catch (err) {
      throw new Error('Failed to create guest user account|500');
    }
  }

  async getMe(userId: string): Promise<any> {
    const user = await this.authRepo.getUserById(userId);
    if (!user) throw new Error('User not found|404');
    
    let displayApiKey = "";
    if (!user.api_key) {
      const apiKey = 'swazz_live_' + crypto.randomUUID().replace(/-/g, '');
      const hashedApiKey = await hashApiKey(apiKey);
      await this.authRepo.updateUserApiKey(userId, hashedApiKey);
      displayApiKey = apiKey;
    } else {
      displayApiKey = 'swazz_live_' + '•'.repeat(24);
    }
    
    return { 
      username: user.username, 
      api_key: displayApiKey, 
      public_key: user.public_key,
      is_guest: user.is_guest === 1,
      delete_requested_at: user.delete_requested_at,
      two_factor_enabled: user.two_factor_enabled === 1,
      plan: user.plan || 'Free',
      github_id: user.github_id || null
    };
  }

  async updatePublicKey(userId: string, publicKey: string | undefined | null): Promise<any> {
    const val = (publicKey === '' || publicKey === null || publicKey === undefined) ? null : publicKey.toLowerCase();
    await this.authRepo.updateUserPublicKey(userId, val);
    return { status: 'ok', public_key: val };
  }

  async regenerateApiKey(userId: string, c: any): Promise<any> {
    const oldUser = await this.authRepo.getUserById(userId);
    if (!oldUser) throw new Error('Unauthorized|401');

    const newApiKey = 'swazz_live_' + crypto.randomUUID().replace(/-/g, '');
    const hashedNewApiKey = await hashApiKey(newApiKey);
    await this.authRepo.updateUserApiKey(userId, hashedNewApiKey);

    const kv = this.env.SESSION_CACHE;
    if (kv) {
      try {
        if (oldUser?.api_key) {
          const cacheKey = oldUser.api_key.startsWith('swazz_live_') ? await hashApiKey(oldUser.api_key) : oldUser.api_key;
          await kv.delete(`apikey:${cacheKey}`);
        }
        await kv.put(`apikey:${hashedNewApiKey}`, JSON.stringify({ userId: String(userId) }), { expirationTtl: 300 });
      } catch {}
    }
    return { api_key: newApiKey };
  }

  async loginStep1(body: any, clientIp: string, turnstileToken: string | undefined, remoteIp: string | undefined): Promise<any> {
    const ipRateLimit = await this.authRepo.checkIpRateLimit(`ip:${clientIp}`, 30, 60);
    if (ipRateLimit.limited) throw new Error('Too many requests. Please try again later.|429');
    const systemRateLimit = await this.authRepo.checkIpRateLimit('system', 100, 60);
    if (systemRateLimit.limited) throw new Error('System busy. Please try again later.|429');

    const turnstileSecret = this.env.TURNSTILE_SECRET;
    let isVerified = false;
    if (turnstileSecret && this.env.JWT_SECRET !== 'test-secret') {
      if (!turnstileToken) throw new Error('Missing Turnstile token|403');
      const valid = await verifyTurnstile(turnstileToken, turnstileSecret, remoteIp);
      if (!valid) throw new Error('Turnstile verification failed|403');
      isVerified = true;
    } else {
      isVerified = true;
    }

    const username = body.username.trim();
    const token = (isVerified ? 'verified_' : '') + crypto.randomUUID();
    const challenge = crypto.randomUUID();
    const difficulty = 3;
    const expiry = new Date(Date.now() + 5 * 60 * 1000);
    const expiryStr = expiry.toISOString().replace('T', ' ').replace('Z', '').split('.')[0];

    await this.authRepo.createLoginChallenge(token, username, challenge, difficulty, expiryStr);

    return { status: 'ok', token, challenge, difficulty };
  }

  async login(body: any, clientIp: string, turnstileToken: string | undefined, remoteIp: string | undefined, c: Context<{ Bindings: Env }>): Promise<any> {
    const startTime = Date.now();
    const enforceUniformDelay = async (start: number) => {
      const elapsed = Date.now() - start;
      const targetDelay = 300;
      if (elapsed < targetDelay) await new Promise(resolve => setTimeout(resolve, targetDelay - elapsed));
    };

    const ipRateLimit2 = await this.authRepo.checkIpRateLimit(`ip:${clientIp}`, 30, 60);
    if (ipRateLimit2.limited) throw new Error('Too many requests. Please try again later.|429');

    let username: string;
    const isTestEnv = this.env.JWT_SECRET === 'test-secret';
    
    if (isTestEnv && !body.token && body.username) {
      username = body.username;
    } else {
      const turnstileSecret = this.env.TURNSTILE_SECRET;
      if (turnstileSecret && this.env.JWT_SECRET !== 'test-secret' && !body.token.startsWith('verified_')) {
        if (!turnstileToken) throw new Error('Missing Turnstile token|403');
        const valid = await verifyTurnstile(turnstileToken, turnstileSecret, remoteIp);
        if (!valid) throw new Error('Turnstile verification failed|403');
      }

      const challengeRow = await this.authRepo.getAndConsumeChallenge(body.token);
      if (!challengeRow) throw new Error('Session expired or invalid login token|401');

      const expiresAt = new Date(challengeRow.expires_at + 'Z');
      if (expiresAt.getTime() < Date.now()) throw new Error('Session expired|401');

      const nonce = String(body.nonce);
      const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(challengeRow.challenge + nonce));
      const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      const targetPrefix = '0'.repeat(challengeRow.difficulty);
      
      if (!hashHex.startsWith(targetPrefix)) throw new Error('Proof of work verification failed|403');

      username = challengeRow.username;
    }

    const rateLimit = await this.authRepo.checkLoginRateLimit(username);
    if (rateLimit.locked) throw new Error(`Account temporarily locked due to too many failed attempts|429|${rateLimit.retryAfter}`);

    const user = await this.authRepo.getUserByUsername(username);

    if (!user) {
      await verifyDummyPassword(body.password);
      await this.authRepo.recordFailedLogin(username);
      await enforceUniformDelay(startTime);
      throw new Error('Invalid credentials|401');
    }

    if (user.is_interactive === 0) {
      await verifyDummyPassword(body.password);
      await enforceUniformDelay(startTime);
      throw new Error('Interactive login is disabled for service accounts|403');
    }

    const valid = await verifyPassword(body.password, user.password_hash);
    if (!valid) {
      await this.authRepo.recordFailedLogin(username);
      const postRateLimit = await this.authRepo.checkLoginRateLimit(username);
      const status = postRateLimit.locked ? 'locked' : 'failed_password';
      await this.authRepo.recordLoginHistory(user.id, status, 'password', user.two_factor_enabled === 1, this.extractLoginMeta(c));
      await enforceUniformDelay(startTime);
      throw new Error('Invalid credentials|401');
    }

    if (user.two_factor_enabled === 1) {
      if (!body.two_factor_code) {
        await enforceUniformDelay(startTime);
        return { status: '2fa_required' };
      }
      if (!user.two_factor_secret) {
        await enforceUniformDelay(startTime);
        throw new Error('Internal server error: 2FA configured incorrectly|500');
      }
      let decryptedSecret: string;
      try {
        decryptedSecret = await decryptTOTPSecret(user.two_factor_secret, body.password);
      } catch {
        await this.authRepo.recordFailedLogin(username);
        const postRateLimit = await this.authRepo.checkLoginRateLimit(username);
        await this.authRepo.recordLoginHistory(user.id, postRateLimit.locked ? 'locked' : 'failed_password', 'password', true, this.extractLoginMeta(c));
        await enforceUniformDelay(startTime);
        throw new Error('Invalid credentials|401');
      }
      const isValid2fa = await verifyTOTP(decryptedSecret, body.two_factor_code);
      if (!isValid2fa) {
        await this.authRepo.recordFailedLogin(username);
        const postRateLimit = await this.authRepo.checkLoginRateLimit(username);
        await this.authRepo.recordLoginHistory(user.id, postRateLimit.locked ? 'locked' : 'failed_2fa', 'password', true, this.extractLoginMeta(c));
        await enforceUniformDelay(startTime);
        throw new Error('Invalid credentials|401');
      }
    }

    await this.authRepo.resetLoginAttempts(username);
    await this.authRepo.recordLoginHistory(user.id, 'success', 'password', user.two_factor_enabled === 1, this.extractLoginMeta(c));

    const payload = { sub: user.id, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 };
    const secret = this.env.JWT_SECRET;
    if (!secret) throw new Error('Internal server error: auth not configured|500');
    const jwtToken = await sign(payload, secret);

    await enforceUniformDelay(startTime);
    return { status: 'ok', token: jwtToken };
  }

  async deleteUser(userId: string, c: Context<{ Bindings: Env }>): Promise<any> {
    await this.authRepo.scheduleUserDeletion(userId);
    deletionCache.delete(userId);

    try {
      const doId = this.env.COORDINATOR_DO.idFromName('global-coordinator');
      const stub = this.env.COORDINATOR_DO.get(doId);
      await stub.fetch(new Request(`http://do/revoke-user?userId=${userId}`, { method: 'POST' }) as any);
    } catch {}

    return { status: 'deletion_scheduled', eta_days: 7 };
  }

  async cancelDeleteUser(userId: string): Promise<any> {
    await this.authRepo.cancelUserDeletion(userId);
    deletionCache.delete(userId);
    return { status: 'deletion_cancelled' };
  }

  async setup2FA(userId: string, body: any): Promise<any> {
    const user = await this.authRepo.getUserById(userId);
    if (!user) throw new Error('User not found|404');
    if (user.two_factor_enabled === 1) throw new Error('2FA is already enabled. Disable it first.|400');
    
    const userPass = await this.authRepo.getUserByUsername(user.username);
    if (!userPass) throw new Error('User not found|404');
    const isPasswordValid = await verifyPassword(body.password, userPass.password_hash);
    if (!isPasswordValid) throw new Error('Invalid password|401');

    const secret = generateTOTPSecret();
    const encryptedSecret = await encryptTOTPSecret(secret, body.password);
    
    await this.authRepo.updateUserTwoFactorSecret(userId, encryptedSecret, 0);

    const issuer = 'Swazz';
    return { status: 'ok', secret, otpauth_url: "otpauth://totp/" + encodeURIComponent(issuer) + ":" + encodeURIComponent(user.username) + "?secret=" + secret + "&issuer=" + encodeURIComponent(issuer) };
  }

  async verify2FA(userId: string, body: any): Promise<any> {
    const user = await this.authRepo.getUserById(userId);
    if (!user) throw new Error('User not found|404');
    const userPass = await this.authRepo.getUserByUsername(user.username);
    
    if (!userPass || !userPass.two_factor_secret) throw new Error('2FA has not been set up. Call setup endpoint first.|400');

    const isPasswordValid = await verifyPassword(body.password, userPass.password_hash);
    if (!isPasswordValid) throw new Error('Invalid password or 2FA code|401');

    let decryptedSecret: string;
    try {
      decryptedSecret = await decryptTOTPSecret(userPass.two_factor_secret, body.password);
    } catch {
      throw new Error('Invalid password or 2FA code|401');
    }

    const isValid = await verifyTOTP(decryptedSecret, body.code);
    if (!isValid) throw new Error('Invalid password or 2FA code|401');

    await this.authRepo.updateUserTwoFactorSecret(userId, userPass.two_factor_secret, 1);
    return { status: 'ok' };
  }

  async disable2FA(userId: string, body: any): Promise<any> {
    const user = await this.authRepo.getUserById(userId);
    if (!user) throw new Error('User not found|404');
    const userPass = await this.authRepo.getUserByUsername(user.username);
    
    if (!userPass || userPass.two_factor_enabled !== 1 || !userPass.two_factor_secret) throw new Error('2FA is not enabled|400');

    const isPasswordValid = await verifyPassword(body.password, userPass.password_hash);
    if (!isPasswordValid) throw new Error('Invalid password or 2FA code|401');

    let decryptedSecret: string;
    try {
      decryptedSecret = await decryptTOTPSecret(userPass.two_factor_secret, body.password);
    } catch {
      throw new Error('Invalid password or 2FA code|401');
    }

    const isValid = await verifyTOTP(decryptedSecret, body.code);
    if (!isValid) throw new Error('Invalid password or 2FA code|401');

    await this.authRepo.updateUserTwoFactorSecret(userId, null, 0);
    return { status: 'ok' };
  }

  async generatePasskeyRegistrationOptions(userId: string, rpID: string, c: any): Promise<any> {
    const user = await this.authRepo.getUserById(userId);
    if (!user) throw new Error('User not found|404');

    const encoder = new TextEncoder();
    const userIDBytes = encoder.encode(userId);

    const passkeys = await this.authRepo.getPasskeysByUserId(userId);
    const excludeCredentials = passkeys.map(pk => ({ id: pk.credential_id, type: 'public-key' as const, transports: [] }));

    const options = await generateRegistrationOptions({
      rpName: 'Swazz', rpID, userID: userIDBytes as any, userName: user.username, userDisplayName: user.username,
      excludeCredentials, authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred', authenticatorAttachment: 'platform' }
    });

    if (!this.env.SESSION_CACHE) throw new Error('Internal server error: SESSION_CACHE is not configured|500');
    await this.env.SESSION_CACHE.put("passkey_challenge:" + userId, options.challenge, { expirationTtl: 300 });

    return options;
  }

  async verifyPasskeyRegistration(userId: string, body: any, expectedOrigin: string, rpID: string, c: any): Promise<any> {
    let expectedChallenge = '';
    if (this.env.SESSION_CACHE) {
      expectedChallenge = await this.env.SESSION_CACHE.get("passkey_challenge:" + userId) || '';
      await this.env.SESSION_CACHE.delete("passkey_challenge:" + userId);
    }
    if (!expectedChallenge) throw new Error('Challenge expired or not found|400');

    try {
      const verification = await verifyRegistrationResponse({ response: body, expectedChallenge, expectedOrigin, expectedRPID: rpID });
      if (verification.verified && verification.registrationInfo) {
        const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
        const transports = body.response.transports ? body.response.transports.join(',') : '';
        const webauthn_user_id = arrayBufferToBase64(new TextEncoder().encode(userId));

        await this.authRepo.savePasskey(credential.id, userId, arrayBufferToBase64(credential.publicKey), webauthn_user_id, credential.counter, credentialDeviceType, credentialBackedUp, transports);

        return { status: 'ok', verified: true };
      }
      throw new Error('Verification failed|400');
    } catch (err: any) {
      throw new Error(err.message + '|400');
    }
  }

  async generatePasskeyLoginOptions(body: any, clientIp: string, rpID: string, c: Context<{ Bindings: Env }>): Promise<any> {
    const ipRateLimit = await this.authRepo.checkIpRateLimit(`ip:${clientIp}`, 30, 60);
    if (ipRateLimit.limited) throw new Error('Too many requests. Please try again later.|429');

    const username = body.username.trim();
    const user = await this.authRepo.getUserByUsername(username);
    if (!user) {
      await new Promise(r => setTimeout(r, 200));
      throw new Error('User not found|404');
    }

    if (user.is_interactive === 0) {
      await new Promise(r => setTimeout(r, 200));
      throw new Error('Interactive login restricted for this account|403');
    }

    const passkeys = await this.authRepo.getPasskeysByUserId(user.id);
    if (!passkeys || passkeys.length === 0) {
      await new Promise(r => setTimeout(r, 200));
      throw new Error('No passkeys found for user|404');
    }

    const allowCredentials = passkeys.map(pk => ({ id: pk.credential_id, type: 'public-key' as const, transports: pk.transports ? (pk.transports.split(',')) as any : undefined }));
    const options = await generateAuthenticationOptions({ rpID, allowCredentials, userVerification: 'preferred' });

    if (!this.env.SESSION_CACHE) throw new Error('Internal server error: SESSION_CACHE is not configured|500');
    await this.env.SESSION_CACHE.put("passkey_login:" + user.id, options.challenge, { expirationTtl: 300 });

    return options;
  }

  async verifyPasskeyLogin(body: any, clientIp: string, expectedOrigin: string, rpID: string, c: Context<{ Bindings: Env }>): Promise<any> {
    const ipRateLimit = await this.authRepo.checkIpRateLimit(`ip:${clientIp}`, 30, 60);
    if (ipRateLimit.limited) throw new Error('Too many requests. Please try again later.|429');

    const credential_id = body.id;
    const pk = await this.authRepo.getPasskeyByCredentialId(credential_id);
    if (!pk) throw new Error('Credential not found|404');

    const user = await this.authRepo.getUserById(pk.user_id);
    if (!user) {
      throw new Error('User not found|404');
    }
    if (user.is_interactive === 0) {
      throw new Error('Interactive login restricted for this account|403');
    }

    let expectedChallenge = '';
    if (this.env.SESSION_CACHE) {
      expectedChallenge = await this.env.SESSION_CACHE.get("passkey_login:" + pk.user_id) || '';
      await this.env.SESSION_CACHE.delete("passkey_login:" + pk.user_id);
    }
    if (!expectedChallenge) throw new Error('Challenge expired or not found|400');

    try {
      const verification = await verifyAuthenticationResponse({
        response: body, expectedChallenge, expectedOrigin, expectedRPID: rpID,
        credential: { id: credential_id, publicKey: base64ToArrayBuffer(pk.public_key), counter: pk.counter, transports: pk.transports ? pk.transports.split(',') as any : undefined }
      });

      if (verification.verified && verification.authenticationInfo) {
        await this.authRepo.updatePasskeyCounter(credential_id, verification.authenticationInfo.newCounter);
        if (user) await this.authRepo.resetLoginAttempts(user.username);

        const payload = { sub: pk.user_id, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 };
        const secret = this.env.JWT_SECRET;
        if (!secret) throw new Error('Internal server error: auth not configured|500');
        const jwtToken = await sign(payload, secret);

        return { status: 'ok', token: jwtToken };
      }
      throw new Error('Verification failed|400');
    } catch (err: any) {
      throw new Error(err.message + '|400');
    }
  }

  async getPasskeys(userId: string): Promise<any> {
    return await this.authRepo.getPasskeysByUserId(userId);
  }

  async deletePasskey(userId: string, id: string): Promise<any> {
    const success = await this.authRepo.deletePasskey(userId, id);
    if (!success) throw new Error('Failed to delete|500');
    return { status: 'ok' };
  }

  async updateAdminUserPlan(adminSecret: string, providedSecret: string | undefined, body: any): Promise<any> {
    if (!providedSecret || !safeCompare(providedSecret, adminSecret)) throw new Error('Unauthorized|401');
    const { username, plan } = body;
    if (!username || !plan) throw new Error('Missing username or plan|400');
    if (plan !== 'Free' && plan !== 'Supporter Plan') throw new Error('Invalid plan. Allowed plans: Free, Supporter Plan|400');
    
    const changes = await this.authRepo.updateUserPlan(username, plan);
    if (changes === 0) throw new Error('User not found|404');
    return { status: 'ok', username, plan };
  }

  async handleGithubLogin(userId: string | null, redirectUri: string): Promise<string> {
    const clientId = this.env.GITHUB_CLIENT_ID;
    if (!clientId) throw new Error('GitHub OAuth not configured|500');
    const statePayload = { action: userId ? 'link' : 'login', userId: userId || null, exp: Math.floor(Date.now() / 1000) + 60 * 10 };
    const secret = this.env.JWT_SECRET;
    const state = await sign(statePayload, secret);
    const githubAuthUrl = new URL('https://github.com/login/oauth/authorize');
    githubAuthUrl.searchParams.set('client_id', clientId);
    githubAuthUrl.searchParams.set('redirect_uri', redirectUri);
    githubAuthUrl.searchParams.set('scope', 'user:email');
    githubAuthUrl.searchParams.set('state', state);
    return githubAuthUrl.toString();
  }

  async handleGithubCallback(code: string, state: string, frontendUrl: string, c: any): Promise<{ redirectUrl: string }> {
    const secret = this.env.JWT_SECRET;
    let decodedState: any;
    try {
      decodedState = await verify(state, secret, "HS256");
    } catch {
      return { redirectUrl: `${frontendUrl}/?error=${encodeURIComponent('Invalid or expired state')}` };
    }
    if (!decodedState || (decodedState.action !== 'login' && decodedState.action !== 'link')) {
      return { redirectUrl: `${frontendUrl}/?error=${encodeURIComponent('Invalid state payload')}` };
    }

    const clientId = this.env.GITHUB_CLIENT_ID;
    const clientSecret = this.env.GITHUB_CLIENT_SECRET;
    if (!clientId || !clientSecret) return { redirectUrl: `${frontendUrl}/?error=${encodeURIComponent('GitHub OAuth not configured on server')}` };

    try {
      const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'User-Agent': 'Swazz-Edge-Coordinator' },
        body: JSON.stringify({ client_id: clientId, client_secret: clientSecret, code }),
      });
      const tokenData = (await tokenRes.json()) as { access_token?: string; error?: string };
      if (tokenData.error || !tokenData.access_token) return { redirectUrl: `${frontendUrl}/?error=${encodeURIComponent('Failed to exchange code: ' + (tokenData.error || 'unknown'))}` };

      const userRes = await fetch('https://api.github.com/user', {
        headers: { 'Authorization': `token ${tokenData.access_token}`, 'User-Agent': 'Swazz-Edge-Coordinator', 'Accept': 'application/json' },
      });
      const userData = (await userRes.json()) as { id?: number; login?: string; email?: string | null };
      if (!userData.id || !userData.login) return { redirectUrl: `${frontendUrl}/?error=${encodeURIComponent('Failed to fetch GitHub profile')}` };

      let email = userData.email || null;
      if (!email) {
        const emailsRes = await fetch('https://api.github.com/user/emails', {
          headers: { 'Authorization': `token ${tokenData.access_token}`, 'User-Agent': 'Swazz-Edge-Coordinator', 'Accept': 'application/json' },
        });
        const emailsData = (await emailsRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
        if (Array.isArray(emailsData)) {
          const primaryEmail = emailsData.find(e => e.primary && e.verified) || emailsData.find(e => e.primary) || emailsData[0];
          if (primaryEmail) email = primaryEmail.email;
        }
      }

      if (decodedState.action === 'link') {
        const userId = decodedState.userId;
        if (!userId) return { redirectUrl: `${frontendUrl}/?error=${encodeURIComponent('Invalid user session for linking')}` };
        const user = await this.authRepo.getUserById(userId);
        if (user && user.is_interactive === 0) {
          return { redirectUrl: `${frontendUrl}/?error=${encodeURIComponent('Linking GitHub is not allowed for non-interactive service accounts')}` };
        }
        const linked = await this.authRepo.linkGithubUser(userId, String(userData.id));
        if (!linked) return { redirectUrl: `${frontendUrl}/?error=${encodeURIComponent('GitHub account is already linked to another user')}` };
        return { redirectUrl: `${frontendUrl}/?status=github_linked` };
      } else {
        let user = await this.authRepo.getUserByGithubId(String(userData.id));
        if (user && user.is_interactive === 0) {
          return { redirectUrl: `${frontendUrl}/?error=${encodeURIComponent('Interactive login restricted for this account')}` };
        }
        let userId: string;
        if (user) {
          userId = user.id;
        } else {
          if (email) {
            const existingUser = await this.authRepo.getUserByEmail(email);
            if (existingUser) return { redirectUrl: `${frontendUrl}/?error=${encodeURIComponent('An account with this email already exists. Please log in with your password and link your GitHub account in settings.')}` };
          }
          let baseUsername = userData.login.replace(/[^a-zA-Z0-9_\-]/g, '').substring(0, 15);
          if (baseUsername.length < 3) baseUsername = 'gh_' + baseUsername;
          let username = baseUsername, usernameHash = '', isUnique = false, attempts = 0;
          while (!isUnique && attempts < 10) {
            const finalUsername = attempts === 0 ? username : `${username.substring(0, 16)}_${Math.floor(Math.random() * 100)}`;
            const currentHash = await hashUsername(finalUsername);
            const exists = await this.authRepo.checkUsernameExists(currentHash);
            if (!exists) { username = finalUsername; usernameHash = currentHash; isUnique = true; } else { attempts++; }
          }
          if (!isUnique) return { redirectUrl: `${frontendUrl}/?error=${encodeURIComponent('Failed to generate a unique username')}` };
          
          const hash = await hashPassword(crypto.randomUUID() + crypto.randomUUID());
          const hashedApiKey = await hashApiKey('swazz_live_' + crypto.randomUUID().replace(/-/g, ''));
          
          const created = await this.authRepo.createGithubUser(username, usernameHash, hash, email, hashedApiKey, String(userData.id));
          userId = created.id;
        }
        
        await this.authRepo.recordLoginHistory(userId, 'success', 'github', user ? user.two_factor_enabled === 1 : false, this.extractLoginMeta(c));
        
        const payload = { sub: userId, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 7 };
        const jwtToken = await sign(payload, secret);
        const exchangeCode = crypto.randomUUID();
        
        if (this.env.SESSION_CACHE) {
          await this.env.SESSION_CACHE.put(`oauth_code:${exchangeCode}`, jwtToken, { expirationTtl: 60 });
        } else {
          throw new Error('Internal server error: SESSION_CACHE is not configured|500');
        }
        
        return { redirectUrl: `${frontendUrl}/?exchange_code=${exchangeCode}` };
      }
    } catch (err) {
      return { redirectUrl: `${frontendUrl}/?error=${encodeURIComponent('Authentication failed. Please try again later.')}` };
    }
  }

  async exchangeOauthToken(body: any, c: any): Promise<any> {
    const code = body.code;
    const key = `oauth_code:${code}`;
    let token: string | null = null;
    const cache = this.env.SESSION_CACHE;
    if (cache) {
      token = await cache.get(key);
      if (token) await cache.delete(key);
    } else {
      throw new Error('Internal server error: SESSION_CACHE is not configured|500');
    }
    if (!token) throw new Error('Invalid or expired exchange code|400');
    return { status: 'ok', token };
  }
}
