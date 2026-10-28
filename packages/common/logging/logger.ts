// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

export interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  module: string;
  msg: string;
  requestId?: string;
  traceId?: string;
  error?: any;
  payload?: Record<string, any>;
}

export function formatLog(
  level: LogEntry['level'],
  module: string,
  msg: string,
  options?: { requestId?: string; traceId?: string; error?: any; payload?: Record<string, any>; [key: string]: any }
): LogEntry {
  const { requestId, traceId, error, payload, ...extra } = options || {};

  let formattedError: any = undefined;
  if (error !== undefined && error !== null) {
    if (error instanceof Error) {
      formattedError = {
        message: error.message,
        name: error.name,
        stack: error.stack,
      };
    } else {
      formattedError = error;
    }
  }

  let mergedPayload = payload;
  if (Object.keys(extra).length > 0) {
    mergedPayload = { ...payload, ...extra };
  }

  return {
    timestamp: new Date().toISOString(),
    level,
    module,
    msg,
    requestId,
    traceId,
    error: formattedError,
    payload: mergedPayload,
  };
}

const MAX_LOGS = 200;
const memoryLogs: LogEntry[] = [];

export function getBufferedLogs(): LogEntry[] {
  return [...memoryLogs];
}

export function clearBufferedLogs(): void {
  memoryLogs.length = 0;
}

function recordLog(entry: LogEntry): void {
  memoryLogs.unshift(entry);
  if (memoryLogs.length > MAX_LOGS) {
    memoryLogs.length = MAX_LOGS;
  }
}

export function logInfo(_ctxOrEnv: any, module: string, msg: string, options?: any) {
  const entry = formatLog('info', module, msg, options);
  const serialized = JSON.stringify(entry);
  console.log(serialized);
  recordLog(JSON.parse(serialized));
}

export function logWarn(_ctxOrEnv: any, module: string, msg: string, options?: any) {
  const entry = formatLog('warn', module, msg, options);
  const serialized = JSON.stringify(entry);
  console.warn(serialized);
  recordLog(JSON.parse(serialized));
}

export function logError(_ctxOrEnv: any, module: string, msg: string, options?: any) {
  const entry = formatLog('error', module, msg, options);
  const serialized = JSON.stringify(entry);
  console.error(serialized);
  recordLog(JSON.parse(serialized));
}
