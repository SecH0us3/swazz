// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

export function isVersionOutdated(runnerVer: string, coordVer: string): boolean {
  if (typeof runnerVer !== 'string') {
    throw new TypeError('runnerVer must be a string');
  }
  if (typeof coordVer !== 'string') {
    throw new TypeError('coordVer must be a string');
  }
  if (runnerVer === 'dev' || coordVer === 'dev') return false;
  
  const cleanRunner = runnerVer.replace(/^v\.?/, '');
  const cleanCoord = coordVer.replace(/^v\.?/, '');
  
  const [runnerRelease, runnerPre] = cleanRunner.split('-');
  const [coordRelease, coordPre] = cleanCoord.split('-');
  
  const runnerParts = runnerRelease.split('.').map(Number);
  const coordParts = coordRelease.split('.').map(Number);
  
  for (let i = 0; i < Math.max(runnerParts.length, coordParts.length); i++) {
    const r = runnerParts[i];
    const c = coordParts[i];
    if (r === undefined && c === undefined) break;
    const rNum = r === undefined ? 0 : r;
    const cNum = c === undefined ? 0 : c;
    if (isNaN(rNum) || isNaN(cNum)) {
      if (runnerRelease < coordRelease) return true;
      if (runnerRelease > coordRelease) return false;
      break;
    }
    if (rNum < cNum) return true;
    if (rNum > cNum) return false;
  }
  
  if (runnerPre && !coordPre) return true;
  if (!runnerPre && coordPre) return false;
  if (runnerPre && coordPre) {
    return runnerPre < coordPre;
  }
  
  return false;
}

export function getPublicKeyFromTags(tags: string[]): string | undefined {
  return tags.find(t =>
    t !== 'runner-pending' &&
    t !== 'runner' &&
    !t.startsWith('name:') &&
    !t.startsWith('version:') &&
    !t.startsWith('user_id:')
  );
}

export function getRunIdFromTags(tags: string[]): string | undefined {
  return tags.find(t =>
    t !== 'client' &&
    t !== 'runner' &&
    t !== 'runner-pending' &&
    !t.startsWith('name:') &&
    !t.startsWith('version:') &&
    !t.startsWith('user_id:')
  );
}

// Per-scan keys the coordinator keeps in DO storage until the scan is dispatched or dropped.
export function scanStateKeys(runId: string): string[] {
  return [`config:${runId}`, `config_ref:${runId}`, `config_meta:${runId}`, `user_public_key:${runId}`];
}

export async function clearScanState(storage: DurableObjectStorage, runId: string): Promise<void> {
  await storage.delete(scanStateKeys(runId));
}

export const DO_STORAGE_BATCH_LIMIT = 128;
export const FINISHED_SCANS_KEY = 'finished_runs';
export const MAX_FINISHED_SCANS = 200;

export async function markScanFinished(storage: DurableObjectStorage, runId: string): Promise<void> {
  if (!storage?.get || !storage?.put) return;
  const map = await storage.get<string[]>([FINISHED_SCANS_KEY]);
  const existing = (map instanceof Map ? map.get(FINISHED_SCANS_KEY) : undefined) ?? [];
  const list = Array.isArray(existing) ? existing.filter(id => id !== runId) : [];
  list.push(runId);
  while (list.length > MAX_FINISHED_SCANS) {
    list.shift();
  }
  await storage.put(FINISHED_SCANS_KEY, list);
}

export async function getFinishedScans(storage: DurableObjectStorage): Promise<Set<string>> {
  if (!storage?.get) return new Set();
  const map = await storage.get<string[]>([FINISHED_SCANS_KEY]);
  const list = map instanceof Map ? map.get(FINISHED_SCANS_KEY) : undefined;
  return new Set(Array.isArray(list) ? list : []);
}

export async function batchStorageGet<T = any>(
  storage: DurableObjectStorage,
  keys: string[]
): Promise<Map<string, T>> {
  if (keys.length === 0) {
    return new Map();
  }
  if (keys.length <= DO_STORAGE_BATCH_LIMIT) {
    return await storage.get<T>(keys);
  }
  const merged = new Map<string, T>();
  for (let i = 0; i < keys.length; i += DO_STORAGE_BATCH_LIMIT) {
    const chunk = keys.slice(i, i + DO_STORAGE_BATCH_LIMIT);
    const part = await storage.get<T>(chunk);
    for (const [k, v] of part.entries()) {
      merged.set(k, v);
    }
  }
  return merged;
}


