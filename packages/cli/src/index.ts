#!/usr/bin/env node

/**
 * swazz CLI — run API fuzzing from the command line.
 *
 * Usage:
 *   swazz --config swazz.config.json [--format sarif|json|console] [--output report.sarif] [--quiet]
 *   swazz --url https://api.example.com/swagger.json [options]
 */

import { parseArgs } from 'node:util';
import { writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FuzzRunner } from '@swazz/core';
import { loadConfig, loadConfigFromUrl } from './config.js';
import { Classifier } from './classifier.js';
import { nodeSender } from './sender.js';
import { toSarif } from './output/sarif.js';
import { toJson } from './output/json.js';
import { toHtml } from './output/html.js';
import { printProgress, printSummary, clearProgress } from './output/console.js';
import type { CliOptions, Finding, OutputFormat } from './types.js';

// Read version from package.json at runtime
async function getVersion(): Promise<string> {
    try {
        const pkgPath = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
        const pkg = JSON.parse(await readFile(pkgPath, 'utf-8'));
        return pkg.version ?? '1.0.0';
    } catch {
        return '1.0.0';
    }
}

function parseCliArgs(): CliOptions {
    const { values } = parseArgs({
        options: {
            config:            { type: 'string',  short: 'c' },
            url:               { type: 'string',  short: 'u' },
            'base-url':        { type: 'string' },
            format:            { type: 'string',  short: 'f', default: 'console' },
            output:            { type: 'string',  short: 'o' },
            quiet:             { type: 'boolean', short: 'q', default: false },
            'fail-on-findings':{ type: 'boolean', default: false },
            include:           { type: 'string',  multiple: true },
            exclude:           { type: 'string',  multiple: true },
            version:           { type: 'boolean', short: 'v', default: false },
            help:              { type: 'boolean', short: 'h', default: false },
        },
    });

    if (values.version) {
        // version printed async just before exit in main()
        (globalThis as any).__printVersion = true;
        return {} as any;
    }

    const needsInput = !values.config && !values.url;
    if (values.help || needsInput) {
        process.stderr.write(`
swazz — Smart API Fuzzer CLI

Usage:
  swazz --config <path>  [options]          use a config file
  swazz --url <swagger>  [options]          quick run without a config file

Source (one required):
  -c, --config <path>    Path to swazz.config.json
  -u, --url <url>        Swagger/OpenAPI spec URL (no config file needed)
      --base-url <url>   Override base URL (use with --url)

Output:
  -f, --format <fmt>     Output format: console, json, sarif, html  (default: console)
                         Multiple formats: -f json,html
  -o, --output <path>    Write report to file (stdout if omitted)
  -q, --quiet            Suppress live progress output

Filtering:
      --include <glob>   Include only matching endpoints (repeatable)
      --exclude <glob>   Exclude matching endpoints (repeatable)

CI / Misc:
      --fail-on-findings Exit with code 1 if error-level findings found
  -v, --version          Show version
  -h, --help             Show this help

Examples:
  swazz -c swazz.config.json
  swazz -u https://api.example.com/swagger.json -f html -o report.html
  swazz -c cfg.json --exclude "/health" --exclude "/metrics" --fail-on-findings
`);
        process.exit(values.help ? 0 : 1);
    }

    const formatStr = (values.format as string) || 'console';
    const requestedFormats = formatStr.split(',').map(f => f.trim()) as OutputFormat[];

    for (const format of requestedFormats) {
        if (!['console', 'json', 'sarif', 'html'].includes(format)) {
            process.stderr.write(`Unknown format: ${format}. Use console, json, sarif, or html.\n`);
            process.exit(1);
        }
    }

    return {
        config:         values.config,
        url:            values.url,
        baseUrl:        values['base-url'],
        format:         requestedFormats,
        output:         values.output,
        quiet:          values.quiet ?? false,
        failOnFindings: values['fail-on-findings'] ?? false,
        include:        values.include ?? [],
        exclude:        values.exclude ?? [],
    };
}

async function main(): Promise<void> {
    const version = await getVersion();

    const opts = parseCliArgs();

    if ((globalThis as any).__printVersion) {
        process.stdout.write(`swazz v${version}\n`);
        process.exit(0);
    }

    // Load config — either from file or from --url shortcut
    let cliConfigResult: Awaited<ReturnType<typeof loadConfig>>;

    if (opts.url) {
        process.stderr.write(`Loading spec from ${opts.url}...\n`);
        cliConfigResult = await loadConfigFromUrl(opts.url, opts.baseUrl);
    } else {
        process.stderr.write(`Loading config from ${opts.config}...\n`);
        cliConfigResult = await loadConfig(opts.config!);
    }

    let { cliConfig, runConfig } = cliConfigResult;

    // Merge CLI --include / --exclude on top of config file filters
    if (opts.include.length > 0 || opts.exclude.length > 0) {
        const merged = {
            include: [...(cliConfig.endpoints?.include ?? []), ...opts.include],
            exclude: [...(cliConfig.endpoints?.exclude ?? []), ...opts.exclude],
        };
        // Re-apply filtering on already-loaded endpoints
        const { filterEndpoints } = await import('./config.js');
        runConfig = {
            ...runConfig,
            endpoints: filterEndpoints(runConfig.endpoints, merged),
        };
        if (runConfig.endpoints.length === 0) {
            process.stderr.write('Error: No endpoints remain after applying --include/--exclude filters.\n');
            process.exit(1);
        }
    }

    const specCount = opts.url ? 1 : cliConfig.swagger_urls.length;
    process.stderr.write(`Loaded ${runConfig.endpoints.length} endpoints from ${specCount} spec(s)\n`);
    process.stderr.write(`Base URL:   ${runConfig.base_url}\n`);
    process.stderr.write(`Profiles:   ${runConfig.settings.profiles.join(', ')}\n`);
    process.stderr.write(`Iterations: ${runConfig.settings.iterations_per_profile} per profile\n`);
    process.stderr.write('\n');

    // Set up classifier
    const classifier = new Classifier(cliConfig.rules);
    const findings: Finding[] = [];

    // Create runner — do NOT keep allResults in memory, only process findings on the fly
    const runner = new FuzzRunner(runConfig, nodeSender);

    runner.onResult = (result) => {
        const finding = classifier.classify(result);
        if (finding) findings.push(finding);
    };

    runner.onProgress = (stats) => {
        if (!opts.quiet) {
            printProgress(stats);
        }
    };

    runner.onError = (err) => {
        clearProgress();
        process.stderr.write(`  Error: ${err.message}\n`);
    };

    // Handle graceful shutdown
    let stopped = false;
    const shutdown = () => {
        if (stopped) process.exit(1);
        stopped = true;
        clearProgress();
        process.stderr.write('\n  Stopping scan (Ctrl+C again to force)...\n');
        runner.stop();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Run
    process.stderr.write('Starting scan...\n\n');
    await runner.start();
    const stats = runner.getStats();

    // Always print summary to stderr (never pollutes stdout / piped JSON)
    printSummary(findings, stats);

    // Write output reports
    for (const format of opts.format) {
        if (format === 'console') continue;

        let content: string | undefined;
        const ext = format === 'sarif' ? 'sarif' : format;

        if (format === 'sarif') {
            content = JSON.stringify(toSarif(findings, version), null, 2);
        } else if (format === 'json') {
            content = JSON.stringify(toJson(findings, stats, version), null, 2);
        } else if (format === 'html') {
            content = toHtml(findings, stats);
        }

        if (content) {
            if (opts.output) {
                const finalPath = opts.format.filter(f => f !== 'console').length > 1
                    ? `${opts.output}.${ext}`
                    : opts.output;
                await writeFile(resolve(finalPath), content, 'utf-8');
                process.stderr.write(`\nReport written to ${finalPath}\n`);
            } else {
                // HTML to stdout without a file path is likely a mistake — warn
                if (format === 'html') {
                    process.stderr.write('\nNote: piping HTML to stdout. Use -o report.html to write to a file.\n');
                }
                process.stdout.write(content + '\n');
            }
        }
    }

    // Exit code
    const hasErrors = findings.some(f => f.level === 'error');
    if (hasErrors && !opts.failOnFindings) {
        process.stderr.write('\nScan found potential issues. Use --fail-on-findings to exit with code 1 in CI environments.\n');
    }
    process.exit(hasErrors && opts.failOnFindings ? 1 : 0);
}

main().catch((err) => {
    process.stderr.write(`\nFatal: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(2);
});
