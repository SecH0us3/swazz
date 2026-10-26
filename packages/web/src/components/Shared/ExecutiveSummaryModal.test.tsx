// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExecutiveSummaryModal } from './ExecutiveSummaryModal';

describe('ExecutiveSummaryModal', () => {
  const mockOnClose = vi.fn();
  const mockGetSummary = vi.fn();

  const mockWriteText = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, {
      clipboard: {
        writeText: mockWriteText,
      },
    });
  });

  it('loads and renders executive summary markdown', async () => {
    mockGetSummary.mockResolvedValueOnce({
      summary: '### Security Posture: STABLE\nNo critical vulnerabilities found.',
      model: 'chrome-gemini-nano (on-device)',
      simulated: false,
    });

    render(
      <ExecutiveSummaryModal
        runId="run-123"
        onClose={mockOnClose}
        getExecutiveSummary={mockGetSummary}
      />
    );

    expect(screen.getByText(/Generating Executive Summary/i)).toBeTruthy();

    expect(await screen.findByText(/Security Posture/i)).toBeTruthy();
    expect(screen.getByText('⚡ Gemini Nano (On-Device)')).toBeTruthy();

    const copyBtn = screen.getByRole('button', { name: /Copy Summary/i });
    fireEvent.click(copyBtn);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(expect.stringContaining('Security Posture'));
  });

  it('says why the summary is rule-based', async () => {
    mockGetSummary.mockResolvedValueOnce({
      summary: '### Security Posture: STABLE',
      model: 'algorithmic-rules (local)',
      simulated: true,
      fallbackReason: 'downloadable',
    });

    render(
      <ExecutiveSummaryModal
        runId="run-123"
        onClose={mockOnClose}
        getExecutiveSummary={mockGetSummary}
      />
    );

    expect(await screen.findByText(/has not downloaded its on-device model \(Gemini Nano\) yet, so a rule-based summary was used/i)).toBeTruthy();
    expect(screen.getByText('🛠️ Rule-based (Local)')).toBeTruthy();
  });

  it('shows no fallback note for a summary the model wrote', async () => {
    mockGetSummary.mockResolvedValueOnce({ summary: 'AI text', model: 'chrome-gemini-nano (on-device)', simulated: false });
    render(
      <ExecutiveSummaryModal runId="run-123" onClose={mockOnClose} getExecutiveSummary={mockGetSummary} />
    );
    expect(await screen.findByText('AI text')).toBeTruthy();
    expect(screen.queryByText(/rule-based summary was used/i)).toBeNull();
  });

  it('aborts the generation when closed', async () => {
    let seen: AbortSignal | undefined;
    mockGetSummary.mockImplementationOnce((_id: string, signal?: AbortSignal) => {
      seen = signal;
      return new Promise(() => {});
    });
    const { unmount } = render(
      <ExecutiveSummaryModal runId="run-123" onClose={mockOnClose} getExecutiveSummary={mockGetSummary} />
    );
    expect(seen?.aborted).toBe(false);
    unmount();
    expect(seen?.aborted).toBe(true);
  });

  it('closes on close button click', async () => {
    mockGetSummary.mockResolvedValueOnce({
      summary: 'Summary text',
      model: 'algorithmic-rules (local)',
      simulated: true,
    });

    render(
      <ExecutiveSummaryModal
        runId="run-123"
        onClose={mockOnClose}
        getExecutiveSummary={mockGetSummary}
      />
    );

    await screen.findByText('Summary text');
    const closeBtn = screen.getByRole('button', { name: /Close/i });
    fireEvent.click(closeBtn);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });
});
