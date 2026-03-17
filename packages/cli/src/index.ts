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
import { toHtml } from './output/html.js';
import { printProgress, printSummary, clearProgress } from './output/console.js';
import type { CliOptions, Finding, OutputFormat } from './types.js';

function parseCliArgs(): CliOptions {
    const { values } = parseArgs({
        options: {
            config: { type: 'string', short: 'c' },
            format: { type: 'string', short: 'f', default: 'console' },
            output: { type: 'string', short: 'o' },
            quiet: { type: 'boolean', short: 'q', default: false },
            'fail-on-findings': { type: 'boolean', default: false },
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
  --fail-on-findings    Exit with code 1 if findings are found (useful for CI)
  -h, --help            Show this help
`);
        process.exit(values.help ? 0 : 1);
    }

    const formatStr = (values.format as string) || 'console';
    const requestedFormats = formatStr.split(',').map(f => f.trim()) as OutputFormat[];
    
    for (const format of requestedFormats) {
        if (!['console', 'json', 'sarif', 'html'].includes(format)) {
            console.error(`Unknown format: ${format}. Use console, json, sarif, or html.`);
            process.exit(1);
        }
    }

    return {
        config: values.config,
        format: requestedFormats,
        output: values.output,
        quiet: values.quiet ?? false,
        failOnFindings: values['fail-on-findings'] ?? false,
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
    for (const format of opts.format) {
        if (format === 'console') continue;

        let content: string | undefined;
        let ext = format === 'sarif' ? 'sarif' : format;

        if (format === 'sarif') {
            content = JSON.stringify(toSarif(findings), null, 2);
        } else if (format === 'json') {
            content = JSON.stringify(toJson(findings, stats), null, 2);
        } else if (format === 'html') {
            content = toHtml(findings, stats);
        }

        if (content) {
            if (opts.output) {
                // If multiple formats, use output as base name
                const finalPath = opts.format.filter(f => f !== 'console').length > 1
                    ? `${opts.output}.${ext}`
                    : opts.output;

                await writeFile(resolve(finalPath), content, 'utf-8');
                console.error(`\nReport written to ${finalPath}`);
            } else {
                console.log(content);
            }
        }
    }

    // Exit with error code if there are error-level findings AND --fail-on-findings is set
    const hasErrors = findings.some(f => f.level === 'error');
    if (hasErrors && !opts.failOnFindings) {
        console.error('\nScan found potential issues. Use --fail-on-findings to exit with code 1 in CI environments.');
    }
    process.exit(hasErrors && opts.failOnFindings ? 1 : 0);
}

main().catch((err) => {
    console.error(`\nFatal: ${err.message}`);
    process.exit(2);
});
