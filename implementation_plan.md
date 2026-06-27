# Implementation Plan - Task 96: Content Negotiation for Landing Page

## 🎯 Goal
Support content negotiation on the landing page route (`/`) of the Edge coordinator. When a client sends an `Accept: text/markdown` header, the server should return the page content in clean Markdown. For `Accept: text/html` (standard browser requests), return the landing page HTML. Default to the standard JSON status response for other types.

## 🛠 Proposed Changes

### 1. Edge Coordinator (`packages/edge/src/index.ts`)
- Modify `app.get('/')` handler to read the `Accept` request header.
- If `Accept` includes `text/markdown`, return the markdown layout of the landing page with `Content-Type: text/markdown; charset=utf-8` and `Access-Control-Allow-Origin: *`.
- If `Accept` includes `text/html`, return the basic HTML landing page structure.
- Otherwise, default to returning `c.json({ service: 'swazz-edge', status: 'ok' })`.

### 2. Test Coverage (`packages/edge/src/index.test.ts`)
- Add tests for `GET /` with different `Accept` headers:
  - `Accept: text/markdown` -> returns status 200, markdown content type, containing the title `# Swazz: Smart API Fuzzer ⚡️`.
  - `Accept: text/html` -> returns status 200, html content type, containing the HTML structure.
  - `Accept: application/json` (or default) -> returns status 200, json content type with `{ service: 'swazz-edge', status: 'ok' }`.

### 3. Documentation
- Verify that [packages/web/public/index.md](file:///Users/alex/src/swazz/packages/web/public/index.md) matches the landing page copy returned by Hono's markdown content negotiation.

## 🧪 Verification Plan
- Run unit tests: `npm run test --workspace=packages/edge`
- Rebuild frontend: `npm run build`
