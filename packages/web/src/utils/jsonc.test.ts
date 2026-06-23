import { describe, it, expect } from 'vitest';
import { stripJSONC } from './jsonc.js';

describe('stripJSONC utility', () => {
    it('should keep plain JSON unchanged and preserve its length', () => {
        const input = '{"a": 1, "b": "hello"}';
        const output = stripJSONC(input);
        expect(output).toBe(input);
        expect(output.length).toBe(input.length);
    });

    it('should strip single-line comments and preserve length', () => {
        const input = `{\n  // this is a comment\n  "a": 1\n}`;
        const output = stripJSONC(input);
        // Comments should be replaced with spaces, keeping newlines
        expect(output).toBe(`{\n                      \n  "a": 1\n}`);
        expect(output.length).toBe(input.length);
        expect(JSON.parse(output)).toEqual({ a: 1 });
    });

    it('should strip inline single-line comments', () => {
        const input = `{\n  "a": 1 // some comment\n}`;
        const output = stripJSONC(input);
        expect(output).toBe(`{\n  "a": 1                \n}`);
        expect(output.length).toBe(input.length);
        expect(JSON.parse(output)).toEqual({ a: 1 });
    });

    it('should strip multi-line block comments and preserve line endings', () => {
        const input = `{\n  /*\n  block\n  comment\n  */\n  "a": 1\n}`;
        const output = stripJSONC(input);
        expect(output).toBe(`{\n    \n       \n         \n    \n  "a": 1\n}`);
        expect(output.length).toBe(input.length);
        expect(JSON.parse(output)).toEqual({ a: 1 });
    });

    it('should ignore comment characters inside string values', () => {
        const input = '{"url": "http://example.com/path", "text": "/* not comment */", "slash": "// not comment"}';
        const output = stripJSONC(input);
        expect(output).toBe(input);
        expect(output.length).toBe(input.length);
        expect(JSON.parse(output)).toEqual({
            url: "http://example.com/path",
            text: "/* not comment */",
            slash: "// not comment"
        });
    });

    it('should handle nested escaped quotes and other escape sequences', () => {
        const input = '{"text": "hello \\"world // comment? no\\"!"}';
        const output = stripJSONC(input);
        expect(output).toBe(input);
        expect(output.length).toBe(input.length);
        expect(JSON.parse(output)).toEqual({
            text: 'hello "world // comment? no"!'
        });
    });

    it('should handle empty input gracefully', () => {
        const input = '';
        const output = stripJSONC(input);
        expect(output).toBe('');
    });

    it('should handle trailing potential comment slash', () => {
        const input = '{"a": 1}/';
        const output = stripJSONC(input);
        expect(output).toBe('{"a": 1}/');
    });

    it('should handle multiple asterisks in block comments', () => {
        const input = '{"a": 1} /***/';
        const output = stripJSONC(input);
        expect(output).toBe('{"a": 1}      ');
        expect(output.length).toBe(input.length);
    });

    it('should handle empty block comments', () => {
        const input = '{"a": 1} /**/';
        const output = stripJSONC(input);
        expect(output).toBe('{"a": 1}     ');
        expect(output.length).toBe(input.length);
    });
});
