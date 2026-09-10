// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)

/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import '@testing-library/jest-dom/vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import {
  ContactSalesCard,
  buildLicenseRequestBody,
  buildLicenseRequestMailto,
  SALES_EMAIL,
} from './ContactSalesCard.js';
import { FEATURES, FEATURE_TYPE_PAID } from '@swazz/shared';

describe('ContactSalesCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe('buildLicenseRequestBody', () => {
    it('includes Project and Logo consent in both states', () => {
      const bodyWithConsent = buildLicenseRequestBody({
        projectName: 'Test Project',
        logoConsent: true,
      });
      expect(bodyWithConsent).toContain('Project / Product: Test Project');
      expect(bodyWithConsent).toContain('Logo consent: yes');

      const bodyWithoutConsent = buildLicenseRequestBody({
        projectName: 'Test Project',
        logoConsent: false,
      });
      expect(bodyWithoutConsent).toContain('Project / Product: Test Project');
      expect(bodyWithoutConsent).toContain('Logo consent: no');
    });

    it('includes optional fields when provided', () => {
      const body = buildLicenseRequestBody({
        projectName: 'Acme App',
        logoConsent: true,
        company: 'Acme Corp',
        contactPerson: 'Alice',
        workEmail: 'alice@acme.com',
        expectedUsers: 25,
        expectedConcurrency: 50,
        features: ['ai_remediation_pro', 'report_exports'],
        comments: 'Need custom SLA',
      });
      expect(body).toContain('Company: Acme Corp');
      expect(body).toContain('Contact person: Alice');
      expect(body).toContain('Work email: alice@acme.com');
      expect(body).toContain('Expected users: 25');
      expect(body).toContain('Expected concurrency: 50');
      expect(body).toContain('Interested features: AI Remediation Pro, Report Exports (SARIF / HTML / MD / JUnit)');
      expect(body).toContain('Comments: Need custom SLA');
    });

    it('omits optional fields when empty', () => {
      const body = buildLicenseRequestBody({
        projectName: 'Simple',
        logoConsent: false,
      });
      expect(body).not.toContain('Company:');
      expect(body).not.toContain('Contact person:');
      expect(body).not.toContain('Work email:');
      expect(body).not.toContain('Expected users:');
      expect(body).not.toContain('Expected concurrency:');
      expect(body).not.toContain('Interested features:');
      expect(body).not.toContain('Comments:');
    });
  });

  describe('buildLicenseRequestMailto', () => {
    it('contains sales email and url-encoded subject and body', () => {
      const mailto = buildLicenseRequestMailto({
        projectName: 'My App',
        logoConsent: true,
      });
      expect(mailto.startsWith(`mailto:${SALES_EMAIL}`)).toBe(true);
      expect(mailto).toContain('subject=Swazz%20commercial%20license%20request%20%E2%80%94%20My%20App');
      expect(mailto).toContain('body=');
    });

    it('truncates mailto url if it exceeds 1800 characters', () => {
      const longComment = 'a'.repeat(3000);
      const mailto = buildLicenseRequestMailto({
        projectName: 'Big Project',
        logoConsent: true,
        comments: longComment,
      });
      expect(mailto.length).toBeLessThanOrEqual(1800);
    });
  });

  describe('Component UI', () => {
    it('renders Contact Sales card and opens modal on click', () => {
      render(<ContactSalesCard />);
      const btn = screen.getByRole('button', { name: /contact sales/i });
      expect(btn).toBeInTheDocument();

      fireEvent.click(btn);
      expect(screen.getByRole('heading', { name: /contact sales/i })).toBeInTheDocument();
    });

    it('requires project name before enabling Open in Email Client button', () => {
      render(<ContactSalesCard />);
      fireEvent.click(screen.getByRole('button', { name: /contact sales/i }));

      const openMailBtn = screen.getByRole('button', { name: /open in email client/i });
      expect(openMailBtn).toBeDisabled();

      const input = screen.getByPlaceholderText(/e\.g\. Acme API Gateway/i);
      fireEvent.change(input, { target: { value: 'Secret Project' } });

      expect(openMailBtn).not.toBeDisabled();
    });

    it('includes only paid features from FEATURES in details checkboxes', () => {
      render(<ContactSalesCard />);
      fireEvent.click(screen.getByRole('button', { name: /contact sales/i }));

      const paidFeatures = FEATURES.filter((f) => f.type === FEATURE_TYPE_PAID);
      for (const feat of paidFeatures) {
        expect(screen.getByText(feat.label)).toBeInTheDocument();
      }

      const comingSoonFeatures = FEATURES.filter((f) => f.type !== FEATURE_TYPE_PAID);
      for (const feat of comingSoonFeatures) {
        expect(screen.queryByText(feat.label)).not.toBeInTheDocument();
      }
    });

    it('copies text to clipboard when Copy Text button is clicked', async () => {
      const writeTextMock = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, {
        clipboard: {
          writeText: writeTextMock,
        },
      });

      render(<ContactSalesCard />);
      fireEvent.click(screen.getByRole('button', { name: /contact sales/i }));

      const input = screen.getByPlaceholderText(/e\.g\. Acme API Gateway/i);
      fireEvent.change(input, { target: { value: 'Secret Project' } });

      const copyBtn = screen.getByRole('button', { name: /copy text/i });
      fireEvent.click(copyBtn);

      expect(writeTextMock).toHaveBeenCalledWith(
        expect.stringContaining('Project / Product: Secret Project')
      );
      await waitFor(() => {
        expect(screen.getByRole('button', { name: /✓ copied/i })).toBeInTheDocument();
      });
    });
  });
});
