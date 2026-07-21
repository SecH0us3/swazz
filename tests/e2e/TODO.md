# Future E2E Integration Tests (TODO)

This document lists candidate E2E test scenarios to be added to the Swazz suite to guarantee full coverage of edge-cases, performance profiles, and multi-user vulnerability flows.

## 1. Multi-Identity & BOLA (Broken Object Level Authorization) Flows
* **Objective**: Verify that the fuzzer successfully detects BOLA (IDOR) vulnerabilities when configured with multiple user sessions.
* **Test Steps**:
  1. Register `User A` and `User B` on the login screen.
  2. In the "Bola / Multi-Identity" settings panel, input auth headers/cookies for both identities.
  3. Run the scan with BOLA testing enabled.
  4. Verify that the fuzzer detects the cross-user resource access and records a warning for `A01:2025 Broken Access Control`.

## 2. Scan History & Persistence (IndexedDB / D1)
* **Objective**: Ensure scan results are correctly persisted in IndexedDB and sync to the D1 coordinator database.
* **Test Steps**:
  1. Complete a scan run.
  2. Reload the page.
  3. Navigate to "Scan History" in the sidebar.
  4. Verify that the previous run appears and loading it correctly restores the Heatmap, Request Logs, and Grouped Errors.

## 3. Vulnerability Triage & False Positive Marking
* **Objective**: Test the interactive triage workflow for findings.
* **Test Steps**:
  1. Expand a grouped finding (e.g. `CORS Misconfiguration`).
  2. Click on a specific finding item.
  3. Change its triage state to `False Positive` or `Ignored` in the Inspector panel.
  4. Assert that the item's opacity fades out and the FP/Ignored badge is applied instantly.
  5. Reload the page and ensure the triage state is persisted.

## 4. Advanced Fuzzing & Project Settings Tabs
* **Objective**: Verify that the user can configure advanced project settings and that they persist across tabs.
* **Test Steps**:
  1. Click on the "Project Settings" button in the sidebar (or selector menu).
  2. **General Tab**: Verify API Spec URL and Base URL input fields are correct.
  3. **Performance Tab**:
     - Change the Max Concurrency input field to `5`.
     - Toggle the `Rate Limit Detection` switch on.
     - Change the `Rate Limit Burst Size` input to `100`.
  4. **Anomalies Tab**:
     - Check the `Analyze Response Body` anomaly detection switch.
     - Change the `Size Anomaly Multiplier` input to `10.0`.
     - Change the `Time Anomaly Threshold (ms)` to `3000`.
  5. **Wordlists Tab**:
     - Input a custom list of query parameters into the text area.
  6. **Raw Config Tab**:
     - Verify that the raw JSON view automatically updates to reflect the Performance and Anomaly changes made in previous tabs.
  7. Click "Save" and verify the settings are persistent.

## 5. Payload Settings Modal Interaction
* **Objective**: Test the custom payload catalog configuration.
* **Test Steps**:
  1. Click the gear icon next to "API SPECS" or "Payload Settings" in the sidebar to open the `PayloadSettingsModal`.
  2. Verify that different payload category sections (e.g. SQL Injection, XSS, Path Traversal) are loaded.
  3. Toggle specific payloads off/on.
  4. Click "Close" and start a fuzzing run.
  5. Verify that fuzzed requests omit/include the modified payload list.

## 6. Input Validation & Error Handling (Broken Specs)
* **Objective**: Verify UI resilience when a user inputs a broken/malformed URL or invalid OpenAPI specification.
* **Test Steps**:
  1. Fill the Swagger URL input field with a malformed address or a page returning a `500` error.
  2. Click "Add".
  3. Verify that the application displays a friendly validation error toast or alert and doesn't crash.

## 7. User Settings and Profile Management
* **Objective**: Verify profile updates.
* **Test Steps**:
  1. Click the user profile avatar in the header to open the `UserSettings` modal.
  2. Change preferences (e.g. toggle Dark/Light mode theme).
  3. Verify that CSS classes (`.dark` / `.light`) are applied to the body instantly.

## 8. Distributed Fuzzing Agents Version Display
* **Objective**: Ensure that the "Distributed Fuzzing Agents" page correctly lists active runner agents along with their version tag complying with semantic versioning (semver).
* **Test Steps**:
  1. Navigate to the "Runners" or "Distributed Fuzzing Agents" settings/dashboard tab.
  2. Verify that the agent registration list displays the connected local runner (e.g. `runner-MacBook-Air`).
  3. Verify that a version badge/tag is visible next to the agent name.
  4. Assert that the version tag matches semantic versioning format (e.g. `v[0-9]+\.[0-9]+\.[0-9]+` / `v1.0.0`).

## 9. Request Mutation Visual Diff
* **Objective**: Verify that the visual mutation highlighting (request diff-view) renders correctly for fuzzed requests (Task 21).
* **Test Steps**:
  1. Complete a fuzzing run.
  2. Go to the "Request Logs" tab and click on any fuzzed request row.
  3. Inspect the right side-panel (Request Detail).
  4. Assert that the visual diff comparisons (original vs mutated) are visible.
  5. Check that class names `.diff-mutated-malicious`, `.diff-added-key`, or equivalent highlighting spans are present and styled with correct colors.

## 10. Keyboard Shortcuts & Help Modal
* **Objective**: Verify that hotkeys trigger the correct UI menus and overlays (Task 46).
* **Test Steps**:
  1. Focus on the main layout.
  2. Trigger the keyboard shortcut helper by pressing the `?` key on the keyboard.
  3. Verify that the Keyboard Shortcuts Modal is displayed and lists valid shortcuts (e.g. `Ctrl+R` to run, `Esc` to close).
  4. Press `Esc` and verify that the modal closes.

## 11. HAR File Import (Traffic Replay Fuzzing)
* **Objective**: Verify that importing a `.har` traffic recording populates the endpoint list (Task 56).
* **Test Steps**:
  1. Click on the spec file upload area in the sidebar and choose a `.har` file from the disk.
  2. Verify that the system parses the traffic and renders the reconstructed endpoints in the sidebar.
  3. Check that parameters mapped from request paths and query params in the HAR are listed.

## 12. Request Log Filters (Status, Path & Identity) [DONE]
* **Objective**: Ensure that logs can be sliced dynamically using the header filter bar.
* **Test Steps**:
  1. Complete a fuzzing run.
  2. Select the `5xx` tab in the Inspector header and verify that the rows listed only show statuses >= 500.
  3. Type `/users` into the `Filter by path` input field, verify that list results only contain endpoints matching `/users`.
  4. Select `User B` in the identity dropdown filter, and verify that only requests mapped to User B are visible.
  5. Click the `✕` button next to search input and verify that the search text is cleared.

## 13. Sidebar Endpoint Tree Filtering [DONE]
* **Objective**: Verify that selecting/deselecting target endpoints in the sidebar filters the fuzzing scope.
* **Test Steps**:
  1. Load the Vulnerable Demo API.
  2. In the left Sidebar, type `/login` into the `Search endpoints...` box.
  3. Uncheck the checkbox next to the `POST /login` endpoint.
  4. Trigger a fuzzing run.
  5. Verify that no requests targeting `POST /login` appear in the live logs and heatmap cells.

## 14. Modal Backdrop and Closure Dismissals [DONE]
* **Objective**: Ensure consistent dismiss behaviors for all modals (escape, close button, backdrop click).
* **Test Steps**:
  1. Open the "Project Settings" modal.
  2. Click on the overlay backdrop surrounding the settings window, and verify that the modal is dismissed.
  3. Reopen the modal, click the close button (`✕`) in the top-right corner, and verify it closes.
  4. Open the "Payload Settings" modal, press the `Escape` key, and verify it closes.

## 15. Runner Agent Disconnection & Failover
* **Objective**: Verify fuzzer stability when a connected runner agent goes offline unexpectedly during a run.
* **Test Steps**:
  1. Connect two runner agents to the Coordinator.
  2. Start a fuzzing run.
  3. Kill one of the runner agent processes midway through the run.
  4. Verify that the Coordinator successfully re-allocates pending fuzzing paths to the remaining active runner.
  5. Ensure the scan completes successfully without hangs.

## 16. Rate Limit Detection & Throttle Control
* **Objective**: Ensure the fuzzer respects rate limiting thresholds and throttles requests when encountering HTTP 429.
* **Test Steps**:
  1. Start the fuzzing run against an endpoint configured to return HTTP 429 after 20 requests.
  2. Enable Rate Limit Detection in the Project Settings.
  3. Start the scan.
  4. Verify that the fuzzer dynamically drops concurrency and pauses according to the burst/backoff configurations when 429 is encountered.

## 17. OWASP Top 10 Mapping Accuracy
* **Objective**: Ensure vulnerability findings are mapped to the correct OWASP Top 10 categories.
* **Test Steps**:
  1. Complete a fuzzing run that triggers SQL Injection and XSS vulnerabilities.
  2. Navigate to the "OWASP Top 10" tab in the dashboard.
  3. Verify that the findings are correctly aggregated under `A03:2021-Injection` and `A01:2021-Broken Access Control` (for BOLA).
  4. Expand a category card to verify it lists the correct finding instances.

## 18. Interactive Application Security Testing (IAST) Integration
* **Objective**: Verify that the fuzzer supports interactive runtime analysis to track data flows, verify execution context, and detect code-level vulnerability sinks in real-time.
* **Test Steps**:
  1. Instrument the target application with a dynamic agent (e.g., node agent or JVM agent).
  2. Perform a fuzzer scan run against the instrumented endpoints.
  3. Verify that the runner agent collects telemetry, taint analysis data, and runtime vulnerability warnings via direct process hooks.
  4. Ensure that the findings dashboard displays enriched IAST stack traces and verifies precise code locations of vulnerability sinks.



## 19. Response Body Copy Button
* **Objective**: Verify that the copy button correctly copies the JSON response body to the clipboard.
* **Test Steps**:
  1. Complete a fuzzing run.
  2. Click on a fuzzed request row in the Inspector to open the Request Detail modal.
  3. Ensure a response body is present.
  4. Hover over the Response Body block and click the "Copy" button.
  5. Verify that the button text changes to "✓ Copied".
  6. Assert that the clipboard content matches the displayed JSON response body exactly.
