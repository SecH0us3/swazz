import { describe, it, expect } from 'vitest';
import { isVersionOutdated } from '../../../src/coordinator/utils';

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
