import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cronMatches, handleScheduledScans } from '../../../src/utils/scheduler';
import { Env } from '../../../src/env';
import { ScansRepository } from '../../../src/repositories/scans';

vi.mock('../../../src/repositories/scans', () => {
  return {
    ScansRepository: vi.fn().mockImplementation(() => ({
      getScheduledScanConfigs: vi.fn(),
      getProjectOwnerForScan: vi.fn(),
      triggerScheduledScan: vi.fn(),
    })),
  };
});

describe('scheduler util', () => {
  describe('cronMatches', () => {
    it('returns false for invalid expression', () => {
      expect(cronMatches('invalid', new Date())).toBe(false);
    });

    it('matches exact time', () => {
      const d = new Date(Date.UTC(2025, 0, 1, 12, 30)); // Jan 1 2025, 12:30 UTC
      expect(cronMatches('30 12 1 1 3', d)).toBe(true); // 3 = Wednesday
    });

    it('matches wildcards', () => {
      const d = new Date(Date.UTC(2025, 0, 1, 12, 30));
      expect(cronMatches('* * * * *', d)).toBe(true);
    });

    it('matches step values', () => {
      const d = new Date(Date.UTC(2025, 0, 1, 12, 30));
      expect(cronMatches('*/15 * * * *', d)).toBe(true);
      expect(cronMatches('*/7 * * * *', d)).toBe(false); // 30 is not divisible by 7 starting from 0
    });

    it('matches lists', () => {
      const d = new Date(Date.UTC(2025, 0, 1, 12, 30));
      expect(cronMatches('15,30,45 * * * *', d)).toBe(true);
      expect(cronMatches('15,45 * * * *', d)).toBe(false);
    });

    it('matches ranges', () => {
      const d = new Date(Date.UTC(2025, 0, 1, 12, 30));
      expect(cronMatches('20-40 * * * *', d)).toBe(true);
      expect(cronMatches('10-20 * * * *', d)).toBe(false);
    });

    it('matches ranges with steps', () => {
      const d = new Date(Date.UTC(2025, 0, 1, 12, 30));
      expect(cronMatches('0-45/15 * * * *', d)).toBe(true);
      expect(cronMatches('0-20/15 * * * *', d)).toBe(false);
    });
  });

  describe('handleScheduledScans', () => {
    let mockEnv: any;
    let mockRepo: any;

    beforeEach(() => {
      mockEnv = {
        SCAN_QUEUE: {
          send: vi.fn(),
        },
      };

      const RepoMock = vi.mocked(ScansRepository);
      RepoMock.mockClear();
    });

    it('processes scheduled scans', async () => {
      const configs = [
        {
          id: 'c1',
          project_id: 'p1',
          cron_schedule: '* * * * *', // runs every minute
          config_json: '{"base_url": "http://test", "settings": {"profiles": ["full"]}}'
        }
      ];

      vi.useFakeTimers();
      const now = new Date(Date.UTC(2025, 0, 1, 12, 30));
      vi.setSystemTime(now);

      const repoInstance = {
        getScheduledScanConfigs: vi.fn().mockResolvedValue(configs),
        getProjectOwnerForScan: vi.fn().mockResolvedValue({ id: 'u1', public_key: 'pk' }),
        triggerScheduledScan: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(ScansRepository).mockImplementation(function() { return repoInstance; } as any);

      await handleScheduledScans(mockEnv as Env);

      expect(repoInstance.getScheduledScanConfigs).toHaveBeenCalled();
      expect(repoInstance.getProjectOwnerForScan).toHaveBeenCalledWith('p1');
      expect(repoInstance.triggerScheduledScan).toHaveBeenCalledWith(
        expect.any(String),
        'p1',
        'http://test',
        'full',
        'queued',
        'u1',
        'c1',
        now.toISOString()
      );
      expect(mockEnv.SCAN_QUEUE.send).toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('skips scan if already ran in last 50 seconds', async () => {
      vi.useFakeTimers();
      const now = new Date(Date.UTC(2025, 0, 1, 12, 30));
      vi.setSystemTime(now);

      const lastRun = new Date(now.getTime() - 10000).toISOString(); // 10s ago

      const configs = [
        {
          id: 'c1',
          project_id: 'p1',
          cron_schedule: '* * * * *',
          last_run_at: lastRun,
        }
      ];

      const repoInstance = {
        getScheduledScanConfigs: vi.fn().mockResolvedValue(configs),
        getProjectOwnerForScan: vi.fn(),
      };
      vi.mocked(ScansRepository).mockImplementation(function() { return repoInstance; } as any);

      await handleScheduledScans(mockEnv as Env);

      expect(repoInstance.getProjectOwnerForScan).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('skips if no active owner', async () => {
      vi.useFakeTimers();
      const now = new Date(Date.UTC(2025, 0, 1, 12, 30));
      vi.setSystemTime(now);

      const configs = [
        {
          id: 'c1',
          project_id: 'p1',
          cron_schedule: '* * * * *',
        }
      ];

      const repoInstance = {
        getScheduledScanConfigs: vi.fn().mockResolvedValue(configs),
        getProjectOwnerForScan: vi.fn().mockResolvedValue(null),
        triggerScheduledScan: vi.fn(),
      };
      vi.mocked(ScansRepository).mockImplementation(function() { return repoInstance; } as any);

      await handleScheduledScans(mockEnv as Env);

      expect(repoInstance.triggerScheduledScan).not.toHaveBeenCalled();

      vi.useRealTimers();
    });

    it('catches and logs errors during processing', async () => {
      vi.useFakeTimers();
      const now = new Date(Date.UTC(2025, 0, 1, 12, 30));
      vi.setSystemTime(now);

      const configs = [
        {
          id: 'c1',
          project_id: 'p1',
          cron_schedule: '* * * * *',
        }
      ];

      const repoInstance = {
        getScheduledScanConfigs: vi.fn().mockResolvedValue(configs),
        getProjectOwnerForScan: vi.fn().mockRejectedValue(new Error('db fail')),
      };
      vi.mocked(ScansRepository).mockImplementation(function() { return repoInstance; } as any);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await handleScheduledScans(mockEnv as Env);

      expect(consoleSpy).toHaveBeenCalledWith(`[Scheduler] Error processing schedule c1:`, expect.any(Error));

      consoleSpy.mockRestore();
      vi.useRealTimers();
    });
  });
});
