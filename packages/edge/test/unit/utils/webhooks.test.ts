import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { dispatchWebhook } from '../../../src/utils/webhooks';
import { Env } from '../../../src/env';
import { logInfo, logError } from '../../../../common/logging/logger';

vi.mock('../../../../common/logging/logger', () => ({
  logInfo: vi.fn(),
  logError: vi.fn()
}));

describe('Webhook Utility - dispatchWebhook', () => {
  let mockAll: any;
  let mockBind: any;
  let mockPrepare: any;
  let mockDB: any;
  let mockEnv: Env;
  let mockFetch: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAll = vi.fn();
    mockBind = vi.fn().mockReturnValue({ all: mockAll });
    mockPrepare = vi.fn().mockReturnValue({ bind: mockBind });
    mockDB = {
      prepare: mockPrepare
    };
    mockEnv = {
      DB: mockDB
    } as unknown as Env;

    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('should successfully retrieve and dispatch matching webhooks', async () => {
    const webhooks = [
      {
        id: 'wh-1',
        url: 'https://example.com/webhook1',
        headers: JSON.stringify({ 'X-Custom-Header': 'value1' }),
        event_types: JSON.stringify(['scan.completed', 'scan.failed'])
      },
      {
        id: 'wh-2',
        url: 'https://example.com/webhook2',
        headers: null,
        event_types: JSON.stringify(['scan.completed'])
      }
    ];

    mockAll.mockResolvedValue({ results: webhooks });

    const payload = { scanId: 'scan-123', status: 'completed' };
    const ctx = {
      waitUntil: vi.fn()
    };

    await dispatchWebhook(mockEnv, 'proj-123', 'scan.completed', payload, ctx);

    expect(mockPrepare).toHaveBeenCalledWith(
      'SELECT id, url, headers, event_types FROM project_webhooks WHERE project_id = ?'
    );
    expect(mockBind).toHaveBeenCalledWith('proj-123');
    expect(mockAll).toHaveBeenCalled();

    // Verify fetch was called for both webhooks since both handle 'scan.completed'
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Verify wait until was called
    expect(ctx.waitUntil).toHaveBeenCalled();

    // Verify first fetch details
    const firstCall = mockFetch.mock.calls[0];
    expect(firstCall[0]).toBe('https://example.com/webhook1');
    expect(firstCall[1].method).toBe('POST');
    expect(firstCall[1].headers).toEqual({
      'Content-Type': 'application/json',
      'User-Agent': 'Swazz-Webhook-Dispatcher/1.0',
      'X-Custom-Header': 'value1'
    });

    const parsedBody = JSON.parse(firstCall[1].body);
    expect(parsedBody.event).toBe('scan.completed');
    expect(parsedBody.project_id).toBe('proj-123');
    expect(parsedBody.data).toEqual(payload);
    expect(parsedBody.timestamp).toBeDefined();

    // Verify second fetch details (no custom headers)
    const secondCall = mockFetch.mock.calls[1];
    expect(secondCall[0]).toBe('https://example.com/webhook2');
    expect(secondCall[1].headers).toEqual({
      'Content-Type': 'application/json',
      'User-Agent': 'Swazz-Webhook-Dispatcher/1.0'
    });

    expect(logInfo).toHaveBeenCalledWith({ env: mockEnv, executionCtx: ctx }, 'Webhook', expect.stringContaining('Dispatching scan.completed webhook'));
  });

  it('should fallback to direct await if ctx.waitUntil is not provided', async () => {
    const webhooks = [
      {
        id: 'wh-1',
        url: 'https://example.com/webhook1',
        headers: null,
        event_types: JSON.stringify(['scan.completed'])
      }
    ];

    mockAll.mockResolvedValue({ results: webhooks });

    await dispatchWebhook(mockEnv, 'proj-123', 'scan.completed', { key: 'value' });

    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should handle database retrieval errors gracefully', async () => {
    const dbError = new Error('DB Connection Timeout');
    mockAll.mockRejectedValue(dbError);

    const payload = { data: 'test' };
    await dispatchWebhook(mockEnv, 'proj-123', 'scan.completed', payload);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      { env: mockEnv, executionCtx: undefined },
      'Webhook',
      'Failed to retrieve webhooks for project proj-123',
      { error: dbError }
    );
  });

  it('should filter out webhooks that do not match the event type', async () => {
    const webhooks = [
      {
        id: 'wh-1',
        url: 'https://example.com/webhook1',
        headers: null,
        event_types: JSON.stringify(['scan.failed'])
      }
    ];

    mockAll.mockResolvedValue({ results: webhooks });

    await dispatchWebhook(mockEnv, 'proj-123', 'scan.completed', {});

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should handle malformed JSON in event_types gracefully', async () => {
    const webhooks = [
      {
        id: 'wh-1',
        url: 'https://example.com/webhook1',
        headers: null,
        event_types: 'invalid-json'
      }
    ];

    mockAll.mockResolvedValue({ results: webhooks });

    await dispatchWebhook(mockEnv, 'proj-123', 'scan.completed', {});

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should handle malformed JSON in custom headers gracefully and use default headers', async () => {
    const webhooks = [
      {
        id: 'wh-1',
        url: 'https://example.com/webhook1',
        headers: 'malformed-headers-json',
        event_types: JSON.stringify(['scan.completed'])
      }
    ];

    mockAll.mockResolvedValue({ results: webhooks });

    await dispatchWebhook(mockEnv, 'proj-123', 'scan.completed', {});

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/json',
      'User-Agent': 'Swazz-Webhook-Dispatcher/1.0'
    });
    expect(logError).toHaveBeenCalledWith(
      { env: mockEnv, executionCtx: undefined },
      'Webhook',
      'Failed to parse custom headers for webhook wh-1',
      { error: expect.any(SyntaxError) }
    );
  });

  it('should log an error when webhook returns non-OK status code', async () => {
    const webhooks = [
      {
        id: 'wh-1',
        url: 'https://example.com/webhook1',
        headers: null,
        event_types: JSON.stringify(['scan.completed'])
      }
    ];

    mockAll.mockResolvedValue({ results: webhooks });
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502
    });

    await dispatchWebhook(mockEnv, 'proj-123', 'scan.completed', {});

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      { env: mockEnv, executionCtx: undefined },
      'Webhook',
      'Webhook wh-1 returned non-OK status 502 for event scan.completed'
    );
  });

  it('should log an error when fetch fails due to network/timeout exception', async () => {
    const webhooks = [
      {
        id: 'wh-1',
        url: 'https://example.com/webhook1',
        headers: null,
        event_types: JSON.stringify(['scan.completed'])
      }
    ];

    mockAll.mockResolvedValue({ results: webhooks });
    const networkError = new Error('DNS resolution failed');
    mockFetch.mockRejectedValue(networkError);

    await dispatchWebhook(mockEnv, 'proj-123', 'scan.completed', {});

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      { env: mockEnv, executionCtx: undefined },
      'Webhook',
      'Failed to dispatch webhook wh-1 to https://example.com/webhook1',
      { error: networkError }
    );
  });
});
