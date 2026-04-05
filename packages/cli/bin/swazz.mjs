#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const dir = dirname(fileURLToPath(import.meta.url));
const dest = resolve(dir, '../src/index.ts');

const result = spawnSync(process.execPath, ['--import', 'tsx/esm', dest, ...process.argv.slice(2)], {
    stdio: 'inherit'
});

process.exit(result.status ?? 1);
