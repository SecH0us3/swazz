// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)

import { describe, it, expect } from 'vitest';
import {
  isTrialLicense,
  licenseTierLabel,
  daysBadgeTone,
  formatLicenseDate,
  formatLicenseDateTime,
  hasFeature,
  LicenseInfo,
  LicenseStatus,
  FREE_CONCURRENCY_CEILING,
  MAX_CONCURRENCY_CEILING,
} from './license.js';

describe('utils/license', () => {
  describe('formatLicenseDate and formatLicenseDateTime', () => {
    it('formats date unambiguously with month name', () => {
      const iso = '2027-04-09T14:32:00Z';
      const formatted = formatLicenseDate(iso);
      expect(formatted).toContain('Apr');
      expect(formatted).toContain('2027');
      expect(formatted).toContain('9');
    });

    it('formats date time with hour and minute', () => {
      const iso = '2027-04-09T14:32:00Z';
      const formatted = formatLicenseDateTime(iso);
      expect(formatted).toContain('Apr');
      expect(formatted).toContain('2027');
      expect(formatted).toContain('9');
    });

    it('returns raw string for invalid date', () => {
      expect(formatLicenseDate('not-a-date')).toBe('not-a-date');
      expect(formatLicenseDateTime('not-a-date')).toBe('not-a-date');
    });
  });

  describe('daysBadgeTone', () => {
    it('returns ok for > 30 days', () => {
      expect(daysBadgeTone(31)).toBe('ok');
      expect(daysBadgeTone(100)).toBe('ok');
      expect(daysBadgeTone(365)).toBe('ok');
    });

    it('returns warn for 8 to 30 days', () => {
      expect(daysBadgeTone(30)).toBe('warn');
      expect(daysBadgeTone(15)).toBe('warn');
      expect(daysBadgeTone(8)).toBe('warn');
    });

    it('returns danger for <= 7 days', () => {
      expect(daysBadgeTone(7)).toBe('danger');
      expect(daysBadgeTone(1)).toBe('danger');
      expect(daysBadgeTone(0)).toBe('danger');
    });
  });

  describe('hasFeature with status: expired', () => {
    it('returns false for status expired even if feature is present', () => {
      const status: LicenseStatus = {
        status: 'expired',
        license: {
          company: 'Acme',
          expires_at: '2026-01-01T00:00:00Z',
          features: ['*'],
          kind: 'commercial',
        },
      };
      expect(hasFeature(status, 'ai_remediation_pro')).toBe(false);
      expect(hasFeature(status, 'enterprise')).toBe(false);
    });

    it('returns true for status active when feature is present or wildcard', () => {
      const status: LicenseStatus = {
        status: 'active',
        license: {
          company: 'Acme',
          expires_at: '2027-01-01T00:00:00Z',
          features: ['*'],
          kind: 'commercial',
        },
      };
      expect(hasFeature(status, 'ai_remediation_pro')).toBe(true);

      const statusWithSpecific: LicenseStatus = {
        status: 'active',
        license: {
          company: 'Acme',
          expires_at: '2027-01-01T00:00:00Z',
          features: ['scheduled_runs'],
          kind: 'commercial',
        },
      };
      expect(hasFeature(statusWithSpecific, 'scheduled_runs')).toBe(true);
      expect(hasFeature(statusWithSpecific, 'enterprise')).toBe(false);
    });

    it('returns false for community or invalid status', () => {
      expect(hasFeature({ status: 'community', license: null }, 'enterprise')).toBe(false);
      expect(hasFeature({ status: 'invalid', license: null }, 'enterprise')).toBe(false);
      expect(hasFeature(null, 'enterprise')).toBe(false);
    });
  });

  describe('isTrialLicense', () => {
    it('uses explicit kind field when present', () => {
      const trialLic: LicenseInfo = {
        company: 'Acme Corp',
        expires_at: '2027-01-01',
        features: ['*'],
        kind: 'trial',
      };
      expect(isTrialLicense(trialLic)).toBe(true);

      const commLic: LicenseInfo = {
        company: 'tester (14-Day Trial)',
        expires_at: '2027-01-01',
        features: ['*'],
        kind: 'commercial',
      };
      expect(isTrialLicense(commLic)).toBe(false);
    });

    it('falls back to company convention when kind is missing', () => {
      const legacyTrial: LicenseInfo = {
        company: 'user123 (14-Day Trial)',
        expires_at: '2027-01-01',
        features: ['*'],
      };
      expect(isTrialLicense(legacyTrial)).toBe(true);

      const legacyCommercial: LicenseInfo = {
        company: 'Big Corp',
        expires_at: '2027-01-01',
        features: ['*'],
      };
      expect(isTrialLicense(legacyCommercial)).toBe(false);
    });

    it('returns false for null/undefined', () => {
      expect(isTrialLicense(null)).toBe(false);
      expect(isTrialLicense(undefined)).toBe(false);
    });
  });

  describe('licenseTierLabel', () => {
    it('returns Trial License Active for trial license', () => {
      expect(licenseTierLabel({ company: 'A', expires_at: '', features: ['*'], kind: 'trial' })).toBe(
        'Trial License Active'
      );
    });

    it('returns Enterprise License Active for commercial with wildcard or enterprise feature', () => {
      expect(licenseTierLabel({ company: 'A', expires_at: '', features: ['*'], kind: 'commercial' })).toBe(
        'Enterprise License Active'
      );
      expect(licenseTierLabel({ company: 'A', expires_at: '', features: ['enterprise'], kind: 'commercial' })).toBe(
        'Enterprise License Active'
      );
    });

    it('returns Commercial License Active for commercial without enterprise', () => {
      expect(
        licenseTierLabel({ company: 'A', expires_at: '', features: ['scheduled_runs'], kind: 'commercial' })
      ).toBe('Commercial License Active');
    });
  });

  describe('concurrency ceilings', () => {
    it('exports the expected default free and max concurrency ceilings', () => {
      expect(FREE_CONCURRENCY_CEILING).toBe(5);
      expect(MAX_CONCURRENCY_CEILING).toBe(1000);
    });
  });
});
