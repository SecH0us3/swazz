/** Normalize a string into a lowercase slug suitable for grouping keys. */
export function slugify(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

export function cleanErrorMessage(msg: string): string {
    if (!msg) return 'Unknown Error';
    
    // Take only the first line of multi-line error messages/stacktraces
    let firstLine = msg.split('\n')[0].trim();
    
    // Replace UUIDs/GUIDs to group dynamic paths/resources together
    const guidRegex = /[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/g;
    firstLine = firstLine.replace(guidRegex, '<guid>');
    
    // Detect specific Postgres / Npgsql errors
    if (firstLine.includes('Npgsql.PostgresException')) {
        let part = firstLine.replace(/^Npgsql\.PostgresException\s*\([^)]*\):?/, '').trim();
        // Strip leading error code if present, e.g. "22021:"
        part = part.replace(/^\d+:\s*/, '').trim();
        return `Postgres Error: ${part}`;
    }
    
    // Detect unique constraint violations (e.g. Postgres duplicate key)
    if (firstLine.includes('duplicate key value violates unique constraint')) {
        const match = firstLine.match(/violates unique constraint "([^"]+)"/);
        if (match) {
            return `Unique Constraint Violation: ${match[1]}`;
        }
        return 'Unique Constraint Violation';
    }

    // Detect foreign key violations
    if (firstLine.includes('violates foreign key constraint')) {
        const match = firstLine.match(/violates foreign key constraint "([^"]+)"/);
        if (match) {
            return `Foreign Key Violation: ${match[1]}`;
        }
        return 'Foreign Key Violation';
    }
    
    // Detect standard exception patterns (e.g. System.NullReferenceException: ...)
    const excMatch = firstLine.match(/^(?:[a-zA-Z0-9_]+\.)*([a-zA-Z0-9_]+Exception):\s*(.*)$/);
    if (excMatch) {
        const type = excMatch[1];
        let detail = excMatch[2].trim();
        
        // Specific cleanup for common HTTP/Network exceptions
        if (type === 'HttpRequestException' && detail.includes('status code does not indicate success:')) {
            const statusMatch = detail.match(/(\d+)\s*\(([^)]+)\)/);
            if (statusMatch) {
                return `${type}: ${statusMatch[1]} ${statusMatch[2]}`;
            }
        }
        
        if (detail.length > 60) {
            detail = detail.substring(0, 57) + '...';
        }
        return `${type}: ${detail}`;
    }

    // Replace long numeric IDs to avoid over-grouping (e.g. "Order 12345" vs "Order 67890")
    // Applied AFTER specific parsers so error codes (like Postgres 22021) are handled first.
    firstLine = firstLine.replace(/\b\d{4,}\b/g, '<id>');

    // Default truncation for long single-line error messages
    if (firstLine.length > 80) {
        return firstLine.substring(0, 77) + '...';
    }
    return firstLine;
}

const nullPointerRegexes = [
    /System\.NullReferenceException/i,
    /NullPointerException/i,
    /nil pointer dereference/i,
    /NoneType' object/i,
    /Cannot read propert(y|ies) of (null|undefined)/i,
    /Call to a member function .* on null/i,
    /Attempt to read property .* on null/i,
    /undefined method .* for nil:NilClass/i
];

export function isNullPointerException(text: string): boolean {
    return nullPointerRegexes.some(r => r.test(text));
}

export function extractErrorSubtype(responsePreview: string | undefined): { title: string; key: string } | null {
    if (!responsePreview) return null;
    
    try {
        let body = JSON.parse(responsePreview);
        while (typeof body === 'string') {
            try {
                body = JSON.parse(body);
            } catch {
                break;
            }
        }

        if (body && typeof body === 'object') {
            // Check for MCP Error
            if (body.isError === true && body.content && Array.isArray(body.content)) {
                const txt = body.content.find((c: any) => c.type === 'text');
                if (txt) {
                    let textStr = '';
                    if (typeof txt.text === 'object') {
                        textStr = txt.text.message || JSON.stringify(txt.text);
                    } else if (typeof txt.text === 'string') {
                        textStr = txt.text;
                    }
                    
                    if (textStr) {
                        const mcpCodeMatch = textStr.match(/MCP error (-?\d+):?\s*(.*)/i);
                        if (mcpCodeMatch) {
                            const codeNum = mcpCodeMatch[1];
                            const codeMsg = cleanErrorMessage(mcpCodeMatch[2]);
                            return {
                                title: `MCP Error ${codeNum}: ${codeMsg}`,
                                key: `mcp_error_${codeNum}_${slugify(codeMsg)}`,
                            };
                        }
                        
                        const cleanMsg = cleanErrorMessage(textStr);
                        return {
                            title: `MCP Tool Error: ${cleanMsg}`,
                            key: `mcp_tool_error_${slugify(cleanMsg)}`,
                        };
                    }
                }
            }

            // Check for NPE in any top-level string values first to prevent false positives in raw text
            const hasNPE = Object.values(body).some(v => typeof v === 'string' && isNullPointerException(v));
            if (hasNPE) {
                return {
                    title: 'Null Reference Exception',
                    key: 'null_reference_exception',
                };
            }
            // 1. Exception Type + Message (e.g. ContractValidation: InvalidToken)
            if (body.exceptionType) {
                const rawMsg = body.message || 'UnknownException';
                const msg = cleanErrorMessage(rawMsg);
                // If it's a generic exception wrapper like 'apierror', and we parsed a more specific exception class, omit 'apierror'
                if (body.exceptionType.toLowerCase() === 'apierror' && msg.includes('Exception:')) {
                    return {
                        title: msg,
                        key: slugify(msg),
                    };
                }
                return {
                    title: `${body.exceptionType}: ${msg}`,
                    key: `${body.exceptionType.toLowerCase()}_${slugify(msg)}`,
                };
            }
            // 2. Validation details (ASP.NET Core validation)
            if (body.errors && typeof body.errors === 'object') {
                const keys = Object.keys(body.errors);
                if (keys.length > 0) {
                    const firstKey = keys[0];
                    return {
                        title: `Validation Error: ${firstKey}`,
                        key: `val_err_${firstKey.toLowerCase()}`,
                    };
                }
            }
            // 3. Simple message or error fields
            if (body.message && typeof body.message === 'string') {
                const msg = cleanErrorMessage(body.message);
                return {
                    title: msg,
                    key: `msg_${slugify(msg)}`,
                };
            }
            if (body.error && typeof body.error === 'string') {
                const err = cleanErrorMessage(body.error);
                return {
                    title: err,
                    key: `err_${slugify(err)}`,
                };
            }
            if (body.title && typeof body.title === 'string') {
                const titleText = cleanErrorMessage(body.title);
                return {
                    title: titleText,
                    key: `title_${slugify(titleText)}`,
                };
            }
        } else if (typeof body === 'string') {
            const mcpCodeMatch = body.match(/MCP error (-?\d+):?\s*(.*)/i);
            if (mcpCodeMatch) {
                const codeNum = mcpCodeMatch[1];
                const codeMsg = cleanErrorMessage(mcpCodeMatch[2]);
                return {
                    title: `MCP Error ${codeNum}: ${codeMsg}`,
                    key: `mcp_error_${codeNum}_${slugify(codeMsg)}`,
                };
            }
        }
    } catch {
        // Ignore JSON parsing errors and fall back to raw string checks
    }

    if (responsePreview) {
        const mcpCodeMatch = responsePreview.match(/MCP error (-?\d+):?\s*(.*)/i);
        if (mcpCodeMatch) {
            const codeNum = mcpCodeMatch[1];
            const codeMsg = cleanErrorMessage(mcpCodeMatch[2]);
            return {
                title: `MCP Error ${codeNum}: ${codeMsg}`,
                key: `mcp_error_${codeNum}_${slugify(codeMsg)}`,
            };
        }
    }

    if (isNullPointerException(responsePreview)) {
        return {
            title: 'Null Reference Exception',
            key: 'null_reference_exception',
        };
    }

    return null;
}

export function getCleanDedupeKey(method: string, endpoint: string, status: number, errorMsg?: string): string {
    let cleanErr = errorMsg || '';
    
    // 1. Remove Cloudflare Ray IDs
    cleanErr = cleanErr.replace(/Ray ID:?\s*[a-z0-9]+/gi, 'Ray ID: [REDACTED]');
    cleanErr = cleanErr.replace(/Ray ID\s*<strong[^>]*>[a-z0-9]+<\/strong>/gi, 'Ray ID: [REDACTED]');
    
    // 2. Remove UUIDs
    cleanErr = cleanErr.replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '[UUID]');
    
    // 3. Remove common dynamic parts like timestamps or session IDs
    cleanErr = cleanErr.replace(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/gi, '[TIMESTAMP]');
    cleanErr = cleanErr.replace(/\d{10,13}/g, '[TIMESTAMP_MS]');
    
    // 4. Limit length or keep only first line if it's a huge HTML error page
    if (cleanErr.includes('<!DOCTYPE html>') || cleanErr.includes('<html')) {
        cleanErr = 'HTML Error Page';
    } else {
        // Just take the first 150 characters to avoid noise from different stack traces/IDs
        cleanErr = cleanErr.slice(0, 150);
    }
    
    return `${method} ${endpoint}::${status}::${cleanErr}`;
}

