---
layout: default
title: DefectDojo Integration
---

# DefectDojo Integration Guidelines 🥋

DefectDojo is an open-source vulnerability management tool that allows you to aggregate, triage, and manage findings from multiple security scanners. Swazz supports seamless integration with DefectDojo by exporting findings in the standardized **SARIF 2.1.0** format with rich metadata.

---

## 📤 Exporting Swazz Reports to SARIF

To generate a SARIF report compatible with DefectDojo, run the Swazz CLI using the `--sarif` option. You should also ensure that a base URL is specified (either via the configuration file or CLI arguments) so that Swazz can reconstruct absolute target URLs for the HTTP request evidence.

Run the following command:

```bash
./swazz-engine start --config swazz.config.json --sarif swazz.sarif
```

### Configuration Example (`swazz.config.json`)
Make sure your configuration contains the `base_url` parameter, which is utilized to format target URLs for request mapping:

```json
{
  "base_url": "https://api.example.com",
  "settings": {
    "profiles": ["malicious", "boundary", "bola-test"]
  }
}
```

---

## 📥 Importing SARIF Files into DefectDojo

You can import the generated SARIF reports into DefectDojo either via the Web UI or programmatically using the DefectDojo API.

### Option 1: Using the DefectDojo Web UI

1. Log into your **DefectDojo** instance.
2. Select or create a **Product** for the target application.
3. Start or select an **Engagement** (e.g., "API Fuzzing Run").
4. Click **Engagement Options** (top right) and select **Import Scan Results**.
5. Configure the import form:
   - **Scan Type:** Select `SARIF` (or `SARIF Scan` depending on version).
   - **File:** Choose the generated `swazz.sarif` file.
   - **Active/Verified:** Check these boxes to automatically verify findings.
   - **Environment:** Select the environment (e.g., `Development`, `Staging`).
6. Click **Submit** to process the import.

### Option 2: Programmatically via the DefectDojo API (CI/CD)

To automate imports as part of a CI/CD pipeline, upload the scan file using `curl` and DefectDojo's `/api/v2/import-scan/` endpoint:

```bash
curl -X POST \
  -H "Authorization: Token <your_defectdojo_api_token>" \
  -F "scan_type=SARIF" \
  -F "file=@packages/container/swazz.sarif" \
  -F "engagement=<engagement_id>" \
  -F "active=true" \
  -F "verified=true" \
  https://defectdojo.example.com/api/v2/import-scan/
```

---

## 🗺️ How DefectDojo Maps Swazz Finding Attributes

When DefectDojo ingests a Swazz SARIF file, it maps SARIF properties to its internal database fields:

### 1. Severity Mapping
Swazz maps its finding severity levels to the standard SARIF `level` property. DefectDojo translates these levels into its own severity levels:
* `error` ➡️ **High** / **Critical**
* `warning` ➡️ **Medium**
* `note` ➡️ **Low** / **Info**

### 2. CWE Mapping
Each finding rule in the SARIF report contains a MITRE CWE ID under its properties (`properties.cwe`). DefectDojo automatically links the imported findings to the corresponding CWE definitions:
* `swazz/bola-idor`, `swazz/tenant-isolation-bypass` ➡️ **CWE-639** (Authorization Bypass Through User-Controlled Key)
* `swazz/unauthorized-access` ➡️ **CWE-306** (Missing Authentication for Critical Function)
* `swazz/sensitive-data-leak`, `swazz/response-size-anomaly` ➡️ **CWE-200** (Exposure of Sensitive Information to an Unauthorized Actor)
* `swazz/no-rate-limit` ➡️ **CWE-307** (Improper Restriction of Excessive Authentication Attempts)
* `swazz/rate-limit-active` ➡️ **CWE-770** (Allocation of Resources Without Limits or Throttling)
* `swazz/oob-interaction` ➡️ **CWE-918** (Server-Side Request Forgery)
* `swazz/cors-misconfig` ➡️ **CWE-942** (Permissive Cross-Domain Policy with Untrusted Domains)
* `swazz/csp-missing`, `swazz/csp-unsafe-directive`, `swazz/network-error` ➡️ **CWE-693** (Protection Mechanism Failure)
* `swazz/crlf-injection`, `swazz/header-injection` ➡️ **CWE-113** (Improper Control of Generation of Code aka 'HTTP Response Splitting')
* `swazz/reflected-xss` ➡️ **CWE-79** (Improper Neutralization of Input During Web Page Generation)
* `swazz/rce-leak` ➡️ **CWE-94** (Improper Control of Generation of Code aka 'Code Injection')
* `swazz/time-based-sqli`, `swazz/sql-error-leak` ➡️ **CWE-89** (Improper Neutralization of Special Elements used in an SQL Command)
* `swazz/time-based-cmdi` ➡️ **CWE-78** (Improper Neutralization of Special Elements used in an OS Command)
* `swazz/stack-trace-leak` ➡️ **CWE-209** (Generation of Error Message Containing Sensitive Information)
* `swazz/null-pointer-exception` ➡️ **CWE-476** (Null Pointer Dereference)
* `swazz/timeout` ➡️ **CWE-400** (Uncontrolled Resource Consumption)

### 3. File & Endpoint Paths
* The target API route (e.g. `/api/v1/users`) is mapped in the SARIF `locations[].physicalLocation.artifactLocation.uri` and is preserved in DefectDojo's **File Path** or **Location** attribute.
* The HTTP verb (e.g., `POST`, `GET`, `DELETE`) is captured in `logicalLocations[0].name` and is surfaced directly.

### 4. HTTP Requests & Responses
DefectDojo processes DAST/API details by extracting evidence metadata. Swazz provides this via two primary mechanisms in SARIF:
* **Custom Properties:** In each result's `properties` block, Swazz embeds `"webRequest"` and `"webResponse"` structures.
  - `properties.webRequest`: Contains the `method`, `url` (reconstructed absolute URL), and request `body` payload.
  - `properties.webResponse`: Contains the `statusCode` and the raw `body` text.
* **Markdown Overviews:** To ensure the request/response payloads are readable in DefectDojo regardless of standard SARIF limitations, Swazz includes a formatted markdown details card in `message.markdown`. This block renders as a clean HTML report inside DefectDojo's finding description, displaying:
  - Finding rule and level
  - Verb and endpoint URL
  - Active fuzzing profile
  - JSON-formatted request payload
  - Response body (automatically truncated if it exceeds 2000 characters to prevent UI bloat)
