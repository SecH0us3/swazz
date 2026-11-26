import { describe, it, expect, beforeEach } from 'vitest';
import background from './background.js';

describe('Traffic Capture logic (B1 Regression & Scope rules)', () => {
    beforeEach(() => {
        background.resetState();
    });

    it('captures an in-scope request from a different-origin tab (SPA API call regression fix)', () => {
        background.setRecording(true);
        background.setTargetDomains(['api.example.com']);

        // Tab is app.example.com, request is made to api.example.com
        const reqData = {
            url: 'https://api.example.com/v1/users/123?filter=active',
            method: 'GET',
            headers: { 'accept': 'application/json' },
            body: ''
        };
        const senderTab = {
            id: 1,
            url: 'https://app.example.com/dashboard'
        };

        background.processCapturedRequest(reqData, senderTab);

        const captured = background.getCapturedRequests();
        expect(captured['GET:api.example.com/v1/users/{id}']).toBeDefined();
        expect(captured['GET:api.example.com/v1/users/{id}'].count).toBe(1);
        expect(captured['GET:api.example.com/v1/users/{id}'].queryKeys).toContain('filter');
        expect(captured['GET:api.example.com/v1/users/{id}'].queryVariations).toContain('?filter=active');
        expect(background.getDroppedOutOfScope()).toBe(0);
    });

    it('drops out-of-scope requests and increments droppedOutOfScope counter', () => {
        background.setRecording(true);
        background.setTargetDomains(['example.com']);

        const reqData = {
            url: 'https://other-domain.org/api/data',
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{"foo":"bar"}'
        };
        const senderTab = {
            id: 2,
            url: 'https://example.com/home'
        };

        background.processCapturedRequest(reqData, senderTab);

        const captured = background.getCapturedRequests();
        expect(Object.keys(captured)).toHaveLength(0);
        expect(background.getDroppedOutOfScope()).toBe(1);
    });

    it('drops requests when targetDomains is empty and increments droppedNoScope counter', () => {
        background.setRecording(true);
        background.setTargetDomains([]);

        const reqData = {
            url: 'https://example.com/api/test',
            method: 'GET'
        };

        background.processCapturedRequest(reqData, null);

        const captured = background.getCapturedRequests();
        expect(Object.keys(captured)).toHaveLength(0);
        expect(background.getDroppedNoScope()).toBe(1);
    });

    it('drops requests when recording is disabled', () => {
        background.setRecording(false);
        background.setTargetDomains(['example.com']);

        const reqData = {
            url: 'https://example.com/api/test',
            method: 'GET'
        };

        background.processCapturedRequest(reqData, null);

        const captured = background.getCapturedRequests();
        expect(Object.keys(captured)).toHaveLength(0);
        expect(background.getDroppedOutOfScope()).toBe(0);
        expect(background.getDroppedNoScope()).toBe(0);
    });

    it('drops requests when sender.tab.url is unparseable', () => {
        background.setRecording(true);
        background.setTargetDomains(['example.com']);

        const reqData = {
            url: 'https://example.com/api/test',
            method: 'GET'
        };
        const senderTab = {
            id: 3,
            url: 'not a valid url'
        };

        background.processCapturedRequest(reqData, senderTab);

        const captured = background.getCapturedRequests();
        expect(Object.keys(captured)).toHaveLength(0);
    });
});

describe('Response correlation across tabs and frames', () => {
    beforeEach(() => {
        background.resetState();
        background.setRecording(true);
        background.setTargetDomains(['api.example.com']);
    });

    const req = (path) => ({
        url: `https://api.example.com${path}`,
        method: 'GET',
        headers: {},
        body: '',
        requestId: 3
    });

    it('does not pair a response with a same-numbered request from another tab', () => {
        // inject.js mints request ids from a per-document counter that restarts at
        // 1, so two tabs routinely produce the same raw id.
        const tabA = { tab: { id: 1, url: 'https://app.example.com/a' }, frameId: 0 };
        const tabB = { tab: { id: 2, url: 'https://app.example.com/b' }, frameId: 0 };

        background.processCapturedRequest(req('/alpha'), tabA.tab, tabA);
        background.processCapturedRequest(req('/beta'), tabB.tab, tabB);

        // Tab A answers 500; it must land on /alpha and never on /beta.
        background.processCapturedResponse(
            { requestId: 3, status: 500, statusText: 'Server Error', headers: {}, bodyText: 'boom' },
            tabA
        );

        const captured = background.getCapturedRequests();
        expect(captured['GET:api.example.com/alpha'].statuses).toEqual({ '500': 1 });
        expect(captured['GET:api.example.com/beta'].statuses).toEqual({});
        expect(captured['GET:api.example.com/beta'].lastResponse).toBeUndefined();
    });

    it('pairs a response with its own request', () => {
        const sender = { tab: { id: 7, url: 'https://app.example.com/x' }, frameId: 0 };
        background.processCapturedRequest(req('/solo'), sender.tab, sender);
        background.processCapturedResponse(
            { requestId: 3, status: 201, statusText: 'Created', headers: {}, bodyText: '{}' },
            sender
        );

        const captured = background.getCapturedRequests();
        expect(captured['GET:api.example.com/solo'].statuses).toEqual({ '201': 1 });
        expect(captured['GET:api.example.com/solo'].lastResponse.status).toBe(201);
    });

    it('routes a message through handleRuntimeMessage end to end', () => {
        const sender = { tab: { id: 9, url: 'https://app.example.com/y' }, frameId: 0 };
        background.handleRuntimeMessage(
            { source: 'swazz-detector', type: 'request', data: req('/routed') },
            sender
        );
        background.handleRuntimeMessage(
            {
                source: 'swazz-detector',
                type: 'response',
                data: { requestId: 3, status: 404, statusText: 'Not Found', headers: {}, bodyText: '' }
            },
            sender
        );

        expect(background.getCapturedRequests()['GET:api.example.com/routed'].statuses).toEqual({ '404': 1 });
    });
});

describe('Out-of-scope accounting', () => {
    beforeEach(() => {
        background.resetState();
        background.setRecording(true);
        background.setTargetDomains(['api.example.com']);
    });

    const hit = (host) => background.processCapturedRequest(
        { url: `https://${host}/x`, method: 'GET', headers: {}, body: '' },
        { id: 1, url: `https://${host}/page` },
        { tab: { id: 1, url: `https://${host}/page` }, frameId: 0 }
    );

    it('records every ignored host, not only the most recent one', () => {
        // The popup previously offered just the last dropped host, hiding the rest.
        hit('amplitude.com');
        hit('amplitude.com');
        hit('segment.io');
        hit('sentry.io');

        expect(background.getDroppedHosts()).toEqual({
            'amplitude.com': 2,
            'segment.io': 1,
            'sentry.io': 1
        });
        expect(background.getDroppedOutOfScope()).toBe(4);
    });

    it('does not record in-scope hosts as ignored', () => {
        background.processCapturedRequest(
            { url: 'https://api.example.com/v1/ok', method: 'GET', headers: {}, body: '' },
            { id: 1, url: 'https://app.example.com/' },
            { tab: { id: 1, url: 'https://app.example.com/' }, frameId: 0 }
        );
        expect(background.getDroppedHosts()).toEqual({});
    });

    it('bounds the host map so a noisy page cannot grow it without limit', () => {
        for (let i = 0; i < 260; i++) hit(`h${i}.example.net`);
        const hosts = background.getDroppedHosts();
        expect(Object.keys(hosts).length).toBeLessThanOrEqual(200);
        // Counting continues for hosts already known.
        hit('h0.example.net');
        expect(background.getDroppedHosts()['h0.example.net']).toBe(2);
    });
});

describe('Service worker lifecycle and request accounting', () => {
    beforeEach(() => {
        background.resetState();
        background.setRecording(true);
        background.setTargetDomains(['api.example.com']);
    });

    it('counts a request once even though inject.js reports it twice', () => {
        // For fetch(new Request(..., {body})) the request is announced
        // synchronously and then again once its body has been read, under the
        // same id — the second message must add the body, not another hit.
        const sender = { tab: { id: 1, url: 'https://app.example.com/' }, frameId: 0 };
        const base = {
            url: 'https://api.example.com/v1/items',
            method: 'POST',
            headers: {},
            requestId: 42
        };

        background.processCapturedRequest({ ...base, body: '' }, sender.tab, sender);
        background.processCapturedRequest({ ...base, body: '{"a":1}' }, sender.tab, sender);

        const entry = background.getCapturedRequests()['POST:api.example.com/v1/items'];
        expect(entry.count).toBe(1);
        expect(entry.bodyVariations).toEqual(['{"a":1}']);
    });

    it('still counts genuinely separate requests', () => {
        const sender = { tab: { id: 1, url: 'https://app.example.com/' }, frameId: 0 };
        const base = { url: 'https://api.example.com/v1/items', method: 'GET', headers: {}, body: '' };
        background.processCapturedRequest({ ...base, requestId: 1 }, sender.tab, sender);
        background.processCapturedRequest({ ...base, requestId: 2 }, sender.tab, sender);
        expect(background.getCapturedRequests()['GET:api.example.com/v1/items'].count).toBe(2);
    });

    it('exposes a hydration gate so a cold worker cannot drop events', () => {
        // An MV3 worker restarts with recording === false and reads storage
        // asynchronously; events must wait for that read.
        expect(typeof background.whenHydrated).toBe('function');
        expect(background.isHydrated()).toBe(true); // no chrome API under test
    });

    it('captures WebMCP tool registration from an in-scope sender tab', () => {
        background.setRecording(true);
        background.setTargetDomains(['example.com']);

        const senderTab = { id: 1, url: 'https://example.com/app' };
        const reqData = {
            url: 'webmcp://tool/search_data',
            method: 'CALL',
            headers: {
                'content-type': 'application/json',
                'x-webmcp-annotations': JSON.stringify({ consequentialHint: true })
            },
            body: '{"type":"object","properties":{"query":{"type":"string"}}}'
        };

        background.processCapturedRequest(reqData, senderTab);

        const captured = background.getCapturedRequests();
        const entry = captured['CALL:webmcp://tool/search_data'];
        expect(entry).toBeDefined();
        expect(entry.method).toBe('CALL');
        expect(entry.path).toBe('webmcp://tool/search_data');
        expect(entry.headers['content-type']).toBe('application/json');
        expect(entry.bodyVariations).toContain('{"type":"object","properties":{"query":{"type":"string"}}}');
        expect(background.getDroppedOutOfScope()).toBe(0);
    });

    it('drops WebMCP tool registration from an out-of-scope sender tab', () => {
        background.setRecording(true);
        background.setTargetDomains(['example.com']);

        const senderTab = { id: 2, url: 'https://malicious.org/page' };
        const reqData = {
            url: 'webmcp://tool/evil_tool',
            method: 'CALL',
            headers: { 'content-type': 'application/json' },
            body: '{}'
        };

        background.processCapturedRequest(reqData, senderTab);

        const captured = background.getCapturedRequests();
        expect(captured['CALL:webmcp://tool/evil_tool']).toBeUndefined();
        expect(background.getDroppedOutOfScope()).toBe(1);
    });
});

describe('Full-page navigation and form POST capture via webRequest', () => {
    beforeEach(() => {
        background.resetState();
        background.setRecording(true);
        background.setTargetDomains(['0ae4009404e2b0a881342a9900f300a8.web-security-academy.net']);
    });

    it('extractWebRequestBody serializes formData, decodes raw ArrayBuffer, and handles empty bodies', () => {
        expect(background.extractWebRequestBody(null)).toEqual({ body: '', contentType: '' });

        const formRes = background.extractWebRequestBody({
            formData: {
                csrf: ['tok123'],
                username: ['wiener'],
                password: ['peter']
            }
        });
        expect(formRes.contentType).toBe('application/x-www-form-urlencoded');
        const params = new URLSearchParams(formRes.body);
        expect(params.get('csrf')).toBe('tok123');
        expect(params.get('username')).toBe('wiener');
        expect(params.get('password')).toBe('peter');

        const encoded = new TextEncoder().encode('{"user":"wiener"}');
        const rawRes = background.extractWebRequestBody({
            raw: [{ bytes: encoded.buffer }]
        });
        expect(rawRes.body).toBe('{"user":"wiener"}');
        expect(rawRes.contentType).toBe('');
    });

    it('captures main_frame POST /login with formData and does not record a bogus GET /login', () => {
        background.handleWebRequestBeforeRequest({
            requestId: '101',
            url: 'https://0ae4009404e2b0a881342a9900f300a8.web-security-academy.net/login',
            method: 'POST',
            type: 'main_frame',
            tabId: 5,
            frameId: 0,
            requestBody: {
                formData: {
                    csrf: ['abc'],
                    username: ['wiener'],
                    password: ['peter']
                }
            }
        });
        background.handleWebRequestSendHeaders({
            requestId: '101',
            tabId: 5,
            frameId: 0,
            requestHeaders: [
                { name: 'Content-Type', value: 'application/x-www-form-urlencoded' },
                { name: 'Cookie', value: 'session=secret' },
                { name: 'X-Custom', value: '1' }
            ]
        });
        background.handleWebRequestResponse({
            requestId: '101',
            tabId: 5,
            frameId: 0,
            statusCode: 200,
            statusLine: 'HTTP/1.1 200 OK',
            responseHeaders: [{ name: 'Content-Type', value: 'text/html' }]
        }, true);

        const captured = background.getCapturedRequests();
        expect(captured['GET:0ae4009404e2b0a881342a9900f300a8.web-security-academy.net/login']).toBeUndefined();
        const postEntry = captured['POST:0ae4009404e2b0a881342a9900f300a8.web-security-academy.net/login'];
        expect(postEntry).toBeDefined();
        expect(postEntry.method).toBe('POST');
        expect(postEntry.headers['content-type']).toBe('application/x-www-form-urlencoded');
        expect(postEntry.headers['x-custom']).toBe('1');
        expect(postEntry.headers['cookie']).toBeUndefined();
        expect(postEntry.bodyVariations).toHaveLength(1);
        const parsedBody = new URLSearchParams(postEntry.bodyVariations[0]);
        expect(parsedBody.get('username')).toBe('wiener');
        expect(parsedBody.get('password')).toBe('peter');
        expect(postEntry.statuses).toEqual({ '200': 1 });
    });

    it('tracks POST -> 302 -> GET redirect chain sharing the same Chrome requestId as separate endpoints', () => {
        const host = 'https://0ae4009404e2b0a881342a9900f300a8.web-security-academy.net';

        // Hop 1: POST /login -> 302
        background.handleWebRequestBeforeRequest({
            requestId: '202',
            url: `${host}/login`,
            method: 'POST',
            type: 'main_frame',
            tabId: 7,
            frameId: 0,
            requestBody: { formData: { username: ['wiener'], password: ['peter'] } }
        });
        background.handleWebRequestResponse({
            requestId: '202',
            tabId: 7,
            frameId: 0,
            statusCode: 302,
            statusLine: 'HTTP/1.1 302 Found',
            responseHeaders: [{ name: 'Location', value: '/my-account' }]
        }, false);

        // Hop 2: GET /my-account -> 200 (same requestId!)
        background.handleWebRequestBeforeRequest({
            requestId: '202',
            url: `${host}/my-account`,
            method: 'GET',
            type: 'main_frame',
            tabId: 7,
            frameId: 0
        });
        background.handleWebRequestResponse({
            requestId: '202',
            tabId: 7,
            frameId: 0,
            statusCode: 200,
            statusLine: 'HTTP/1.1 200 OK',
            responseHeaders: [{ name: 'Content-Type', value: 'text/html' }]
        }, true);

        const captured = background.getCapturedRequests();
        expect(captured['POST:0ae4009404e2b0a881342a9900f300a8.web-security-academy.net/login']).toBeDefined();
        expect(captured['POST:0ae4009404e2b0a881342a9900f300a8.web-security-academy.net/login'].statuses).toEqual({ '302': 1 });
        expect(captured['GET:0ae4009404e2b0a881342a9900f300a8.web-security-academy.net/my-account']).toBeDefined();
        expect(captured['GET:0ae4009404e2b0a881342a9900f300a8.web-security-academy.net/my-account'].statuses).toEqual({ '200': 1 });
    });

    it('captures sub_frame POSTs while ignoring noisy sub_frame GETs', () => {
        const host = 'https://0ae4009404e2b0a881342a9900f300a8.web-security-academy.net';
        background.handleWebRequestBeforeRequest({
            requestId: '301',
            url: `${host}/iframe-page`,
            method: 'GET',
            type: 'sub_frame',
            tabId: 8,
            frameId: 12
        });
        background.handleWebRequestBeforeRequest({
            requestId: '302',
            url: `${host}/iframe-submit`,
            method: 'POST',
            type: 'sub_frame',
            tabId: 8,
            frameId: 12,
            requestBody: { formData: { action: ['go'] } }
        });

        const captured = background.getCapturedRequests();
        expect(captured['GET:0ae4009404e2b0a881342a9900f300a8.web-security-academy.net/iframe-page']).toBeUndefined();
        expect(captured['POST:0ae4009404e2b0a881342a9900f300a8.web-security-academy.net/iframe-submit']).toBeDefined();
        expect(captured['POST:0ae4009404e2b0a881342a9900f300a8.web-security-academy.net/iframe-submit'].bodyVariations).toEqual(['action=go']);
    });

    it('keeps endpoints with the same path on different hosts isolated', () => {
        background.setTargetDomains(['lab1.example.com', 'lab2.example.com']);
        background.handleWebRequestBeforeRequest({
            requestId: '401',
            url: 'https://lab1.example.com/login',
            method: 'POST',
            type: 'main_frame',
            tabId: 1,
            frameId: 0,
            requestBody: { formData: { csrf: ['tok1'], username: ['a'] } }
        });
        background.handleWebRequestBeforeRequest({
            requestId: '402',
            url: 'https://lab2.example.com/login',
            method: 'POST',
            type: 'main_frame',
            tabId: 2,
            frameId: 0,
            requestBody: { formData: { csrf: ['tok2'], username: ['b'] } }
        });

        const captured = background.getCapturedRequests();
        expect(captured['POST:lab1.example.com/login']).toBeDefined();
        expect(captured['POST:lab2.example.com/login']).toBeDefined();
        expect(captured['POST:lab1.example.com/login'].bodyVariations[0]).toContain('tok1');
        expect(captured['POST:lab2.example.com/login'].bodyVariations[0]).toContain('tok2');
    });

    it('does not count Swazz Dashboard traffic as ignored out-of-scope', () => {
        background.setTargetDomains(['lab1.example.com']);
        background.setSwazzUrl('https://swazz.secmy.app');

        background.processCapturedRequest(
            { url: 'https://swazz.secmy.app/api/scans/123/runner-logs', method: 'GET', headers: {}, body: '' },
            { id: 1, url: 'https://swazz.secmy.app/' }
        );
        background.processCapturedRequest(
            { url: 'http://localhost:5173/api/projects', method: 'GET', headers: {}, body: '' },
            { id: 1, url: 'http://localhost:5173/' }
        );

        expect(background.getDroppedOutOfScope()).toBe(0);
        expect(background.getDroppedHosts()).toEqual({});
    });
});
