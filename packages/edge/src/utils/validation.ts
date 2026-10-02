// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import type { Context, Next } from 'hono';

export class ValidationError extends Error {
  constructor(message: string, public status: 400 | 413 = 400) {
    super(message);
    this.name = 'ValidationError';
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/; // ulid, uuid, 'c_'+ulid
export const CREDENTIAL_ID_PATTERN = /^[A-Za-z0-9_-]{1,1400}$/;

export function isValidId(v: unknown): v is string {
  return typeof v === 'string' && ID_PATTERN.test(v);
}

export function isValidCredentialId(v: unknown): v is string {
  return typeof v === 'string' && CREDENTIAL_ID_PATTERN.test(v);
}

export const LIMITS = {
  NAME: 128,
  SHORT_TEXT: 256,
  DESCRIPTION: 2000,
  LONG_TEXT: 50_000,
  URL: 2048,
  EMAIL: 254,
  USERNAME: 64,
  PASSWORD: 256,
  JSON_BODY_BYTES: 1_048_576, // 1 MiB
  CONFIG_BODY_BYTES: 1_900_000, // 1.9 MB (below D1's ~2 MB row limit)
  LARGE_BODY_BYTES: 22_020_096 /* 21 MiB */
} as const;

/** Reads the body with a byte cap (rejects early on Content-Length; otherwise counts bytes while
 *  reading the stream and aborts above the cap). Throws ValidationError('Request body too large', 413),
 *  or ValidationError('Invalid JSON body') on parse failure or when the root is not a plain object
 *  (unless opts.allowArray). */
export async function readJsonBody<T = Record<string, unknown>>(
  c: Context,
  opts?: { maxBytes?: number; allowArray?: boolean; optional?: boolean; allowPrimitives?: boolean; tooLargeMessage?: string }
): Promise<T> {
  const maxBytes = opts?.maxBytes ?? LIMITS.JSON_BODY_BYTES;
  const tooLargeMsg = opts?.tooLargeMessage ?? 'Request body too large';
  const clHeader = c.req.header('content-length');
  if (clHeader !== undefined && clHeader !== null) {
    const cl = parseInt(clHeader, 10);
    if (!isNaN(cl) && cl > maxBytes) {
      throw new ValidationError(tooLargeMsg, 413);
    }
  }

  const bodyStream = c.req.raw.body;
  if (!bodyStream) {
    if (opts?.optional) {
      return {} as T;
    }
    throw new ValidationError('Invalid JSON body', 400);
  }

  const reader = bodyStream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel();
          } catch {}
          throw new ValidationError(tooLargeMsg, 413);
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  if (chunks.length === 0 || totalBytes === 0) {
    if (opts?.optional) {
      return {} as T;
    }
    throw new ValidationError('Invalid JSON body', 400);
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const text = new TextDecoder().decode(merged);

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ValidationError('Invalid JSON body', 400);
  }

  if (opts?.allowPrimitives) {
    return parsed as T;
  }

  if (parsed === null || typeof parsed !== 'object') {
    throw new ValidationError('Invalid JSON body', 400);
  }

  if (!opts?.allowArray && Array.isArray(parsed)) {
    throw new ValidationError('Invalid JSON body', 400);
  }

  return parsed as T;
}

/** Reads text body with a byte cap. */
export async function readTextBody(
  c: Context,
  opts?: { maxBytes?: number }
): Promise<string> {
  const maxBytes = opts?.maxBytes ?? LIMITS.JSON_BODY_BYTES;
  const clHeader = c.req.header('content-length');
  if (clHeader !== undefined && clHeader !== null) {
    const cl = parseInt(clHeader, 10);
    if (!isNaN(cl) && cl > maxBytes) {
      throw new ValidationError('Request body too large', 413);
    }
  }

  const bodyStream = c.req.raw.body;
  if (!bodyStream) {
    return '';
  }

  const reader = bodyStream.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
          try {
            await reader.cancel();
          } catch {}
          throw new ValidationError('Request body too large', 413);
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

/** Field helpers: each throws ValidationError(`<field> must be a string of at most <max> characters`). */
export function reqString(v: unknown, field: string, max: number, min = 1): string {
  if (typeof v !== 'string' || v.length < min || v.length > max) {
    throw new ValidationError(`${field} must be a string of at most ${max} characters`, 400);
  }
  return v;
}

export function optString(v: unknown, field: string, max: number): string | undefined {
  if (v === undefined || v === null) {
    return undefined;
  }
  if (typeof v !== 'string' || v.length > max) {
    throw new ValidationError(`${field} must be a string of at most ${max} characters`, 400);
  }
  return v;
}

export function optStringArray(v: unknown, field: string, maxItems: number, maxLen: number): string[] | undefined {
  if (v === undefined || v === null) {
    return undefined;
  }
  if (!Array.isArray(v) || v.length > maxItems) {
    throw new ValidationError(`${field} must be an array of at most ${maxItems} items`, 400);
  }
  for (const item of v) {
    if (typeof item !== 'string' || item.length > maxLen) {
      throw new ValidationError(`${field} items must be strings of at most ${maxLen} characters`, 400);
    }
  }
  return v;
}

/** Middleware: validates path parameters against isValidId */
export function requireValidParams(...paramNames: string[]) {
  return async (c: Context, next: Next) => {
    for (const name of paramNames) {
      const val = c.req.param(name);
      if (val !== undefined && !isValidId(val)) {
        return c.json({ error: 'Not Found' }, 404);
      }
    }
    await next();
  };
}
