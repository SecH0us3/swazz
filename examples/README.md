# Swazz Cookbook & Configuration Examples

Welcome to the **Swazz Cookbook**! 🧑‍🍳

This directory contains practical configuration templates and examples for running the Swazz security scanner. Use these configurations as a starting point for your own security tests.

## Available Examples

### 1. `swazz.config.example.jsonc`
The comprehensive, fully-documented example configuration file. It contains extensive comments explaining every possible parameter, including target selection, fuzzing settings, multi-auth flows, sequences, and advanced plugin options.
**Use case:** Reference for writing your own configs from scratch.

### 2. `swazz.config.petstore.json`
A lightweight, ready-to-run configuration targeting the public Swagger Petstore API.
**Use case:** Quick start and testing the fuzzer's basic capabilities without complex setups.
**How to run:**
```bash
swazz run -c examples/swazz.config.petstore.json
```

### 3. `swazz.config.bola-test.json`
A specialized configuration designed to test BOLA (Broken Object Level Authorization) vulnerabilities. Demonstrates how to configure role-based access rules and multiple user contexts.
**Use case:** Testing API authorization controls.

### 4. `swazz.config.demo.json`
A minimal configuration used for the local Swazz Demo API.
**Use case:** For contributors testing against the local `scripts/start-local-dev.sh` environment.

### 5. `wraggler.config.example.jsonc`
Configuration example for the Edge Coordinator (Wraggler).
**Use case:** Setting up a custom deployment of the Swazz orchestration API.

---

## Getting Started

To use any of these configurations, pass them to the `swazz run` command using the `-c` or `--config` flag:

```bash
swazz run -c examples/<config-file>.json
```

If you modify these templates, we recommend copying them to your project root or outside the repository rather than modifying the tracked examples:
```bash
cp examples/swazz.config.example.jsonc ./my-target-config.jsonc
```
