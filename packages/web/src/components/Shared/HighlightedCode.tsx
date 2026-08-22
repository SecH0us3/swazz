// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import type { ReactNode } from 'react';

type TokenType = 'comment' | 'string' | 'number' | 'boolean' | 'null' | 'property' | 'keyword' | 'function' | 'operator' | 'punctuation' | 'url';

interface Token {
    type: TokenType;
    value: string;
}

const TOKEN_TYPES: Record<TokenType, string> = {
    comment: 'comment',
    string: 'string',
    number: 'number',
    boolean: 'boolean',
    null: 'null',
    property: 'property',
    keyword: 'keyword',
    function: 'function',
    operator: 'operator',
    punctuation: 'punctuation',
    url: 'url'
};

function tokenizeJson(code: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < code.length) {
        const ch = code[i];
        if (ch === '"') {
            const start = i;
            i++;
            while (i < code.length && code[i] !== '"') {
                if (code[i] === '\\') i++;
                i++;
            }
            i++;
            const value = code.slice(start, i);
            const isProperty = i < code.length && code[i] === ':';
            tokens.push({ type: isProperty ? 'property' : 'string', value });
        } else if (ch === '-' || (ch >= '0' && ch <= '9')) {
            const start = i;
            while (i < code.length && /[0-9.eE+\-]/.test(code[i])) i++;
            tokens.push({ type: 'number', value: code.slice(start, i) });
        } else if (code.startsWith('true', i) || code.startsWith('false', i)) {
            const start = i;
            i += code.startsWith('true', i) ? 4 : 5;
            tokens.push({ type: 'boolean', value: code.slice(start, i) });
        } else if (code.startsWith('null', i)) {
            tokens.push({ type: 'null', value: 'null' });
            i += 4;
        } else if ('{}[],:'.includes(ch)) {
            tokens.push({ type: 'punctuation', value: ch });
            i++;
        } else if (/[a-zA-Z]/.test(ch)) {
            const start = i;
            while (i < code.length && /[a-zA-Z]/.test(code[i])) i++;
            tokens.push({ type: 'operator', value: code.slice(start, i) });
        } else {
            const start = i;
            while (i < code.length && !'"{}[],:-0123456789'.includes(code[i]) && !/[a-zA-Z]/.test(code[i])) i++;
            tokens.push({ type: 'operator', value: code.slice(start, i) });
        }
    }
    return tokens;
}

function tokenizeBash(code: string): Token[] {
    const tokens: Token[] = [];
    const lines = code.split('\n');
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        if (line.trimStart().startsWith('#')) {
            tokens.push({ type: 'comment', value: line });
            if (lineIndex < lines.length - 1) {
                tokens.push({ type: 'operator', value: '\n' });
            }
            continue;
        }
        let i = 0;
        while (i < line.length) {
            const ch = line[i];
            if (ch === '#' && (i === 0 || line[i - 1] === ' ')) {
                tokens.push({ type: 'comment', value: line.slice(i) });
                break;
            }
            if (ch === '"' || ch === "'") {
                const quote = ch;
                const start = i;
                i++;
                while (i < line.length && line[i] !== quote) {
                    if (line[i] === '\\') i++;
                    i++;
                }
                i++;
                tokens.push({ type: 'string', value: line.slice(start, i) });
            } else if (ch === '-' && line[i + 1] === '-') {
                const start = i;
                while (i < line.length && !' \t'.includes(line[i])) i++;
                tokens.push({ type: 'keyword', value: line.slice(start, i) });
            } else if (ch === 'h' && line.startsWith('https://', i)) {
                const start = i;
                while (i < line.length && !' \t'.includes(line[i])) i++;
                tokens.push({ type: 'url', value: line.slice(start, i) });
            } else if (/[a-zA-Z_]/.test(ch)) {
                const start = i;
                while (i < line.length && /[a-zA-Z0-9_\-]/.test(line[i])) i++;
                const word = line.slice(start, i);
                if (word === 'export' || word === 'return' || word === 'async' || word === 'await' || word === 'const' || word === 'new' || word === 'if' || word === 'else' || word === 'function' || word === 'default') {
                    tokens.push({ type: 'keyword', value: word });
                } else if (word === 'true' || word === 'false') {
                    tokens.push({ type: 'boolean', value: word });
                } else if (word === 'null') {
                    tokens.push({ type: 'null', value: word });
                } else if (i < line.length && line[i] === '(') {
                    tokens.push({ type: 'function', value: word });
                } else {
                    tokens.push({ type: 'operator', value: word });
                }
            } else if ('|&;(){}'.includes(ch)) {
                tokens.push({ type: 'operator', value: ch });
                i++;
            } else {
                const start = i;
                while (i < line.length && !' |&;(){}"\'#-'.includes(line[i]) && !/[a-zA-Z0-9_]/.test(line[i])) i++;
                if (i === start) i++;
                tokens.push({ type: 'operator', value: line.slice(start, i) });
            }
        }
        if (lineIndex < lines.length - 1) {
            tokens.push({ type: 'operator', value: '\n' });
        }
    }
    return tokens;
}

function tokenize(code: string, language: string): Token[] {
    if (language === 'json') {
        return tokenizeJson(code);
    }
    return tokenizeBash(code);
}

export interface HighlightedCodeProps {
    code: string;
    language: 'json' | 'bash';
}

export function HighlightedCode({ code, language }: HighlightedCodeProps) {
    const tokens = tokenize(code, language);
    const nodes: ReactNode[] = [];
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        if (token.value === '\n') {
            nodes.push('\n');
            continue;
        }
        nodes.push(
            <span key={i} className={`token ${TOKEN_TYPES[token.type]}`}>
                {token.value}
            </span>
        );
    }
    return <>{nodes}</>;
}
