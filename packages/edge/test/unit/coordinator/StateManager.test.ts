// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi } from 'vitest';
import { StateManager } from '../../../src/coordinator/StateManager';

describe('StateManager', () => {
  it('should reconstruct state from active WebSockets', () => {
    const mockWs = {
      deserializeAttachment: vi.fn().mockReturnValue({ authenticated: true, activeJobs: ['run-1'] })
    } as any;
    const mockState = {
      getWebSockets: vi.fn().mockReturnValue([mockWs]),
      getTags: vi.fn().mockReturnValue(['runner'])
    } as any;

    const manager = new StateManager(mockState);
    expect(manager.runners.has(mockWs)).toBe(true);
    expect(manager.jobs.get('run-1')).toBe(mockWs);
  });

  it('treats only runners tagged shared as shared runners', () => {
    const mockWs = {} as any;
    const tags = vi.fn();
    const mockState = { getWebSockets: vi.fn().mockReturnValue([]), getTags: tags } as any;
    const manager = new StateManager(mockState);

    tags.mockReturnValue(['runner', 'shared']);
    expect(manager.isSharedRunner(mockWs)).toBe(true);
    // A keyed runner and a runner connected with a user API token both serve one user only.
    tags.mockReturnValue(['runner', 'private-company-tag', 'user_id:u1']);
    expect(manager.isSharedRunner(mockWs)).toBe(false);
    tags.mockReturnValue(['runner', 'user_id:u1']);
    expect(manager.isSharedRunner(mockWs)).toBe(false);
  });

  it('should reconstruct runner challenges from active WebSockets', () => {
    const mockWs = {
      deserializeAttachment: vi.fn().mockReturnValue({ authenticated: false, nonce: 'nonce-123' })
    } as any;
    const mockState = {
      getWebSockets: vi.fn().mockReturnValue([mockWs]),
      getTags: vi.fn().mockReturnValue(['runner-pending'])
    } as any;

    const manager = new StateManager(mockState);
    expect(manager.pendingChallenges.get(mockWs)).toBe('nonce-123');
    expect(manager.runners.has(mockWs)).toBe(false);
  });

  it('should reconstruct client connections mapping back to their runId', () => {
    const mockWs = {} as any;
    const mockState = {
      getWebSockets: vi.fn().mockReturnValue([mockWs]),
      getTags: vi.fn().mockReturnValue(['client', 'run-abc'])
    } as any;

    const manager = new StateManager(mockState);
    expect(manager.clients.get('run-abc')?.has(mockWs)).toBe(true);
  });

  describe('hasCapacity', () => {
    const mockState = {
      getWebSockets: vi.fn().mockReturnValue([]),
      getTags: vi.fn().mockReturnValue(['runner'])
    } as any;

    it('returns true when activeJobs is below MAX_ACTIVE_JOBS_PER_RUNNER', () => {
      const manager = new StateManager(mockState);
      const ws = { deserializeAttachment: vi.fn().mockReturnValue({ activeJobs: ['a', 'b'] }) } as any;
      expect(manager.hasCapacity(ws)).toBe(true);
    });

    it('returns false when activeJobs reaches MAX_ACTIVE_JOBS_PER_RUNNER (10)', () => {
      const manager = new StateManager(mockState);
      const ws = {
        deserializeAttachment: vi.fn().mockReturnValue({
          activeJobs: Array.from({ length: 10 }, (_, i) => `job-${i}`)
        })
      } as any;
      expect(manager.hasCapacity(ws)).toBe(false);
    });

    it('fails closed (returns false) when deserializeAttachment throws', () => {
      const manager = new StateManager(mockState);
      const ws = {
        deserializeAttachment: vi.fn().mockImplementation(() => {
          throw new Error('corrupt attachment');
        })
      } as any;
      expect(manager.hasCapacity(ws)).toBe(false);
    });

    it('fails closed (returns false) when activeJobs is not an array', () => {
      const manager = new StateManager(mockState);
      const ws = {
        deserializeAttachment: vi.fn().mockReturnValue({ activeJobs: 'not-an-array' })
      } as any;
      expect(manager.hasCapacity(ws)).toBe(false);
    });
  });
});

