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

async function pushToKV(ctxOrEnv: any, entry: LogEntry) {
  let env: any = ctxOrEnv;
  let waitCtx: any = null;

  if (ctxOrEnv) {
    if (typeof ctxOrEnv.env === 'object') {
      env = ctxOrEnv.env;
    }
    if (typeof ctxOrEnv.waitUntil === 'function') {
      waitCtx = ctxOrEnv;
    } else if (ctxOrEnv.executionCtx && typeof ctxOrEnv.executionCtx.waitUntil === 'function') {
      waitCtx = ctxOrEnv.executionCtx;
    }
  }

  if (!env?.SESSION_CACHE) return;

  const p = (async () => {
    try {
      const key = 'admin:logs';
      const raw = await env.SESSION_CACHE.get(key);
      let logs: LogEntry[] = [];
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            logs = parsed;
          }
        } catch {
          logs = [];
        }
      }
      logs.unshift(entry);
      if (logs.length > 200) {
        logs = logs.slice(0, 200);
      }
      await env.SESSION_CACHE.put(key, JSON.stringify(logs));
    } catch (e) {
      console.error('Failed to buffer log to KV:', e);
    }
  })();

  if (waitCtx) {
    waitCtx.waitUntil(p);
  } else {
    // If no execution context is available (e.g. tests or scripts), we wait to guarantee write
    await p;
  }
}

export function logInfo(ctxOrEnv: any, module: string, msg: string, options?: any) {
  const entry = formatLog('info', module, msg, options);
  console.log(JSON.stringify(entry));
  if (ctxOrEnv) pushToKV(ctxOrEnv, entry);
}

export function logWarn(ctxOrEnv: any, module: string, msg: string, options?: any) {
  const entry = formatLog('warn', module, msg, options);
  console.warn(JSON.stringify(entry));
  if (ctxOrEnv) pushToKV(ctxOrEnv, entry);
}

export function logError(ctxOrEnv: any, module: string, msg: string, options?: any) {
  const entry = formatLog('error', module, msg, options);
  console.error(JSON.stringify(entry));
  if (ctxOrEnv) pushToKV(ctxOrEnv, entry);
}
