// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { HighlightedCode } from './HighlightedCode.js';

describe('HighlightedCode', () => {
    it('highlights JSON keys, strings, numbers, booleans, and null', () => {
        render(<HighlightedCode code={'{"id": 1, "name": "admin", "active": true, "meta": null}'} language="json" />);
        expect(document.querySelector('.token.property')).not.toBeNull();
        expect(document.querySelector('.token.number')).not.toBeNull();
        expect(document.querySelector('.token.string')).not.toBeNull();
        expect(document.querySelector('.token.boolean')).not.toBeNull();
        expect(document.querySelector('.token.null')).not.toBeNull();
        expect(screen.getByText('"id"')).toBeDefined();
    });

    it('highlights bash comments, flags, and URLs', () => {
        render(<HighlightedCode code={'# install\nswazz scan --spec https://x/swagger.json'} language="bash" />);
        expect(document.querySelector('.token.comment')).not.toBeNull();
        expect(document.querySelector('.token.keyword')).not.toBeNull();
        expect(document.querySelector('.token.url')).not.toBeNull();
    });

    it('highlights JS keywords and function calls in worker snippet', () => {
        render(<HighlightedCode code={'export default {\n  async fetch(request, env) {\n    return await env.SWAZZ_COORDINATOR.fetch(request);\n  }\n}'} language="bash" />);
        expect(document.querySelector('.token.keyword')).not.toBeNull();
        expect(document.querySelector('.token.function')).not.toBeNull();
    });

    it('preserves newlines between tokens', () => {
        const { container } = render(<HighlightedCode code={'# a\n# b'} language="bash" />);
        expect(container.textContent).toBe('# a\n# b');
    });
});
