#!/usr/bin/env node

/**
 * swazz CLI — run API fuzzing from the command line.
 *
 * Usage:
 *   swazz --config swazz.config.json [--format sarif|json|console] [--output report.sarif] [--quiet]
 */

import { parseArgs } from 'node:util';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { FuzzRunner } from '@swazz/core';
import type { FuzzResult } from '@swazz/core';
import { loadConfig } from './config.js';
import { Classifier } from './classifier.js';
import { nodeSender } from './sender.js';
import { toSarif } from './output/sarif.js';
import { toJson } from './output/json.js';
import { printProgress, printSummary, clearProgress } from './output/console.js';
import type { CliOptions, Finding } from './types.js';

function parseCliArgs(): CliOptions {
    const { values } = parseArgs({
        options: {
            config: { type: 'string', short: 'c' },
            format: { type: 'string', short: 'f', default: 'console' },
            output: { type: 'string', short: 'o' },
            quiet: { type: 'boolean', short: 'q', default: false },
            help: { type: 'boolean', short: 'h', default: false },
        },
    });

    if (values.help || !values.config) {
        console.log(`
swazz — Smart API Fuzzer CLI

Usage:
  swazz --config <path>  [options]
  swazz -c swazz.config.json -f sarif -o report.sarif

Options:
  -c, --config <path>   Path to swazz.config.json (required)
  -f, --format <fmt>    Output format: console, json, sarif (default: console)
  -o, --output <path>   Write report to file (default: stdout for json/sarif)
  -q, --quiet           Suppress live progress output
  -h, --help            Show this help
`);
        process.exit(values.help ? 0 : 1);
    }

    const format = values.format as CliOptions['format'];
    if (!['console', 'json', 'sarif'].includes(format)) {
        console.error(`Unknown format: ${format}. Use console, json, or sarif.`);
        process.exit(1);
    }

    return {
        config: values.config,
        format,
        output: values.output,
        quiet: values.quiet ?? false,
    };
}

async function main(): Promise<void> {
    const opts = parseCliArgs();

    // Load config and build runner config
    console.error(`Loading config from ${opts.config}...`);
    const { cliConfig, runConfig } = await loadConfig(opts.config);
    console.error(`Loaded ${runConfig.endpoints.length} endpoints from ${cliConfig.swagger_urls.length} spec(s)`);
    console.error(`Base URL: ${runConfig.base_url}`);
    console.error(`Profiles: ${runConfig.settings.profiles.join(', ')}`);
    console.error(`Iterations: ${runConfig.settings.iterations_per_profile} per profile`);
    console.error('');

    // Set up classifier
    const classifier = new Classifier(cliConfig.rules);

    // Collect results and findings
    const allResults: FuzzResult[] = [];
    const findings: Finding[] = [];

    // Create runner
    const runner = new FuzzRunner(runConfig, nodeSender);

    runner.onResult = (result) => {
        allResults.push(result);
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
        console.error(`  Error: ${err.message}`);
    };

    // Handle graceful shutdown
    let stopped = false;
    const shutdown = () => {
        if (stopped) process.exit(1);
        stopped = true;
        clearProgress();
        console.error('\n  Stopping scan (Ctrl+C again to force)...');
        runner.stop();
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    // Run
    console.error('Starting scan...\n');
    await runner.start();
    const stats = runner.getStats();

    // Always print summary to stderr
    printSummary(findings, stats);

    // Write output
    let output: string | undefined;

    if (opts.format === 'sarif') {
        output = JSON.stringify(toSarif(findings), null, 2);
    } else if (opts.format === 'json') {
        output = JSON.stringify(toJson(findings, stats), null, 2);
    }

    if (output) {
        if (opts.output) {
            await writeFile(resolve(opts.output), output, 'utf-8');
            console.error(`\nReport written to ${opts.output}`);
        } else {
            console.log(output);
        }
    }

    // Exit with error code if there are error-level findings
    const hasErrors = findings.some(f => f.level === 'error');
    process.exit(hasErrors ? 1 : 0);
}

main().catch((err) => {
    console.error(`\nFatal: ${err.message}`);
    process.exit(2);
});
