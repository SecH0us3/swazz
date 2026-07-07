# 🗺 Swazz Roadmap

This roadmap tracks planned features, documentation improvements, and architectural changes for the **Swazz** fuzzer. 

> **AI Assistant Note:** Antigravity can automatically execute these tasks. Just say: *"Antigravity, start working on task X"* and the AI will implement the feature and check it off the list.


## 🟢 Low Complexity


- [ ] **Task 98: RSS Feed Integration**
  - **Design Goal:** Provide a standard RSS feed for product updates, security disclosures, or public scan releases.
  - **Implementation Details:**
    - Create a public route (`GET /api/feed.xml` or `/feed.rss`) serving well-formatted RSS XML content.
    - Render posts, updates, or public releases with proper XML namespaces, publishing dates, and author credits.

- [ ] **Task 105: Fix RBAC Logical Gaps (Validation Checks)**
  - **Design Goal:** Ensure API robustness by verifying the existence of entities before modifying them.
  - **Implementation Details:**
    - `updateMemberRoles`: Verify user is a project member before applying updates.
    - `updateCustomRole` & `deleteCustomRole`: Verify the role exists before performing updates/deletes.
    - `createInvitation`: Prevent sending multiple active invitations to the same user/email in the same project.

- [ ] **Task 106: Fix Authentication Bypasses in Scans Service**
  - **Design Goal:** Ensure that unauthenticated requests do not bypass RBAC checks when `AUTH_ENABLED` is true.
  - **Implementation Details:**
    - In `ScansService`, methods like `createScan`, `getScans`, `getScan`, `updateScan`, and `generateUploadUrl` currently skip RBAC checks if `userId` is `null` (e.g. unauthenticated request), allowing them to bypass `project_id` restrictions.
    - Require `userId` to be present if `AUTH_ENABLED === 'true'` and the target entity is tied to a `project_id`.

- [ ] **Task 99: Secondary Product Blog**
  - **Design Goal:** Design and mount a realistic secondary blog section/layout to publish technical articles, vulnerability writeups, and security research related to Swazz fuzzer findings.
  - **Implementation Details:**
    - Set up a clean, modern blog index and article layout in the frontend web application.
    - Support markdown article rendering and sharing actions to drive organic technical traffic.

## 🟡 Medium Complexity


- [ ] **Task 88: Password Change, Reset Flow, and Backup Codes**
  - **Design Goal:** Provide secure password management tools including dynamic password changes, email-based password recovery (forgot password flow), and 2FA backup codes.
  - **Implementation Details:**
    - Implement `POST /api/auth/password/change` validating the current password before applying a new PBKDF2 hash.
    - Implement a tokenized forgot password flow: send recovery links/tokens via email, verifying them at `/api/auth/password/reset`.
    - Generate a set of 8-character numeric backup codes when 2FA is set up, saving their hashes in the database. Support logging in with a backup code in place of a TOTP code.




## 🔴 High Complexity

- [ ] **Task 48: Implement Active Web Crawler (Spider)**
  - **Design Goal:** Enable target discovery by dynamically crawling web applications from a starting URL without relying solely on static API specifications.
  - **Implementation Details:**
    - Parse HTML responses for anchor tags, forms, link/script tags, and check common discovery files like robots.txt and sitemap.xml.
    - Implement a concurrent, recursive crawler in Go with rate-limiting, depth-limits, and domain scoping to build a dynamic Sitemap.
    - Feed discovered URLs and form inputs into the fuzzing execution pipeline.

- [ ] **Task 59: Headless Browser Crawler & Interception Sniffer**
  - **Design Goal:** Enable target discovery by crawling web applications using a browser engine, capturing and sniffing all background API requests to automatically populate the fuzzer path list.
  - **Implementation Details:**
    - Spin up a headless browser to crawl target pages.
    - Intercept network request traffic (AJAX, fetch requests, form submissions) and convert them to internal API specifications for fuzzing.

- [ ] **Task 62: Browser Extension for Real-Time Traffic Capturing & Request Recording**
  - **Design Goal:** Build a browser extension (similar to Cobalt) that sniffs web traffic as the user interacts with the app, recording API endpoints and capturing client requests directly into the Swazz configuration profile. This can serve as a more optimal, zero-setup alternative to exporting/uploading HAR files.
  - **Implementation Details:**
    - Capture HTTP/HTTPS requests on specified domains in background service workers.
    - Synchronize captured endpoints and authentication states in real-time with the local runner profile.

- [ ] **Task 112: Webhook Notifications & Report Upload Integration**
  - **Design Goal:** Support webhook notifications to allow uploading fuzzer findings/reports (including validated AI findings/remediation recommendations) to user-specified URLs.
  - **Implementation Details:**
    - Add a `webhooks` configuration section to Project Settings (allowing users to define target URLs, authentication headers, and toggle event types).
    - Save webhook configurations in D1.
    - When fuzzer events or findings are logged (including after LLM triage and patch validation), serialize the finding reports and queue a webhook delivery.
    - The edge backend stores the original reports in the D1 database, but the webhook delivery must dispatch the reports out to the client's destination URL asynchronously (e.g. using Cloudflare Workers outbound fetch, decoupled via findings queues).


- [ ] **Task 122: Enterprise SAML Authentication & Organizations**
  - **Design Goal:** Support SAML SSO for enterprise customers by introducing an Organizations layer to group projects and configure IdP authentication details.
  - **Implementation Details:**
    - Create database tables for `organizations`, `organization_members` (RBAC), and `organization_saml_configs`.
    - Group projects under organizations via `organization_id` field in `projects` table.
    - Implement a domain-based login redirect checking user email domains to route employees to their mapped SAML IdP.
    - Implement a lightweight SAML Assertion Consumer Service (ACS) endpoint verifying XML signatures against IdP certificates using the Workers Web Crypto API.
    - Build UI settings tabs in the dashboard for managing organization details, team memberships, and SAML configurations.





