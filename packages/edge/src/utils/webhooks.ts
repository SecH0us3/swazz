import { Env } from '../env';
import { getDB } from './db';
import { logInfo, logError } from '../../../common/logging/logger';
import { Webhook } from '../types';

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
      'SELECT id, url, headers, event_types FROM project_webhooks WHERE project_id = ?'
    ).bind(projectId).all<Webhook>();
    webhooks = results || [];
  } catch (err) {
    logError(env, 'Webhook', `Failed to retrieve webhooks for project ${projectId}`, { error: err });
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

  const webhookPayload = {
    event: eventType,
    timestamp: new Date().toISOString(),
    project_id: projectId,
    data: payload
  };

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
        logError(env, 'Webhook', `Failed to parse custom headers for webhook ${webhook.id}`, { error: err });
      }
    }

    try {
      logInfo(env, 'Webhook', `Dispatching ${eventType} webhook to ${webhook.url}`);
      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: headersObj,
        body: JSON.stringify(webhookPayload),
        signal: AbortSignal.timeout(5000)
      });

      if (!response.ok) {
        logError(env, 'Webhook', `Webhook ${webhook.id} returned non-OK status ${response.status} for event ${eventType}`);
      } else {
        logInfo(env, 'Webhook', `Webhook ${webhook.id} dispatched successfully`);
      }
    } catch (err) {
      logError(env, 'Webhook', `Failed to dispatch webhook ${webhook.id} to ${webhook.url}`, { error: err });
    }
  });

  if (ctx && typeof ctx.waitUntil === 'function') {
    ctx.waitUntil(Promise.all(dispatchPromises));
  } else {
    // If no context, await them directly
    await Promise.all(dispatchPromises);
  }
}
