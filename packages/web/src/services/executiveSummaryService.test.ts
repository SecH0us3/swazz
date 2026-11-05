// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  generateExecutiveSummary,
  generateAlgorithmicExecutiveSummary,
  type ReportStatsInput,
} from './executiveSummaryService';

describe('executiveSummaryService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    delete (globalThis as any).ai;
    delete (globalThis as any).LanguageModel;
  });

  const sampleReportData: ReportStatsInput = {
    totalRequests: 1450,
    durationSec: 45,
    totalEndpoints: 18,
    findingsCount: 4,
    errorsCount: 2,
    warningsCount: 1,
    notesCount: 1,
    topFindings: [
      {
        ruleId: 'swazz/sqli',
        level: 'error',
        endpoint: '/api/v1/users',
        owaspCategory: ['API3:2023 Injection'],
      },
      {
        ruleId: 'swazz/ssrf',
        level: 'error',
        endpoint: '/api/v1/webhook/fetch',
        owaspCategory: ['API7:2023 Server Side Request Forgery'],
      },
      {
        ruleId: 'swazz/cors-misconfig',
        level: 'warning',
        endpoint: '/api/v1/profile',
      },
    ],
  };

  it('generates structured algorithmic executive summary with risk posture and action plan', () => {
    const result = generateAlgorithmicExecutiveSummary(sampleReportData);

    expect(result.summary).toContain('Security Posture');
    expect(result.summary).toContain('CRITICAL');
    expect(result.summary).toContain('Key Risk Vectors');
    expect(result.summary).toContain('Strategic Action Plan');
    expect(result.summary).toContain('swazz/sqli');
    expect(result.simulated).toBe(true);
  });

  it('handles zero findings cleanly with a positive posture assessment', () => {
    const cleanReport: ReportStatsInput = {
      totalRequests: 500,
      durationSec: 20,
      totalEndpoints: 10,
      findingsCount: 0,
      errorsCount: 0,
      warningsCount: 0,
      notesCount: 0,
      topFindings: [],
    };

    const result = generateAlgorithmicExecutiveSummary(cleanReport);

    expect(result.summary).toContain('STABLE');
    expect(result.summary).toContain('No critical or high-severity vulnerabilities');
    expect(result.simulated).toBe(true);
  });

  it('uses Chrome AI when available on-device', async () => {
    const mockSession = {
      prompt: vi.fn().mockResolvedValue(`### Security Posture: High Risk
The automated fuzzing assessment evaluated 18 endpoints across 1,450 requests. 2 critical findings were identified including SQL injection and SSRF.

### Strategic Recommendations:
1. Enforce strict parameterization on database endpoints.
2. Restrict outbound egress network traffic.`),
      destroy: vi.fn(),
    };

    (globalThis as any).ai = {
      languageModel: {
        availability: vi.fn().mockResolvedValue('readily'),
        create: vi.fn().mockResolvedValue(mockSession),
      },
    };

    const result = await generateExecutiveSummary(sampleReportData);

    expect(result.simulated).toBe(false);
    expect(result.model).toContain('gemini-nano');
    expect(result.summary).toContain('Security Posture');
    expect(result.summary).toContain('SQL injection');
  });

  it('gracefully falls back to algorithmic summary when Chrome AI fails', async () => {
    (globalThis as any).ai = {
      languageModel: {
        availability: vi.fn().mockResolvedValue('readily'),
        create: vi.fn().mockRejectedValue(new Error('GPU memory exhausted')),
      },
    };

    const result = await generateExecutiveSummary(sampleReportData);

    expect(result.simulated).toBe(true);
    expect(result.fallbackReason).toBe('failed');
    expect(result.model).toContain('algorithmic-rules');
    expect(result.summary).toContain('CRITICAL');
  });

  it('reports why the summary is rule-based when no model is ready', async () => {
    expect((await generateExecutiveSummary(sampleReportData)).fallbackReason).toBe('unavailable');

    (globalThis as any).LanguageModel = { availability: vi.fn().mockResolvedValue('downloadable'), create: vi.fn() };
    expect((await generateExecutiveSummary(sampleReportData)).fallbackReason).toBe('downloadable');
  });

  it('uses the rule-based summary when the model takes too long', async () => {
    const session = { prompt: vi.fn((_t: string, _o: { signal: AbortSignal }) => new Promise(() => {})), destroy: vi.fn() };
    (globalThis as any).LanguageModel = { availability: vi.fn().mockResolvedValue('available'), create: vi.fn().mockResolvedValue(session) };
    const result = await generateExecutiveSummary(sampleReportData, { timeoutMs: 20 });
    expect(result.fallbackReason).toBe('timeout');
    expect(session.prompt.mock.calls[0]![1].signal.aborted).toBe(true);
    expect(session.destroy).toHaveBeenCalled();
  });

  it('stops when the caller aborts', async () => {
    const session = { prompt: vi.fn(() => new Promise(() => {})), destroy: vi.fn() };
    (globalThis as any).LanguageModel = { availability: vi.fn().mockResolvedValue('available'), create: vi.fn().mockResolvedValue(session) };
    const controller = new AbortController();
    const pending = generateExecutiveSummary(sampleReportData, { signal: controller.signal });
    await vi.waitFor(() => expect(session.prompt).toHaveBeenCalled());
    controller.abort();
    const result = await pending;
    expect(result.simulated).toBe(true);
    expect(result.fallbackReason).toBeUndefined();
    expect(session.destroy).toHaveBeenCalled();
  });

  it('reports no fallback reason for a summary the model wrote', async () => {
    const session = { prompt: vi.fn().mockResolvedValue('A professional executive summary of the scan results.'), destroy: vi.fn() };
    (globalThis as any).LanguageModel = { availability: vi.fn().mockResolvedValue('available'), create: vi.fn().mockResolvedValue(session) };
    const result = await generateExecutiveSummary(sampleReportData);
    expect(result.simulated).toBe(false);
    expect(result.fallbackReason).toBeUndefined();
  });
});
