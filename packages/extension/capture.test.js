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
        expect(captured['GET:/v1/users/{id}']).toBeDefined();
        expect(captured['GET:/v1/users/{id}'].count).toBe(1);
        expect(captured['GET:/v1/users/{id}'].queryKeys).toContain('filter');
        expect(captured['GET:/v1/users/{id}'].queryVariations).toContain('?filter=active');
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
        expect(captured['GET:/alpha'].statuses).toEqual({ '500': 1 });
        expect(captured['GET:/beta'].statuses).toEqual({});
        expect(captured['GET:/beta'].lastResponse).toBeUndefined();
    });

    it('pairs a response with its own request', () => {
        const sender = { tab: { id: 7, url: 'https://app.example.com/x' }, frameId: 0 };
        background.processCapturedRequest(req('/solo'), sender.tab, sender);
        background.processCapturedResponse(
            { requestId: 3, status: 201, statusText: 'Created', headers: {}, bodyText: '{}' },
            sender
        );

        const captured = background.getCapturedRequests();
        expect(captured['GET:/solo'].statuses).toEqual({ '201': 1 });
        expect(captured['GET:/solo'].lastResponse.status).toBe(201);
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

        expect(background.getCapturedRequests()['GET:/routed'].statuses).toEqual({ '404': 1 });
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

        const entry = background.getCapturedRequests()['POST:/v1/items'];
        expect(entry.count).toBe(1);
        expect(entry.bodyVariations).toEqual(['{"a":1}']);
    });

    it('still counts genuinely separate requests', () => {
        const sender = { tab: { id: 1, url: 'https://app.example.com/' }, frameId: 0 };
        const base = { url: 'https://api.example.com/v1/items', method: 'GET', headers: {}, body: '' };
        background.processCapturedRequest({ ...base, requestId: 1 }, sender.tab, sender);
        background.processCapturedRequest({ ...base, requestId: 2 }, sender.tab, sender);
        expect(background.getCapturedRequests()['GET:/v1/items'].count).toBe(2);
    });

    it('exposes a hydration gate so a cold worker cannot drop events', () => {
        // An MV3 worker restarts with recording === false and reads storage
        // asynchronously; events must wait for that read.
        expect(typeof background.whenHydrated).toBe('function');
        expect(background.isHydrated()).toBe(true); // no chrome API under test
    });
});
