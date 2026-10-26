// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { getRunIdFromTags } from './utils';
import { isSharedRunnerTags } from './runnerAccess';
import { DeliveryTracker } from './delivery';

// Upper bound on scans one runner holds concurrently. Keeps the socket attachment
// (activeJobs + recentJobs) well under the 2 KB Durable Object limit and bounds the
// work done before the WebSocket upgrade response is returned.
export const MAX_ACTIVE_JOBS_PER_RUNNER = 10;

// Runner heartbeat. Agents that connect with ?heartbeat=1 send HEARTBEAT_PING every 30 s; the
// Durable Object answers it with HEARTBEAT_PONG without waking up and records when it last did.
// A connection that dies without a close frame (a reset TCP stream) is never reported to the
// object, so a heartbeat runner silent for longer than RUNNER_HEARTBEAT_TIMEOUT_MS is treated
// as gone: it is no longer listed and no longer handed scans. Runners without heartbeat support
// are kept as before.
export const HEARTBEAT_PING = '{"type":"ping"}';
export const HEARTBEAT_PONG = '{"type":"pong"}';
export const RUNNER_HEARTBEAT_TIMEOUT_MS = 90_000;

export class StateManager {
  runners = new Set<WebSocket>();
  clients = new Map<string, Set<WebSocket>>();
  jobs = new Map<string, WebSocket>();
  pendingChallenges = new Map<WebSocket, string>();
  pendingParses = new Map<string, (r: Response) => void>();
  pendingParseUrls = new Map<string, string>();
  // The runner each parse request went to; only that runner may answer it.
  pendingParseRunners = new Map<string, WebSocket>();
  // MCP SSE connections, each with the user who opened it (handlers/sse.ts).
  sseStreams = new Map<string, { controller: ReadableStreamDefaultController; userId: string }>();
  delivery: DeliveryTracker;

  constructor(private state: DurableObjectState) {
    this.delivery = new DeliveryTracker(state);
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

  /**
   * Drops heartbeat runners that have gone silent: they leave the runner set, their in-memory job
   * assignments are released (the runs can be resumed by the agent's next connection) and the
   * socket is closed. Call before listing runners or choosing one for a scan.
   */
  pruneDeadRunners(now: number = Date.now()): void {
    for (const ws of [...this.runners, ...this.pendingChallenges.keys()]) {
      if (!this.isHeartbeatExpired(ws, now)) continue;
      this.runners.delete(ws);
      this.pendingChallenges.delete(ws);
      for (const [runId, r] of this.jobs.entries()) {
        if (r === ws) this.jobs.delete(runId);
      }
      try {
        ws.close(1011, 'heartbeat timeout');
      } catch { /* already gone */ }
    }
  }

  private isHeartbeatExpired(ws: WebSocket, now: number): boolean {
    type HeartbeatAttachment = { heartbeat?: unknown; connectedAt?: unknown } | null | undefined;
    let att: HeartbeatAttachment;
    try {
      att = ws.deserializeAttachment?.() as HeartbeatAttachment;
    } catch {
      return false;
    }
    if (!att || att.heartbeat !== true) return false;
    const pongAt = typeof this.state.getWebSocketAutoResponseTimestamp === 'function'
      ? this.state.getWebSocketAutoResponseTimestamp(ws)
      : null;
    const lastSeen = pongAt ? pongAt.getTime() : (typeof att.connectedAt === 'number' ? att.connectedAt : now);
    return now - lastSeen > RUNNER_HEARTBEAT_TIMEOUT_MS;
  }

  /** A platform runner that may take any tenant's scans; every other runner serves one user. */
  isSharedRunner(ws: WebSocket): boolean {
    return isSharedRunnerTags(this.state.getTags(ws));
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

