import { Env } from '../env';
import { getDB } from './db';
import { logInfo, logError } from '../../../common/logging/logger';
import { Webhook } from '../types';

export async function signWebhookPayload(secret: string, timestamp: number, payloadStr: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const message = encoder.encode(`${timestamp}.${payloadStr}`);
  
  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  
  const signatureBuffer = await crypto.subtle.sign(
    'HMAC',
    key,
    message
  );
  return Array.from(new Uint8Array(signatureBuffer), b => b.toString(16).padStart(2, '0')).join('');
}

export async function dispatchWebhook(
  env: Env,
  projectId: string,
  eventType: string,
  payload: any,
  ctx?: { waitUntil: (promise: Promise<any>) => void }
): Promise<void> {
  const db = getDB(env);
  
  // Query all webhooks for this project
  let webhooks: Webhook[] = [];
  try {
    const { results } = await db.prepare(
      'SELECT id, url, headers, event_types, secret FROM project_webhooks WHERE project_id = ?'
    ).bind(projectId).all<Webhook>();
    webhooks = results || [];
  } catch (err) {
    logError({ env, executionCtx: ctx }, 'Webhook', `Failed to retrieve webhooks for project ${projectId}`, { error: err });
    return;
  }

  // Filter webhooks that handle the specific event type
  const matchingWebhooks = webhooks.filter(w => {
    try {
      const events: string[] = JSON.parse(w.event_types);
      return Array.isArray(events) && events.includes(eventType);
    } catch {
      return false;
    }
  });

  if (matchingWebhooks.length === 0) {
    return;
  }

  const timestamp = Math.floor(Date.now() / 1000);
  const webhookPayload = {
    event: eventType,
    timestamp: new Date().toISOString(),
    project_id: projectId,
    data: payload
  };
  const payloadStr = JSON.stringify(webhookPayload);

  const dispatchPromises = matchingWebhooks.map(async (webhook) => {
    const headersObj: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Swazz-Webhook-Dispatcher/1.0'
    };

    if (webhook.headers) {
      try {
        const parsed = JSON.parse(webhook.headers);
        Object.assign(headersObj, parsed);
      } catch (err) {
        logError({ env, executionCtx: ctx }, 'Webhook', `Failed to parse custom headers for webhook ${webhook.id}`, { error: err });
      }
    }

    if (webhook.secret) {
      try {
        const signature = await signWebhookPayload(webhook.secret, timestamp, payloadStr);
        headersObj['X-Swazz-Signature'] = `t=${timestamp},v1=${signature}`;
      } catch (err) {
        logError({ env, executionCtx: ctx }, 'Webhook', `Failed to sign webhook payload for webhook ${webhook.id}`, { error: err });
      }
    }

    try {
      logInfo({ env, executionCtx: ctx }, 'Webhook', `Dispatching ${eventType} webhook to ${webhook.url}`);
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: headersObj,
        body: payloadStr,
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        logError({ env, executionCtx: ctx }, 'Webhook', `Webhook ${webhook.id} returned non-OK status ${response.status} for event ${eventType}`);
      } else {
        logInfo({ env, executionCtx: ctx }, 'Webhook', `Webhook ${webhook.id} dispatched successfully`);
      }
    } catch (err) {
      logError({ env, executionCtx: ctx }, 'Webhook', `Failed to dispatch webhook ${webhook.id} to ${webhook.url}`, { error: err });
    }
  });

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(Promise.all(dispatchPromises));
  } else {
    // If no context, await them directly
    await Promise.all(dispatchPromises);
  }
}
