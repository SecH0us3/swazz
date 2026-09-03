// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Env } from '../env';
import { IAuthRepository } from '../repositories/auth';
import { getFeatureType, FEATURE_TYPE_PAID } from '@swazz/shared';

export const DEFAULT_LICENSE_PUBKEY_HEX = '0407b9eb6ca30fa7b7ef1f3b3b27d1aa6683b6c49cbb6b756561cfacc0597bef';
export const DEFAULT_DEV_LICENSE_PRIVKEY_HEX = '302e020100300506032b657004220420b52bfb4e1736b2d3026e64fc4273b3703d1c3c993d6661a40b6f0c144678bef6';

export interface LicenseInfo {
  company: string;
  expires_at: string;
  features: string[];
  max_users?: number;
  max_concurrency?: number;
}

export const TRIAL_COOLDOWN_MS = 24 * 60 * 60 * 1000; // 24 hours
export const TRIAL_DURATION_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

export interface TrialStatus {
  claimed: boolean;
  claimed_at: string | null;
  can_claim: boolean;
  cooldown_remaining_ms: number;
  next_available_at: string | null;
}

export interface ILicenseService {
  activate(userId: string, licenseKey: string): Promise<{ status: string; license: LicenseInfo }>;
  deactivate(userId: string): Promise<{ status: string }>;
  getStatus(userId: string): Promise<{ status: string; license: LicenseInfo | null }>;
  hasFeature(userId: string, feature: string): Promise<boolean>;
  getTrialStatus(userId: string): Promise<TrialStatus>;
  claimTrial(userId: string, username: string): Promise<{ status: string; license: LicenseInfo; token: string }>;
}

function base64UrlDecode(str: string): Uint8Array {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  let binary: string;
  try {
    binary = atob(padded);
  } catch {
    throw new Error('license: invalid token format|400');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export async function signLicenseToken(
  privKeyHex: string,
  payload: { company: string; expires_at: string; features: string[]; max_users?: number; max_concurrency?: number }
): Promise<string> {
  const header = { alg: 'EdDSA', typ: 'JWT' };
  const headerB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signedMessage = new TextEncoder().encode(headerB64 + '.' + payloadB64);

  let privKeyBytes = hexToBytes(privKeyHex);
  if (privKeyBytes.length === 32) {
    const pkcs8Header = new Uint8Array([
      0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20
    ]);
    const wrapped = new Uint8Array(48);
    wrapped.set(pkcs8Header, 0);
    wrapped.set(privKeyBytes, 16);
    privKeyBytes = wrapped;
  }

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    privKeyBytes,
    { name: 'Ed25519' },
    true,
    ['sign']
  );
  const sig = await crypto.subtle.sign('Ed25519', cryptoKey, signedMessage);
  const sigB64 = bytesToBase64Url(new Uint8Array(sig));

  return `${headerB64}.${payloadB64}.${sigB64}`;
}

export class LicenseService implements ILicenseService {
  constructor(private env: Env, private authRepo: IAuthRepository) {}

  private getPublicKeyHex(): string {
    if (this.env.NODE_ENV === 'production') {
      if (!this.env.SWAZZ_LICENSE_PUBKEY) {
        throw new Error('license: SWAZZ_LICENSE_PUBKEY must be configured in production environment|500');
      }
      if (this.env.SWAZZ_LICENSE_PUBKEY === DEFAULT_LICENSE_PUBKEY_HEX) {
        throw new Error('license: default development public key is forbidden in production environment|500');
      }
      return this.env.SWAZZ_LICENSE_PUBKEY;
    }
    return this.env.SWAZZ_LICENSE_PUBKEY || DEFAULT_LICENSE_PUBKEY_HEX;
  }

  private cacheKey(userId: string): string {
    return `license:${userId}`;
  }

  private async getCachedLicense(userId: string): Promise<LicenseInfo | null> {
    const kv = this.env.SESSION_CACHE;
    if (!kv) return null;
    try {
      const raw = await kv.get(this.cacheKey(userId));
      if (!raw) return null;
      return JSON.parse(raw) as LicenseInfo;
    } catch {
      return null;
    }
  }

  private async setCachedLicense(userId: string, license: LicenseInfo): Promise<void> {
    const kv = this.env.SESSION_CACHE;
    if (!kv) return;
    try {
      await kv.put(this.cacheKey(userId), JSON.stringify(license), { expirationTtl: 300 });
    } catch {}
  }

  private async deleteCachedLicense(userId: string): Promise<void> {
    const kv = this.env.SESSION_CACHE;
    if (!kv) return;
    try {
      await kv.delete(this.cacheKey(userId));
    } catch {}
  }

  private async loadLicense(userId: string): Promise<LicenseInfo | null> {
    const cached = await this.getCachedLicense(userId);
    if (cached) return cached;

    const key = await this.authRepo.getLicenseKey(userId);
    if (!key) return null;
    try {
      const license = await this.verifyToken(key);
      await this.setCachedLicense(userId, license);
      return license;
    } catch {
      return null;
    }
  }

  async verifyToken(tokenStr: string): Promise<LicenseInfo> {
    let cleanToken = tokenStr.trim();
    if (cleanToken.includes('SWAZZ_LICENSE_KEY:')) {
      cleanToken = cleanToken.split('SWAZZ_LICENSE_KEY:')[1].trim();
    }
    const lines = cleanToken.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.startsWith('eyJ') && line.split('.').length === 3) {
        cleanToken = line;
        break;
      }
    }

    const parts = cleanToken.split('.');
    if (parts.length !== 3) {
      throw new Error('license: invalid token format|400');
    }

    const [headerB64, payloadB64, sigB64] = parts;
    const sigBytes = base64UrlDecode(sigB64);
    if (sigBytes.length !== 64) {
      throw new Error('license: invalid signature|400');
    }

    const pubKeyHex = this.getPublicKeyHex();
    const pubKeyBytes = hexToBytes(pubKeyHex);
    if (pubKeyBytes.length !== 32) {
      throw new Error('license: public key not configured|500');
    }

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      pubKeyBytes,
      { name: 'Ed25519' },
      true,
      ['verify']
    );

    const signedMessage = new TextEncoder().encode(headerB64 + '.' + payloadB64);
    const valid = await crypto.subtle.verify('Ed25519', cryptoKey, sigBytes, signedMessage);
    if (!valid) {
      throw new Error('license: invalid signature|400');
    }

    const payloadBytes = base64UrlDecode(payloadB64);
    let payload: any;
    try {
      payload = JSON.parse(new TextDecoder().decode(payloadBytes));
    } catch {
      throw new Error('license: invalid token format|400');
    }

    if (payload.expires_at) {
      const expires = new Date(payload.expires_at);
      if (isNaN(expires.getTime())) {
        throw new Error('license: invalid token format|400');
      }
      if (expires.getTime() < Date.now()) {
        throw new Error('license: expired license|403');
      }
    }

    const features = Array.isArray(payload.features) ? payload.features : [];
    const hasUnlimited = features.some((f: string) => {
      const fl = String(f).toLowerCase();
      return fl === '*' || fl === 'all' || fl === 'unlimited_scans';
    });

    // Clamp max_concurrency: 0/absent → 5 (or 1000 when unlimited_scans is
    // granted without an explicit value), >1000 → 1000. Mirrors the Go gate.
    let maxConcurrency = payload.max_concurrency;
    if (typeof maxConcurrency !== 'number' || maxConcurrency <= 0) {
      maxConcurrency = hasUnlimited ? 1000 : 5;
    } else if (maxConcurrency > 1000) {
      maxConcurrency = 1000;
    }

    return {
      company: payload.company || '',
      expires_at: payload.expires_at || '',
      features,
      max_users: payload.max_users,
      max_concurrency: maxConcurrency,
    };
  }

  private hasFeatureIn(license: LicenseInfo | null, feature: string): boolean {
    if (!license) return false;
    const lower = feature.toLowerCase();
    return license.features.some((f) => {
      const fl = f.toLowerCase();
      return fl === '*' || fl === 'all' || fl === lower;
    });
  }

  async activate(userId: string, licenseKey: string): Promise<{ status: string; license: LicenseInfo }> {
    const license = await this.verifyToken(licenseKey);
    await this.authRepo.setLicenseKey(userId, licenseKey.trim());
    await this.setCachedLicense(userId, license);
    return { status: 'ok', license };
  }

  async deactivate(userId: string): Promise<{ status: string }> {
    await this.authRepo.setLicenseKey(userId, null);
    await this.deleteCachedLicense(userId);
    return { status: 'ok' };
  }

  async getStatus(userId: string): Promise<{ status: string; license: LicenseInfo | null }> {
    const license = await this.loadLicense(userId);
    if (license) {
      return { status: 'active', license };
    }
    const key = await this.authRepo.getLicenseKey(userId);
    return { status: key ? 'invalid' : 'community', license: null };
  }

  async hasFeature(userId: string, feature: string): Promise<boolean> {
    const license = await this.loadLicense(userId);
    return this.hasFeatureIn(license, feature);
  }

  async getTrialStatus(userId: string): Promise<TrialStatus> {
    const claimedAt = await this.authRepo.getTrialClaimedAt(userId);
    if (!claimedAt) {
      return {
        claimed: false,
        claimed_at: null,
        can_claim: true,
        cooldown_remaining_ms: 0,
        next_available_at: null,
      };
    }

    const lastClaimed = new Date(claimedAt).getTime();
    if (isNaN(lastClaimed)) {
      return {
        claimed: true,
        claimed_at: claimedAt,
        can_claim: true,
        cooldown_remaining_ms: 0,
        next_available_at: null,
      };
    }

    const elapsed = Date.now() - lastClaimed;
    if (elapsed >= TRIAL_COOLDOWN_MS) {
      return {
        claimed: true,
        claimed_at: claimedAt,
        can_claim: true,
        cooldown_remaining_ms: 0,
        next_available_at: null,
      };
    }

    const remaining = TRIAL_COOLDOWN_MS - elapsed;
    const nextAvailableAt = new Date(lastClaimed + TRIAL_COOLDOWN_MS).toISOString();
    return {
      claimed: true,
      claimed_at: claimedAt,
      can_claim: false,
      cooldown_remaining_ms: remaining,
      next_available_at: nextAvailableAt,
    };
  }

  async claimTrial(userId: string, username: string): Promise<{ status: string; license: LicenseInfo; token: string }> {
    const trialStatus = await this.getTrialStatus(userId);
    if (!trialStatus.can_claim) {
      const hoursLeft = Math.max(1, Math.ceil(trialStatus.cooldown_remaining_ms / (60 * 60 * 1000)));
      throw new Error(`Trial license can only be generated once every 24 hours. Next trial available in ${hoursLeft} hour${hoursLeft === 1 ? '' : 's'}|429`);
    }

    let privKeyHex = this.env.SWAZZ_LICENSE_PRIVKEY;
    if (this.env.NODE_ENV === 'production') {
      if (!privKeyHex) {
        throw new Error('Trial license generation is not configured on this server|503');
      }
      if (privKeyHex === DEFAULT_DEV_LICENSE_PRIVKEY_HEX) {
        throw new Error('Development private key is forbidden in production environment|500');
      }
    } else if (!privKeyHex) {
      const pubKeyHex = this.getPublicKeyHex();
      if (pubKeyHex === DEFAULT_LICENSE_PUBKEY_HEX) {
        privKeyHex = DEFAULT_DEV_LICENSE_PRIVKEY_HEX;
      }
    }

    if (!privKeyHex) {
      throw new Error('Trial license generation is not configured on this server|503');
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + TRIAL_DURATION_MS).toISOString();
    const company = username ? `${username} (14-Day Trial)` : 'Swazz Trial User';

    const payload = {
      company,
      expires_at: expiresAt,
      features: ['*'],
      max_users: 1,
      max_concurrency: 1000,
    };

    const token = await signLicenseToken(privKeyHex, payload);
    const license = await this.verifyToken(token);

    await this.authRepo.setTrialClaimedAt(userId);
    await this.authRepo.setLicenseKey(userId, token);
    await this.setCachedLicense(userId, license);

    return { status: 'ok', license, token };
  }
}
