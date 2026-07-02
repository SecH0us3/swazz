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

  it('routes to correct database shards based on routingKey (sharding routing implementation)', () => {
    const mockPrimaryDB = { name: 'primary' } as unknown as D1Database;
    const mockShard1DB = { name: 'shard1' } as unknown as D1Database;
    
    // In a sharded environment, env would contain additional database bindings
    const mockEnv = { 
      DB: mockPrimaryDB,
      DB_SHARD_1: mockShard1DB 
    } as unknown as Env;
    
    // Verifies that routing resolves to correct databases
    expect(getDB(mockEnv, 'project-routing-to-primary')).toBe(mockPrimaryDB);
    expect(getDB(mockEnv, 'project-routing-to-shard-1')).toBe(mockShard1DB);
  });
});
