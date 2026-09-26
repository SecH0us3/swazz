// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect } from 'vitest';
import { matchesFinding } from './utils/findings.js';
import type { AnalysisFinding } from './types.js';

describe('matchesFinding predicate (Defect 4)', () => {
  it('matches only the target finding by id when two findings share the same ruleId', () => {
    const finding1: AnalysisFinding = {
      id: 'finding-1',
      ruleId: 'swazz/sql-error-leak',
      level: 'error',
      message: 'SQL syntax error in user_id',
    };
    const finding2: AnalysisFinding = {
      id: 'finding-2',
      ruleId: 'swazz/sql-error-leak',
      level: 'error',
      message: 'SQL syntax error in search_query',
    };

    const target = { id: 'finding-1', ruleId: 'swazz/sql-error-leak' };

    expect(matchesFinding(finding1, target)).toBe(true);
    // Must return false for finding2 despite identical ruleId (would fail if || was used)
    expect(matchesFinding(finding2, target)).toBe(false);
  });

  it('falls back to ruleId matching when target finding has no unique id', () => {
    const finding1: AnalysisFinding = {
      id: 'finding-1',
      ruleId: 'swazz/crlf-injection',
      level: 'error',
      message: 'CRLF injection in path',
    };
    const finding2: AnalysisFinding = {
      id: 'finding-2',
      ruleId: 'swazz/reflected-xss',
      level: 'error',
      message: 'Reflected XSS in query',
    };

    const targetWithoutId = { ruleId: 'swazz/crlf-injection' };

    expect(matchesFinding(finding1, targetWithoutId)).toBe(true);
    expect(matchesFinding(finding2, targetWithoutId)).toBe(false);
  });

  it('correctly updates only the targeted finding in a findings array using matchesFinding', () => {
    const findings: AnalysisFinding[] = [
      {
        id: 'finding-1',
        ruleId: 'swazz/sql-error-leak',
        level: 'error',
        message: 'SQL syntax error in user_id',
        ai_status: 'pending',
      },
      {
        id: 'finding-2',
        ruleId: 'swazz/sql-error-leak',
        level: 'error',
        message: 'SQL syntax error in search_query',
        ai_status: 'pending',
      },
    ];

    const target = { id: 'finding-1', ruleId: 'swazz/sql-error-leak' };
    const updated = findings.map(f => {
      if (matchesFinding(f, target)) {
        return { ...f, ai_status: 'completed' as const, ai_explanation: 'Analysis 1' };
      }
      return f;
    });

    expect(updated[0].id).toBe('finding-1');
    expect(updated[0].ai_status).toBe('completed');
    expect(updated[0].ai_explanation).toBe('Analysis 1');

    // finding-2 must remain untouched
    expect(updated[1].id).toBe('finding-2');
    expect(updated[1].ai_status).toBe('pending');
    expect(updated[1].ai_explanation).toBeUndefined();
  });
});
