import { describe, it, expect } from 'vitest';
import { hashUsername } from '../../../src/utils/auth';

describe('Auth Utils - Username Hashing', () => {
  it('should generate a valid 64-character SHA-256 hex string', async () => {
    const hash = await hashUsername('testuser');
    expect(hash).toHaveLength(64);
    expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
  });

  it('should be case-insensitive', async () => {
    const hash1 = await hashUsername('TestUser');
    const hash2 = await hashUsername('testuser');
    const hash3 = await hashUsername('TESTUSER');
    
    expect(hash1).toBe(hash2);
    expect(hash2).toBe(hash3);
  });

  it('should trim leading and trailing whitespace', async () => {
    const hash1 = await hashUsername('  testuser  ');
    const hash2 = await hashUsername('testuser');
    
    expect(hash1).toBe(hash2);
  });

  it('should generate different hashes for different usernames', async () => {
    const hash1 = await hashUsername('user1');
    const hash2 = await hashUsername('user2');
    
    expect(hash1).not.toBe(hash2);
  });

  it('should apply the constant secure salt', async () => {
    // A known hash calculated with: sha256("testuser:swazz-secure-username-salt-constant-2026")
    // "testuser:swazz-secure-username-salt-constant-2026"
    const hash = await hashUsername('testuser');
    expect(hash).toBe('9717408f93c7899956f0e8b4778804623e795b878f15b06cf44f89f0dff257ff');
  });

  it('should reject non-string inputs with a TypeError', async () => {
    await expect(hashUsername(null as any)).rejects.toThrow(TypeError);
    await expect(hashUsername(undefined as any)).rejects.toThrow(TypeError);
    await expect(hashUsername(123 as any)).rejects.toThrow(TypeError);
  });
});
