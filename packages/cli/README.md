# @swazz/cli

Smart API Fuzzer CLI — run API fuzzing from the command line.

## Usage

### Run from source (local development)

```bash
# In the repository root
npm run dev:cli -- --config swazz.config.petstore.json --format json,sarif,html -o my_report
```

Or within the `packages/cli` directory:

```bash
npm start -- --config ../../swazz.config.petstore.json --format html -o report.html
```

### Global usage (when installed)

```bash
swazz --config swazz.config.json [options]
```

## Options

- `-c, --config <path>`:   **Required**. Path to `swazz.config.json`
- `-f, --format <fmt>`:    Output format(s): `console`, `json`, `sarif`, `html`. Supports multiple formats separated by comma (e.g., `json,html`). (default: `console`)
- `-o, --output <path>`:   Write report to file. If multiple formats are selected, this is used as a base name (e.g., `-o my_report` generates `my_report.json`, `my_report.html`).
- `-q, --quiet`:           Suppress live progress output
- `--fail-on-findings`:    Exit with code 1 if findings are found (useful for CI)
- `-h, --help`:            Show help

## Configuration

Example `swazz.config.json`:

```json
{
  "swagger_urls": ["https://petstore.swagger.io/v2/swagger.json"],
  "base_url": "https://petstore.swagger.io/v2",
  "settings": {
    "iterations_per_profile": 5,
    "concurrency": 2,
    "profiles": ["RANDOM"]
  }
}
```
