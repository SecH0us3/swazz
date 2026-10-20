// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// Runner errors shown to users: on the dashboard's live stream, in the runner log and as a failed
// scan's reason. They come from a runner (the user's own, or a shared one the operator runs), so
// they are untrusted text: reduced to one bounded line, with stack traces (internal paths and
// code locations, no help to the user) cut off, and URLs kept to scheme and host (Go's HTTP
// errors quote the full URL, whose userinfo, path or query may carry a token, and everyone with
// access to the project sees a failed scan's reason). React renders them as text, never as HTML.
//
// Non-goal: redacting what a runner chose to put in its own message (a target hostname, a status
// code); those describe the user's own scan. Coordinator-originated failures use fixed texts.

export const MAX_RUNNER_MESSAGE_LENGTH = 500;

export const UNKNOWN_FAILURE = 'The scan failed without an error message.';

/** Why a scan that could not be handed to the scan queue failed, as the user is told. */
export const SCAN_NOT_QUEUED = 'The scan could not be queued, so it never started. Start it again; if this keeps happening, try again later.';

// The start of a stack trace: a Go goroutine dump, a JS/TS frame, or a source location line.
const STACK_TRACE_START = /(?:^|\n)\s*(?:goroutine \d+ \[|panic:|at [\w$.<>]+ \(|[\w./\\-]+\.(?:go|ts|js|mjs):\d+)/;
// ANSI escape sequences (colored terminal output).
const ANSI_ESCAPES = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
// URLs inside free text.
const URL_IN_TEXT = /[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"'<>]+/g;
// C0 and C1 control characters, which include line breaks.
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]+/g;

/** One bounded line of runner-provided text, safe to show to the user. */
export function sanitizeRunnerText(raw: unknown, max: number = MAX_RUNNER_MESSAGE_LENGTH): string {
  let text: string;
  if (typeof raw === 'string') {
    text = raw;
  } else if (raw === null || raw === undefined) {
    text = '';
  } else {
    try {
      text = JSON.stringify(raw) ?? '';
    } catch {
      text = String(raw);
    }
  }
  const stackAt = text.search(STACK_TRACE_START);
  if (stackAt >= 0) text = text.slice(0, stackAt);
  text = text.replace(URL_IN_TEXT, redactUrl);
  text = text.replace(ANSI_ESCAPES, '').replace(CONTROL_CHARS, ' ').replace(/\s+/g, ' ').trim();
  if (text.length > max) text = `${text.slice(0, max - 1).trimEnd()}…`;
  return text;
}

/**
 * A URL down to scheme and host; userinfo, path, query and fragment become "…" (hosted MCP
 * servers often put the key in the path).
 */
function redactUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return '(URL)';
  }
  if (!u.host) return `${u.protocol}…`;
  const userinfo = u.username || u.password ? '…@' : '';
  const query = u.search || raw.includes('?') ? '?…' : '';
  const fragment = u.hash ? '#…' : '';
  const path = u.pathname && u.pathname !== '/' ? '/…' : '';
  return `${u.protocol}//${userinfo}${u.host}${path}${query}${fragment}`;
}

/**
 * The user-facing text of a runner error, from any of its stored or streamed shapes: the
 * runner's `{"error": "..."}`, an event `{"type":"error","data":...}` whose data is a string or
 * carries `message`/`error`, or a JSON string of either. Empty when there is nothing to show.
 */
export function runnerErrorText(payload: unknown): string {
  let value: any = payload;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return sanitizeRunnerText(value);
    }
  }
  if (value === null || typeof value !== 'object') return sanitizeRunnerText(value);
  const data = value.type === 'error' && 'data' in value ? value.data : value;
  if (typeof data === 'string') return sanitizeRunnerText(data);
  if (data && typeof data === 'object') {
    for (const key of ['message', 'error']) {
      if (typeof data[key] === 'string') return sanitizeRunnerText(data[key]);
    }
  }
  return '';
}
