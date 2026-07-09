# Implementation Plan: Task 89 (Webhook HMAC Signature Verification)

## 1. Schema & Database Migrations
- Create a new migration file `packages/edge/migrations/0025_add_secret_to_webhooks.sql`:
  - Execute `ALTER TABLE project_webhooks ADD COLUMN secret TEXT;` to support persisting unique secret keys per webhook.
- Update `Webhook` typescript interface in `packages/edge/src/types.ts` to include `secret: string;`.

## 2. Backend & Database Repository
- **ProjectRepository (`packages/edge/src/repositories/projects.ts`)**:
  - Update `createProjectWebhook` to accept the `secret` parameter and insert it into the database.
  - Ensure `getProjectWebhooks` and `getProjectWebhook` retrieve the `secret` column.
- **ProjectService (`packages/edge/src/services/projects.ts`)**:
  - Automatically generate a unique `whsec_...` cryptographically secure key upon creating a webhook using `crypto.getRandomValues`.
  - Include the `secret` in the return value of `createProjectWebhook`.
  - For `testProjectWebhook`, retrieve the `secret` and sign the test payload.

## 3. Webhook HMAC Signing & Dispatcher
- **Webhook Dispatcher (`packages/edge/src/utils/webhooks.ts`)**:
  - Retrieve the `secret` field when querying the webhooks for the project.
  - Sign the JSON payload using HMAC-SHA256 via Web Crypto (`crypto.subtle`).
  - To prevent replay attacks, sign the payload format: `${timestamp}.${JSON.stringify(webhookPayload)}`.
  - Attach the signature and timestamp as a custom header `X-Swazz-Signature: t=${timestamp},v1=${signature}`.
  - Make sure `testProjectWebhook` inside `packages/edge/src/services/projects.ts` uses the same header format.

## 4. Frontend UI (React UI & Styling)
- **WebhooksTab (`packages/web/src/components/ProjectSettings/WebhooksTab.tsx`)**:
  - Display the generated secret key on the webhook list card.
  - Support a **Reveal/Hide** toggle for the secret key.
  - Support a **Copy** button to copy the secret key to the clipboard.
- **Styling (`packages/web/src/index.css`)**:
  - Define custom classes like `.webhook-secret-container`, `.webhook-secret-value`, `.webhook-secret-toggle`, and `.webhook-secret-copy` inside the CSS file (no inline styles).

## 5. Documentation & Roadmap
- Create/update documentation detailing webhook signature verification, complete with code snippets showing how receiver servers can verify signatures in different environments.
- Move Task 89 from `ROADMAP.md` to `ROADMAP-DONE.md` upon completion.
