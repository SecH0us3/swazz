// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

export type CodeLang = 'json' | 'generic';

export interface CodeToken {
    text: string;
    className?: string; // one of 'tok-key' | 'tok-str' | 'tok-fn', or undefined for plain text
}

const JSON_REGEX = /(?<key>"(?:\\.|[^"\\])*"\s*:)|(?<str>"(?:\\.|[^"\\])*")|(?<bool>\b(?:true|false|null)\b)|(?<num>-?\b\d+(?:\.\d+)?\b)/g;

const GENERIC_KEYWORDS = [
    'resource', 'variable', 'output', 'locals', 'provider', 'terraform', 'module',
    'rule', 'rules', 'action', 'block', 'description', 'kind', 'phase', 'enabled',
    'ref', 'expression', 'name', 'zone_id', 'and', 'or', 'not', 'contains',
    'matches', 'lower', 'deny', 'allow', 'pass', 'drop', 'SecRule', 'SecAction',
    'SecRuleEngine', 'chain', 'phase:1', 'phase:2', 'log', 'nolog', 'id', 'msg',
    'severity', 'server', 'location', 'listen', 'return', 'root', 'proxy_pass',
    'if', 'then', 'else',
];

const KEYWORDS_PATTERN = GENERIC_KEYWORDS.slice()
    .sort((a, b) => b.length - a.length)
    .join('|');

const GENERIC_REGEX = new RegExp(
    '(?<comment>(?://|#)[^\\n]*)' +
    '|(?<str>"(?:\\\\.|[^"\\\\])*"|\'(?:\\\\.|[^\'\\\\])*\')' +
    `|(?<kw>(?<![\\w-])(?:${KEYWORDS_PATTERN})(?![\\w-]))` +
    '|(?<num>-?\\b\\d+(?:\\.\\d+)?\\b)',
    'g'
);

function getClassName(match: RegExpExecArray, lang: CodeLang): string | undefined {
    const groups = match.groups;
    if (!groups) return undefined;

    if (lang === 'json') {
        if (groups.key) return 'tok-key';
        if (groups.str) return 'tok-str';
        if (groups.bool) return 'tok-key';
        if (groups.num) return 'tok-fn';
    } else {
        if (groups.comment) return 'tok-key';
        if (groups.str) return 'tok-str';
        if (groups.kw) return 'tok-fn';
        if (groups.num) return 'tok-fn';
    }

    return undefined;
}

export function tokenizeCode(code: string, lang: CodeLang): CodeToken[] {
    if (!code) {
        return [];
    }

    const regex = lang === 'json' ? JSON_REGEX : GENERIC_REGEX;
    regex.lastIndex = 0;

    const tokens: CodeToken[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(code)) !== null) {
        if (match.index > lastIndex) {
            tokens.push({ text: code.slice(lastIndex, match.index) });
        }

        const text = match[0];
        const className = getClassName(match, lang);
        if (className) {
            tokens.push({ text, className });
        } else {
            tokens.push({ text });
        }

        lastIndex = match.index + text.length;
        if (text.length === 0) {
            regex.lastIndex = match.index + 1;
        }
    }

    if (lastIndex < code.length) {
        tokens.push({ text: code.slice(lastIndex) });
    }

    regex.lastIndex = 0;
    return tokens;
}
