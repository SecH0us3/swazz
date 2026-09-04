// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect } from 'vitest';
import { tokenizeCode } from './syntaxHighlight.js';

describe('syntaxHighlight', () => {
    describe('json language', () => {
        it('tokenizes key, string value, boolean, and number with reconstruction', () => {
            const jsonCode = '{\n  "name": "swazz",\n  "active": true,\n  "count": 42\n}';
            const tokens = tokenizeCode(jsonCode, 'json');

            // Find key token
            const keyToken = tokens.find((t) => t.text.includes('"name"'));
            expect(keyToken).toBeDefined();
            expect(keyToken?.className).toBe('tok-key');

            // Find string value token
            const strToken = tokens.find((t) => t.text === '"swazz"');
            expect(strToken).toBeDefined();
            expect(strToken?.className).toBe('tok-str');

            // Find boolean token
            const boolToken = tokens.find((t) => t.text === 'true');
            expect(boolToken).toBeDefined();
            expect(boolToken?.className).toBe('tok-key');

            // Find number token
            const numToken = tokens.find((t) => t.text === '42');
            expect(numToken).toBeDefined();
            expect(numToken?.className).toBe('tok-fn');

            // Reconstruction property holds byte-for-byte
            expect(tokens.map((t) => t.text).join('')).toBe(jsonCode);
        });

        it('reconstructs sample inputs byte-for-byte (sample 1: empty object and arrays)', () => {
            const code = '{"rules": [], "details": null, "negative": -3.14}';
            const tokens = tokenizeCode(code, 'json');
            expect(tokens.map((t) => t.text).join('')).toBe(code);

            const nullToken = tokens.find((t) => t.text === 'null');
            expect(nullToken?.className).toBe('tok-key');

            const numToken = tokens.find((t) => t.text === '-3.14');
            expect(numToken?.className).toBe('tok-fn');
        });

        it('reconstructs sample inputs byte-for-byte (sample 2: AWS WAF JSON snippet)', () => {
            const awsJson = '{\n  "Name": "AWS-AWSManagedRulesCommonRuleSet",\n  "Priority": 0,\n  "OverrideAction": { "None": {} }\n}';
            const tokens = tokenizeCode(awsJson, 'json');
            expect(tokens.map((t) => t.text).join('')).toBe(awsJson);
        });
    });

    describe('generic language', () => {
        it('tokenizes Terraform snippet: resource and enabled as tok-fn, quoted strings as tok-str', () => {
            const tfSnippet = 'resource "cloudflare_ruleset" "x" { enabled = true }';
            const tokens = tokenizeCode(tfSnippet, 'generic');

            // resource and enabled get tok-fn
            const resourceToken = tokens.find((t) => t.text === 'resource');
            expect(resourceToken).toBeDefined();
            expect(resourceToken?.className).toBe('tok-fn');

            const enabledToken = tokens.find((t) => t.text === 'enabled');
            expect(enabledToken).toBeDefined();
            expect(enabledToken?.className).toBe('tok-fn');

            // quoted strings get tok-str
            const str1 = tokens.find((t) => t.text === '"cloudflare_ruleset"');
            expect(str1).toBeDefined();
            expect(str1?.className).toBe('tok-str');

            const str2 = tokens.find((t) => t.text === '"x"');
            expect(str2).toBeDefined();
            expect(str2?.className).toBe('tok-str');

            // Reconstruction property holds byte-for-byte
            expect(tokens.map((t) => t.text).join('')).toBe(tfSnippet);
        });

        it('tokenizes Wirefilter snippet with comment: comment as tok-key, keywords as tok-fn, strings as tok-str', () => {
            const wfSnippet = '# Block SQLi bypass\nhttp.request.uri.query contains "1\' OR \'1\'=\'1"';
            const tokens = tokenizeCode(wfSnippet, 'generic');

            // comment gets tok-key
            const commentToken = tokens.find((t) => t.text.startsWith('#'));
            expect(commentToken).toBeDefined();
            expect(commentToken?.className).toBe('tok-key');

            // keyword contains gets tok-fn
            const containsToken = tokens.find((t) => t.text === 'contains');
            expect(containsToken).toBeDefined();
            expect(containsToken?.className).toBe('tok-fn');

            // quoted string gets tok-str
            const strToken = tokens.find((t) => t.text === '"1\' OR \'1\'=\'1"');
            expect(strToken).toBeDefined();
            expect(strToken?.className).toBe('tok-str');

            // Reconstruction property holds byte-for-byte
            expect(tokens.map((t) => t.text).join('')).toBe(wfSnippet);
        });

        it('does not treat hyphenated identifiers like rule-cf as standalone keywords', () => {
            const code = 'rule-cf';
            const tokens = tokenizeCode(code, 'generic');
            expect(tokens).toEqual([{ text: 'rule-cf' }]);
            expect(tokens[0].className).toBeUndefined();
        });

        it('reconstructs sample inputs byte-for-byte (sample 1: ModSecurity SecRule with phase:1 and deny)', () => {
            const secRuleCode = 'SecRule REQUEST_URI "@contains test" "id:1001,phase:1,deny,status:403"';
            const tokens = tokenizeCode(secRuleCode, 'generic');
            expect(tokens.map((t) => t.text).join('')).toBe(secRuleCode);

            const secRuleToken = tokens.find((t) => t.text === 'SecRule');
            expect(secRuleToken?.className).toBe('tok-fn');
        });

        it('reconstructs sample inputs byte-for-byte (sample 2: Nginx config with proxy_pass and // comments)', () => {
            const nginxCode = '// Nginx upstream configuration\nlocation /api/ {\n  proxy_pass http://backend;\n  return 200;\n}';
            const tokens = tokenizeCode(nginxCode, 'generic');
            expect(tokens.map((t) => t.text).join('')).toBe(nginxCode);

            const commentToken = tokens.find((t) => t.text.startsWith('//'));
            expect(commentToken?.className).toBe('tok-key');

            const locationToken = tokens.find((t) => t.text === 'location');
            expect(locationToken?.className).toBe('tok-fn');

            const proxyPassToken = tokens.find((t) => t.text === 'proxy_pass');
            expect(proxyPassToken?.className).toBe('tok-fn');

            const numToken = tokens.find((t) => t.text === '200');
            expect(numToken?.className).toBe('tok-fn');
        });
    });

    describe('edge cases', () => {
        it('returns empty array for empty string', () => {
            expect(tokenizeCode('', 'json')).toEqual([]);
            expect(tokenizeCode('', 'generic')).toEqual([]);
        });

        it('handles plain text without matching tokens', () => {
            const plain = 'abcdef';
            const tokens = tokenizeCode(plain, 'generic');
            expect(tokens).toEqual([{ text: 'abcdef' }]);
            expect(tokens[0].className).toBeUndefined();
        });
    });
});
