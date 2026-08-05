// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

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

  it('should serialize error objects and merge extra fields into payload', () => {
    const err = new Error('database down');
    const entry = formatLog('error', 'Database', 'Failed to connect', {
      error: err,
      host: 'localhost',
      port: 5432,
      payload: { someDefault: 'value' }
    });

    expect(entry.error).toBeDefined();
    expect(entry.error.message).toBe('database down');
    expect(entry.error.name).toBe('Error');
    expect(entry.error.stack).toBeDefined();
    
    expect(entry.payload).toBeDefined();
    expect(entry.payload?.someDefault).toBe('value');
    expect(entry.payload?.host).toBe('localhost');
    expect(entry.payload?.port).toBe(5432);
  });

  it('should accept non-Error objects or strings as error options', () => {
    const entry = formatLog('error', 'Service', 'Generic crash', {
      error: 'raw-string-error'
    });
    expect(entry.error).toBe('raw-string-error');
  });
});
