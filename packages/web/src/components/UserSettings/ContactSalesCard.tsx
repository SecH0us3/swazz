// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React, { useState, useRef, useEffect } from 'react';
import { Modal } from '../Shared/Modal.js';
import { FEATURES, FEATURE_TYPE_PAID } from '@swazz/shared';
import { useAppStore } from '../../store/appStore.js';

export const SALES_EMAIL = 'swazz@secmy.app';

export interface LicenseRequest {
  projectName: string;
  logoConsent: boolean;
  company?: string;
  contactPerson?: string;
  workEmail?: string;
  expectedUsers?: number;
  expectedConcurrency?: number;
  features?: string[];
  comments?: string;
}

export function buildLicenseRequestBody(req: LicenseRequest): string {
  const lines: string[] = [];
  lines.push(`Project / Product: ${req.projectName.trim()}`);
  lines.push(`Logo consent: ${req.logoConsent ? 'yes' : 'no'}`);

  if (req.company?.trim()) {
    lines.push(`Company: ${req.company.trim()}`);
  }
  if (req.contactPerson?.trim()) {
    lines.push(`Contact person: ${req.contactPerson.trim()}`);
  }
  if (req.workEmail?.trim()) {
    lines.push(`Work email: ${req.workEmail.trim()}`);
  }
  if (req.expectedUsers !== undefined && req.expectedUsers !== null && !isNaN(req.expectedUsers)) {
    lines.push(`Expected users: ${req.expectedUsers}`);
  }
  if (req.expectedConcurrency !== undefined && req.expectedConcurrency !== null && !isNaN(req.expectedConcurrency)) {
    lines.push(`Expected concurrency: ${req.expectedConcurrency}`);
  }
  if (req.features && req.features.length > 0) {
    const labels = req.features.map((fId) => {
      const def = FEATURES.find((f) => f.id === fId);
      return def ? def.label : fId;
    });
    lines.push(`Interested features: ${labels.join(', ')}`);
  }
  if (req.comments?.trim()) {
    lines.push(`Comments: ${req.comments.trim()}`);
  }

  return lines.join('\n');
}

export function buildLicenseRequestMailto(req: LicenseRequest): string {
  const subject = `Swazz commercial license request — ${req.projectName.trim()}`;
  const body = buildLicenseRequestBody(req);
  const base = `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(subject)}&body=`;
  const encodedBody = encodeURIComponent(body);
  const fullUrl = `${base}${encodedBody}`;

  if (fullUrl.length <= 1800) {
    return fullUrl;
  }

  const remaining = 1800 - base.length;
  if (remaining <= 0) {
    return `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(subject)}`;
  }
  return `${base}${encodedBody.slice(0, remaining)}`;
}

interface ContactSalesCardProps {
  isCommercialActive?: boolean;
  isPrimary?: boolean;
}

export function ContactSalesCard({ isCommercialActive = false, isPrimary = false }: ContactSalesCardProps) {
  const userProfile = useAppStore((state) => state.userProfile);
  const [isOpen, setIsOpen] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [logoConsent, setLogoConsent] = useState(false);
  const [company, setCompany] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [workEmail, setWorkEmail] = useState('');
  const [expectedUsers, setExpectedUsers] = useState<string>('');
  const [expectedConcurrency, setExpectedConcurrency] = useState<string>('');
  const [selectedFeatures, setSelectedFeatures] = useState<string[]>([]);
  const [comments, setComments] = useState('');
  const [copied, setCopied] = useState(false);

  const openBtnRef = useRef<HTMLButtonElement>(null);
  const projectInputRef = useRef<HTMLInputElement>(null);
  const modalContentRef = useRef<HTMLDivElement>(null);

  const handleOpen = () => {
    setIsOpen(true);
  };

  const handleClose = () => {
    setIsOpen(false);
    setTimeout(() => {
      openBtnRef.current?.focus();
    }, 0);
  };

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        projectInputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  // Focus trap inside modal
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const modalEl = modalContentRef.current;
      if (!modalEl) return;
      const focusableElements = modalEl.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusableElements.length === 0) return;
      const first = focusableElements[0];
      const last = focusableElements[focusableElements.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          last.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === last) {
          first.focus();
          e.preventDefault();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const currentReq: LicenseRequest = {
    projectName,
    logoConsent,
    company: company || undefined,
    contactPerson: contactPerson || undefined,
    workEmail: workEmail || undefined,
    expectedUsers: expectedUsers ? parseInt(expectedUsers, 10) : undefined,
    expectedConcurrency: expectedConcurrency ? parseInt(expectedConcurrency, 10) : undefined,
    features: selectedFeatures.length > 0 ? selectedFeatures : undefined,
    comments: comments || undefined,
  };

  const fullBody = buildLicenseRequestBody(currentReq);
  const mailtoUrl = buildLicenseRequestMailto(currentReq);
  const isUrlTruncated =
    `mailto:${SALES_EMAIL}?subject=${encodeURIComponent(`Swazz commercial license request — ${projectName.trim()}`)}&body=${encodeURIComponent(fullBody)}`.length > 1800;

  const handleToggleFeature = (fId: string) => {
    setSelectedFeatures((prev) =>
      prev.includes(fId) ? prev.filter((id) => id !== fId) : [...prev, fId]
    );
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(fullBody);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleOpenMail = () => {
    window.location.href = mailtoUrl;
  };

  const paidFeatures = FEATURES.filter((f) => f.type === FEATURE_TYPE_PAID);

  return (
    <>
      <div className="contact-sales-card">
        <div className="contact-sales-info">
          <h3>{isCommercialActive ? 'Renew or expand your license?' : 'Need a commercial license?'}</h3>
          <p>Contact us — we'll help tailor duration, seat count, and concurrency level.</p>
        </div>
        <button
          ref={openBtnRef}
          type="button"
          className={`btn ${isPrimary ? 'btn-primary' : 'btn-secondary'} btn-sm`}
          onClick={handleOpen}
        >
          ✉ Contact Sales
        </button>
      </div>

      {isOpen && (
        <Modal title="Contact Sales — License Request" onClose={handleClose} width="640px">
          <div ref={modalContentRef} className="contact-sales-form">
            <div>
              <label className="settings-form-label">
                Project / Product Name <span style={{ color: 'var(--color-error)' }}>*</span>
              </label>
              <input
                ref={projectInputRef}
                type="text"
                className="input"
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
                maxLength={120}
                placeholder="e.g. Acme API Gateway"
                required
                autoFocus
              />
            </div>

            <label className="contact-sales-consent">
              <input
                type="checkbox"
                checked={logoConsent}
                onChange={(e) => setLogoConsent(e.target.checked)}
              />
              <span>
                I agree to display our company logo on the Swazz website and materials as a customer{' '}
                <span className="license-info-sub">(optional, does not affect license decisions)</span>
              </span>
            </label>

            <details className="contact-sales-details">
              <summary>Specify additional details (optional)</summary>
              <div className="contact-sales-details-content">
                <div>
                  <label className="settings-form-label">Company (Legal Entity)</label>
                  <input
                    type="text"
                    className="input"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    maxLength={120}
                    placeholder="e.g. Acme Corp B.V."
                  />
                </div>

                <div>
                  <label className="settings-form-label">Contact Person</label>
                  <input
                    type="text"
                    className="input"
                    value={contactPerson}
                    onChange={(e) => setContactPerson(e.target.value)}
                    maxLength={120}
                    placeholder="e.g. Jane Doe"
                  />
                </div>

                <div>
                  <label className="settings-form-label">Work Email</label>
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <input
                      type="email"
                      className="input"
                      value={workEmail}
                      onChange={(e) => setWorkEmail(e.target.value)}
                      placeholder="jane@company.com"
                    />
                    {userProfile?.username && userProfile.username.includes('@') && (
                      <button
                        type="button"
                        className="btn btn-secondary btn-xs"
                        style={{ whiteSpace: 'nowrap' }}
                        onClick={() => setWorkEmail(userProfile.username)}
                      >
                        Use account email
                      </button>
                    )}
                  </div>
                </div>

                <div>
                  <label className="settings-form-label">Expected Number of Users (1–10,000)</label>
                  <input
                    type="number"
                    className="input"
                    min={1}
                    max={10000}
                    value={expectedUsers}
                    onChange={(e) => setExpectedUsers(e.target.value)}
                    placeholder="e.g. 10"
                  />
                </div>

                <div>
                  <label className="settings-form-label">Concurrency Needed (1–1,000)</label>
                  <input
                    type="number"
                    className="input"
                    min={1}
                    max={1000}
                    value={expectedConcurrency}
                    onChange={(e) => setExpectedConcurrency(e.target.value)}
                    placeholder="e.g. 50"
                  />
                </div>

                <div>
                  <label className="settings-form-label">Features of Interest</label>
                  <div className="contact-sales-features-grid">
                    {paidFeatures.map((f) => (
                      <label key={f.id} className="contact-sales-feature-check">
                        <input
                          type="checkbox"
                          checked={selectedFeatures.includes(f.id)}
                          onChange={() => handleToggleFeature(f.id)}
                        />
                        <span>{f.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="settings-form-label">Comments or Special Requirements</label>
                  <textarea
                    className="input"
                    rows={3}
                    maxLength={500}
                    value={comments}
                    onChange={(e) => setComments(e.target.value)}
                    placeholder="Any specific needs, deployment constraints, or questions..."
                  />
                </div>
              </div>
            </details>

            {isUrlTruncated && (
              <p className="contact-sales-hint">
                Note: Email content is long and may be truncated by your mail client. Use the "Copy Text" button to copy the complete request text.
              </p>
            )}

            <div className="contact-sales-footer">
              <a href={`mailto:${SALES_EMAIL}`} className="contact-sales-email-link">
                {SALES_EMAIL}
              </a>
              <div className="contact-sales-buttons">
                <button type="button" className="btn btn-secondary btn-sm" onClick={handleCopy}>
                  {copied ? '✓ Copied' : 'Copy Text'}
                </button>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  onClick={handleOpenMail}
                  disabled={!projectName.trim()}
                >
                  Open in Email Client
                </button>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
