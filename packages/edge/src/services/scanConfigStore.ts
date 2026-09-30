// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Env } from '../env';

export const MAX_SCAN_CONFIG_BYTES = 20 * 1024 * 1024;
export const SCAN_CONFIG_PREFIX = 'scans/configs/';

const RUN_ID_REGEX = /^[A-Za-z0-9_-]{1,64}$/;
const SCAN_CONFIG_KEY_REGEX = /^scans\/configs\/[A-Za-z0-9_-]{1,64}\/[0-9a-f-]{36}\.json$/;

export function isValidRunId(runId: unknown): runId is string {
  return typeof runId === 'string' && RUN_ID_REGEX.test(runId);
}

export function isValidScanConfigKey(key: unknown): key is string {
  return typeof key === 'string' && !key.includes('..') && SCAN_CONFIG_KEY_REGEX.test(key);
}

export function isScanConfigKeyForRun(key: unknown, runId: unknown): key is string {
  if (!isValidScanConfigKey(key) || !isValidRunId(runId)) {
    return false;
  }
  return key.startsWith(`${SCAN_CONFIG_PREFIX}${runId}/`);
}

/** Serializes config, enforces the size cap (throws 'Scan config too large (<n> bytes, limit <max>)|413'),
 *  performs no I/O. */
export function serializeScanConfig(config: unknown): { body: string; byteLength: number } {
  const serialized = JSON.stringify(config === undefined ? {} : config);
  const byteLength = new TextEncoder().encode(serialized).byteLength;
  if (byteLength > MAX_SCAN_CONFIG_BYTES) {
    throw new Error(`Scan config too large (${byteLength} bytes, limit ${MAX_SCAN_CONFIG_BYTES})|413`);
  }
  return { body: serialized, byteLength };
}

/** Validates runId, writes body to env.STORAGE with contentType application/json, returns the key. */
export async function writeScanConfig(env: Env, runId: string, body: string): Promise<string> {
  if (!isValidRunId(runId)) {
    throw new Error('Invalid runId|400');
  }

  const key = `${SCAN_CONFIG_PREFIX}${runId}/${crypto.randomUUID()}.json`;
  await env.STORAGE.put(key, body, {
    httpMetadata: { contentType: 'application/json' },
  });

  return key;
}

/** Validates the key (throws 'Invalid scan config key|500'), reads it and JSON-parses it. Throws if the
 *  object is missing or the JSON is invalid. */
export async function getScanConfig(env: Env, key: string): Promise<any> {
  if (!isValidScanConfigKey(key)) {
    throw new Error('Invalid scan config key|500');
  }

  const obj = await env.STORAGE.get(key);
  if (!obj) {
    throw new Error(`Scan config not found: ${key}|500`);
  }

  const text = await obj.text();
  return JSON.parse(text);
}

/** Validates the key, deletes the object, swallows and logs errors (best effort). */
export async function deleteScanConfig(env: Env, key: string): Promise<void> {
  if (!isValidScanConfigKey(key)) {
    console.warn(`[scanConfigStore] deleteScanConfig: invalid key ignored: ${key}`);
    return;
  }

  try {
    await env.STORAGE.delete(key);
  } catch (err) {
    console.error(`[scanConfigStore] Failed to delete scan config ${key}:`, err);
  }
}
