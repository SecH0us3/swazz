// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { getPublicKeyFromTags, getRunIdFromTags } from './utils';

// Upper bound on scans one runner holds concurrently. Keeps the socket attachment
// (activeJobs + recentJobs) well under the 2 KB Durable Object limit and bounds the
// work done before the WebSocket upgrade response is returned.
export const MAX_ACTIVE_JOBS_PER_RUNNER = 10;

export class StateManager {
  runners = new Set<WebSocket>();
  clients = new Map<string, Set<WebSocket>>();
  jobs = new Map<string, WebSocket>();
  pendingChallenges = new Map<WebSocket, string>();
  pendingParses = new Map<string, (r: Response) => void>();
  pendingParseUrls = new Map<string, string>();
  sseStreams = new Map<string, ReadableStreamDefaultController>();

  constructor(private state: DurableObjectState) {
    this.reconstructState();
  }

  private reconstructState(): void {
    for (const ws of this.state.getWebSockets()) {
      const tags = this.state.getTags(ws);
      if (tags.includes('runner') || tags.includes('runner-pending')) {
        const attachment = ws.deserializeAttachment() as { authenticated?: boolean; activeJobs?: string[]; nonce?: string } | null;
        if (tags.includes('runner') || (attachment && attachment.authenticated)) {
          this.runners.add(ws);
          if (attachment && attachment.activeJobs) {
            for (const runId of attachment.activeJobs) {
              this.jobs.set(runId, ws);
            }
          }
        } else if (attachment && attachment.nonce) {
          this.pendingChallenges.set(ws, attachment.nonce);
        }
      } else if (tags.includes('client')) {
        const runId = getRunIdFromTags(tags);
        if (runId) {
          if (!this.clients.has(runId)) {
            this.clients.set(runId, new Set());
          }
          this.clients.get(runId)!.add(ws);
        }
      }
    }
  }

  isPrivateRunner(ws: WebSocket): boolean {
    const tags = this.state.getTags(ws);
    return !!getPublicKeyFromTags(tags);
  }

  hasCapacity(ws: WebSocket): boolean {
    if (typeof ws.deserializeAttachment !== 'function') {
      return true;
    }
    try {
      const att = ws.deserializeAttachment() as { activeJobs?: unknown } | null;
      if (att !== null && att !== undefined && typeof att !== 'object') {
        return false;
      }
      if (att?.activeJobs !== undefined && !Array.isArray(att.activeJobs)) {
        return false;
      }
      return (att?.activeJobs?.length ?? 0) < MAX_ACTIVE_JOBS_PER_RUNNER;
    } catch {
      // Fail closed on corrupt or unreadable attachment
      return false;
    }
  }
}

