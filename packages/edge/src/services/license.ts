// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Env } from '../env';
import { IAuthRepository } from '../repositories/auth';
import { getFeatureType, FEATURE_TYPE_PAID } from '@swazz/shared';

export const DEFAULT_LICENSE_PUBKEY_HEX = 'a84976722d515a815a4a5ebcebf7ffecaa2d9735d10ea354ef3ddc45dfba8314';

export interface LicenseInfo {
  company: string;
  expires_at: string;
  features: string[];
  max_users?: number;
  max_concurrency?: number;
}

export interface ILicenseService {
  activate(userId: string, licenseKey: string): Promise<{ status: string; license: LicenseInfo }>;
  deactivate(userId: string): Promise<{ status: string }>;
  getStatus(userId: string): Promise<{ status: string; license: LicenseInfo | null }>;
  hasFeature(userId: string, feature: string): Promise<boolean>;
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

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export class LicenseService implements ILicenseService {
  constructor(private env: Env, private authRepo: IAuthRepository) {}

  private getPublicKeyHex(): string {
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
    const parts = tokenStr.trim().split('.');
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
}
