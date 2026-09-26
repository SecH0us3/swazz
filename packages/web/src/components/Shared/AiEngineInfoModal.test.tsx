// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AiEngineInfoModal } from './AiEngineInfoModal';
import * as chromeAiModule from '../../services/chromeAiService';

describe('AiEngineInfoModal', () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders modal title and closes on close button click', () => {
    vi.spyOn(chromeAiModule, 'isChromeAIAvailable').mockResolvedValue(false);

    render(<AiEngineInfoModal onClose={mockOnClose} />);

    expect(screen.getByText(/Swazz AI Engine/i)).toBeTruthy();

    const closeBtn = screen.getByRole('button', { name: /Got it/i });
    fireEvent.click(closeBtn);
    expect(mockOnClose).toHaveBeenCalledTimes(1);
  });

  it('displays Chrome Gemini Nano as active when available', async () => {
    vi.spyOn(chromeAiModule, 'isChromeAIAvailable').mockResolvedValue(true);

    render(<AiEngineInfoModal onClose={mockOnClose} />);

    // Wait for async detection
    expect(await screen.findByText(/Chrome Gemini Nano Active/i)).toBeTruthy();
  });

  it('displays Cloud & Offline Fallback when Chrome AI is not available', async () => {
    vi.spyOn(chromeAiModule, 'isChromeAIAvailable').mockResolvedValue(false);

    render(<AiEngineInfoModal onClose={mockOnClose} />);

    expect(await screen.findByText(/Cloud & Offline Fallback Active/i)).toBeTruthy();
  });

  it('explains the 3-tier cascade and local privacy', () => {
    vi.spyOn(chromeAiModule, 'isChromeAIAvailable').mockResolvedValue(true);

    render(<AiEngineInfoModal onClose={mockOnClose} />);

    expect(screen.getByText(/Tier 1 \(Default\): Chrome Built-in AI/i)).toBeTruthy();
    expect(screen.getByText(/Tier 2 \(Cloud Fallback\): Cloudflare Workers AI/i)).toBeTruthy();
    expect(screen.getByText(/Tier 3 \(Offline\): Algorithmic Rules/i)).toBeTruthy();
    expect(screen.getByText(/Zero Cloud Exfiltration/i)).toBeTruthy();
  });
});
