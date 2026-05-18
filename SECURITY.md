# Security Policy

## Supported Versions

Use this section to tell people about which versions of your project are currently being supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| 1.0.x   | :white_check_mark: |
| < 1.0   | :x:                |

## Reporting a Vulnerability

We take the security of Swazz seriously. If you discover a security vulnerability in the fuzzer itself (e.g., an issue that could lead to code execution, data exposure, or bypasses within the tool), please report it to us privately.

We highly recommend reporting security vulnerabilities privately to prevent them from being publicly exposed before a fix is available. 
You can do this by sending an email to `security@secmy.app` or by using GitHub's [Private Vulnerability Reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability).

You *can* open a standard GitHub Issue if you prefer, but please be aware that this will make the vulnerability details publicly visible immediately, which is generally discouraged.

### What to include in your report

* A detailed description of the vulnerability.
* Steps to reproduce the issue (including any payload or specific configuration used).
* The version of Swazz you are using (`swazz-engine --version`).
* Potential impact of the vulnerability.

### What to expect

Please note that this is an open-source project maintained in our free time. We do not offer strict SLAs or guaranteed response times. 

However, we will try our best to:
- Review your report as soon as we have availability.
- Work on a patch for confirmed vulnerabilities in upcoming releases.
- Publicly acknowledge your contribution (if you wish) once the patch is published.

---
*Note: As Swazz is a security tool designed to fuzz other applications, bugs that cause the target application to crash are expected and are not considered vulnerabilities in Swazz itself. Only issues that affect the security of the Swazz engine or its host environment should be reported here.*
