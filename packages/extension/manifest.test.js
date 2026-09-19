import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const dir = path.dirname(new URL(import.meta.url).pathname);
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf-8');
const manifest = JSON.parse(read('manifest.json'));

// Guardrails, not style checks: each of these encodes a defect that actually
// shipped in this extension and was only caught by a human reading the diff.
describe('manifest contract', () => {
    // "side_panel" was used as a permission name. Chrome drops unknown
    // permissions with a warning, leaving chrome.sidePanel undefined at runtime.
    const KNOWN_PERMISSIONS = new Set([
        'activeTab', 'alarms', 'bookmarks', 'browsingData', 'contextMenus', 'cookies',
        'debugger', 'declarativeNetRequest', 'downloads', 'history', 'identity',
        'management', 'nativeMessaging', 'notifications', 'offscreen', 'scripting',
        'sidePanel', 'storage', 'tabs', 'topSites', 'unlimitedStorage', 'webNavigation',
        'webRequest'
    ]);

    it('declares only permissions Chrome actually recognises', () => {
        for (const p of manifest.permissions || []) {
            expect(KNOWN_PERMISSIONS.has(p), `unknown permission "${p}"`).toBe(true);
        }
    });

    it('requests sidePanel whenever it ships a side panel', () => {
        if (manifest.side_panel) {
            expect(manifest.permissions).toContain('sidePanel');
        }
    });

    it('captures inside iframes, since responses are correlated per frame', () => {
        for (const cs of manifest.content_scripts || []) {
            expect(cs.all_frames, `${cs.js} must run in all frames`).toBe(true);
        }
    });

    it('exposes no web-accessible resources unless something loads them by URL', () => {
        const exposed = (manifest.web_accessible_resources || [])
            .flatMap(entry => entry.resources || []);
        if (exposed.length > 0) {
            const sources = ['content.js', 'popup.js', 'background.js', 'inject.js']
                .map(read).join('\n');
            for (const res of exposed) {
                expect(sources, `${res} is web-accessible but never loaded by URL`)
                    .toContain(`getURL('${res}')`);
            }
        }
    });

    it('references only files that exist', () => {
        const referenced = [
            ...(manifest.content_scripts || []).flatMap(cs => cs.js || []),
            manifest.background?.service_worker,
            manifest.action?.default_popup,
            manifest.side_panel?.default_path,
            ...Object.values(manifest.action?.default_icon || {})
        ].filter(Boolean);

        for (const f of referenced) {
            expect(fs.existsSync(path.join(dir, f)), `${f} is referenced but missing`).toBe(true);
        }
    });
});

describe('offline and privacy contract', () => {
    it('loads no remote resources: the popup is documented as working offline', () => {
        // XML namespaces (xmlns="http://www.w3.org/2000/svg") are identifiers, not
        // fetches, so they are not what this guards against.
        const NAMESPACES = /xmlns(:\w+)?="[^"]*"/g;
        for (const f of ['popup.css', 'popup.html', 'sidepanel.html']) {
            const body = read(f)
                .replace(/\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, '')
                .replace(NAMESPACES, '');
            expect(body, `${f} must not fetch anything remote`).not.toMatch(/https?:\/\/(?!127\.0\.0\.1|localhost)/);
        }
    });
});

describe('markup and stylesheet agree', () => {
    // classList.add('hidden') did nothing for most elements because only three
    // element-scoped rules existed and no generic utility.
    it('defines every utility class the scripts toggle', () => {
        // content.js styles the pages it visits with a stylesheet it injects
        // itself, so its rules live in that file rather than in popup.css.
        const checks = [
            { js: 'popup.js', styles: read('popup.css') },
            { js: 'content.js', styles: read('popup.css') + read('content.js') }
        ];
        for (const { js, styles } of checks) {
            const toggled = new Set(
                [...read(js).matchAll(/classList\.(?:add|remove|toggle)\(\s*['"]([\w-]+)['"]/g)].map(m => m[1])
            );
            for (const cls of toggled) {
                expect(styles, `${js} toggles .${cls} but no stylesheet defines it`)
                    .toMatch(new RegExp(`\\.${cls}\\b`));
            }
        }
    });

    it('keeps popup and side panel on the same element ids', () => {
        const ids = (f) => [...read(f).matchAll(/id="([\w-]+)"/g)].map(m => m[1]).sort();
        expect(ids('sidepanel.html')).toEqual(ids('popup.html'));
    });
});
