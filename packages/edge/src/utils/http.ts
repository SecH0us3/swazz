// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import type { ContentfulStatusCode } from 'hono/utils/http-status';

export function errorStatus(raw: string | number | undefined, fallback: ContentfulStatusCode = 500): ContentfulStatusCode {
  const n = typeof raw === 'number' ? raw : Number.parseInt(raw ?? '', 10);
  return (Number.isInteger(n) && n >= 400 && n <= 599 ? n : fallback) as ContentfulStatusCode;
}

export function toStatusCode(raw: string | number | undefined, fallback: ContentfulStatusCode = 200): ContentfulStatusCode {
  const n = typeof raw === 'number' ? raw : Number.parseInt(raw ?? '', 10);
  return (Number.isInteger(n) && n >= 100 && n <= 599 ? n : fallback) as ContentfulStatusCode;
}
