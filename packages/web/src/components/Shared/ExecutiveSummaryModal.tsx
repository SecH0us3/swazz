// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React, { useState, useEffect } from 'react';
import { Modal } from './Modal.js';
import { FormattedMarkdown } from './FormattedMarkdown.js';

interface ExecutiveSummaryModalProps {
  runId: string | null;
  onClose: () => void;
  getExecutiveSummary: (runId: string) => Promise<{ summary: string; model: string }>;
}

export const ExecutiveSummaryModal: React.FC<ExecutiveSummaryModalProps> = ({
  runId,
  onClose,
  getExecutiveSummary,
}) => {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState('');
  const [model, setModel] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!runId) {
      setError('No scan run selected');
      setLoading(false);
      return;
    }

    let mounted = true;
    setLoading(true);
    getExecutiveSummary(runId)
      .then(res => {
        if (mounted) {
          setSummary(res.summary);
          setModel(res.model);
          setLoading(false);
        }
      })
      .catch(err => {
        if (mounted) {
          setError(err.message || 'Failed to generate executive summary');
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [runId, getExecutiveSummary]);

  const handleCopy = () => {
    if (!summary) return;
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(summary);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Modal title="📊 Executive Summary (AI Audit Assessment)" onClose={onClose} width="680px">
      <div className="exec-summary-modal-body">
        {loading ? (
          <div className="exec-summary-loading-state">
            <span className="spinner-sm" />
            <span>Generating Executive Summary with on-device AI...</span>
          </div>
        ) : error ? (
          <div className="exec-summary-error-state">
            <span className="error-text">{error}</span>
          </div>
        ) : (
          <>
            <div className="exec-summary-modal-header">
              <span className="exec-summary-scope-label">Scan Assessment Summary</span>
              {model && (
                <span className="badge badge-ai-model">
                  {model.includes('gemini') || model.includes('chrome')
                    ? '⚡ Gemini Nano (On-Device)'
                    : '🛠️ Rule-based (Local)'}
                </span>
              )}
            </div>

            <div className="exec-summary-markdown-container">
              <FormattedMarkdown content={summary} />
            </div>

            <div className="exec-summary-modal-footer">
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={handleCopy}
              >
                {copied ? '✓ Copied' : '📋 Copy Summary'}
              </button>
              <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
};

export default ExecutiveSummaryModal;
