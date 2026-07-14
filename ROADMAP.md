# 🗺 Swazz Roadmap

This roadmap tracks planned features, documentation improvements, and architectural changes for the **Swazz** fuzzer. 

> **AI Assistant Note:** Antigravity can automatically execute these tasks. Just say: *"Antigravity, start working on task X"* and the AI will implement the feature and check it off the list.


## 🟢 Low Complexity


- [ ] **Task 98: RSS Feed Integration**
  - **Design Goal:** Provide a standard RSS feed for product updates, security disclosures, or public scan releases.
  - **Implementation Details:**
    - Create a public route (`GET /api/feed.xml` or `/feed.rss`) serving well-formatted RSS XML content.
    - Render posts, updates, or public releases with proper XML namespaces, publishing dates, and author credits.



- [ ] **Task 99: Secondary Product Blog**
  - **Design Goal:** Design and mount a realistic secondary blog section/layout to publish technical articles, vulnerability writeups, and security research related to Swazz fuzzer findings.
  - **Implementation Details:**
    - Set up a clean, modern blog index and article layout in the frontend web application.
    - Support markdown article rendering and sharing actions to drive organic technical traffic.

- [ ] **Task 127: Add examples/ directory and cookbook documentation**
  - **Design Goal:** Provide a dedicated space for practical configuration recipes and usage examples of the Swazz fuzzer, helping users get started quickly and master advanced scenarios.
  - **Implementation Details:**
    - Create a new directory `/examples` in the repository root.
    - Move existing root config files (e.g., `swazz.config.example.jsonc`, `swazz.config.bola-test.json`, `swazz.config.petstore.json`, `wraggler.config.example.jsonc`, etc.) to `/examples` to clean up the repository root.
    - Add a `README.md` file in `/examples` describing the cookbook and linking to the recipe documentation.
    - Populate the examples directory with recipes covering configurations from basic HTTP requests and API scans to advanced multi-auth, chaining rules, and custom wordlist scans.

- [ ] **Task 130: Render Infinity (∞) for Timeout status code (HTTP 0)**
  - **Design Goal:** Improve status code visibility in result lists and logs by displaying the infinity symbol (∞) instead of `0` when a request times out or encounters a network error.
  - **Implementation Details:**
    - Update components rendering request status badges (e.g. `Inspector.tsx`, result lists) to check if status is `0` and display `∞` or `ERR` clearly instead of the number `0`.



## 🟡 Medium Complexity

- [ ] **Task 140: Onboarding & Landing Page UX Redesign**
  - **Design Goal:** Improve the conversion funnel and initial user experience by fixing major UX bottlenecks on the landing page and onboarding flow, decreasing time-to-value for new users.
  - **Implementation Details:**
    - **Hero & CTA Redesign:** Replace the static login screenshot with a dynamic demo/GIF of the product's actual OWASP findings. Add a clear primary CTA (e.g., "Run a live demo scan") and a secondary CTA ("Read the docs").
    - **Frictionless Entry:** Remove the auto-opening login modal on the first visit. Simplify login options by prioritizing GitHub Auth as the primary method and "Try without signup" as a prominent secondary option.
    - **Postpone Seed Phrase:** Remove the mandatory seed-phrase (E2EE key) generation step before the first scan. Offer it as an optional backup step later when the user actually has valuable findings to protect.
    - **Fix Turnstile (P0):** Fix the Cloudflare Turnstile "Verification failed" bug on the auth gates that physically blocks registration.
    - **Brand & Trust Consistency:** Align the landing page (dark/lime) with the product dashboard (light/purple) using a unified theme. Add social proof (GitHub stars, scan metrics, etc.) to the landing page.
    - **Clear Positioning:** Resolve the contradictory messaging between "sign up for free" and "Closed Beta".

- [ ] **Task 141: Dashboard & Reports UX Redesign**
  - **Design Goal:** Improve the clarity, trust, and information architecture of the product's reporting dashboard (OWASP Coverage and Grouped Errors), ensuring security professionals can easily read and trust the results.
  - **Implementation Details:**
    - **Consistent Metrics (Trust Factor):** Fix the inconsistent finding counters across different tabs (e.g., 546 / 780 / 1029). Establish a single source of truth for metrics and clearly label exactly what each number represents (e.g., "Total Requests", "Raw Findings", "Grouped Vulnerabilities").
    - **Separate Security vs. Infrastructure:** Redesign the "Grouped Errors" view to visually and structurally separate real security vulnerabilities (e.g., SQLi, CORS Misconfiguration) from infrastructure noise/errors (e.g., HTTP 520, Network Timeouts). 
    - **Severity Sorting:** Ensure findings are prioritized and sorted by security severity, giving visual weight to critical vulnerabilities over generic errors.
    - **OWASP Widget Polish:** Polish the OWASP API Top-10 mapping UI, as this is a strong value proposition. Ensure the severity bars and categories are easily scannable and export-friendly.


- [ ] **Task 88: Password Change, Reset Flow, and Backup Codes**
  - **Design Goal:** Provide secure password management tools including dynamic password changes, email-based password recovery (forgot password flow), and 2FA backup codes.
  - **Implementation Details:**
    - Implement `POST /api/auth/password/change` validating the current password before applying a new PBKDF2 hash.
    - Implement a tokenized forgot password flow: send recovery links/tokens via email using the [Cloudflare Email Routing Send Emails API](https://developers.cloudflare.com/email-service/get-started/send-emails/), verifying them at `/api/auth/password/reset`.
    - Generate a set of 8-character numeric backup codes when 2FA is set up, saving their hashes in the database. Support logging in with a backup code in place of a TOTP code.


- [ ] **Task 125: Domain WAF Analysis via waf.secmy.app**
  - **Design Goal:** Enable runner agents to perform active or passive WAF checks on target domains using `https://waf.secmy.app/` to identify defensive layers, active protections, and potential firewall bypass vectors.
  - **Implementation Details:**
    - Introduce configuration parameters to toggle WAF checks and customize the WAF API endpoint (defaulting to https://waf.secmy.app/).
    - Implement a Go analyzer/scanner module within the runner agent that interacts with the configured WAF API endpoint.
    - Retrieve, parse, and incorporate WAF detection and bypass recommendation findings into the final scan report.

- [ ] **Task 126: Domain Reconnaissance via recon1.secmy.app**
  - **Design Goal:** Enable runners to automatically discover subdomains, open ports, and map IP details of a target domain using `https://recon1.secmy.app/` during initial scanning phases.
  - **Implementation Details:**
    - Add reconnaissance toggles and parameters (including a configurable API endpoint defaulting to https://recon1.secmy.app/) to runner settings.
    - Build a recon module inside the Go runner to query the configured reconnaissance API.
    - Log discovered assets and append discovered HTTP/HTTPS endpoints to the runner's fuzz target list or output metadata.


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
- [ ] **Task 122: Enterprise SAML Authentication & Organizations**
  - **Design Goal:** Support SAML SSO for enterprise customers by introducing an Organizations layer to group projects and configure IdP authentication details.
  - **Implementation Details:**
    - Create database tables for `organizations`, `organization_members` (RBAC), and `organization_saml_configs`.
    - Group projects under organizations via `organization_id` field in `projects` table.
    - Implement a domain-based login redirect checking user email domains to route employees to their mapped SAML IdP.
    - Implement a lightweight SAML Assertion Consumer Service (ACS) endpoint verifying XML signatures against IdP certificates using the Workers Web Crypto API.
    - Build UI settings tabs in the dashboard for managing organization details, team memberships, and SAML configurations.





