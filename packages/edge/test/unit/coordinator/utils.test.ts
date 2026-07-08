import { describe, it, expect } from 'vitest';
import { isVersionOutdated, getPublicKeyFromTags, getRunIdFromTags } from '../../../src/coordinator/utils';

describe('isVersionOutdated', () => {
  it('returns false if either version is dev', () => {
    expect(isVersionOutdated('dev', '1.0.0')).toBe(false);
    expect(isVersionOutdated('1.0.0', 'dev')).toBe(false);
  });

  it('returns true if runner version is older', () => {
    expect(isVersionOutdated('1.0.0', '1.1.0')).toBe(true);
    expect(isVersionOutdated('1.0.0', '2.0.0')).toBe(true);
    expect(isVersionOutdated('v1.0.0', '1.0.1')).toBe(true);
  });

  it('returns false if runner version is equal or newer', () => {
    expect(isVersionOutdated('1.1.0', '1.1.0')).toBe(false);
    expect(isVersionOutdated('2.0.0', '1.1.0')).toBe(false);
    expect(isVersionOutdated('v1.0.2', '1.0.1')).toBe(false);
  });
});

describe('getPublicKeyFromTags', () => {
  it('extracts public key by skipping runner and metadata tags', () => {
    const tags = ['runner-pending', 'name:test', 'version:1.0', 'user_id:123', 'mypublickeyhash123'];
    expect(getPublicKeyFromTags(tags)).toBe('mypublickeyhash123');
  });

  it('returns undefined if no public key tag is found', () => {
    const tags = ['runner', 'name:test', 'version:1.0', 'user_id:123'];
    expect(getPublicKeyFromTags(tags)).toBeUndefined();
  });
});

describe('getRunIdFromTags', () => {
  it('extracts run ID by skipping client and metadata tags', () => {
    const tags = ['client', 'name:test', 'version:1.0', 'user_id:123', 'runId-999'];
    expect(getRunIdFromTags(tags)).toBe('runId-999');
  });

  it('returns undefined if no run ID tag is found', () => {
    const tags = ['runner', 'name:test', 'version:1.0', 'user_id:123'];
    expect(getRunIdFromTags(tags)).toBeUndefined();
  });
});

