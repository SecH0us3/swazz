# Walkthrough - Task 90: CSRF Protection Middleware in Coordinator

This walkthrough summarizes the implementation of **Task 90: Implement CSRF Protection Middleware in Coordinator**.

The coordinator now protects state-changing endpoints (`POST`, `PUT`, `DELETE`, `PATCH`) from Cross-Site Request Forgery (CSRF) using double-submit cookie validation, while automatically permitting runner agents and external APIs.

---

## 🛠️ Implemented Changes

### 1. Backend Protection (`packages/edge`)
- **Custom CSRF Middleware**: Created [csrf.ts](file:///Users/alex/src/swazz/packages/edge/src/utils/csrf.ts) which:
  - Generates a secure CSRF token (UUID) and sets it in an `HttpOnly`, `SameSite=Lax` cookie named `csrf_token`.
  - For safe HTTP methods (`GET`, `HEAD`, `OPTIONS`), it appends `X-CSRF-Token` to the response headers.
  - Bypasses validation if requests carry `Authorization` or `X-Upload-Token` headers (since token-based auth is immune to CSRF).
  - For cookie-based state-changing requests, validates that the `X-CSRF-Token` header matches the `csrf_token` cookie.
- **Middleware Application**: Registered the middleware globally on `/api/*` in [index.ts](file:///Users/alex/src/swazz/packages/edge/src/index.ts).
- **CORS Support**: Added `X-CSRF-Token` to exposed and allowed CORS headers in [index.ts](file:///Users/alex/src/swazz/packages/edge/src/index.ts).

### 2. Frontend State & Requests (`packages/web`)
- **Global Token Store**: Added a `csrfToken` state in [appStore.ts](file:///Users/alex/src/swazz/packages/web/src/store/appStore.ts).
- **Token Capture**: Updated [useAuth.ts](file:///Users/alex/src/swazz/packages/web/src/hooks/useAuth.ts) to parse the token from the `/api/info` GET response header on startup and save it.
- **Request Interception**: Updated the following state-changing hooks and components to dynamically append the `X-CSRF-Token` header:
  - [useAuth.ts](file:///Users/alex/src/swazz/packages/web/src/hooks/useAuth.ts) (login, register, guest)
  - [useRunner.ts](file:///Users/alex/src/swazz/packages/web/src/hooks/useRunner.ts) (start, stop, pause, resume, and proxy requests)
  - [projectService.ts](file:///Users/alex/src/swazz/packages/web/src/services/projectService.ts) (createProject)
  - [swaggerService.ts](file:///Users/alex/src/swazz/packages/web/src/services/swaggerService.ts) (loadSwaggerUrl)
  - [UserSettings.tsx](file:///Users/alex/src/swazz/packages/web/src/components/UserSettings.tsx) (2FA setup, verify, disable, and delete account)
  - [DeletionOverlay.tsx](file:///Users/alex/src/swazz/packages/web/src/components/Auth/DeletionOverlay.tsx) (cancel-deletion)
  - [RunnersTab.tsx](file:///Users/alex/src/swazz/packages/web/src/components/ProjectSettings/RunnersTab.tsx) (public key save)

### 3. Architecture Documentation & Roadmap
- Updated [architecture.md](file:///Users/alex/src/swazz/docs/architecture.md) to document the details of the CSRF pattern.
- Updated the status of Task 90 in [ROADMAP.md](file:///Users/alex/src/swazz/ROADMAP.md) to `[/]` for review.

---

## 🧪 Verification & Test Results

### 1. Edge Integration Tests
Unit tests in [index.test.ts](file:///Users/alex/src/swazz/packages/edge/src/index.test.ts) were added to check:
- Safe methods correctly generating tokens and headers.
- Unsafe requests without tokens failing with `403 Forbidden` (`Invalid or missing CSRF token`).
- Requests with `Authorization` headers bypassing the check.

All 37/37 tests passed:
```bash
 ✓ src/index.test.ts (27 tests) 536ms
 Test Files  3 passed (3)
      Tests  37 passed (37)
```

### 2. Playwright E2E Integration Tests
Successfully ran the E2E suite and verified the full pipeline works seamlessly without interruption.
