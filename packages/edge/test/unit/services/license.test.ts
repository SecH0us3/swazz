// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { LicenseService, DEFAULT_LICENSE_PUBKEY_HEX, DEFAULT_DEV_LICENSE_PRIVKEY_HEX } from '../../../src/services/license';
import { FEATURE_SCHEDULED_RUNS, FEATURE_ENTERPRISE } from '@swazz/shared';
import { generateTestKeyPair, signLicenseToken } from '../../utils/license';

describe('LicenseService', () => {
  let keyPair: { pubKeyHex: string; privKeyHex: string };
  let env: any;
  let authRepo: any;

  beforeEach(async () => {
    keyPair = await generateTestKeyPair();
    env = {
      SWAZZ_LICENSE_PUBKEY: keyPair.pubKeyHex,
      SWAZZ_LICENSE_PRIVKEY: keyPair.privKeyHex,
    };
    authRepo = {
      getLicenseKey: vi.fn(),
      setLicenseKey: vi.fn(),
      getTrialClaimedAt: vi.fn().mockResolvedValue(null),
      setTrialClaimedAt: vi.fn().mockResolvedValue(undefined),
    };
  });

  function makeService() {
    return new LicenseService(env, authRepo);
  }

  it('verifies a valid token and returns license info', async () => {
    const token = await signLicenseToken(keyPair.privKeyHex, {
      company: 'Acme',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      features: ['scheduled_runs', 'enterprise'],
      max_concurrency: 50,
    });

    const license = await makeService().verifyToken(token);
    expect(license.company).toBe('Acme');
    expect(license.features).toContain('scheduled_runs');
    expect(license.max_concurrency).toBe(50);
  });

  it('rejects a token with invalid signature', async () => {
    const other = await generateTestKeyPair();
    const token = await signLicenseToken(other.privKeyHex, {
      company: 'Evil',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      features: ['*'],
    });

    await expect(makeService().verifyToken(token)).rejects.toThrow('invalid signature');
  });

  it('rejects an expired token', async () => {
    const token = await signLicenseToken(keyPair.privKeyHex, {
      company: 'Old',
      expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
      features: ['*'],
    });

    await expect(makeService().verifyToken(token)).rejects.toThrow('expired license');
  });

  it('rejects malformed tokens', async () => {
    await expect(makeService().verifyToken('not.a.token')).rejects.toThrow('invalid token format');
  });

  it('activate stores the key and returns status', async () => {
    const token = await signLicenseToken(keyPair.privKeyHex, {
      company: 'Acme',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      features: ['*'],
    });

    const result = await makeService().activate('user-1', token);
    expect(result.status).toBe('ok');
    expect(authRepo.setLicenseKey).toHaveBeenCalledWith('user-1', token);
  });

  it('getStatus returns community when no key stored', async () => {
    authRepo.getLicenseKey.mockResolvedValue(null);
    const result = await makeService().getStatus('user-1');
    expect(result.status).toBe('community');
    expect(result.license).toBeNull();
  });

  it('getStatus returns active with license info', async () => {
    const token = await signLicenseToken(keyPair.privKeyHex, {
      company: 'Acme',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      features: ['scheduled_runs'],
    });
    authRepo.getLicenseKey.mockResolvedValue(token);

    const result = await makeService().getStatus('user-1');
    expect(result.status).toBe('active');
    expect(result.license?.company).toBe('Acme');
  });

  it('getStatus returns invalid for a tampered stored key', async () => {
    authRepo.getLicenseKey.mockResolvedValue('tampered.token.value');
    const result = await makeService().getStatus('user-1');
    expect(result.status).toBe('invalid');
  });

  it('hasFeature returns false without a key', async () => {
    authRepo.getLicenseKey.mockResolvedValue(null);
    expect(await makeService().hasFeature('user-1', FEATURE_SCHEDULED_RUNS)).toBe(false);
  });

  it('hasFeature returns true for granted features', async () => {
    const token = await signLicenseToken(keyPair.privKeyHex, {
      company: 'Acme',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      features: [FEATURE_SCHEDULED_RUNS],
    });
    authRepo.getLicenseKey.mockResolvedValue(token);

    expect(await makeService().hasFeature('user-1', FEATURE_SCHEDULED_RUNS)).toBe(true);
    expect(await makeService().hasFeature('user-1', FEATURE_ENTERPRISE)).toBe(false);
  });

  it('hasFeature returns true for wildcard licenses', async () => {
    const token = await signLicenseToken(keyPair.privKeyHex, {
      company: 'Acme',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      features: ['*'],
    });
    authRepo.getLicenseKey.mockResolvedValue(token);

    expect(await makeService().hasFeature('user-1', FEATURE_ENTERPRISE)).toBe(true);
  });

  it('hasFeature returns false for an expired stored key', async () => {
    const token = await signLicenseToken(keyPair.privKeyHex, {
      company: 'Old',
      expires_at: new Date(Date.now() - 60 * 1000).toISOString(),
      features: ['*'],
    });
    authRepo.getLicenseKey.mockResolvedValue(token);

    expect(await makeService().hasFeature('user-1', FEATURE_SCHEDULED_RUNS)).toBe(false);
  });

  it('clamps max_concurrency to 1000 when above the cap', async () => {
    const token = await signLicenseToken(keyPair.privKeyHex, {
      company: 'Overkill',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      features: ['unlimited_scans'],
      max_concurrency: 5000,
    });

    const license = await makeService().verifyToken(token);
    expect(license.max_concurrency).toBe(1000);
  });

  it('defaults max_concurrency to 1000 when unlimited_scans granted without a value', async () => {
    const token = await signLicenseToken(keyPair.privKeyHex, {
      company: 'Unlimited',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      features: ['unlimited_scans'],
    });

    const license = await makeService().verifyToken(token);
    expect(license.max_concurrency).toBe(1000);
  });

  it('defaults max_concurrency to 5 without unlimited_scans', async () => {
    const token = await signLicenseToken(keyPair.privKeyHex, {
      company: 'Free',
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      features: ['scheduled_runs'],
    });

    const license = await makeService().verifyToken(token);
    expect(license.max_concurrency).toBe(5);
  });

  it('deactivate clears the stored key and the cache', async () => {
    const kv = {
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
    };
    const service = new LicenseService({ ...env, SESSION_CACHE: kv }, authRepo);

    const result = await service.deactivate('user-1');
    expect(result.status).toBe('ok');
    expect(authRepo.setLicenseKey).toHaveBeenCalledWith('user-1', null);
    expect(kv.delete).toHaveBeenCalledWith('license:user-1');
  });

  describe('Trial License', () => {
    it('getTrialStatus returns unclaimed state initially with can_claim true', async () => {
      authRepo.getTrialClaimedAt.mockResolvedValue(null);
      const res = await makeService().getTrialStatus('user-1');
      expect(res.claimed).toBe(false);
      expect(res.claimed_at).toBeNull();
      expect(res.can_claim).toBe(true);
      expect(res.cooldown_remaining_ms).toBe(0);
      expect(res.next_available_at).toBeNull();
    });

    it('getTrialStatus returns cooldown active when claimed within 24 hours', async () => {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      authRepo.getTrialClaimedAt.mockResolvedValue(oneHourAgo);
      const res = await makeService().getTrialStatus('user-1');
      expect(res.claimed).toBe(true);
      expect(res.claimed_at).toBe(oneHourAgo);
      expect(res.can_claim).toBe(false);
      expect(res.cooldown_remaining_ms).toBeGreaterThan(22 * 60 * 60 * 1000);
      expect(res.cooldown_remaining_ms).toBeLessThanOrEqual(23 * 60 * 60 * 1000);
      expect(res.next_available_at).toBeDefined();
    });

    it('getTrialStatus returns can_claim true when claimed more than 24 hours ago', async () => {
      const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
      authRepo.getTrialClaimedAt.mockResolvedValue(twoDaysAgo);
      const res = await makeService().getTrialStatus('user-1');
      expect(res.claimed).toBe(true);
      expect(res.claimed_at).toBe(twoDaysAgo);
      expect(res.can_claim).toBe(true);
      expect(res.cooldown_remaining_ms).toBe(0);
      expect(res.next_available_at).toBeNull();
    });

    it('claimTrial successfully generates, activates, and returns a 14-day trial token', async () => {
      const res = await makeService().claimTrial('user-1', 'alex');
      expect(res.status).toBe('ok');
      expect(res.license.company).toBe('alex (14-Day Trial)');
      expect(res.license.features).toEqual(['*']);
      expect(res.license.max_users).toBe(1);
      expect(res.license.max_concurrency).toBe(1000);
      expect(typeof res.token).toBe('string');
      expect(res.token.split('.').length).toBe(3);

      // Verify expiration is ~14 days from now
      const expiresAt = new Date(res.license.expires_at).getTime();
      const expectedMin = Date.now() + 13 * 24 * 60 * 60 * 1000;
      const expectedMax = Date.now() + 15 * 24 * 60 * 60 * 1000;
      expect(expiresAt).toBeGreaterThan(expectedMin);
      expect(expiresAt).toBeLessThan(expectedMax);

      expect(authRepo.setTrialClaimedAt).toHaveBeenCalledWith('user-1');
      expect(authRepo.setLicenseKey).toHaveBeenCalledWith('user-1', res.token);
    });

    it('claimTrial rejects if trial was claimed within 24 hours (cooldown active)', async () => {
      const recentClaim = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
      authRepo.getTrialClaimedAt.mockResolvedValue(recentClaim);
      await expect(makeService().claimTrial('user-1', 'alex')).rejects.toThrow('once every 24 hours');
      expect(authRepo.setTrialClaimedAt).not.toHaveBeenCalled();
    });

    it('claimTrial succeeds if trial was claimed more than 24 hours ago (renewal)', async () => {
      const oldClaim = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
      authRepo.getTrialClaimedAt.mockResolvedValue(oldClaim);
      const res = await makeService().claimTrial('user-1', 'alex');
      expect(res.status).toBe('ok');
      expect(authRepo.setTrialClaimedAt).toHaveBeenCalledWith('user-1');
      expect(authRepo.setLicenseKey).toHaveBeenCalledWith('user-1', res.token);
    });

    it('claimTrial rejects if SWAZZ_LICENSE_PRIVKEY is not configured with custom pubkey', async () => {
      env.SWAZZ_LICENSE_PRIVKEY = undefined;
      await expect(makeService().claimTrial('user-1', 'alex')).rejects.toThrow('Trial license generation is not configured');
    });

    it('claimTrial falls back to default dev keypair when pubkey is default and privkey is undefined', async () => {
      const defaultService = new LicenseService({}, authRepo);
      const res = await defaultService.claimTrial('user-1', 'alex');
      expect(res.status).toBe('ok');
      expect(res.license.company).toBe('alex (14-Day Trial)');
      expect(typeof res.token).toBe('string');
    });
  });

  describe('Production Dev-Key Protection (NODE_ENV === production)', () => {
    it('rejects getPublicKeyHex / verifyToken when NODE_ENV is production and SWAZZ_LICENSE_PUBKEY is not set', async () => {
      const devToken = await signLicenseToken(DEFAULT_DEV_LICENSE_PRIVKEY_HEX, {
        company: 'Dev Org',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        features: ['*'],
      });
      const service = new LicenseService({ NODE_ENV: 'production' } as any, authRepo);
      await expect(service.verifyToken(devToken)).rejects.toThrow('SWAZZ_LICENSE_PUBKEY must be configured in production');
    });

    it('rejects getPublicKeyHex / verifyToken when NODE_ENV is production and SWAZZ_LICENSE_PUBKEY is the default dev pubkey', async () => {
      const devToken = await signLicenseToken(DEFAULT_DEV_LICENSE_PRIVKEY_HEX, {
        company: 'Dev Org',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        features: ['*'],
      });
      const service = new LicenseService({
        NODE_ENV: 'production',
        SWAZZ_LICENSE_PUBKEY: DEFAULT_LICENSE_PUBKEY_HEX,
      } as any, authRepo);
      await expect(service.verifyToken(devToken)).rejects.toThrow('default development public key is forbidden in production');
    });

    it('rejects claimTrial when NODE_ENV is production and SWAZZ_LICENSE_PRIVKEY is not set', async () => {
      const service = new LicenseService({
        NODE_ENV: 'production',
        SWAZZ_LICENSE_PUBKEY: keyPair.pubKeyHex,
      } as any, authRepo);
      await expect(service.claimTrial('user-1', 'alex')).rejects.toThrow('Trial license generation is not configured on this server');
    });

    it('rejects claimTrial when NODE_ENV is production and SWAZZ_LICENSE_PRIVKEY is the default dev privkey', async () => {
      const service = new LicenseService({
        NODE_ENV: 'production',
        SWAZZ_LICENSE_PUBKEY: keyPair.pubKeyHex,
        SWAZZ_LICENSE_PRIVKEY: DEFAULT_DEV_LICENSE_PRIVKEY_HEX,
      } as any, authRepo);
      await expect(service.claimTrial('user-1', 'alex')).rejects.toThrow('Development private key is forbidden in production');
    });

    it('rejects tokens signed with dev private key in production environment', async () => {
      const prodService = new LicenseService({
        NODE_ENV: 'production',
        SWAZZ_LICENSE_PUBKEY: keyPair.pubKeyHex, // Valid production key
      } as any, authRepo);

      // Sign with default dev private key
      const devToken = await signLicenseToken(DEFAULT_DEV_LICENSE_PRIVKEY_HEX, {
        company: 'Dev Org',
        expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        features: ['*'],
      });

      // Prod service must reject dev-signed token
      await expect(prodService.verifyToken(devToken)).rejects.toThrow('invalid signature');
    });
  });
});
