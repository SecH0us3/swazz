// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React, { useState, useEffect } from 'react';
import { Modal } from './Modal.js';
import { isChromeAIAvailable } from '../../services/chromeAiService.js';

interface AiEngineInfoModalProps {
  onClose: () => void;
}

export const AiEngineInfoModal: React.FC<AiEngineInfoModalProps> = ({ onClose }) => {
  const [chromeAvailable, setChromeAvailable] = useState<boolean | null>(null);
  const [showSetup, setShowSetup] = useState(false);

  useEffect(() => {
    let mounted = true;
    isChromeAIAvailable().then(available => {
      if (mounted) setChromeAvailable(available);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return (
    <Modal title="✨ Swazz AI Engine (On-Device & Fallback)" onClose={onClose} width="640px">
      <div className="ai-info-modal-body">
        {/* Dynamic status card */}
        <div className={`ai-info-status-card ${chromeAvailable ? 'active' : 'inactive'}`}>
          <div className="ai-info-status-icon">
            {chromeAvailable ? '⚡' : '☁️'}
          </div>
          <div className="ai-info-status-text">
            <div className="ai-info-status-title">
              {chromeAvailable === null ? (
                'Detecting local Chrome AI capability...'
              ) : chromeAvailable ? (
                'Chrome Gemini Nano Active (On-Device)'
              ) : (
                'Cloud & Offline Fallback Active'
              )}
            </div>
            <div className="ai-info-status-desc">
              {chromeAvailable
                ? 'Your device runs local neural inference. Findings are analyzed privately without network calls.'
                : 'Chrome Prompt API is not detected in this browser. Swazz seamlessly routes analysis through Cloudflare Workers AI or offline rules.'}
            </div>
          </div>
        </div>

        {/* Privacy Highlight */}
        <div className="ai-info-privacy-callout">
          <strong className="ai-info-privacy-title">🔒 Zero Cloud Exfiltration by Default</strong>
          <p className="ai-info-privacy-text">
            When running Google Chrome, Swazz executes Gemini Nano directly on your device CPU/GPU.
            Vulnerability details, target endpoints, session tokens, and request payloads never leave your browser.
          </p>
        </div>

        {/* 3-Tier Architecture Explanation */}
        <div className="ai-info-section-title">Cascade Execution Architecture</div>
        <div className="ai-info-tiers">
          <div className="ai-info-tier-card tier-primary">
            <div className="ai-info-tier-header">
              <span className="ai-info-tier-name">Tier 1 (Default): Chrome Built-in AI</span>
              <span className="badge badge-ai-model">⚡ On-Device</span>
            </div>
            <p className="ai-info-tier-desc">
              Executes Gemini Nano via <code>window.ai.languageModel</code> locally. 0 latency, 0 cloud cost, 100% private.
            </p>
          </div>

          <div className="ai-info-tier-card">
            <div className="ai-info-tier-header">
              <span className="ai-info-tier-name">Tier 2 (Cloud Fallback): Cloudflare Workers AI</span>
              <span className="badge badge-ai-model">☁️ Serverless</span>
            </div>
            <p className="ai-info-tier-desc">
              Uses serverless Meta Llama 3.2 edge inference when Chrome AI is unavailable, disabled, or GPU memory is saturated.
            </p>
          </div>

          <div className="ai-info-tier-card">
            <div className="ai-info-tier-header">
              <span className="ai-info-tier-name">Tier 3 (Offline): Algorithmic Rules</span>
              <span className="badge badge-ai-model">🛠️ Local Rules</span>
            </div>
            <p className="ai-info-tier-desc">
              Instant deterministic remediation synthesis (CyberNova engine), guaranteeing zero-failure triage even without an internet connection.
            </p>
          </div>
        </div>

        {/* Chrome Gemini Nano Setup Toggle */}
        <div className="ai-info-setup-toggle-row">
          <button
            type="button"
            className="btn btn-ghost btn-xs ai-info-setup-toggle-btn"
            onClick={() => setShowSetup(prev => !prev)}
          >
            {showSetup ? '▼ Hide Chrome Gemini Nano Setup Guide' : '▶ How to enable Chrome Built-in AI in Google Chrome'}
          </button>
        </div>

        {showSetup && (
          <div className="ai-info-setup-box">
            <div className="ai-info-setup-step">
              <strong>1. Browser:</strong> Google Chrome 128+ or Chrome Dev / Canary.
            </div>
            <div className="ai-info-setup-step">
              <strong>2. Enable Prompt API:</strong> Open <code className="ai-info-setup-code">chrome://flags/#prompt-api-for-gemini-nano</code> and set to <strong>Enabled</strong>.
            </div>
            <div className="ai-info-setup-step">
              <strong>3. Bypass Model Checks:</strong> Open <code className="ai-info-setup-code">chrome://flags/#optimization-guide-on-device-model</code> and set to <strong>Enabled BypassPerfRequirement</strong>.
            </div>
            <div className="ai-info-setup-step">
              <strong>4. Download Model:</strong> Open <code className="ai-info-setup-code">chrome://components</code> and click <em>Check for update</em> under <strong>Optimization Guide On Device Model</strong>.
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="ai-info-modal-footer">
          <button type="button" className="btn btn-primary" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </Modal>
  );
};

export default AiEngineInfoModal;
