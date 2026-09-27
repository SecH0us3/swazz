import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Builds the extension zip archive for dev or prod mode.
 *
 * @param {Object} options
 * @param {'dev'|'prod'} options.mode - Build mode ('dev' or 'prod')
 * @param {string} options.out - Destination path for the zip file
 * @param {Object} [options.env=process.env] - Environment variables
 * @returns {{ mode: string, out: string, url: string, fileCount: number }}
 */
export function buildZip({ mode, out, env = process.env }) {
    if (!mode || (mode !== 'dev' && mode !== 'prod')) {
        throw new Error(`Invalid mode: ${mode}. Must be "dev" or "prod".`);
    }
    if (!out) {
        throw new Error('Missing required argument: out');
    }

    // 1. URL selection
    let url;
    if (mode === 'dev') {
        url = 'http://localhost:5173';
    } else {
        url = (env && env.SWAZZ_EXTENSION_URL) || 'https://swazz.secmy.app';
    }

    // Strip trailing slashes
    url = url.replace(/\/+$/, '');

    // 2. Validate URL: bare origin with no path
    let parsed;
    try {
        parsed = new URL(url);
    } catch (e) {
        throw new Error(`Invalid URL "${url}": ${e.message}`);
    }
    if (parsed.origin !== url) {
        throw new Error(`URL "${url}" must be a bare origin without path or query`);
    }

    // Validate with extension's own isAuthOriginAllowed
    const require = createRequire(import.meta.url);
    const { isAuthOriginAllowed } = require('./scope.js');
    if (!isAuthOriginAllowed(url)) {
        throw new Error(`URL "${url}" is not allowed by scope.isAuthOriginAllowed`);
    }

    // 3. Stage files in temporary directory
    const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'swazz-ext-'));
    const stagingExtDir = path.join(stagingRoot, 'extension');
    fs.mkdirSync(stagingExtDir, { recursive: true });

    try {
        const extDir = path.dirname(fileURLToPath(import.meta.url));
        let fileCount = 0;

        // Copy allowlisted files: manifest.json, icons/**, *.html, *.css, and *.js except *.test.js
        const entries = fs.readdirSync(extDir, { withFileTypes: true });
        for (const entry of entries) {
            if (entry.isFile()) {
                const name = entry.name;
                if (name === 'manifest.json' || name.endsWith('.html') || name.endsWith('.css')) {
                    fs.copyFileSync(path.join(extDir, name), path.join(stagingExtDir, name));
                    fileCount++;
                } else if (name.endsWith('.js') && !name.endsWith('.test.js')) {
                    if (name === 'config.js') {
                        const stagedConfig = `// Default Swazz dashboard URL. The production zip build (build-zip.mjs --mode prod)
// rewrites this file in a staging copy; the source always keeps the local-dev value.
(function (root) {
    root.SWAZZ_DEFAULT_URL = ${JSON.stringify(url)};
})(typeof self !== 'undefined' ? self : globalThis);
`;
                        fs.writeFileSync(path.join(stagingExtDir, 'config.js'), stagedConfig, 'utf8');
                        fileCount++;
                    } else {
                        fs.copyFileSync(path.join(extDir, name), path.join(stagingExtDir, name));
                        fileCount++;
                    }
                }
            } else if (entry.isDirectory() && entry.name === 'icons') {
                const iconsSrc = path.join(extDir, 'icons');
                const iconsDest = path.join(stagingExtDir, 'icons');
                const copyDir = (src, dest) => {
                    fs.mkdirSync(dest, { recursive: true });
                    for (const item of fs.readdirSync(src, { withFileTypes: true })) {
                        const srcItem = path.join(src, item.name);
                        const destItem = path.join(dest, item.name);
                        if (item.isDirectory()) {
                            copyDir(srcItem, destItem);
                        } else if (item.isFile()) {
                            fs.copyFileSync(srcItem, destItem);
                            fileCount++;
                        }
                    }
                };
                copyDir(iconsSrc, iconsDest);
            }
        }

        if (!fs.existsSync(path.join(stagingExtDir, 'config.js'))) {
            const stagedConfig = `// Default Swazz dashboard URL. The production zip build (build-zip.mjs --mode prod)
// rewrites this file in a staging copy; the source always keeps the local-dev value.
(function (root) {
    root.SWAZZ_DEFAULT_URL = ${JSON.stringify(url)};
})(typeof self !== 'undefined' ? self : globalThis);
`;
            fs.writeFileSync(path.join(stagingExtDir, 'config.js'), stagedConfig, 'utf8');
            fileCount++;
        }

        // 4. Create zip archive
        const absOut = path.resolve(process.cwd(), out);
        if (fs.existsSync(absOut)) {
            fs.unlinkSync(absOut);
        }
        fs.mkdirSync(path.dirname(absOut), { recursive: true });

        execFileSync('zip', ['-r', '-X', absOut, 'extension'], { cwd: stagingRoot });

        console.log(`[build-zip] ${mode} → ${out} (default URL ${url}, ${fileCount} files)`);
        return { mode, out: absOut, url, fileCount };
    } finally {
        fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
}

function parseArgs(args) {
    let mode = 'dev';
    let out = '';
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--mode' && i + 1 < args.length) {
            mode = args[++i];
        } else if (args[i] === '--out' && i + 1 < args.length) {
            out = args[++i];
        }
    }
    return { mode, out };
}

const isDirectRun = Boolean(
    process.argv[1] &&
    (import.meta.url === pathToFileURL(process.argv[1]).href ||
     (fs.existsSync(process.argv[1]) && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href))
);

if (isDirectRun) {
    const { mode, out } = parseArgs(process.argv.slice(2));
    try {
        if (!out) {
            throw new Error('Missing required argument: --out <path>');
        }
        buildZip({ mode, out, env: process.env });
    } catch (err) {
        if (mode === 'dev') {
            console.warn(`[build-zip] Warning: ${err.message}`);
            process.exit(0);
        } else {
            console.error(`[build-zip] Error: ${err.message}`);
            process.exit(1);
        }
    }
}
