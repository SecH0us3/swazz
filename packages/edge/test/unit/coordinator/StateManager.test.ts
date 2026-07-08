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
});
