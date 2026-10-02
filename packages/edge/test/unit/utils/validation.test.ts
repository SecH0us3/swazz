// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  ValidationError,
  isValidId,
  readJsonBody,
  reqString,
  optString,
  optStringArray,
  LIMITS,
} from '../../../src/utils/validation';

describe('Validation Primitives', () => {
  describe('isValidId', () => {
    it('accepts ulid, uuid and c_+ulid', () => {
      expect(isValidId('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
      expect(isValidId('123e4567-e89b-12d3-a456-426614174000')).toBe(true);
      expect(isValidId('c_01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true);
      expect(isValidId('simple_id-123')).toBe(true);
    });

    it('rejects ../x, an 800-character string and an empty string', () => {
      expect(isValidId('../x')).toBe(false);
      expect(isValidId('a'.repeat(800))).toBe(false);
      expect(isValidId('')).toBe(false);
      expect(isValidId(null)).toBe(false);
      expect(isValidId(undefined)).toBe(false);
      expect(isValidId(12345)).toBe(false);
      expect(isValidId('hello world')).toBe(false);
      expect(isValidId('hello/world')).toBe(false);
    });
  });

  describe('Field helpers', () => {
    describe('reqString', () => {
      it('accepts valid strings within bounds', () => {
        expect(reqString('hello', 'name', 10)).toBe('hello');
        expect(reqString('a', 'name', 10, 1)).toBe('a');
        expect(reqString('1234567890', 'name', 10)).toBe('1234567890');
      });

      it('rejects wrong type with 400', () => {
        expect(() => reqString(123, 'name', 10)).toThrow(ValidationError);
        try {
          reqString(123, 'name', 10);
        } catch (e: any) {
          expect(e.status).toBe(400);
          expect(e.message).toBe('name must be a string of at most 10 characters');
        }
        expect(() => reqString(null, 'name', 10)).toThrow(ValidationError);
        expect(() => reqString(undefined, 'name', 10)).toThrow(ValidationError);
        expect(() => reqString({}, 'name', 10)).toThrow(ValidationError);
      });

      it('rejects over-long string with 400', () => {
        try {
          reqString('12345678901', 'name', 10);
        } catch (e: any) {
          expect(e.status).toBe(400);
          expect(e.message).toBe('name must be a string of at most 10 characters');
        }
      });

      it('rejects under-min string with 400', () => {
        try {
          reqString('', 'name', 10, 1);
        } catch (e: any) {
          expect(e.status).toBe(400);
          expect(e.message).toBe('name must be a string of at most 10 characters');
        }
      });
    });

    describe('optString', () => {
      it('returns undefined for null or undefined', () => {
        expect(optString(undefined, 'desc', 50)).toBeUndefined();
        expect(optString(null, 'desc', 50)).toBeUndefined();
      });

      it('accepts valid string within bounds', () => {
        expect(optString('', 'desc', 50)).toBe('');
        expect(optString('test', 'desc', 50)).toBe('test');
        expect(optString('a'.repeat(50), 'desc', 50)).toBe('a'.repeat(50));
      });

      it('rejects wrong type with 400', () => {
        try {
          optString(123, 'desc', 50);
        } catch (e: any) {
          expect(e.status).toBe(400);
          expect(e.message).toBe('desc must be a string of at most 50 characters');
        }
      });

      it('rejects over-long string with 400', () => {
        try {
          optString('a'.repeat(51), 'desc', 50);
        } catch (e: any) {
          expect(e.status).toBe(400);
          expect(e.message).toBe('desc must be a string of at most 50 characters');
        }
      });
    });

    describe('optStringArray', () => {
      it('returns undefined for null or undefined', () => {
        expect(optStringArray(undefined, 'tags', 5, 20)).toBeUndefined();
        expect(optStringArray(null, 'tags', 5, 20)).toBeUndefined();
      });

      it('accepts valid array within bounds', () => {
        expect(optStringArray([], 'tags', 5, 20)).toEqual([]);
        expect(optStringArray(['a', 'b'], 'tags', 5, 20)).toEqual(['a', 'b']);
        expect(optStringArray(Array(5).fill('a'.repeat(20)), 'tags', 5, 20)).toHaveLength(5);
      });

      it('rejects non-array with 400', () => {
        try {
          optStringArray('string', 'tags', 5, 20);
        } catch (e: any) {
          expect(e.status).toBe(400);
          expect(e.message).toBe('tags must be an array of at most 5 items');
        }
      });

      it('rejects too many items with 400', () => {
        try {
          optStringArray(['1', '2', '3', '4', '5', '6'], 'tags', 5, 20);
        } catch (e: any) {
          expect(e.status).toBe(400);
          expect(e.message).toBe('tags must be an array of at most 5 items');
        }
      });

      it('rejects items with wrong type with 400', () => {
        try {
          optStringArray([123], 'tags', 5, 20);
        } catch (e: any) {
          expect(e.status).toBe(400);
          expect(e.message).toBe('tags items must be strings of at most 20 characters');
        }
      });

      it('rejects over-long item with 400', () => {
        try {
          optStringArray(['a'.repeat(21)], 'tags', 5, 20);
        } catch (e: any) {
          expect(e.status).toBe(400);
          expect(e.message).toBe('tags items must be strings of at most 20 characters');
        }
      });
    });
  });

  describe('readJsonBody', () => {
    const helperApp = () => {
      const app = new Hono();
      app.onError((err, c) => {
        if (err instanceof ValidationError) {
          return c.json({ error: err.message }, err.status);
        }
        return c.json({ error: 'Internal Server Error' }, 500);
      });
      return app;
    };

    it('reads valid JSON object', async () => {
      const app = helperApp();
      app.post('/test', async (c) => {
        const body = await readJsonBody(c);
        return c.json({ received: body });
      });

      const res = await app.request('/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: 'val' }),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: { key: 'val' } });
    });

    it('rejects invalid JSON with 400', async () => {
      const app = helperApp();
      app.post('/test', async (c) => {
        const body = await readJsonBody(c);
        return c.json(body);
      });

      const res = await app.request('/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
    });

    it('rejects array root with 400 by default', async () => {
      const app = helperApp();
      app.post('/test', async (c) => {
        const body = await readJsonBody(c);
        return c.json(body);
      });

      const res = await app.request('/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(['item']),
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
    });

    it('allows array root when opts.allowArray is true', async () => {
      const app = helperApp();
      app.post('/test', async (c) => {
        const body = await readJsonBody(c, { allowArray: true });
        return c.json(body);
      });

      const res = await app.request('/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(['item']),
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(['item']);
    });

    it('rejects null root with 400', async () => {
      const app = helperApp();
      app.post('/test', async (c) => {
        const body = await readJsonBody(c);
        return c.json(body);
      });

      const res = await app.request('/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'null',
      });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'Invalid JSON body' });
    });

    it('rejects Content-Length over the cap with 413', async () => {
      const app = helperApp();
      app.post('/test', async (c) => {
        const body = await readJsonBody(c, { maxBytes: 50 });
        return c.json(body);
      });

      const res = await app.request('/test', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': '100',
        },
        body: JSON.stringify({ a: 'b' }),
      });
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: 'Request body too large' });
    });

    it('rejects a chunked body over the cap without Content-Length with 413', async () => {
      const app = helperApp();
      app.post('/test', async (c) => {
        const body = await readJsonBody(c, { maxBytes: 30 });
        return c.json(body);
      });

      // Stream larger than 30 bytes without Content-Length header
      const largeJson = JSON.stringify({ data: 'this string is longer than thirty bytes total' });
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(largeJson.slice(0, 20)));
          controller.enqueue(encoder.encode(largeJson.slice(20)));
          controller.close();
        },
      });

      const req = new Request('http://localhost/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: stream,
        duplex: 'half',
      } as any);

      const res = await app.fetch(req);
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({ error: 'Request body too large' });
    });
  });
});
