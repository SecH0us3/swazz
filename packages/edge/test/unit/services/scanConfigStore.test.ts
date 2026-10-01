// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isValidRunId,
  isValidScanConfigKey,
  isScanConfigKeyForRun,
  serializeScanConfig,
  writeScanConfig,
  getScanConfig,
  deleteScanConfig,
  ScanConfigNotFoundError,
  MAX_SCAN_CONFIG_BYTES,
  SCAN_CONFIG_PREFIX,
} from '../../../src/services/scanConfigStore';
import { Env } from '../../../src/env';

describe('scanConfigStore', () => {
  let mockEnv: Env;
  let store: Map<string, { value: string; httpMetadata?: any }>;
  let mockStorage: any;

  beforeEach(() => {
    store = new Map();
    mockStorage = {
      put: vi.fn(async (key: string, value: string, opts?: any) => {
        store.set(key, { value, httpMetadata: opts?.httpMetadata });
      }),
      get: vi.fn(async (key: string) => {
        const item = store.get(key);
        if (!item) return null;
        return {
          text: async () => item.value,
          httpMetadata: item.httpMetadata,
        };
      }),
      delete: vi.fn(async (key: string) => {
        store.delete(key);
      }),
    };

    mockEnv = {
      STORAGE: mockStorage,
    } as any;
  });

  describe('isValidRunId (Threat model invariant 2)', () => {
    it('accepts valid UUID and alphanumeric strings with underscores and hyphens', () => {
      expect(isValidRunId(crypto.randomUUID())).toBe(true);
      expect(isValidRunId('run-123_abc')).toBe(true);
      expect(isValidRunId('a')).toBe(true);
      expect(isValidRunId('A'.repeat(64))).toBe(true);
    });

    it('rejects path traversal and directory separators', () => {
      expect(isValidRunId('../x')).toBe(false);
      expect(isValidRunId('a/b')).toBe(false);
      expect(isValidRunId('..')).toBe(false);
      expect(isValidRunId('/run1')).toBe(false);
    });

    it('rejects empty strings', () => {
      expect(isValidRunId('')).toBe(false);
    });

    it('rejects strings longer than 64 characters', () => {
      expect(isValidRunId('a'.repeat(65))).toBe(false);
    });

    it('rejects non-strings and special characters', () => {
      expect(isValidRunId(null)).toBe(false);
      expect(isValidRunId(undefined)).toBe(false);
      expect(isValidRunId(12345)).toBe(false);
      expect(isValidRunId({})).toBe(false);
      expect(isValidRunId(['run-1'])).toBe(false);
      expect(isValidRunId('run id with spaces')).toBe(false);
      expect(isValidRunId('run$special!')).toBe(false);
    });
  });

  describe('isValidScanConfigKey (Threat model invariant 3)', () => {
    it('accepts valid generated keys matching the invariant regex', () => {
      const runId = 'valid-run-123';
      const uuid = crypto.randomUUID();
      const key = `${SCAN_CONFIG_PREFIX}${runId}/${uuid}.json`;
      expect(isValidScanConfigKey(key)).toBe(true);
    });

    it('rejects keys missing prefix', () => {
      const uuid = crypto.randomUUID();
      expect(isValidScanConfigKey(`other/configs/run1/${uuid}.json`)).toBe(false);
      expect(isValidScanConfigKey(`configs/run1/${uuid}.json`)).toBe(false);
      expect(isValidScanConfigKey(`run1/${uuid}.json`)).toBe(false);
    });

    it('rejects keys with path traversal / ..', () => {
      const uuid = crypto.randomUUID();
      expect(isValidScanConfigKey(`scans/configs/../${uuid}.json`)).toBe(false);
      expect(isValidScanConfigKey(`scans/configs/run1/../${uuid}.json`)).toBe(false);
    });

    it('rejects non-.json extensions', () => {
      const uuid = crypto.randomUUID();
      expect(isValidScanConfigKey(`scans/configs/run1/${uuid}.txt`)).toBe(false);
      expect(isValidScanConfigKey(`scans/configs/run1/${uuid}.yaml`)).toBe(false);
      expect(isValidScanConfigKey(`scans/configs/run1/${uuid}.json.bak`)).toBe(false);
    });

    it('rejects invalid UUID formats or invalid runIds in key', () => {
      expect(isValidScanConfigKey('scans/configs/run1/not-a-uuid.json')).toBe(false);
      expect(isValidScanConfigKey(`scans/configs/${'a'.repeat(65)}/${crypto.randomUUID()}.json`)).toBe(false);
    });

    it('rejects non-strings', () => {
      expect(isValidScanConfigKey(null)).toBe(false);
      expect(isValidScanConfigKey(undefined)).toBe(false);
      expect(isValidScanConfigKey(123)).toBe(false);
    });
  });

  describe('isScanConfigKeyForRun (Threat model T3)', () => {
    it('accepts key matching the specified runId', () => {
      const runId = 'valid-run-123';
      const uuid = crypto.randomUUID();
      const key = `${SCAN_CONFIG_PREFIX}${runId}/${uuid}.json`;
      expect(isScanConfigKeyForRun(key, runId)).toBe(true);
    });

    it('rejects key belonging to another runId', () => {
      const uuid = crypto.randomUUID();
      const keyRunA = `${SCAN_CONFIG_PREFIX}run-A/${uuid}.json`;
      expect(isScanConfigKeyForRun(keyRunA, 'run-B')).toBe(false);
    });

    it('rejects prefix collision without boundary (run-1 vs run-123)', () => {
      const uuid = crypto.randomUUID();
      const keyRun123 = `${SCAN_CONFIG_PREFIX}run-123/${uuid}.json`;
      expect(isScanConfigKeyForRun(keyRun123, 'run-1')).toBe(false);
    });

    it('rejects invalid key or invalid runId', () => {
      const uuid = crypto.randomUUID();
      expect(isScanConfigKeyForRun(`../bad/${uuid}.json`, 'run-1')).toBe(false);
      expect(isScanConfigKeyForRun(`${SCAN_CONFIG_PREFIX}run-1/${uuid}.json`, '../bad')).toBe(false);
      expect(isScanConfigKeyForRun(null, 'run-1')).toBe(false);
      expect(isScanConfigKeyForRun(`${SCAN_CONFIG_PREFIX}run-1/${uuid}.json`, null)).toBe(false);
    });
  });

  describe('serializeScanConfig (no I/O, 413 check)', () => {
    it('serializes a config and returns body and byteLength without I/O', () => {
      const config = { base_url: 'https://api.example.com', endpoints: [{ path: '/test' }] };
      const res = serializeScanConfig(config);
      expect(res.body).toBe(JSON.stringify(config));
      expect(res.byteLength).toBe(new TextEncoder().encode(res.body).byteLength);
      expect(mockStorage.put).not.toHaveBeenCalled();
    });

    it('handles undefined config as empty object', () => {
      const res = serializeScanConfig(undefined);
      expect(res.body).toBe('{}');
      expect(res.byteLength).toBe(2);
    });

    it('rejects a config over 20 MB with 413 without I/O (Threat model T1 / invariant 4)', () => {
      const bigString = 'x'.repeat(MAX_SCAN_CONFIG_BYTES + 100);
      const oversizedConfig = { data: bigString };

      expect(() => serializeScanConfig(oversizedConfig)).toThrow(
        new RegExp(`Scan config too large \\(\\d+ bytes, limit ${MAX_SCAN_CONFIG_BYTES}\\)\\|413`)
      );
      expect(mockStorage.put).not.toHaveBeenCalled();
    });
  });

  describe('writeScanConfig and getScanConfig round-trip', () => {
    it('round-trips a config of about 300 KB', async () => {
      const runId = crypto.randomUUID();
      const largeEndpoints = [];
      for (let i = 0; i < 500; i++) {
        largeEndpoints.push({
          path: `/api/v1/resource/${i}/action/test/detail`,
          method: 'POST',
          summary: `Test summary for endpoint ${i} with padding text ${'x'.repeat(400)}`,
          parameters: [
            { name: `param_${i}`, in: 'query', schema: { type: 'string', default: 'sample_value' } },
            { name: 'X-Custom-Header', in: 'header', schema: { type: 'string' } }
          ],
        });
      }
      const config = {
        base_url: 'https://api.example.com',
        endpoints: largeEndpoints,
        settings: {
          disable_shared_runners: true,
          profiles: ['deep-fuzz'],
        },
      };

      const { body } = serializeScanConfig(config);
      expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(250 * 1024); // ~300 KB

      const key = await writeScanConfig(mockEnv, runId, body);
      expect(isValidScanConfigKey(key)).toBe(true);
      expect(isScanConfigKeyForRun(key, runId)).toBe(true);

      const retrieved = await getScanConfig(mockEnv, key);
      expect(retrieved).toEqual(config);
      expect(retrieved.settings.disable_shared_runners).toBe(true);
    });

    it('two writes for the same runId produce different keys (Threat model invariant 1)', async () => {
      const runId = 'test-run-unique';
      const { body } = serializeScanConfig({ base_url: 'https://example.com' });

      const key1 = await writeScanConfig(mockEnv, runId, body);
      const key2 = await writeScanConfig(mockEnv, runId, body);

      expect(key1).not.toBe(key2);
      expect(isValidScanConfigKey(key1)).toBe(true);
      expect(isValidScanConfigKey(key2)).toBe(true);
      expect(isScanConfigKeyForRun(key1, runId)).toBe(true);
      expect(isScanConfigKeyForRun(key2, runId)).toBe(true);
    });

    it('rejects invalid runId on write (Threat model invariant 2)', async () => {
      await expect(writeScanConfig(mockEnv, '../invalid', '{}')).rejects.toThrow('Invalid runId|400');
      expect(mockStorage.put).not.toHaveBeenCalled();
    });

    it('getScanConfig validates key and throws 500 on invalid key (Threat model invariant 3)', async () => {
      await expect(getScanConfig(mockEnv, 'invalid-key')).rejects.toThrow('Invalid scan config key|500');
      expect(mockStorage.get).not.toHaveBeenCalled();
    });

    it('getScanConfig throws ScanConfigNotFoundError with 500 when object is missing in R2', async () => {
      const validKey = `${SCAN_CONFIG_PREFIX}run-1/${crypto.randomUUID()}.json`;
      await expect(getScanConfig(mockEnv, validKey)).rejects.toThrow(ScanConfigNotFoundError);
      await expect(getScanConfig(mockEnv, validKey)).rejects.toThrow(/Scan config not found.*\|500/);
    });

    it('getScanConfig throws when JSON content in R2 is malformed', async () => {
      const validKey = `${SCAN_CONFIG_PREFIX}run-1/${crypto.randomUUID()}.json`;
      store.set(validKey, { value: 'invalid-json{{{' });

      await expect(getScanConfig(mockEnv, validKey)).rejects.toThrow(SyntaxError);
    });
  });

  describe('deleteScanConfig (Threat model invariant 7)', () => {
    it('deletes the object from R2 when key is valid', async () => {
      const runId = crypto.randomUUID();
      const { body } = serializeScanConfig({ test: 123 });
      const key = await writeScanConfig(mockEnv, runId, body);
      expect(store.has(key)).toBe(true);

      await deleteScanConfig(mockEnv, key);
      expect(mockStorage.delete).toHaveBeenCalledWith(key);
      expect(store.has(key)).toBe(false);
    });

    it('ignores invalid keys and does not invoke storage.delete', async () => {
      await deleteScanConfig(mockEnv, 'invalid-key');
      expect(mockStorage.delete).not.toHaveBeenCalled();
    });

    it('swallows errors and does not throw if storage.delete fails', async () => {
      const validKey = `${SCAN_CONFIG_PREFIX}run-1/${crypto.randomUUID()}.json`;
      mockStorage.delete.mockRejectedValueOnce(new Error('R2 delete failed'));

      await expect(deleteScanConfig(mockEnv, validKey)).resolves.not.toThrow();
    });
  });
});
