/**
 * Strips single-line (//) and multi-line (/* *\/) comments from JSON data,
 * preserving line endings and length to keep byte offsets/lines intact.
 */
export function stripJSONC(text: string): string {
    let result = '';
    let state = 0; // 0: normal, 1: string, 2: string_escape, 3: slash, 4: line_comment, 5: block_comment, 6: block_comment_star

    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        switch (state) {
            case 0: // normal
                if (char === '"') {
                    state = 1;
                    result += char;
                } else if (char === '/') {
                    state = 3;
                    result += ' ';
                } else {
                    result += char;
                }
                break;
            case 1: // string
                if (char === '\\') {
                    state = 2;
                    result += char;
                } else if (char === '"') {
                    state = 0;
                    result += char;
                } else {
                    result += char;
                }
                break;
            case 2: // string escape
                state = 1;
                result += char;
                break;
            case 3: // potential comment (previous was '/')
                if (char === '/') {
                    state = 4;
                    result += ' ';
                } else if (char === '*') {
                    state = 5;
                    result += ' ';
                } else {
                    state = 0;
                    // Restore the previous '/' and add current char
                    result = result.slice(0, -1) + '/' + char;
                }
                break;
            case 4: // line comment
                if (char === '\n') {
                    state = 0;
                    result += '\n';
                } else if (char === '\r') {
                    result += '\r';
                } else {
                    result += ' ';
                }
                break;
            case 5: // block comment
                if (char === '*') {
                    state = 6;
                    result += ' ';
                } else if (char === '\n') {
                    result += '\n';
                } else if (char === '\r') {
                    result += '\r';
                } else {
                    result += ' ';
                }
                break;
            case 6: // block comment potential end (previous was '*')
                if (char === '/') {
                    state = 0;
                    result += ' ';
                } else if (char === '*') {
                    result += ' ';
                } else if (char === '\n') {
                    state = 5;
                    result += '\n';
                } else if (char === '\r') {
                    state = 5;
                    result += '\r';
                } else {
                    state = 5;
                    result += ' ';
                }
                break;
        }
    }

    if (state === 3) {
        result = result.slice(0, -1) + '/';
    }

    return result;
}
