// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isValidRunId,
  isValidScanConfigKey,
  putScanConfig,
  getScanConfig,
  deleteScanConfig,
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

  describe('putScanConfig and getScanConfig round-trip', () => {
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

      const serializedSize = new TextEncoder().encode(JSON.stringify(config)).byteLength;
      expect(serializedSize).toBeGreaterThan(250 * 1024); // ~300 KB

      const key = await putScanConfig(mockEnv, runId, config);
      expect(isValidScanConfigKey(key)).toBe(true);
      expect(key.startsWith(`${SCAN_CONFIG_PREFIX}${runId}/`)).toBe(true);

      const retrieved = await getScanConfig(mockEnv, key);
      expect(retrieved).toEqual(config);
      expect(retrieved.settings.disable_shared_runners).toBe(true);
    });

    it('two puts for the same runId produce different keys (Threat model invariant 1)', async () => {
      const runId = 'test-run-unique';
      const config = { base_url: 'https://example.com' };

      const key1 = await putScanConfig(mockEnv, runId, config);
      const key2 = await putScanConfig(mockEnv, runId, config);

      expect(key1).not.toBe(key2);
      expect(isValidScanConfigKey(key1)).toBe(true);
      expect(isValidScanConfigKey(key2)).toBe(true);
      expect(key1.startsWith(`${SCAN_CONFIG_PREFIX}${runId}/`)).toBe(true);
      expect(key2.startsWith(`${SCAN_CONFIG_PREFIX}${runId}/`)).toBe(true);
    });

    it('rejects invalid runId on put (Threat model invariant 2)', async () => {
      await expect(putScanConfig(mockEnv, '../invalid', { test: true })).rejects.toThrow('Invalid runId|400');
      expect(mockStorage.put).not.toHaveBeenCalled();
    });

    it('rejects a config over 20 MB with 413 and writes nothing (Threat model invariant 4)', async () => {
      const runId = crypto.randomUUID();
      // Generate a string that exceeds 20 * 1024 * 1024 bytes
      const bigString = 'x'.repeat(MAX_SCAN_CONFIG_BYTES + 100);
      const oversizedConfig = { data: bigString };

      await expect(putScanConfig(mockEnv, runId, oversizedConfig)).rejects.toThrow(
        new RegExp(`Scan config too large \\(\\d+ bytes, limit ${MAX_SCAN_CONFIG_BYTES}\\)\\|413`)
      );
      expect(mockStorage.put).not.toHaveBeenCalled();
      expect(store.size).toBe(0);
    });

    it('getScanConfig validates key and throws 500 on invalid key (Threat model invariant 3)', async () => {
      await expect(getScanConfig(mockEnv, 'invalid-key')).rejects.toThrow('Invalid scan config key|500');
      expect(mockStorage.get).not.toHaveBeenCalled();
    });

    it('getScanConfig throws 500 when object is missing in R2', async () => {
      const validKey = `${SCAN_CONFIG_PREFIX}run-1/${crypto.randomUUID()}.json`;
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
      const key = await putScanConfig(mockEnv, runId, { test: 123 });
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
