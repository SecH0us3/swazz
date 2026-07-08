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

  it('should correctly identify private runner tags', () => {
    const mockWs = {} as any;
    const mockState = {
      getWebSockets: vi.fn().mockReturnValue([]),
      getTags: vi.fn().mockReturnValue(['runner', 'private-company-tag'])
    } as any;

    const manager = new StateManager(mockState);
    expect(manager.isPrivateRunner(mockWs)).toBe(true);
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
});
