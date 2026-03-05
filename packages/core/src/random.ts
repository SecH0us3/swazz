/**
 * Lightweight random utilities — replaces @faker-js/faker (~5KB vs 5MB).
 * Works in both browser and Node.js / Cloudflare Workers.
 */

// ─── Mini word dictionary (~200 words) ──────────────────

const WORDS = [
    'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel',
    'india', 'juliet', 'kilo', 'lima', 'mike', 'november', 'oscar', 'papa',
    'quebec', 'romeo', 'sierra', 'tango', 'uniform', 'victor', 'whiskey',
    'xray', 'yankee', 'zulu', 'apple', 'banana', 'cherry', 'dragon',
    'eagle', 'falcon', 'grape', 'hawk', 'iron', 'jade', 'knight', 'lemon',
    'mango', 'night', 'ocean', 'pearl', 'quartz', 'river', 'storm', 'tiger',
    'umbra', 'venom', 'whale', 'xenon', 'yeti', 'zebra', 'amber', 'blaze',
    'coral', 'dusk', 'ember', 'frost', 'glow', 'haze', 'ivory', 'jet',
    'karma', 'lotus', 'mist', 'neon', 'onyx', 'prism', 'quest', 'rune',
    'silk', 'torch', 'ultra', 'vivid', 'wind', 'pixel', 'solar', 'lunar',
    'cyber', 'nexus', 'pulse', 'spark', 'steel', 'stone', 'swift', 'flux',
    'blitz', 'crypt', 'drift', 'forge', 'grain', 'haven', 'index', 'joule',
    'knot', 'latch', 'mesh', 'node', 'orbit', 'phase', 'query', 'relay',
    'scope', 'trace', 'unity', 'valve', 'warp', 'yield', 'zinc', 'axis',
    'bolt', 'cage', 'data', 'edge', 'fiber', 'grid', 'hash', 'input',
    'joint', 'key', 'link', 'mode', 'null', 'output', 'path', 'queue',
    'root', 'seed', 'token', 'unit', 'void', 'wire', 'zero', 'bit',
    'byte', 'cell', 'core', 'disk', 'font', 'gate', 'heap', 'icon',
    'jack', 'kern', 'load', 'mask', 'nano', 'page', 'rack', 'scan',
    'tape', 'user', 'view', 'wrap', 'zone', 'arch', 'band', 'chip',
    'dock', 'exit', 'flag', 'gear', 'hook', 'iris', 'jolt', 'kite',
    'lamp', 'maze', 'nest', 'opal', 'pine', 'ring', 'slab', 'tile',
    'undo', 'veil', 'wave', 'apex', 'barn', 'cape', 'dome', 'echo',
    'fern', 'glen', 'hill', 'isle', 'jump', 'knob', 'leaf', 'mill',
    'nova', 'oval', 'pond', 'quay', 'reef', 'sand', 'tent', 'urge',
];

const FIRST_NAMES = [
    'James', 'Mary', 'John', 'Patricia', 'Robert', 'Jennifer', 'Michael',
    'Linda', 'David', 'Elizabeth', 'William', 'Barbara', 'Richard', 'Susan',
    'Joseph', 'Jessica', 'Thomas', 'Sarah', 'Charles', 'Karen',
];

const LAST_NAMES = [
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
    'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez',
    'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
];

const DOMAINS = [
    'test.com', 'example.org', 'demo.net', 'sample.io', 'mock.dev',
    'fake.co', 'stub.app', 'local.test',
];

// ─── Core random functions ──────────────────────────────

/** Pick a random element from array */
export function pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(Math.random() * arr.length)];
}

/** Generate a UUID v4 */
export function uuid(): string {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/** Random word from built-in dictionary */
export function word(): string {
    return pick(WORDS);
}

/** Multiple random words joined by space */
export function words(n: number): string {
    return Array.from({ length: n }, () => word()).join(' ');
}

/** Random sentence (5-12 words, capitalized, with period) */
export function sentence(): string {
    const n = int(5, 12);
    const s = words(n);
    return s.charAt(0).toUpperCase() + s.slice(1) + '.';
}

/** Random integer in [min, max] inclusive */
export function int(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Random float in [min, max) */
export function float(min: number, max: number): number {
    return Math.random() * (max - min) + min;
}

/** Random boolean */
export function bool(): boolean {
    return Math.random() < 0.5;
}

/** Random date between from and to */
export function date(
    from: Date = new Date('2020-01-01'),
    to: Date = new Date(),
): Date {
    const fromMs = from.getTime();
    const toMs = to.getTime();
    return new Date(fromMs + Math.random() * (toMs - fromMs));
}

/** Random email */
export function email(): string {
    const first = pick(FIRST_NAMES).toLowerCase();
    const last = pick(LAST_NAMES).toLowerCase();
    const domain = pick(DOMAINS);
    return `${first}.${last}${int(1, 999)}@${domain}`;
}

/** Random IPv4 address */
export function ipv4(): string {
    return `${int(1, 254)}.${int(0, 255)}.${int(0, 255)}.${int(1, 254)}`;
}

/** Random URI */
export function uri(): string {
    return `https://${word()}.example.com/${word()}/${word()}`;
}

/** Random string of given length (alphanumeric) */
export function randomString(length: number): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
}

/** Random full name */
export function fullName(): string {
    return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

/** Random phone number */
export function phone(): string {
    return `+1${int(200, 999)}${int(100, 999)}${int(1000, 9999)}`;
}
