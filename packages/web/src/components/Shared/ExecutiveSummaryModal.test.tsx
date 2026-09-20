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
      model: 'chrome-gemini-nano (on-device)'
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

  it('closes on close button click', async () => {
    mockGetSummary.mockResolvedValueOnce({
      summary: 'Summary text',
      model: 'algorithmic-rules (local)'
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
