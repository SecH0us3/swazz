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

async function pushToKV(env: any, entry: LogEntry) {
  if (!env?.SESSION_CACHE) return;
  try {
    const key = 'admin:logs';
    const raw = await env.SESSION_CACHE.get(key);
    let logs: LogEntry[] = [];
    if (raw) {
      try {
        logs = JSON.parse(raw);
      } catch {
        logs = [];
      }
    }
    logs.unshift(entry);
    if (logs.length > 1000) {
      logs = logs.slice(0, 1000);
    }
    await env.SESSION_CACHE.put(key, JSON.stringify(logs));
  } catch (e) {
    console.error('Failed to buffer log to KV:', e);
  }
}

export function logInfo(env: any, module: string, msg: string, options?: any) {
  const entry = formatLog('info', module, msg, options);
  console.log(JSON.stringify(entry));
  if (env) pushToKV(env, entry);
}

export function logWarn(env: any, module: string, msg: string, options?: any) {
  const entry = formatLog('warn', module, msg, options);
  console.warn(JSON.stringify(entry));
  if (env) pushToKV(env, entry);
}

export function logError(env: any, module: string, msg: string, options?: any) {
  const entry = formatLog('error', module, msg, options);
  console.error(JSON.stringify(entry));
  if (env) pushToKV(env, entry);
}
