// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { DOCS, DOCS_URL, docsUrl } from './docsLinks.js';

const docsDir = join(__dirname, '..', '..', '..', '..', 'docs');
const srcDir = join(__dirname, '..');

// Resolves a documentation-site URL to its markdown source and checks that the
// page exists and, if an anchor is given, that a heading declares it as `{#id}`.
function brokenReason(url: string): string | null {
    const rest = url.slice(DOCS_URL.length);
    const [file, anchor] = rest.split('#');
    const page = file === '' ? 'index' : file.replace(/\.html$/, '');
    const md = join(docsDir, `${page}.md`);
    if (!existsSync(md)) return `no docs/${page}.md`;
    if (anchor && !readFileSync(md, 'utf8').includes(`{#${anchor}}`)) return `no {#${anchor}} heading in docs/${page}.md`;
    return null;
}

describe('docsLinks', () => {
    it('builds page and anchor URLs', () => {
        expect(docsUrl('usage')).toBe('https://sech0us3.github.io/swazz/usage.html');
        expect(docsUrl('usage', 'auth-sequence')).toBe('https://sech0us3.github.io/swazz/usage.html#auth-sequence');
    });

    it('points every DOCS entry at an existing page and explicit anchor', () => {
        const broken = Object.entries(DOCS)
            .map(([key, url]) => [key, brokenReason(url)] as const)
            .filter(([, reason]) => reason !== null);
        expect(broken).toEqual([]);
    });

    it('has no hard-coded docs-site URLs with dead anchors anywhere in the web source', () => {
        const files: string[] = [];
        const walk = (dir: string) => {
            for (const name of readdirSync(dir)) {
                const path = join(dir, name);
                if (statSync(path).isDirectory()) walk(path);
                else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) files.push(path);
            }
        };
        walk(srcDir);
        const broken: string[] = [];
        for (const file of files) {
            for (const match of readFileSync(file, 'utf8').matchAll(/https:\/\/sech0us3\.github\.io\/swazz\/[^'"`\s)]*/gi)) {
                const reason = brokenReason(match[0].replace(/^https:\/\/sech0us3\.github\.io\/swazz\//i, DOCS_URL));
                if (reason) broken.push(`${file.slice(srcDir.length)}: ${match[0]} (${reason})`);
            }
        }
        expect(broken).toEqual([]);
    });
});
