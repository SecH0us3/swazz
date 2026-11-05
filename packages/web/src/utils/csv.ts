// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * Characters that make a spreadsheet treat a cell as a formula (or, for tab and CR, can be used
 * to smuggle one past a naive check). Exported values often carry attacker-influenced text, such
 * as a User-Agent recorded on a failed login, so a cell must never start with one of them.
 */
const FORMULA_TRIGGERS = /^[=+\-@\t\r]/;

/**
 * Formats one value as a quoted CSV cell that is safe to open in Excel, Sheets or LibreOffice:
 * a leading formula trigger is neutralized with a single quote (OWASP CSV injection guidance),
 * and embedded quotes are doubled.
 */
export function csvCell(value: unknown): string {
    let text = value === null || value === undefined ? '' : String(value);
    if (FORMULA_TRIGGERS.test(text)) {
        text = `'${text}`;
    }
    return `"${text.replace(/"/g, '""')}"`;
}

/** Joins rows of raw values into CSV text, every cell passed through csvCell. */
export function toCsv(rows: unknown[][], lineSeparator = '\r\n'): string {
    return rows.map(row => row.map(csvCell).join(',')).join(lineSeparator);
}
