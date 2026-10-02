// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React, { useState } from 'react';
import { useAppStore } from '../../store/appStore.js';
import { SALES_EMAIL } from './ContactSalesCard.js';

export const SOCIAL_POST_REVIEW_DAYS = 3;
export const SOCIAL_POST_SUBJECT = 'Swazz free 1-year license — social post';
const MAILTO_MAX_LENGTH = 1800;

export interface SocialPostLicenseRequest {
  postUrl: string;
  licenseHolder: string;
  accountEmail: string;
}

// The link only ever lands in a mailto body, but it is still the one value the reviewer
// opens from the email, so accept nothing but an absolute https:// URL.
export function isValidPostUrl(raw: string): boolean {
  const value = raw.trim();
  if (!value || /\s/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.includes('.');
  } catch {
    return false;
  }
}

export function buildSocialPostBody(req: SocialPostLicenseRequest): string {
  return [
    `Post URL: ${req.postUrl.trim()}`,
    `License holder (company / name): ${req.licenseHolder.trim()}`,
    `Swazz account email: ${req.accountEmail.trim()}`,
  ].join('\n');
}

export function buildSocialPostMailto(req: SocialPostLicenseRequest): string {
  const base = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(SOCIAL_POST_SUBJECT)}&body=`;
  const full = `${base}${encodeURIComponent(buildSocialPostBody(req))}`;
  // Every field is length-capped by the form, so this only trips on an absurd URL;
  // drop the body rather than cut a percent escape in half. "Copy Text" keeps it whole.
  return full.length <= MAILTO_MAX_LENGTH ? full : `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(SOCIAL_POST_SUBJECT)}`;
}

export function SocialPostLicenseCard() {
  const userProfile = useAppStore((state) => state.userProfile);
  const defaultEmail = userProfile?.username?.includes('@') ? userProfile.username : '';
  const [isOpen, setIsOpen] = useState(false);
  const [postUrl, setPostUrl] = useState('');
  const [licenseHolder, setLicenseHolder] = useState('');
  const [accountEmail, setAccountEmail] = useState(defaultEmail);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const req: SocialPostLicenseRequest = { postUrl, licenseHolder, accountEmail };
  const urlValid = isValidPostUrl(postUrl);
  const canSend = urlValid && licenseHolder.trim().length > 0 && accountEmail.trim().length > 0;

  const handleSend = () => {
    if (!canSend) return;
    window.location.href = buildSocialPostMailto(req);
  };

  const handleCopy = () => {
    navigator.clipboard
      .writeText(`To: ${SALES_EMAIL}\nSubject: ${SOCIAL_POST_SUBJECT}\n\n${buildSocialPostBody(req)}`)
      .then(() => setCopyState('copied'))
      .catch(() => setCopyState('failed'))
      .finally(() => setTimeout(() => setCopyState('idle'), 2500));
  };

  return (
    <div className="social-license-card">
      <div className="social-license-header">
        <div className="social-license-title-group">
          <span className="social-license-icon" aria-hidden="true">🎁</span>
          <div>
            <h3 className="social-license-title">Free 1-Year License for a Social Post</h3>
            <p className="social-license-subtitle">
              Write a public post about Swazz and get a full-featured license for 12 months — free.
            </p>
          </div>
        </div>
        {!isOpen && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setIsOpen(true)}>
            Get Free License
          </button>
        )}
      </div>

      <ol className="social-license-steps">
        <li>
          Publish a post about Swazz on LinkedIn, X, Reddit, Habr, Telegram, Medium or your blog —
          your own experience or review with a link to the product (reposts don't count).
        </li>
        <li>
          Send us the link to the post and the name the license should be issued to
          (your company, project or full name) at{' '}
          <a href={`mailto:${SALES_EMAIL}`} className="contact-sales-email-link">{SALES_EMAIL}</a>.
        </li>
        <li>
          We review requests within {SOCIAL_POST_REVIEW_DAYS} business days and reply with a license key —
          paste it into the License Key field below.
        </li>
      </ol>
      <p className="social-license-terms">
        All features · 1 user · valid for 365 days · one free license per account.
      </p>

      {isOpen && (
        <form
          className="social-license-form"
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
        >
          <div>
            <label className="settings-form-label" htmlFor="social-license-post-url">
              Link to your post <span style={{ color: 'var(--color-error)' }}>*</span>
            </label>
            <input
              id="social-license-post-url"
              type="url"
              className="input"
              value={postUrl}
              onChange={(e) => setPostUrl(e.target.value)}
              maxLength={500}
              placeholder="https://www.linkedin.com/posts/..."
              autoFocus
              required
            />
            {postUrl.trim() && !urlValid && (
              <p className="social-license-error">Enter the full https:// link to the post.</p>
            )}
          </div>

          <div>
            <label className="settings-form-label" htmlFor="social-license-holder">
              License holder (company, project or full name) <span style={{ color: 'var(--color-error)' }}>*</span>
            </label>
            <input
              id="social-license-holder"
              type="text"
              className="input"
              value={licenseHolder}
              onChange={(e) => setLicenseHolder(e.target.value)}
              maxLength={120}
              placeholder="e.g. Acme Corp or Jane Doe"
              required
            />
            <p className="social-license-hint">Shown as the license owner in the dashboard and CLI.</p>
          </div>

          <div>
            <label className="settings-form-label" htmlFor="social-license-email">
              Swazz account email <span style={{ color: 'var(--color-error)' }}>*</span>
            </label>
            <input
              id="social-license-email"
              type="email"
              className="input"
              value={accountEmail}
              onChange={(e) => setAccountEmail(e.target.value)}
              maxLength={254}
              placeholder="you@example.com"
              required
            />
          </div>

          <div className="social-license-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setIsOpen(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopy} disabled={!canSend}>
              {copyState === 'copied' ? '✓ Copied' : copyState === 'failed' ? "Couldn't copy" : 'Copy Text'}
            </button>
            <button type="submit" className="btn btn-primary btn-sm" disabled={!canSend}>
              ✉ Send Post Link
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
