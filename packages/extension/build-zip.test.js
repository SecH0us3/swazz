import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';
import { buildZip } from './build-zip.mjs';

const dir = path.dirname(new URL(import.meta.url).pathname);
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf-8');

let hasZip = false;
try {
    execSync('which zip && which unzip', { stdio: 'ignore' });
    hasZip = true;
} catch {
    hasZip = false;
}

describe('build-zip', () => {
    let tmpDir;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'build-zip-test-'));
    });

    afterEach(() => {
        if (tmpDir && fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
        }
    });

    it('rejects SWAZZ_EXTENSION_URL=https://evil.example in prod mode and writes no zip', () => {
        const out = path.join(tmpDir, 'evil.zip');
        expect(() => buildZip({
            mode: 'prod',
            out,
            env: { SWAZZ_EXTENSION_URL: 'https://evil.example' }
        })).toThrow();
        expect(fs.existsSync(out)).toBe(false);
    });

    it('rejects SWAZZ_EXTENSION_URL=https://swazz.secmy.app/path (not a bare origin)', () => {
        const out = path.join(tmpDir, 'path.zip');
        expect(() => buildZip({
            mode: 'prod',
            out,
            env: { SWAZZ_EXTENSION_URL: 'https://swazz.secmy.app/path' }
        })).toThrow();
        expect(fs.existsSync(out)).toBe(false);
    });

    it.skipIf(!hasZip)('prod mode with default env produces zip with production default URL and allowlisted files', () => {
        const out = path.join(tmpDir, 'prod.zip');
        buildZip({ mode: 'prod', out, env: {} });
        expect(fs.existsSync(out)).toBe(true);

        const configContent = execSync(`unzip -p "${out}" extension/config.js`, { encoding: 'utf-8' });
        expect(configContent).toContain('https://swazz.secmy.app');

        const listing = execSync(`unzip -Z1 "${out}"`, { encoding: 'utf-8' });
        const files = listing.trim().split('\n');

        expect(files).toContain('extension/manifest.json');
        expect(files).toContain('extension/config.js');

        for (const file of files) {
            expect(file).not.toMatch(/\.test\.js$/);
            expect(file).not.toMatch(/(^|\/)package\.json$/);
            expect(file).not.toMatch(/(^|\/)build-zip\.mjs$/);
            expect(file).not.toMatch(/(^|\/)node_modules(\/|$)/);
            expect(file).not.toMatch(/(^|\/)vitest\.config\./);
            expect(file).not.toMatch(/(^|\/)coverage(\/|$)/);
        }
    });

    it.skipIf(!hasZip)('dev mode produces staged config containing http://localhost:5173', () => {
        const out = path.join(tmpDir, 'dev.zip');
        buildZip({ mode: 'dev', out });
        expect(fs.existsSync(out)).toBe(true);

        const configContent = execSync(`unzip -p "${out}" extension/config.js`, { encoding: 'utf-8' });
        expect(configContent).toContain('http://localhost:5173');
    });

    it.skipIf(!hasZip)('keeps the source packages/extension/config.js byte-identical before and after a prod build', () => {
        const before = read('config.js');
        const out = path.join(tmpDir, 'prod-byte.zip');
        buildZip({ mode: 'prod', out, env: {} });
        const after = read('config.js');
        expect(after).toBe(before);
    });
});
