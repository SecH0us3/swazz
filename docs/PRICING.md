# Swazz Pricing & Licensing Guide

Swazz is committed to empowering the open-source and security community with a world-class API fuzzing engine while building a sustainable commercial model for enterprise adoption.

---

## 📜 Business Source License 1.1 (BSL 1.1)

Swazz source code is distributed under the **Business Source License 1.1 (BSL 1.1)**.

Under BSL 1.1:
- The source code is fully visible, open, and auditable.
- Community members and security researchers can inspect, modify, and build upon the software.
- On the **Change Date** (4 years from release), each version automatically transitions into the fully open-source **GNU Affero General Public License v3.0 (AGPLv3)**.

---

## 🎁 Additional Use Grant (Free Commercial Limit)

Under our **Additional Use Grant**, you are granted full permission to run Swazz in production environments **without purchasing a Commercial License**, provided at least one of the following conditions is met:

1. **Non-Commercial / Open Source Use**: You are using Swazz exclusively to scan non-commercial, academic, or open-source projects.
2. **Small Business / Startup Exemption**: The annual gross revenue of your company (including parent, subsidiary, and affiliated entities) does not exceed **$1,000,000 USD**.

> [!NOTE]
> If your company's annual revenue exceeds **$1,000,000 USD** and you use Swazz in production or commercial environments, an official **Swazz Enterprise Commercial License** is required.

---

## 📊 Feature Comparison Matrix

| Feature / Capability | Community Edition (BSL 1.1 Free) | Swazz Enterprise |
| :--- | :---: | :---: |
| **Max Annual Gross Revenue** | Under $1,000,000 USD | Unlimited |
| **Self-Hosted Engine & Local CLI** | ✅ Included | ✅ Included |
| **OpenAPI, HAR, SOAP & GraphQL Fuzzing** | ✅ Included | ✅ Included |
| **Shared & Private Dedicated Runners** | ✅ Included | ✅ Included |
| **Source Code Access & Auditing** | ✅ Included | ✅ Included |
| **Enterprise SAML / Single Sign-On (Okta, Azure AD)** | ❌ | ✅ Included |
| **Multi-Tenant Organizations & RBAC** | ❌ | ✅ Included |
| **Custom Compliance PDF Reports (PCI-DSS, SOC2)** | ❌ | ✅ Included |
| **Bi-directional Ticket Sync (Jira, GitLab)** | ❌ | ✅ Included |
| **SLA & Priority Security Support** | Community | Dedicated 24/7 |

---

## 🔑 How Enterprise License Verification Works

Swazz Engine binary includes cryptographic **Ed25519 + JWT** license key verification:

1. Set the environment variable `SWAZZ_LICENSE_KEY` with your signed JWT token.
2. The engine verifies the signature against the embedded public key and unlocks enterprise features seamlessly.
3. You can verify your current binary's license terms at any time by running:
   ```bash
   ./swazz-engine license
   ```

---

## 📧 Contact & Enterprise Sales

For commercial licensing, enterprise waitlist registration, or custom deployment support:
- Visit the landing page and click **Request Enterprise License**.
- Or email our team directly at: `enterprise@swazz.secmy.app`
