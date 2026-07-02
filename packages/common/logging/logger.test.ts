import { describe, it, expect, vi } from 'vitest';
import { formatLog, logInfo } from './logger';

describe('Logger Library', () => {
  it('should format logs correctly', () => {
    const entry = formatLog('info', 'test-module', 'hello world', { requestId: 'req-123' });
    expect(entry.level).toBe('info');
    expect(entry.module).toBe('test-module');
    expect(entry.msg).toBe('hello world');
    expect(entry.requestId).toBe('req-123');
    expect(entry.timestamp).toBeDefined();
  });

  it('should buffer to KV if session cache exists', async () => {
    const mockKV = {
      get: vi.fn().mockResolvedValue(JSON.stringify([])),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const env = { SESSION_CACHE: mockKV };
    logInfo(env, 'test', 'msg');
    // Wait for KV push async operation
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(mockKV.put).toHaveBeenCalled();
  });
});
