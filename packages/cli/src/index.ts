#!/usr/bin/env node

/**
 * Swazz CLI Wrapper
 * This script serves as a thin wrapper that delegates the actual fuzzing logic 
 * to the Go binary in packages/container.
 */

import { spawn } from 'node:child_process';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Path to the Go workspace
const goWorkspaceDir = resolve(__dirname, '../../container');
const goSourceFile = join(goWorkspaceDir, 'main.go');

if (!existsSync(goSourceFile)) {
    console.error(`Error: Cannot find Go source at ${goSourceFile}`);
    process.exit(1);
}

// Forward all arguments after "start" or whatever command was used
const args = process.argv.slice(2);

// Build the Go command
// We use `go run main.go start ...args` to execute the CLI logic without needing to precompile for every platform in dev.
const goArgs = ['run', 'main.go', 'start', ...args];

console.log(`[Swazz CLI Wrapper] Delegating to Go engine: go ${goArgs.join(' ')}`);

const child = spawn('go', goArgs, {
    cwd: goWorkspaceDir,
    stdio: 'inherit',
    env: process.env
});

child.on('error', (err) => {
    console.error(`Failed to start Go engine: ${err.message}`);
    console.error(`Make sure you have Go installed and in your PATH.`);
    process.exit(1);
});

child.on('exit', (code) => {
    process.exit(code ?? 1);
});
