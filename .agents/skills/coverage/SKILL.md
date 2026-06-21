---
name: coverage-reporter
description: Runs and measures code coverage for Go backend and React frontend.
---

# Code Coverage Reporting Skill

Use this skill to measure and verify test coverage in this workspace.

## Script Usage
The skill includes a pre-prepared token-efficient script at `.agents/skills/coverage/scripts/run-coverage.sh`.

Run it from the workspace root using:
```bash
rtk bash .agents/skills/coverage/scripts/run-coverage.sh
```

It executes both Vitest coverage (frontend) and Go tool cover (backend), filtering the output to present only the summary statistics. This minimizes token consumption during development and agent analysis.
