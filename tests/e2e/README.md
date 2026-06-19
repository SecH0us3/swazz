# Swazz E2E Integration Testing

This directory contains the Playwright End-to-End integration tests for Swazz. The E2E suite verifies the full lifecycle including user signup, loading Swagger specifications, triggering fuzzing runs, and validating live results/CORS/SQLi findings.

## Prerequisites

Before running the E2E tests, make sure:
1. Node.js dependencies are installed (`npm install`).
2. Playwright browsers are installed (`npx playwright install`).
3. Go compiler is installed (to build the fuzzer engine).

## Running Tests

All commands must be executed from the **project root directory** (`/Users/alex/src/swazz`).

### 1. Manual Execution (Step-by-Step)

If you prefer to start each service manually in separate terminal windows, run the following:

* **Terminal 1: Vulnerable Demo API**
  ```bash
  rtk npx wrangler dev --port 8788 --cwd demo
  ```

* **Terminal 2: Edge Coordinator API**
  ```bash
  rtk npx wrangler dev
  ```

* **Terminal 3: React Web Frontend**
  ```bash
  rtk npm run dev
  ```

* **Terminal 4: Go Runner Agent**
  ```bash
  # Compile the engine
  cd packages/container
  rtk go build -o swazz-engine
  
  # Run the runner agent in dangerous/local bypass mode
  rtk ./swazz-engine run-agent --coordinator ws://127.0.0.1:8787/api/runners/connect --token swazz_live_citoken1234567890 --dangerous-no-container
  ```

* **Terminal 5: Run Playwright**
  ```bash
  # Run in headless mode
  rtk npx playwright test
  
  # Run in interactive UI mode (recommended for debugging)
  rtk npx playwright test --ui
  ```

---

### 2. Automatic Execution (Bash Script)

An automated bash script is provided to spin up all services, execute the tests, and clean up background processes upon completion.

Run the script from the **project root directory**:
```bash
rtk bash tests/e2e/run-e2e.sh
```
