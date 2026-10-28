// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatLog, logInfo, logWarn, logError, getBufferedLogs, clearBufferedLogs } from './logger';

describe('Logger Library', () => {
  beforeEach(() => {
    clearBufferedLogs();
  });
  it('should format logs correctly', () => {
    const entry = formatLog('info', 'test-module', 'hello world', { requestId: 'req-123' });
    expect(entry.level).toBe('info');
    expect(entry.module).toBe('test-module');
    expect(entry.msg).toBe('hello world');
    expect(entry.requestId).toBe('req-123');
    expect(entry.timestamp).toBeDefined();
  });

  it('should buffer logs in-memory and never read or write to KV SESSION_CACHE', async () => {
    const mockKV = {
      get: vi.fn().mockResolvedValue(JSON.stringify([])),
      put: vi.fn().mockResolvedValue(undefined),
    };
    const env = { SESSION_CACHE: mockKV };

    logInfo(env, 'test-mod', 'info message');
    logWarn(env, 'test-mod', 'warn message');
    logError(env, 'test-mod', 'error message');

    expect(mockKV.get).not.toHaveBeenCalled();
    expect(mockKV.put).not.toHaveBeenCalled();

    const logs = getBufferedLogs();
    expect(logs.length).toBe(3);
    expect(logs[0].msg).toBe('error message');
    expect(logs[1].msg).toBe('warn message');
    expect(logs[2].msg).toBe('info message');

    clearBufferedLogs();
    expect(getBufferedLogs()).toEqual([]);
  });

  it('should cap in-memory buffered logs at 200 entries', () => {
    for (let i = 0; i < 250; i++) {
      logInfo(null, 'bulk', `msg-${i}`);
    }
    const logs = getBufferedLogs();
    expect(logs.length).toBe(200);
    expect(logs[0].msg).toBe('msg-249');
    expect(logs[199].msg).toBe('msg-50');
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
