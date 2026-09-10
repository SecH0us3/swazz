// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '../../store/appStore.js';
import {
  LicenseStatus,
  isTrialLicense,
  licenseTierLabel,
  daysBadgeTone,
  formatLicenseDate,
  isComingSoon,
  FREE_CONCURRENCY_CEILING,
  MAX_CONCURRENCY_CEILING,
} from '../../utils/license.js';
import { getFeatureLabel } from '@swazz/shared';
import {
  fetchLicenseStatus,
  fetchTrialStatus,
  activateLicense,
  deactivateLicense,
  claimTrialLicense,
  verifyLicenseKey,
  normalizeLicenseKey,
  TrialStatusData,
} from '../../services/licenseService.js';
import { ContactSalesCard } from './ContactSalesCard.js';
import { Modal } from '../Shared/Modal.js';

function isJwtLike(raw: string): boolean {
  if (!raw) return false;
  const normalized = normalizeLicenseKey(raw);
  if (!normalized.startsWith('eyJ')) return false;
  const parts = normalized.split('.');
  return parts.length === 3 && parts.every((p) => p.length > 0);
}

export function LicenseTab() {
  const userProfile = useAppStore((state) => state.userProfile);
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [trialStatus, setTrialStatus] = useState<TrialStatusData | null>(null);
  const [licenseKey, setLicenseKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isActivating, setIsActivating] = useState(false);
  const [isClaimingTrial, setIsClaimingTrial] = useState(false);
  const [claimedToken, setClaimedToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [showDeactivateModal, setShowDeactivateModal] = useState(false);
  const [keyPreview, setKeyPreview] = useState<{
    valid: boolean;
    license?: any;
    error?: string;
  } | null>(null);

  const lastVerifyTimeRef = useRef<number>(0);
  const verifyTimeoutRef = useRef<any>(null);
  const lastVerifiedKeyRef = useRef<string>('');
  const pendingKeyRef = useRef<string>('');
  const licenseKeyRef = useRef(licenseKey);
  licenseKeyRef.current = licenseKey;

  const performVerification = useCallback(async (rawKey: string) => {
    const normalized = normalizeLicenseKey(rawKey);
    if (!isJwtLike(rawKey)) {
      setKeyPreview(null);
      return;
    }
    lastVerifiedKeyRef.current = normalized;
    try {
      const res = await verifyLicenseKey(normalized);
      setKeyPreview(res);
    } catch {
      setKeyPreview({ valid: false, error: 'Failed to verify key' });
    }
  }, []);

  const scheduleVerification = useCallback((rawKey: string) => {
    if (!isJwtLike(rawKey)) {
      setKeyPreview(null);
      return;
    }
    const normalized = normalizeLicenseKey(rawKey);
    if (normalized === lastVerifiedKeyRef.current && keyPreview !== null) {
      return;
    }

    pendingKeyRef.current = normalized;
    const now = Date.now();
    const elapsed = now - lastVerifyTimeRef.current;

    if (verifyTimeoutRef.current) {
      clearTimeout(verifyTimeoutRef.current);
      verifyTimeoutRef.current = null;
    }

    if (elapsed >= 1000) {
      lastVerifyTimeRef.current = now;
      performVerification(rawKey);
    } else {
      const delay = 1000 - elapsed;
      verifyTimeoutRef.current = setTimeout(() => {
        lastVerifyTimeRef.current = Date.now();
        performVerification(rawKey);
      }, delay);
    }
  }, [keyPreview, performVerification]);

  useEffect(() => {
    return () => {
      if (verifyTimeoutRef.current) {
        clearTimeout(verifyTimeoutRef.current);
      }
    };
  }, []);

  const fetchStatus = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const [licData, trialData] = await Promise.all([
        fetchLicenseStatus(),
        fetchTrialStatus().catch(() => null),
      ]);
      setStatus(licData);
      useAppStore.setState({ licenseStatus: licData });
      if (trialData) {
        setTrialStatus(trialData);
      }
    } catch (err: any) {
      console.error('Failed to fetch license status', err);
      setError(err.message || 'Failed to fetch license status');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (userProfile && !userProfile.isGuest) {
      fetchStatus();
    }
  }, [userProfile, fetchStatus]);

  const handleKeyChange = (val: string) => {
    setLicenseKey(val);
    const normalized = normalizeLicenseKey(val);
    if (normalized !== lastVerifiedKeyRef.current && normalized !== pendingKeyRef.current) {
      setKeyPreview(null);
      if (verifyTimeoutRef.current) {
        clearTimeout(verifyTimeoutRef.current);
        verifyTimeoutRef.current = null;
      }
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData?.getData('text');
    if (pasted) {
      scheduleVerification(pasted);
    } else {
      setTimeout(() => {
        scheduleVerification(licenseKeyRef.current);
      }, 0);
    }
  };

  const handleBlur = () => {
    scheduleVerification(licenseKey);
  };

  const handleActivate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!licenseKey.trim()) return;
    setIsActivating(true);
    setError('');
    setSuccess('');
    try {
      const data = await activateLicense(licenseKey);
      const newStatus: LicenseStatus = { status: 'active', license: data.license };
      setStatus(newStatus);
      useAppStore.setState({ licenseStatus: newStatus });
      setLicenseKey('');
      setKeyPreview(null);
      lastVerifiedKeyRef.current = '';
      pendingKeyRef.current = '';
      if (verifyTimeoutRef.current) {
        clearTimeout(verifyTimeoutRef.current);
        verifyTimeoutRef.current = null;
      }
      setSuccess(`License activated for ${data.license.company}!`);
    } catch (err: any) {
      setError(err.message || 'Failed to activate license');
    } finally {
      setIsActivating(false);
    }
  };

  const handleClaimTrial = async () => {
    setIsClaimingTrial(true);
    setError('');
    setSuccess('');
    try {
      const data = await claimTrialLicense();
      const isRenewal = isActive && trial;
      const newStatus: LicenseStatus = { status: 'active', license: data.license };
      setStatus(newStatus);
      setTrialStatus({
        claimed: true,
        claimed_at: new Date().toISOString(),
        can_claim: false,
        cooldown_remaining_ms: 24 * 60 * 60 * 1000,
      });
      if (data.token) {
        setClaimedToken(data.token);
      }
      useAppStore.setState({ licenseStatus: newStatus });
      setSuccess(
        isRenewal
          ? '14-day free trial license renewed successfully!'
          : '14-day free trial license activated successfully!'
      );
    } catch (err: any) {
      setError(err.message || 'Failed to claim trial license');
    } finally {
      setIsClaimingTrial(false);
    }
  };

  const handleCopyToken = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedToken(true);
    setTimeout(() => setCopiedToken(false), 2000);
  };

  const handleDeactivate = async () => {
    setShowDeactivateModal(false);
    setIsActivating(true);
    setError('');
    setSuccess('');
    try {
      await deactivateLicense();
      const newStatus: LicenseStatus = { status: 'community', license: null };
      setStatus(newStatus);
      setClaimedToken(null);
      useAppStore.setState({ licenseStatus: newStatus });
      setSuccess('License deactivated.');
    } catch (err: any) {
      setError(err.message || 'Failed to deactivate license');
    } finally {
      setIsActivating(false);
    }
  };

  if (userProfile?.isGuest) {
    return (
      <div className="settings-card">
        <h2 className="settings-card-title">License & Subscription</h2>
        <p className="settings-danger-text">License management is only available for registered users.</p>
      </div>
    );
  }

  const isActive = status?.status === 'active' && Boolean(status?.license);
  const isExpired = status?.status === 'expired' && Boolean(status?.license);
  const trial = isTrialLicense(status?.license);
  const remainingDays = status?.license?.expires_at
    ? Math.max(0, Math.ceil((new Date(status.license.expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
    : null;
  const daysAgo = status?.license?.expires_at
    ? Math.max(0, Math.floor((Date.now() - new Date(status.license.expires_at).getTime()) / (1000 * 60 * 60 * 24)))
    : null;
  const canClaimTrial = trialStatus ? (trialStatus.can_claim ?? !trialStatus.claimed) : true;
  const cooldownHours = trialStatus?.cooldown_remaining_ms
    ? Math.max(1, Math.ceil(trialStatus.cooldown_remaining_ms / (60 * 60 * 1000)))
    : null;

  return (
    <div className="settings-card">
      <h2 className="settings-card-title">License & Subscription</h2>
      <p className="settings-card-desc">
        Activate a Swazz license key to unlock paid features: high concurrency, scheduled runs,
        report exports, AI remediation, cloud history, and enterprise tools.
      </p>

      {/* 1. Trial claim or cooldown banner */}
      {!isLoading && !isActive && !isExpired && canClaimTrial && (
        <div className="trial-claim-card">
          <div className="trial-claim-header">
            <div className="trial-claim-title-group">
              <span className="trial-claim-icon">🚀</span>
              <div>
                <h3 className="trial-claim-title">14-Day Free Trial</h3>
                <p className="trial-claim-subtitle">
                  Evaluate full enterprise capabilities: high concurrency, scheduled runs, report exports, and AI remediation.
                </p>
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleClaimTrial}
              disabled={isClaimingTrial}
            >
              {isClaimingTrial ? 'Activating Trial...' : 'Claim 14-Day Free Trial'}
            </button>
          </div>
        </div>
      )}

      {!isLoading && !isActive && !isExpired && !canClaimTrial && (
        <div className="trial-used-notice">
          ✓ Trial claimed today. Next 14-day free trial will be available in {cooldownHours ? `${cooldownHours} hour${cooldownHours === 1 ? '' : 's'}` : '24 hours'}.
        </div>
      )}

      {/* 2. License Status Card (Loading skeleton, active, expired, or community) */}
      {isLoading ? (
        <div className="license-skeleton" aria-busy="true" aria-label="Loading license status..." />
      ) : status ? (
        <div className="license-status-container">
          {isActive ? (
            <>
              <div className="settings-flex-row settings-flex-between">
                <div className="license-status-badge active">
                  <span className="account-status-dot active" />
                  {licenseTierLabel(status.license)}
                </div>
                <div className="license-badge-actions">
                  {trial && canClaimTrial && (
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={handleClaimTrial}
                      disabled={isClaimingTrial}
                    >
                      {isClaimingTrial ? 'Renewing...' : 'Renew 14-Day Trial'}
                    </button>
                  )}
                  {remainingDays !== null && (
                    <span className={`license-days-badge ${daysBadgeTone(remainingDays)}`}>
                      {remainingDays} day{remainingDays === 1 ? '' : 's'} remaining
                    </span>
                  )}
                </div>
              </div>

              <div className="license-info-grid">
                <div className="license-info-item">
                  <span className="license-info-label">Company / Account</span>
                  <span className="license-info-value">{status.license!.company}</span>
                </div>
                <div className="license-info-item">
                  <span className="license-info-label">Expires</span>
                  <span className="license-info-value" title={status.license!.expires_at}>
                    {formatLicenseDate(status.license!.expires_at)}
                  </span>
                </div>
                {status.license!.max_concurrency ? (
                  <div className="license-info-item">
                    <span className="license-info-label">Max Concurrency</span>
                    <span className="license-info-value">
                      {status.license!.max_concurrency}{' '}
                      <span className="license-info-sub">
                        free tier: {FREE_CONCURRENCY_CEILING} · max: {MAX_CONCURRENCY_CEILING}
                      </span>
                    </span>
                  </div>
                ) : null}
                {status.license!.key_fingerprint ? (
                  <div className="license-info-item">
                    <span className="license-info-label">Key</span>
                    <span className="license-info-value mono">
                      {status.license!.key_fingerprint}...
                    </span>
                  </div>
                ) : null}
              </div>

              {!trial && remainingDays !== null && remainingDays <= 30 && (
                <div className="license-expiring-hint">
                  <span>⚠️ License expiring soon ({remainingDays} {remainingDays === 1 ? 'day' : 'days'} remaining). Contact sales below to renew.</span>
                </div>
              )}
              {trial && remainingDays !== null && remainingDays <= 3 && (
                <div className="license-expiring-hint">
                  <span>⚠️ Trial expiring soon ({remainingDays} {remainingDays === 1 ? 'day' : 'days'} remaining). Contact sales below to renew.</span>
                </div>
              )}

              <div className="license-features-list">
                {status.license!.features.map((f) => {
                  const soon = isComingSoon(f);
                  return (
                    <span key={f} className={`license-feature-badge${soon ? ' muted' : ''}`}>
                      {f === '*' ? 'All Features' : `${getFeatureLabel(f)}${soon ? ' · soon' : ''}`}
                    </span>
                  );
                })}
              </div>

              {claimedToken && (
                <div className="trial-token-box">
                  <span className="trial-token-label">License Key (Runner CLI)</span>
                  <div className="trial-token-field">
                    <div className="trial-token-content">{claimedToken}</div>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs response-copy-btn"
                      onClick={() => handleCopyToken(claimedToken)}
                    >
                      {copiedToken ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                  <p className="trial-instructions">
                    Pass to CLI runner: <code>export SWAZZ_LICENSE_KEY=&quot;{claimedToken.slice(0, 24)}...&quot;</code>
                  </p>
                </div>
              )}
            </>
          ) : isExpired ? (
            <>
              <div className="settings-flex-row settings-flex-between">
                <div className="license-status-badge expired">
                  <span className="account-status-dot expired" />
                  License Expired
                </div>
              </div>
              <div className="license-info-grid">
                <div className="license-info-item">
                  <span className="license-info-label">Company / Account</span>
                  <span className="license-info-value">{status.license!.company}</span>
                </div>
                <div className="license-info-item">
                  <span className="license-info-label">Expired</span>
                  <span className="license-info-value" title={status.license!.expires_at}>
                    Expired on {formatLicenseDate(status.license!.expires_at)}
                    {daysAgo !== null && daysAgo > 0 ? ` (${daysAgo} day${daysAgo === 1 ? '' : 's'} ago)` : ''}
                  </span>
                </div>
                {status.license!.key_fingerprint ? (
                  <div className="license-info-item">
                    <span className="license-info-label">Key</span>
                    <span className="license-info-value mono">
                      {status.license!.key_fingerprint}...
                    </span>
                  </div>
                ) : null}
              </div>
              <div className="license-expired-hint">
                <span>Paid features are locked. Please activate a new key or contact sales below to renew.</span>
              </div>
            </>
          ) : (
            <div className="license-status-badge inactive">
              <span className="account-status-dot inactive" />
              {status.status === 'invalid' ? 'License Invalid' : 'Community (Free) Mode'}
            </div>
          )}
        </div>
      ) : null}

      {/* Alerts */}
      {error && (
        <div className="two-factor-error-alert" role="alert" aria-live="polite">
          {error}
        </div>
      )}
      {success && (
        <div className="two-factor-success-alert" role="alert" aria-live="polite">
          {success}
        </div>
      )}

      {/* 3. Commercial License Key input form */}
      <form onSubmit={handleActivate} className="settings-form-group">
        <label htmlFor="license-key-input" className="settings-form-label">Commercial License Key</label>
        <div className="license-input-container">
          <textarea
            id="license-key-input"
            rows={2}
            className="license-key-textarea"
            value={licenseKey}
            onChange={(e) => handleKeyChange(e.target.value)}
            onPaste={handlePaste}
            onBlur={handleBlur}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
              }
            }}
            placeholder="Paste your SWAZZ_LICENSE_KEY here"
            data-1p-ignore
          />
          {keyPreview && (
            <div className={`license-verify-preview ${keyPreview.valid ? 'valid' : 'invalid'}`}>
              {keyPreview.valid
                ? `✓ ${keyPreview.license?.company} · ${keyPreview.license?.kind} · expires ${formatLicenseDate(keyPreview.license?.expires_at || '')}`
                : `✗ ${keyPreview.error || 'Invalid key signature'}`}
            </div>
          )}
          <div className="license-input-actions">
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={isActivating || !licenseKey.trim()}
            >
              {isActivating ? 'Activating...' : 'Activate'}
            </button>
          </div>
        </div>
      </form>

      {/* 4. Contact Sales card (Always rendered) */}
      <ContactSalesCard isCommercialActive={isActive && !trial} isPrimary={isExpired} />

      {/* 5. Deactivate section (at bottom with confirmation modal) */}
      {isActive && (
        <div className="license-deactivate-section">
          <p className="license-deactivate-warning">Paid features will be locked immediately.</p>
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={() => setShowDeactivateModal(true)}
            disabled={isActivating}
          >
            {isActivating ? 'Deactivating...' : 'Deactivate License'}
          </button>
        </div>
      )}

      {showDeactivateModal && (
        <Modal title="Deactivate License" onClose={() => setShowDeactivateModal(false)} width="480px">
          <div>
            <p>
              Deactivate the license for <strong>{status?.license?.company || 'this account'}</strong>? Paid features
              will be locked immediately.
            </p>
            <div className="license-modal-actions">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setShowDeactivateModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={handleDeactivate}
              >
                Deactivate
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
