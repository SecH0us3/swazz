import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScansRepository } from '../../../src/repositories/scans';
import { Env } from '../../../src/env';
import { dispatchWebhook } from '../../../src/utils/webhooks';

const mockLogWarn = vi.fn();
const mockLogError = vi.fn();

vi.mock('../../../../common/logging/logger', () => ({
  logWarn: (...args: any[]) => mockLogWarn(...args),
  logError: (...args: any[]) => mockLogError(...args)
}));

vi.mock('../../../src/utils/webhooks', () => ({
  dispatchWebhook: vi.fn().mockResolvedValue(undefined)
}));

describe('ScansRepository Unit Tests', () => {
  let mockAll: any;
  let mockBind: any;
  let mockPrepare: any;
  let mockBatch: any;
  let mockDB: any;
  let mockEnv: Env;

  beforeEach(() => {
    vi.clearAllMocks();

    mockAll = vi.fn();
    const mockStmt: any = {
      all: mockAll,
      first: mockAll,
      run: mockAll
    };
    mockBind = vi.fn().mockReturnValue(mockStmt);
    mockStmt.bind = mockBind;

    mockPrepare = vi.fn().mockReturnValue(mockStmt);
    mockBatch = vi.fn();
    mockDB = {
      prepare: mockPrepare,
      batch: mockBatch
    };
    mockEnv = {
      DB: mockDB
    } as unknown as Env;
  });

  it('createScan inserts scan row', async () => {
    const repo = new ScansRepository(mockEnv);
    await repo.createScan('s-1', 'p-1', 'https://target.com', 'profile-1', 'queued', 'u-1');

    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO scans'));
    expect(mockBind).toHaveBeenCalledWith('s-1', 'p-1', 'https://target.com', 'profile-1', 'queued', 'u-1');
  });

  it('getUserPublicKey queries user public key', async () => {
    mockAll.mockResolvedValueOnce({ public_key: 'pubkey-123' });
    const repo = new ScansRepository(mockEnv);
    expect(await repo.getUserPublicKey('u-1')).toBe('pubkey-123');

    mockAll.mockResolvedValueOnce(null);
    expect(await repo.getUserPublicKey('u-2')).toBeNull();
  });

  it('getUserDetails queries user username', async () => {
    const details = { username: 'alex' };
    mockAll.mockResolvedValue(details);
    const repo = new ScansRepository(mockEnv);
    expect(await repo.getUserDetails('u-1')).toBe(details);
  });

  it('getProjectMemberRole queries user project member role', async () => {
    mockAll.mockResolvedValueOnce({ role: 'admin' });
    const repo = new ScansRepository(mockEnv);
    expect(await repo.getProjectMemberRole('p-1', 'u-1')).toBe('admin');
  });

  it('createAuditLog inserts audit log row', async () => {
    const repo = new ScansRepository(mockEnv);
    await repo.createAuditLog('a-1', 'p-1', 'u-1', 'alex', 'admin', 'action-1', 'label-1', 'web', '{}', '127.0.0.1');

    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO audit_logs'));
    expect(mockBind).toHaveBeenCalledWith('a-1', 'p-1', 'u-1', 'alex', 'admin', 'action-1', 'label-1', 'web', '{}', '127.0.0.1');
  });

  it('getScans queries scans ordered by created_at desc', async () => {
    const scansList = [{ id: 's-1' }];
    mockAll.mockResolvedValue({ results: scansList });

    const repo = new ScansRepository(mockEnv);
    expect(await repo.getScans('p-1')).toBe(scansList);
    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('SELECT * FROM scans WHERE project_id = ?'));
  });

  it('getScan returns details by scanId', async () => {
    const scan = { id: 's-1', status: 'queued' };
    mockAll.mockResolvedValue(scan);

    const repo = new ScansRepository(mockEnv);
    expect(await repo.getScan('s-1')).toBe(scan);
  });

  describe('updateScan', () => {
    it('throws error if no valid fields provided', async () => {
      const repo = new ScansRepository(mockEnv);
      await expect(repo.updateScan('s-1', { invalid_field: 'val' })).rejects.toThrow('No valid fields to update|400');
    });

    it('prepares update and returns updated scan details', async () => {
      const scan = { id: 's-1', status: 'completed' };
      mockAll.mockResolvedValue(scan); // first for run execution, then getScan query

      const repo = new ScansRepository(mockEnv);
      const res = await repo.updateScan('s-1', { status: 'completed', report_url: 'https://r2.com/1.json' });

      expect(res).toBe(scan);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE scans SET status = ?, report_url = ? WHERE id = ?'));
      expect(mockBind).toHaveBeenCalledWith('completed', 'https://r2.com/1.json', 's-1');
    });
  });

  it('updateScanReportUrl updates url and is_encrypted flag', async () => {
    const repo = new ScansRepository(mockEnv);
    await repo.updateScanReportUrl('s-1', 'https://r2.com/1.json');

    expect(mockPrepare).toHaveBeenCalledWith('UPDATE scans SET report_url = ?, is_encrypted = 1 WHERE id = ?');
    expect(mockBind).toHaveBeenCalledWith('https://r2.com/1.json', 's-1');
  });

  it('getRunnerLogs queries scan events', async () => {
    const logs = [{ id: 'evt-1' }];
    mockAll.mockResolvedValue({ results: logs });

    const repo = new ScansRepository(mockEnv);
    expect(await repo.getRunnerLogs('s-1')).toBe(logs);
  });

  it('getFindings queries findings by scanId', async () => {
    const findings = [{ id: 'f-1' }];
    mockAll.mockResolvedValue({ results: findings });

    const repo = new ScansRepository(mockEnv);
    expect(await repo.getFindings('s-1')).toBe(findings);
  });

  it('getFindingDetails queries finding and scan details', async () => {
    const details = { id: 'f-1', project_id: 'p-1' };
    mockAll.mockResolvedValue(details);

    const repo = new ScansRepository(mockEnv);
    expect(await repo.getFindingDetails('f-1')).toBe(details);
  });

  describe('updateFinding', () => {
    it('throws error if no allowed fields provided', async () => {
      const repo = new ScansRepository(mockEnv);
      await expect(repo.updateFinding('f-1', { invalid: 1 })).rejects.toThrow('No valid fields to update|400');
    });

    it('updates fields and dispatches webhook', async () => {
      const updated = { id: 'f-1', project_id: 'p-1', ai_status: 'confirmed' };
      mockAll
        .mockResolvedValueOnce({ success: true }) // UPDATE query run
        .mockResolvedValueOnce(updated);          // getFindingDetails query first

      const repo = new ScansRepository(mockEnv);
      const res = await repo.updateFinding('f-1', { ai_status: 'confirmed', ai_relevance: 'high' });

      expect(res).toBe(updated);
      expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE findings SET ai_status = ?, ai_relevance = ? WHERE id = ?'));
      expect(mockBind).toHaveBeenCalledWith('confirmed', 'high', 'f-1');
      expect(dispatchWebhook).toHaveBeenCalledWith(mockEnv, 'p-1', 'finding.triaged', updated);
    });
  });

  it('getScheduledScanConfigs queries scan configs', async () => {
    const configs = [{ id: 'c-1', project_id: 'p-1' }];
    mockAll.mockResolvedValue({ results: configs });

    const repo = new ScansRepository(mockEnv);
    expect(await repo.getScheduledScanConfigs()).toBe(configs);
  });

  describe('getProjectOwnerForScan', () => {
    it('returns undefined if project has no owners', async () => {
      mockAll.mockResolvedValue({ results: [] });

      const repo = new ScansRepository(mockEnv);
      expect(await repo.getProjectOwnerForScan('p-1')).toBeUndefined();
    });

    it('prefers Supporter Plan owner over others', async () => {
      const owners = [
        { id: 'u-1', plan: 'Free' },
        { id: 'u-2', plan: 'Supporter Plan' }
      ];
      mockAll.mockResolvedValue({ results: owners });

      const repo = new ScansRepository(mockEnv);
      const owner = await repo.getProjectOwnerForScan('p-1');
      expect(owner).toEqual(owners[1]);
    });
  });

  it('triggerScheduledScan executes batch transaction to insert scan and update schedule last_run_at', async () => {
    const repo = new ScansRepository(mockEnv);
    await repo.triggerScheduledScan('s-1', 'p-1', 'https://target.com', 'prof', 'queued', 'u-1', 'c-1', '2026-07-08T18:00:00Z');

    expect(mockPrepare).toHaveBeenCalledTimes(2);
    expect(mockBatch).toHaveBeenCalled();
  });

  it('getCachedSwagger queries swagger cache by url', async () => {
    const swagger = { base_path: '/api' };
    mockAll.mockResolvedValue(swagger);

    const repo = new ScansRepository(mockEnv);
    expect(await repo.getCachedSwagger('https://target.com/swagger.json')).toBe(swagger);
  });

  it('getCachedSwaggerDetails queries swagger details by url', async () => {
    const details = { endpoints_hash: 'h-1' };
    mockAll.mockResolvedValue(details);

    const repo = new ScansRepository(mockEnv);
    expect(await repo.getCachedSwaggerDetails('https://target.com/swagger.json')).toBe(details);
  });

  it('upsertSwaggerCache inserts or replaces cached details', async () => {
    const repo = new ScansRepository(mockEnv);
    await repo.upsertSwaggerCache('https://target.com/swagger.json', '/api', 'hash1', 'key1', 'key2');

    expect(mockPrepare).toHaveBeenCalledWith(expect.stringContaining('INSERT OR REPLACE INTO swagger_cache'));
    expect(mockBind).toHaveBeenCalledWith('https://target.com/swagger.json', '/api', 'hash1', 'key1', 'key2');
  });

  describe('updateScanStatus', () => {
    it('updates status and triggers webhook', async () => {
      const scan = { id: 's-1', project_id: 'p-1', status: 'completed', summary_stats: '{}' };
      mockAll
        .mockResolvedValueOnce({ success: true }) // UPDATE query run
        .mockResolvedValueOnce(scan);             // getScan query

      const repo = new ScansRepository(mockEnv);
      await repo.updateScanStatus('s-1', 'completed', '{}');

      expect(mockPrepare).toHaveBeenNthCalledWith(1, expect.stringContaining("UPDATE scans SET status = 'completed', completed_at = datetime('now'), summary_stats = ? WHERE id = ?"));
      expect(dispatchWebhook).toHaveBeenCalledWith(mockEnv, 'p-1', 'scan.completed', expect.any(Object));
    });

    it('triggers failed webhook on failed status update', async () => {
      const scan = { id: 's-1', project_id: 'p-1', status: 'failed' };
      mockAll
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce(scan);

      const repo = new ScansRepository(mockEnv);
      await repo.updateScanStatus('s-1', 'failed');

      expect(dispatchWebhook).toHaveBeenCalledWith(mockEnv, 'p-1', 'scan.failed', expect.any(Object));
    });
  });

  it('getQueuedScans queries queued scans and joins runner key', async () => {
    const queued = [{ id: 's-1', userPublicKey: 'pub-1' }];
    mockAll.mockResolvedValue({ results: queued });

    const repo = new ScansRepository(mockEnv);
    expect(await repo.getQueuedScans()).toBe(queued);
  });

  it('getScanConfigByProject queries scan config json', async () => {
    mockAll.mockResolvedValue({ config_json: '{}' });
    const repo = new ScansRepository(mockEnv);
    expect(await repo.getScanConfigByProject('p-1', 'default')).toBe('{}');
  });

  describe('processFindingsQueueMessages', () => {
    it('does nothing if message list is empty', async () => {
      const repo = new ScansRepository(mockEnv);
      await repo.processFindingsQueueMessages([]);
      expect(mockBatch).not.toHaveBeenCalled();
    });

    it('batches scan event insert, status update, findings insert and dispatches webhooks', async () => {
      const messages = [
        {
          body: {
            scanId: 's-1',
            type: 'event',
            payload: { type: 'complete', data: { total: 10 } }
          }
        },
        {
          body: {
            scanId: 's-1',
            type: 'result',
            payload: {
              type: 'result',
              data: {
                analyzerFindings: [
                  { ruleId: 'r-1', level: 'high', message: 'test msg', evidence: 'ev1' }
                ]
              }
            }
          }
        },
        {
          body: {
            scanId: 's-2',
            type: 'error',
            payload: 'DNS failed'
          }
        }
      ];

      mockAll.mockResolvedValueOnce({
        results: [
          { id: 's-1', project_id: 'p-1', target_url: 'https://t1.com', profile: 'prof1' },
          { id: 's-2', project_id: 'p-2', target_url: 'https://t2.com', profile: 'prof2' }
        ]
      });

      const repo = new ScansRepository(mockEnv);
      await repo.processFindingsQueueMessages(messages);

      // Verify batch was executed
      expect(mockBatch).toHaveBeenCalled();

      // Verify we dispatched both completed and failed webhooks
      expect(dispatchWebhook).toHaveBeenCalledTimes(2);
      expect(dispatchWebhook).toHaveBeenNthCalledWith(1, mockEnv, 'p-1', 'scan.completed', expect.any(Object));
      expect(dispatchWebhook).toHaveBeenNthCalledWith(2, mockEnv, 'p-2', 'scan.failed', expect.any(Object));
    });
  });
});
