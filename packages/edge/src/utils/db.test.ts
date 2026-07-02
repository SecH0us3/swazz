import { describe, it, expect } from 'vitest';
import { getDB } from './db';
import { Env } from '../env';
import { D1Database } from '@cloudflare/workers-types';

describe('getDB Helper', () => {
  it('returns the default DB binding when no routingKey is provided', () => {
    const mockDB = {} as D1Database;
    const mockEnv = { DB: mockDB } as unknown as Env;
    expect(getDB(mockEnv)).toBe(mockDB);
  });

  it('returns the default DB binding even when routingKey is provided (current behavior)', () => {
    const mockDB = {} as D1Database;
    const mockEnv = { DB: mockDB } as unknown as Env;
    expect(getDB(mockEnv, 'user-123')).toBe(mockDB);
  });
});
