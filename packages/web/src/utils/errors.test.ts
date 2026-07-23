import { describe, it, expect } from 'vitest';
import { cleanErrorMessage, extractErrorSubtype, getCleanDedupeKey } from './errors.js';

describe('errors utility', () => {
    describe('getCleanDedupeKey', () => {
        it('should format dedupe key with clean error message', () => {
            const key = getCleanDedupeKey('POST', '/api/test', 400, 'Invalid parameter');
            expect(key).toBe('POST /api/test::400::Invalid parameter');
        });

        it('should handle undefined or empty error message', () => {
            const key = getCleanDedupeKey('GET', '/api/test', 500);
            expect(key).toBe('GET /api/test::500::');
        });

        it('should redact Cloudflare Ray IDs', () => {
            const key = getCleanDedupeKey('GET', '/api/test', 502, 'Bad Gateway Ray ID: 88f29d8a1c900000');
            expect(key).toBe('GET /api/test::502::Bad Gateway Ray ID: [REDACTED]');
        });

        it('should replace UUIDs', () => {
            const key = getCleanDedupeKey('POST', '/api/users', 404, 'User 12345678-1234-1234-1234-123456789abc not found');
            expect(key).toBe('POST /api/users::404::User [UUID] not found');
        });

        it('should replace ISO timestamps and millisecond timestamps', () => {
            const key = getCleanDedupeKey('POST', '/api/log', 500, 'Error at 2026-07-22T22:50:00.123Z (epoch 1784760600000)');
            expect(key).toBe('POST /api/log::500::Error at [TIMESTAMP] (epoch [TIMESTAMP_MS])');
        });

        it('should simplify HTML error pages', () => {
            const key = getCleanDedupeKey('GET', '/api/error', 500, '<!DOCTYPE html><html><head><title>500 Internal Server Error</title></head></html>');
            expect(key).toBe('GET /api/error::500::HTML Error Page');
        });

        it('should truncate long error messages to 150 chars', () => {
            const longMsg = 'A'.repeat(200);
            const key = getCleanDedupeKey('GET', '/api/long', 400, longMsg);
            expect(key).toBe(`GET /api/long::400::${'A'.repeat(150)}`);
        });
    });

    describe('cleanErrorMessage', () => {
        it('should return Unknown Error for falsy values', () => {
            expect(cleanErrorMessage('')).toBe('Unknown Error');
        });

        it('should clean Postgres exception details', () => {
            const msg = 'Npgsql.PostgresException (0x80004005): 22021: invalid byte sequence for encoding "UTF8": 0x00\n at some stacktrace';
            expect(cleanErrorMessage(msg)).toBe('Postgres Error: invalid byte sequence for encoding "UTF8": 0x00');
        });

        it('should parse unique constraint violation', () => {
            const msg = 'duplicate key value violates unique constraint "users_email_key"\n at db';
            expect(cleanErrorMessage(msg)).toBe('Unique Constraint Violation: users_email_key');
        });

        it('should parse foreign key violation', () => {
            const msg = 'violates foreign key constraint "orders_user_id_fkey"\n at db';
            expect(cleanErrorMessage(msg)).toBe('Foreign Key Violation: orders_user_id_fkey');
        });

        it('should clean C# NullReferenceException', () => {
            const msg = 'System.NullReferenceException: Object reference not set to an instance of an object.\n   at Auth.Teams.API.AddAvatarToInvite.Handle(AddAvatarToInviteContract contract) in UploadInviteAvatarRequestHandler.cs:line 51';
            expect(cleanErrorMessage(msg)).toBe('NullReferenceException: Object reference not set to an instance of an object.');
        });

        it('should clean C# HttpRequestException status 404', () => {
            const msg = 'System.Net.Http.HttpRequestException: Response status code does not indicate success: 404 (Not Found).\n   at System.Net.Http.HttpResponseMessage.EnsureSuccessStatusCode()';
            expect(cleanErrorMessage(msg)).toBe('HttpRequestException: 404 Not Found');
        });

        it('should replace GUIDs with <guid>', () => {
            const msg = 'Transaction with ID a20cbf2f-b522-4d69-bc41-6a7eac5cb9ce not found.';
            expect(cleanErrorMessage(msg)).toBe('Transaction with ID <guid> not found.');
        });
    });

    describe('extractErrorSubtype', () => {
        it('should return null for non-JSON or invalid preview', () => {
            expect(extractErrorSubtype('invalid json')).toBeNull();
            expect(extractErrorSubtype(undefined)).toBeNull();
        });

        it('should extract error subtype for generic apierror wrapping C# exceptions', () => {
            const preview = JSON.stringify({
                exceptionType: 'apierror',
                message: 'System.NullReferenceException: Object reference not set to an instance of an object.\n   at Auth.Teams.API...'
            });
            const result = extractErrorSubtype(preview);
            expect(result).not.toBeNull();
            expect(result?.title).toBe('Null Reference Exception');
            expect(result?.key).toBe('null_reference_exception');
        });

        it('should detect Java NullPointerException', () => {
            const preview = 'java.lang.NullPointerException: Cannot invoke "String.length()" because "s" is null';
            const result = extractErrorSubtype(preview);
            expect(result).not.toBeNull();
            expect(result?.title).toBe('Null Reference Exception');
            expect(result?.key).toBe('null_reference_exception');
        });

        it('should detect Go nil pointer dereference', () => {
            const preview = 'panic: runtime error: invalid memory address or nil pointer dereference';
            const result = extractErrorSubtype(preview);
            expect(result).not.toBeNull();
            expect(result?.title).toBe('Null Reference Exception');
            expect(result?.key).toBe('null_reference_exception');
        });

        it('should extract error subtype for generic apierror wrapping HttpRequestException', () => {
            const preview = JSON.stringify({
                exceptionType: 'apierror',
                message: 'System.Net.Http.HttpRequestException: Response status code does not indicate success: 404 (Not Found).\n   at ensure...'
            });
            const result = extractErrorSubtype(preview);
            expect(result).not.toBeNull();
            expect(result?.title).toBe('HttpRequestException: 404 Not Found');
            expect(result?.key).toBe('httprequestexception_404_not_found');
        });

        it('should fallback to default formatting if no C# exception signature matches', () => {
            const preview = JSON.stringify({
                exceptionType: 'apierror',
                message: 'Some other weird issue occurred'
            });
            const result = extractErrorSubtype(preview);
            expect(result).not.toBeNull();
            expect(result?.title).toBe('apierror: Some other weird issue occurred');
        });

        it('should extract error subtype with normalized GUIDs', () => {
            const preview = JSON.stringify({
                exceptionType: 'ContractValidation',
                message: 'Transaction with ID a20cbf2f-b522-4d69-bc41-6a7eac5cb9ce not found.'
            });
            const result = extractErrorSubtype(preview);
            expect(result).not.toBeNull();
            expect(result?.title).toBe('ContractValidation: Transaction with ID <guid> not found.');
            expect(result?.key).toBe('contractvalidation_transaction_with_id_guid_not_found_');
        });
    });
});
