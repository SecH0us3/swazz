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
