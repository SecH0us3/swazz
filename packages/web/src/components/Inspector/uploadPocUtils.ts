// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import type { AnalysisFinding } from '../../types.js';

export interface UploadFileMeta {
    filename: string;
    contentType: string;
    probeKind: string;
    size?: number;
}

export interface ExtractedUploadParts {
    isRawBinary: boolean;
    files: Array<{ field: string; file: UploadFileMeta }>;
    fields: Array<{ field: string; value: string }>;
}

export interface SynthesizedProbeContent {
    kind: 'text' | 'base64' | 'placeholder';
    content?: string;
    filename: string;
    contentType: string;
}

export interface FollowUpInfo {
    url: string;
    status?: number;
}

const GIF_POLYGLOT_B64 =
    'R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOzwhLS1zd2F6ei1wb2x5Z2xvdC1jYW5hcnktLT4=';
const PNG_METADATA_CANARY_B64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAABl0RVh0Q29tbWVudABzd2F6ei1leGlmLWNhbmFyeeUrLQsAAAAASUVORK5CYII=';
const MINIMAL_PNG_B64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACklEQVR4nGMAAQAABQABDQottAAAAABJRU5ErkJggg==';

export function isUploadFileMeta(v: unknown): v is UploadFileMeta {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
    const rec = v as Record<string, unknown>;
    return (
        typeof rec.filename === 'string' &&
        typeof rec.contentType === 'string' &&
        typeof rec.probeKind === 'string'
    );
}

export function extractUploadParts(body: unknown): ExtractedUploadParts | null {
    if (!body || typeof body !== 'object') return null;

    if (isUploadFileMeta(body)) {
        return {
            isRawBinary: true,
            files: [{ field: 'body', file: body }],
            fields: [],
        };
    }

    if (Array.isArray(body)) return null;

    const files: Array<{ field: string; file: UploadFileMeta }> = [];
    const fields: Array<{ field: string; value: string }> = [];

    for (const [key, val] of Object.entries(body as Record<string, unknown>)) {
        if (isUploadFileMeta(val)) {
            files.push({ field: key, file: val });
        } else if (Array.isArray(val)) {
            let hasFile = false;
            for (const item of val) {
                if (isUploadFileMeta(item)) {
                    files.push({ field: key, file: item });
                    hasFile = true;
                }
            }
            if (!hasFile) {
                fields.push({ field: key, value: JSON.stringify(val) });
            }
        } else if (val !== undefined && val !== null) {
            fields.push({
                field: key,
                value: typeof val === 'object' ? JSON.stringify(val) : String(val),
            });
        }
    }

    if (files.length === 0) return null;
    return { isRawBinary: false, files, fields };
}

export function synthesizeProbeContent(file: UploadFileMeta): SynthesizedProbeContent {
    const kind = file.probeKind || '';
    const filename = file.filename || 'probe.bin';
    const contentType = file.contentType || 'application/octet-stream';

    switch (kind) {
        case 'svg_upload_probe':
            return {
                kind: 'text',
                content:
                    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(\'swazz-svg-xss\')</script></svg>',
                filename,
                contentType,
            };
        case 'svg_oob_probe':
            return {
                kind: 'text',
                content:
                    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://oob.example.invalid/swazz" width="1" height="1"/></svg>',
                filename,
                contentType,
            };
        case 'gif_polyglot_probe':
            return { kind: 'base64', content: GIF_POLYGLOT_B64, filename, contentType };
        case 'png_metadata_canary':
            return { kind: 'base64', content: PNG_METADATA_CANARY_B64, filename, contentType };
        case 'valid_png':
            return { kind: 'base64', content: MINIMAL_PNG_B64, filename, contentType };
        case 'eicar_av_probe': {
            // Split literal so static AV scanners do not flag the frontend bundle.
            const p1 = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}';
            const p2 = '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';
            return { kind: 'text', content: p1 + p2, filename, contentType };
        }
        case 'null_byte_filename':
        case 'rtl_override_filename':
        case 'double_ext_filename':
        case 'traversal_filename':
        case 'valid_text':
            return { kind: 'text', content: 'swazz-upload-probe', filename, contentType };
        case 'empty_file':
            return { kind: 'text', content: '', filename, contentType };
        default:
            if (kind.startsWith('mime_mismatch_')) {
                return { kind: 'text', content: '<?php echo "swazz-mime-mismatch"; ?>', filename, contentType };
            }
            if (kind.startsWith('truncated_')) {
                return { kind: 'text', content: '%PDF-1.', filename, contentType };
            }
            return { kind: 'placeholder', filename, contentType };
    }
}

export function resolveFollowUpUrl(rawUrl: string, baseUrl?: string): string {
    const trimmed = rawUrl.trim();
    if (!trimmed) return '';
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (!baseUrl) return trimmed;
    try {
        return new URL(trimmed, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
    } catch {
        return trimmed;
    }
}

export function extractFindingFollowUp(finding: AnalysisFinding, baseUrl?: string): FollowUpInfo | null {
    if (finding.followUpUrl) {
        return {
            url: resolveFollowUpUrl(finding.followUpUrl, baseUrl),
            status: finding.followUpStatus,
        };
    }
    if (finding.evidence) {
        const match = finding.evidence.match(/\bFollowUp:\s*GET\s+(\S+)/i);
        if (match && match[1]) {
            const statusMatch = finding.evidence.match(/\bStatus:\s*(\d{3})\b/);
            return {
                url: resolveFollowUpUrl(match[1], baseUrl),
                status: statusMatch ? parseInt(statusMatch[1], 10) : undefined,
            };
        }
    }
    return null;
}

export function extractFollowUpInfo(findings?: AnalysisFinding[], baseUrl?: string): FollowUpInfo | null {
    if (!findings || findings.length === 0) return null;
    for (const f of findings) {
        const info = extractFindingFollowUp(f, baseUrl);
        if (info) return info;
    }
    return null;
}
