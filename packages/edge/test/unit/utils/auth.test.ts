import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  hashUsername,
  hashApiKey,
  getUserIdFromRequest,
  hashPassword,
  verifyPassword,
  verifyTurnstile,
  getSessionIat,
  isAnonymousUser,
  isWebRequest,
  getClientIp,
  getDeleteRequestedAt,
  verifyDummyPassword,
  safeCompare,
  deletionCache
} from '../../../src/utils/auth';
import { Env } from '../../../src/env';
import { sign } from 'hono/jwt';

const mockVerifyApiKey = vi.fn();

vi.mock('../../../src/repositories/auth', () => {
  return {
    AuthRepository: class {
      verifyApiKey = mockVerifyApiKey;
    }
  };
});

vi.mock('../../../src/utils/cleanup', () => ({
  cleanupExpiredGuests: vi.fn().mockResolvedValue(undefined)
}));

function createMockContext() {
  const mockHeaders: Record<string, string> = {};
  const mockQueries: Record<string, string> = {};
  return {
    req: {
      header: (name: string) => mockHeaders[name.toLowerCase()] || mockHeaders[name] || null,
      query: (name: string) => mockQueries[name] || null
    },
    env: {
      JWT_SECRET: 'jwt-secret-123',
      SESSION_CACHE: {
        get: vi.fn(),
        put: vi.fn()
      }
    },
    get: vi.fn(),
    set: vi.fn(),
    headers: mockHeaders,
    queries: mockQueries
  };
}

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
    const hash = await hashUsername('testuser');
    expect(hash).toBe('9717408f93c7899956f0e8b4778804623e795b878f15b06cf44f89f0dff257ff');
  });

  it('should reject non-string inputs with a TypeError', async () => {
    await expect(hashUsername(null as any)).rejects.toThrow(TypeError);
    await expect(hashUsername(undefined as any)).rejects.toThrow(TypeError);
    await expect(hashUsername(123 as any)).rejects.toThrow(TypeError);
  });
});

describe('Auth Utils - Additional functions', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockVerifyApiKey.mockReset();
    deletionCache.clear();
  });

  it('hashApiKey generates hex hash', async () => {
    const hash = await hashApiKey('key-123');
    expect(hash).toBeDefined();
    expect(hash.length).toBe(64);
  });

  describe('getUserIdFromRequest', () => {
    it('returns null if no token is provided', async () => {
      const mockContext = createMockContext() as any;
      expect(await getUserIdFromRequest(mockContext)).toBeNull();
    });

    it('retrieves token from Bearer header', async () => {
      const mockContext = createMockContext() as any;
      mockContext.headers['authorization'] = 'Bearer swazz_live_token';
      mockContext.env.SESSION_CACHE.get.mockResolvedValueOnce(null);
      mockVerifyApiKey.mockRejectedValueOnce(new Error('D1 error'));
      
      const res = await getUserIdFromRequest(mockContext);
      expect(res).toBeNull();
    });

    it('retrieves token from query parameter if header missing', async () => {
      const mockContext = createMockContext() as any;
      mockContext.queries['token'] = 'swazz_live_token';
      mockContext.env.SESSION_CACHE.get.mockResolvedValueOnce(null);
      mockVerifyApiKey.mockRejectedValueOnce(new Error('D1 error'));
      
      const res = await getUserIdFromRequest(mockContext);
      expect(res).toBeNull();
    });

    it('uses KV cache positive match', async () => {
      const mockContext = createMockContext() as any;
      mockContext.headers['authorization'] = 'Bearer swazz_live_token';
      mockContext.env.SESSION_CACHE.get.mockResolvedValueOnce(JSON.stringify({ userId: 'cached-user' }));

      const res = await getUserIdFromRequest(mockContext);
      expect(res).toBe('cached-user');
      expect(mockContext.env.SESSION_CACHE.get).toHaveBeenCalled();
    });

    it('handles KV cache get failure by falling back to D1', async () => {
      const mockContext = createMockContext() as any;
      mockContext.headers['authorization'] = 'Bearer swazz_live_token';
      mockContext.env.SESSION_CACHE.get.mockRejectedValueOnce(new Error('KV read failed'));

      mockVerifyApiKey.mockResolvedValueOnce('d1-user');

      const res = await getUserIdFromRequest(mockContext);
      expect(res).toBe('d1-user');
      expect(mockContext.env.SESSION_CACHE.put).toHaveBeenCalled();
    });

    it('handles KV cache put failure gracefully', async () => {
      const mockContext = createMockContext() as any;
      mockContext.headers['authorization'] = 'Bearer swazz_live_token';
      mockContext.env.SESSION_CACHE.get.mockResolvedValueOnce(null);
      mockContext.env.SESSION_CACHE.put.mockRejectedValueOnce(new Error('KV write failed'));

      mockVerifyApiKey.mockResolvedValueOnce('d1-user');

      const res = await getUserIdFromRequest(mockContext);
      expect(res).toBe('d1-user');
    });

    it('decodes JWT token if valid', async () => {
      const mockContext = createMockContext() as any;
      const jwtToken = await sign({ sub: 'jwt-user' }, 'jwt-secret-123', 'HS256');
      mockContext.headers['authorization'] = `Bearer ${jwtToken}`;

      const res = await getUserIdFromRequest(mockContext);
      expect(res).toBe('jwt-user');
      expect(mockContext.set).toHaveBeenCalledWith('jwtPayload', expect.anything());
    });

    it('returns null if JWT_SECRET is not configured', async () => {
      const mockContext = createMockContext() as any;
      const jwtToken = await sign({ sub: 'jwt-user' }, 'jwt-secret-123', 'HS256');
      mockContext.headers['authorization'] = `Bearer ${jwtToken}`;
      mockContext.env.JWT_SECRET = null;

      const spyConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
      const res = await getUserIdFromRequest(mockContext);
      expect(res).toBeNull();
      expect(spyConsoleError).toHaveBeenCalled();
      spyConsoleError.mockRestore();
    });

    it('uses cached jwtPayload from context', async () => {
      const mockContext = createMockContext() as any;
      mockContext.headers['authorization'] = 'Bearer token';
      mockContext.get.mockReturnValueOnce({ sub: 'cached-jwt-user' });

      const res = await getUserIdFromRequest(mockContext);
      expect(res).toBe('cached-jwt-user');
    });

    it('returns null if JWT token is invalid', async () => {
      const mockContext = createMockContext() as any;
      mockContext.headers['authorization'] = 'Bearer invalid-jwt';
      const res = await getUserIdFromRequest(mockContext);
      expect(res).toBeNull();
    });

    it('returns null if decoded JWT has no sub claim', async () => {
      const mockContext = createMockContext() as any;
      const jwtToken = await sign({ other: 'claim' }, 'jwt-secret-123', 'HS256');
      mockContext.headers['authorization'] = `Bearer ${jwtToken}`;
      const res = await getUserIdFromRequest(mockContext);
      expect(res).toBeNull();
    });
  });

  describe('hashPassword & verifyPassword', () => {
    it('hashes password and verifies it successfully', async () => {
      const hash = await hashPassword('password123');
      expect(hash).toContain('100000:');
      
      const success = await verifyPassword('password123', hash);
      expect(success).toBe(true);

      const fail = await verifyPassword('wrong-pwd', hash);
      expect(fail).toBe(false);
    });

    it('supports legacy password verification format', async () => {
      const storedHash = '0102030405060708090a0b0c0d0e0f10:963a75de6b567d2ad5295c5d0124843bcf2436d4df9f8b4d86c2e379ff96a123';
      const success = await verifyPassword('password', storedHash);
      expect(success).toBeDefined();
    });

    it('returns false for invalid stored hash parts', async () => {
      expect(await verifyPassword('password', 'part1')).toBe(false);
    });

    it('returns false if timing safe check fails length equality', async () => {
      const hash = await hashPassword('p');
      const parts = hash.split(':');
      const modifiedHash = `${parts[0]}:${parts[1]}:1234`;
      expect(await verifyPassword('p', modifiedHash)).toBe(false);
    });
  });

  describe('verifyTurnstile', () => {
    it('bypasses siteverify for mock tokens and dummy secret keys', async () => {
      expect(await verifyTurnstile('mock-token', 'sec')).toBe(true);
      expect(await verifyTurnstile('tok', '1x00000000000000000000000000000000')).toBe(true);
      expect(await verifyTurnstile('mock-123', 'sec')).toBe(true);
    });

    it('queries turnstile siteverify endpoint', async () => {
      const mockFetch = vi.fn().mockResolvedValueOnce({
        json: () => Promise.resolve({ success: true })
      });
      global.fetch = mockFetch;

      const res = await verifyTurnstile('real-token', 'real-secret', '1.1.1.1');
      expect(res).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining('turnstile/v0/siteverify'), expect.anything());
    });

    it('returns false on turnstile api network failure', async () => {
      global.fetch = vi.fn().mockRejectedValueOnce(new Error('network fail'));
      expect(await verifyTurnstile('tok', 'sec')).toBe(false);
    });
  });

  describe('getSessionIat', () => {
    it('returns null if token missing or API key is passed', async () => {
      const mockContext = createMockContext() as any;
      expect(await getSessionIat(mockContext)).toBeNull();

      mockContext.headers['authorization'] = 'Bearer swazz_live_key';
      expect(await getSessionIat(mockContext)).toBeNull();
    });

    it('decodes JWT iat value', async () => {
      const mockContext = createMockContext() as any;
      const nowSeconds = Math.floor(Date.now() / 1000);
      const jwtToken = await sign({ sub: 'user', iat: nowSeconds }, 'jwt-secret-123', 'HS256');
      mockContext.headers['authorization'] = `Bearer ${jwtToken}`;

      const iat = await getSessionIat(mockContext);
      expect(iat).toBe(nowSeconds);
    });

    it('returns null if decoded JWT does not have iat', async () => {
      const mockContext = createMockContext() as any;
      const jwtToken = await sign({ sub: 'user' }, 'jwt-secret-123', 'HS256');
      mockContext.headers['authorization'] = `Bearer ${jwtToken}`;

      const iat = await getSessionIat(mockContext);
      expect(iat).toBeNull();
    });

    it('returns null if getSessionIat throws error during decode', async () => {
      const mockContext = createMockContext() as any;
      mockContext.headers['authorization'] = 'Bearer invalid-token';
      expect(await getSessionIat(mockContext)).toBeNull();
    });
  });

  describe('isAnonymousUser', () => {
    it('returns true if Bearer header is missing', async () => {
      const mockContext = createMockContext() as any;
      expect(await isAnonymousUser(mockContext)).toBe(true);
    });

    it('returns false if valid JWT is decoded', async () => {
      const mockContext = createMockContext() as any;
      const jwtToken = await sign({ sub: 'user' }, 'jwt-secret-123', 'HS256');
      mockContext.headers['authorization'] = `Bearer ${jwtToken}`;
      expect(await isAnonymousUser(mockContext)).toBe(false);
    });

    it('returns true if JWT secret is missing', async () => {
      const mockContext = createMockContext() as any;
      const jwtToken = await sign({ sub: 'user' }, 'jwt-secret-123', 'HS256');
      mockContext.headers['authorization'] = `Bearer ${jwtToken}`;
      mockContext.env.JWT_SECRET = null;
      expect(await isAnonymousUser(mockContext)).toBe(true);
    });

    it('returns true on invalid token verification (throws exception)', async () => {
      const mockContext = createMockContext() as any;
      mockContext.headers['authorization'] = 'Bearer invalid-jwt';
      expect(await isAnonymousUser(mockContext)).toBe(true);
    });
  });

  describe('isWebRequest', () => {
    it('checks headers for browser/web signs', () => {
      const mockContext = createMockContext() as any;

      // 1. Mozilla User Agent
      mockContext.headers['user-agent'] = 'Mozilla/5.0';
      expect(isWebRequest(mockContext)).toBe(true);

      // 2. Origin header
      mockContext.headers['user-agent'] = 'cli-tool';
      mockContext.headers['origin'] = 'https://app.io';
      expect(isWebRequest(mockContext)).toBe(true);

      // 3. Referer header
      mockContext.headers['origin'] = '';
      mockContext.headers['referer'] = 'https://app.io/page';
      expect(isWebRequest(mockContext)).toBe(true);

      // 4. Default non-browser CLI
      mockContext.headers['referer'] = '';
      expect(isWebRequest(mockContext)).toBe(false);
    });
  });

  describe('getClientIp', () => {
    it('extracts IP sequentially from proxy headers', () => {
      const mockContext = createMockContext() as any;

      mockContext.headers['cf-connecting-ip'] = '1.1.1.1';
      expect(getClientIp(mockContext)).toBe('1.1.1.1');

      mockContext.headers['cf-connecting-ip'] = '';
      mockContext.headers['x-real-ip'] = '2.2.2.2';
      expect(getClientIp(mockContext)).toBe('2.2.2.2');

      mockContext.headers['x-real-ip'] = '';
      mockContext.headers['x-forwarded-for'] = '3.3.3.3';
      expect(getClientIp(mockContext)).toBe('3.3.3.3');

      mockContext.headers['x-forwarded-for'] = '';
      expect(getClientIp(mockContext)).toBe('127.0.0.1');
    });
  });

  describe('getDeleteRequestedAt', () => {
    it('uses cached deletion info if valid', async () => {
      deletionCache.set('user-1', {
        deleteRequestedAt: '2026-07-08',
        expiry: Date.now() + 10000
      });
      const mockRepo = {} as any;
      const res = await getDeleteRequestedAt(mockRepo, 'user-1');
      expect(res).toBe('2026-07-08');
    });

    it('queries repository and updates cache on miss', async () => {
      const mockRepo = {
        getUserDeleteRequestedAt: vi.fn().mockResolvedValueOnce('2026-07-08')
      } as any;
      const res = await getDeleteRequestedAt(mockRepo, 'user-2');
      expect(res).toBe('2026-07-08');
      expect(mockRepo.getUserDeleteRequestedAt).toHaveBeenCalledWith('user-2');
      expect(deletionCache.get('user-2')).toBeDefined();
    });
  });

  describe('verifyDummyPassword', () => {
    it('always resolves to false', async () => {
      expect(await verifyDummyPassword('any-pwd')).toBe(false);
    });
  });

  describe('safeCompare', () => {
    it('performs timing safe comparison', () => {
      expect(safeCompare('hello', 'hello')).toBe(true);
      expect(safeCompare('hello', 'world')).toBe(false);
      expect(safeCompare('hello', 'helloo')).toBe(false);
      expect(safeCompare(123 as any, '123')).toBe(false);
    });
  });
});
