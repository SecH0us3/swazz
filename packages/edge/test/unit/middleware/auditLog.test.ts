import { describe, it, expect, vi, beforeEach } from 'vitest';
import { auditLog } from '../../../src/middleware/auditLog';

const mockCreateAuditLog = vi.fn();

vi.mock('../../../src/repositories/auditLog', () => {
  return {
    AuditLogRepository: vi.fn().mockImplementation(function () {
      return {
        createAuditLog: mockCreateAuditLog,
      };
    })
  };
});

vi.mock('../../../src/utils/auth', () => ({
  getUserIdFromRequest: vi.fn().mockResolvedValue('user-123'),
  getClientIp: vi.fn().mockReturnValue('1.1.1.1')
}));

describe('auditLog middleware', () => {
  let mockContext: any;
  let mockNext: any;

  beforeEach(() => {
    vi.clearAllMocks();

    mockNext = vi.fn().mockResolvedValue(undefined);

    mockContext = {
      req: {
        path: '/api/projects/p-123',
        header: vi.fn().mockReturnValue(undefined),
        param: vi.fn().mockReturnValue('p-123'),
      },
      res: {
        status: 200
      },
      env: {},
      get: vi.fn().mockReturnValue(undefined),
      set: vi.fn(),
      executionCtx: {
        waitUntil: vi.fn().mockImplementation((p) => p)
      }
    };
  });

  it('should skip logging if response status is not successful (< 200)', async () => {
    mockContext.res.status = 101;
    const middleware = auditLog('action-key', 'Action Label');
    await middleware(mockContext, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockContext.executionCtx.waitUntil).not.toHaveBeenCalled();
  });

  it('should skip logging if response status is not successful (>= 300)', async () => {
    mockContext.res.status = 301;
    const middleware = auditLog('action-key', 'Action Label');
    await middleware(mockContext, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockContext.executionCtx.waitUntil).not.toHaveBeenCalled();
  });

  it('should skip logging if project ID is missing', async () => {
    mockContext.req.param.mockReturnValue(undefined);
    const middleware = auditLog('action-key', 'Action Label');
    await middleware(mockContext, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockContext.executionCtx.waitUntil).not.toHaveBeenCalled();
  });

  it('should skip logging if executionCtx.waitUntil is missing', async () => {
    mockContext.executionCtx = undefined;
    const middleware = auditLog('action-key', 'Action Label');
    await middleware(mockContext, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockCreateAuditLog).not.toHaveBeenCalled();
  });

  it('should log successfully with source "web"', async () => {
    const middleware = auditLog('action-key', 'Action Label');
    await middleware(mockContext, mockNext);

    expect(mockNext).toHaveBeenCalled();
    expect(mockContext.executionCtx.waitUntil).toHaveBeenCalled();

    // Trigger wait until promise
    const promise = mockContext.executionCtx.waitUntil.mock.calls[0][0];
    await promise;

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      'p-123',
      'user-123',
      'action-key',
      'Action Label',
      'web',
      null,
      '1.1.1.1'
    );
  });

  it('should log successfully with source "mcp" if path starts with /api/mcp', async () => {
    mockContext.req.path = '/api/mcp/scan';
    const middleware = auditLog('action-key', 'Action Label');
    await middleware(mockContext, mockNext);

    const promise = mockContext.executionCtx.waitUntil.mock.calls[0][0];
    await promise;

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      'p-123',
      'user-123',
      'action-key',
      'Action Label',
      'mcp',
      null,
      '1.1.1.1'
    );
  });

  it('should log successfully with source "mcp" if X-MCP-Client header is set', async () => {
    mockContext.req.header.mockImplementation((name: string) => {
      if (name === 'X-MCP-Client') return 'true';
      return undefined;
    });

    const middleware = auditLog('action-key', 'Action Label');
    await middleware(mockContext, mockNext);

    const promise = mockContext.executionCtx.waitUntil.mock.calls[0][0];
    await promise;

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      'p-123',
      'user-123',
      'action-key',
      'Action Label',
      'mcp',
      null,
      '1.1.1.1'
    );
  });

  it('should log successfully with source "api_key" if token starts with swazz_live_', async () => {
    mockContext.req.header.mockImplementation((name: string) => {
      if (name === 'Authorization') return 'Bearer swazz_live_abcdef123';
      return undefined;
    });

    const middleware = auditLog('action-key', 'Action Label');
    await middleware(mockContext, mockNext);

    const promise = mockContext.executionCtx.waitUntil.mock.calls[0][0];
    await promise;

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      'p-123',
      'user-123',
      'action-key',
      'Action Label',
      'api_key',
      null,
      '1.1.1.1'
    );
  });

  it('should serialize auditDetails as string if it is an object', async () => {
    mockContext.get.mockReturnValue({ updatedField: 'name', value: 'New Name' });

    const middleware = auditLog('action-key', 'Action Label');
    await middleware(mockContext, mockNext);

    const promise = mockContext.executionCtx.waitUntil.mock.calls[0][0];
    await promise;

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      'p-123',
      'user-123',
      'action-key',
      'Action Label',
      'web',
      '{"updatedField":"name","value":"New Name"}',
      '1.1.1.1'
    );
  });

  it('should use auditDetails as string directly if it is a string', async () => {
    mockContext.get.mockReturnValue('manual-string-details');

    const middleware = auditLog('action-key', 'Action Label');
    await middleware(mockContext, mockNext);

    const promise = mockContext.executionCtx.waitUntil.mock.calls[0][0];
    await promise;

    expect(mockCreateAuditLog).toHaveBeenCalledWith(
      'p-123',
      'user-123',
      'action-key',
      'Action Label',
      'web',
      'manual-string-details',
      '1.1.1.1'
    );
  });

  it('should catch database errors silently', async () => {
    mockCreateAuditLog.mockRejectedValue(new Error('D1 database down'));
    const spyConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    const middleware = auditLog('action-key', 'Action Label');
    await middleware(mockContext, mockNext);

    const promise = mockContext.executionCtx.waitUntil.mock.calls[0][0];
    await expect(promise).resolves.not.toThrow();
    expect(spyConsoleError).toHaveBeenCalled();

    spyConsoleError.mockRestore();
  });
});
