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
  SocialPostLicenseCard,
  buildSocialPostBody,
  buildSocialPostMailto,
  isValidPostUrl,
  SOCIAL_POST_SUBJECT,
} from './SocialPostLicenseCard.js';
import { SALES_EMAIL } from './ContactSalesCard.js';
import { useAppStore } from '../../store/appStore.js';

describe('SocialPostLicenseCard', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({
      userProfile: { username: 'jane@acme.com', apiKey: 'k', isGuest: false },
    } as any);
  });

  afterEach(() => {
    cleanup();
  });

  describe('isValidPostUrl', () => {
    it('accepts absolute https links', () => {
      expect(isValidPostUrl('https://www.linkedin.com/posts/abc')).toBe(true);
      expect(isValidPostUrl('  https://habr.com/ru/articles/1/  ')).toBe(true);
    });

    it('rejects other schemes, bare text and whitespace', () => {
      expect(isValidPostUrl('')).toBe(false);
      expect(isValidPostUrl('http://example.com/post')).toBe(false);
      expect(isValidPostUrl('javascript:alert(1)')).toBe(false);
      expect(isValidPostUrl('linkedin.com/posts/abc')).toBe(false);
      expect(isValidPostUrl('https://localhost/post')).toBe(false);
      expect(isValidPostUrl('https://example.com/a b')).toBe(false);
    });
  });

  describe('buildSocialPostMailto', () => {
    it('lists every field the license issuer needs', () => {
      const body = buildSocialPostBody({
        postUrl: ' https://x.com/jane/status/1 ',
        licenseHolder: ' Acme Corp ',
        accountEmail: 'jane@acme.com',
      });
      expect(body).toBe(
        'Post URL: https://x.com/jane/status/1\n' +
          'License holder (company / name): Acme Corp\n' +
          'Swazz account email: jane@acme.com'
      );
    });

    it('encodes query delimiters and non-ASCII so they cannot break out of the body', () => {
      const req = {
        postUrl: 'https://habr.com/ru/post?a=1&subject=x#frag',
        licenseHolder: 'ООО Ромашка',
        accountEmail: 'jane@acme.com',
      };
      const url = buildSocialPostMailto(req);
      expect(url.startsWith(`mailto:${SALES_EMAIL}?subject=${encodeURIComponent(SOCIAL_POST_SUBJECT)}&body=`)).toBe(true);
      const body = url.slice(url.indexOf('&body=') + '&body='.length);
      expect(body).not.toMatch(/[&#?\s]/);
      expect(decodeURIComponent(body)).toBe(buildSocialPostBody(req));
    });

    it('drops the body instead of cutting an escape when the link is absurdly long', () => {
      const url = buildSocialPostMailto({
        postUrl: `https://example.com/${'я'.repeat(500)}`,
        licenseHolder: 'Acme',
        accountEmail: 'jane@acme.com',
      });
      expect(url).toBe(`mailto:${SALES_EMAIL}?subject=${encodeURIComponent(SOCIAL_POST_SUBJECT)}`);
    });
  });

  it('explains the offer and the review time', () => {
    render(<SocialPostLicenseCard />);
    expect(screen.getByText('Free 1-Year License for a Social Post')).toBeInTheDocument();
    expect(screen.getByText(/within 3 business days/)).toBeInTheDocument();
    expect(screen.getByText(/All features · 1 user · valid for 365 days/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: SALES_EMAIL })).toHaveAttribute('href', `mailto:${SALES_EMAIL}`);
  });

  it('requires a valid link and holder name before sending, prefilling the account email', async () => {
    const hrefSetter = vi.fn();
    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, set href(v: string) { hrefSetter(v); } },
    });

    try {
      render(<SocialPostLicenseCard />);
      fireEvent.click(screen.getByRole('button', { name: 'Get Free License' }));

      expect(screen.getByLabelText(/Swazz account email/)).toHaveValue('jane@acme.com');
      const send = screen.getByRole('button', { name: /Send Post Link/ });
      expect(send).toBeDisabled();

      fireEvent.change(screen.getByLabelText(/Link to your post/), { target: { value: 'not a url' } });
      fireEvent.change(screen.getByLabelText(/License holder/), { target: { value: 'Acme Corp' } });
      expect(screen.getByText(/full https:\/\/ link/)).toBeInTheDocument();
      expect(send).toBeDisabled();

      fireEvent.change(screen.getByLabelText(/Link to your post/), { target: { value: 'https://x.com/jane/status/1' } });
      expect(send).toBeEnabled();
      fireEvent.click(send);

      await waitFor(() => expect(hrefSetter).toHaveBeenCalledTimes(1));
      const sent = hrefSetter.mock.calls[0][0] as string;
      expect(decodeURIComponent(sent)).toContain('Post URL: https://x.com/jane/status/1');
      expect(decodeURIComponent(sent)).toContain('License holder (company / name): Acme Corp');
      expect(decodeURIComponent(sent)).toContain('Swazz account email: jane@acme.com');
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    }
  });
});
