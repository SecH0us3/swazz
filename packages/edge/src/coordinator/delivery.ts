// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// Acknowledged delivery of run events (the agent side is agent_delivery.go). Agents number each
// run's events (seq, from 1 for every execution, which carries its own exec id) and keep them
// until acknowledged; after a reconnect they replay everything unacknowledged. The coordinator
// therefore:
//  - persists, per run, the exec and highest seq it processed, with every event, so the record
//    survives hibernation and restarts of the Durable Object;
//  - drops an event of the same exec whose seq it already processed (a replayed duplicate),
//    acknowledging it once per connection so the agent can let go of it; an event of another
//    exec is a new execution of the run (a dispatch elsewhere or a restart) and starts over;
//  - acknowledges every ACK_EVERY events, every terminal event and whatever the agent asks for
//    (ack_request: the tail of a run, or events it refused), each only once the events it covers
//    have been handed to the findings queue or written to D1.
// Coordinators announce support with DELIVERY_HEADER on the runner's WebSocket upgrade; agents
// that send no seq are handled exactly as before.
//
// Non-goal: an event whose persistence fails on both the queue and the D1 fallback is lost (and
// logged); it is acknowledged like the rest, since a replay would be dropped as a duplicate.

export const DELIVERY_HEADER = 'X-Swazz-Delivery';
export const ACK_EVERY = 50;
const MAX_EXEC_LENGTH = 64;

export function deliveredSeqKey(runId: string): string {
  return `delivered_seq:${runId}`;
}

export type SeqVerdict = 'new' | 'duplicate' | 'invalid';

interface DeliveredMark {
  exec: string;
  seq: number;
}

function isValidSeq(seq: unknown): seq is number {
  return typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 1;
}

function isValidExec(exec: unknown): exec is string {
  return typeof exec === 'string' && exec.length > 0 && exec.length <= MAX_EXEC_LENGTH;
}

export class DeliveryTracker {
  private sinceAck = new Map<string, number>();
  // Per run, settles once every event processed so far was persisted (or failed for good).
  private persisting = new Map<string, Promise<unknown>>();
  private duplicateAcked = new WeakMap<WebSocket, Set<string>>();
  private refusalLogged = new WeakMap<WebSocket, Set<string>>();

  constructor(private state: DurableObjectState) {}

  /** Classifies an event's seq and, if it is new, records it as the run's latest. */
  async accept(runId: string, exec: unknown, seq: unknown): Promise<SeqVerdict> {
    if (!isValidSeq(seq) || !isValidExec(exec)) return 'invalid';
    const last = await this.last(runId);
    if (last && last.exec === exec && seq <= last.seq) return 'duplicate';
    await this.state.storage.put(deliveredSeqKey(runId), { exec, seq } satisfies DeliveredMark);
    return 'new';
  }

  /** Tracks the persistence of a processed event: acknowledgements wait for it. */
  persisted(runId: string, done: Promise<unknown>): void {
    const previous = this.persisting.get(runId);
    const all = Promise.allSettled(previous ? [previous, done] : [done]);
    this.persisting.set(runId, all);
    void all.then(() => {
      if (this.persisting.get(runId) === all) this.persisting.delete(runId);
    });
  }

  /**
   * Counts a processed event. Every ACK_EVERY events and on terminal ones, returns the
   * acknowledgement, sent once the events it covers are persisted; the caller keeps it alive.
   */
  processed(ws: WebSocket, runId: string, exec: string, seq: number, terminal: boolean): Promise<void> | undefined {
    const count = (this.sinceAck.get(runId) ?? 0) + 1;
    if (count < ACK_EVERY && !terminal) {
      this.sinceAck.set(runId, count);
      return undefined;
    }
    return this.acknowledge(ws, runId, exec, seq);
  }

  /**
   * The agent asks for acknowledgement of what it sent on this connection up to seq. Its events
   * were handled in order before this message, whether processed or refused.
   */
  requested(ws: WebSocket, runId: unknown, exec: unknown, seq: unknown): Promise<void> | undefined {
    if (typeof runId !== 'string' || runId === '' || !isValidExec(exec) || !isValidSeq(seq)) return undefined;
    return this.acknowledge(ws, runId, exec, seq);
  }

  /** A replayed duplicate: tell this connection (once per run) how far the coordinator already is. */
  async duplicate(ws: WebSocket, runId: string): Promise<void> {
    if (!onceFor(this.duplicateAcked, ws, runId)) return;
    const last = await this.last(runId);
    if (last) await this.acknowledge(ws, runId, last.exec, last.seq);
  }

  /** Whether a refused event of this run is the first on this connection (log it once). */
  firstRefusal(ws: WebSocket, runId: string): boolean {
    return onceFor(this.refusalLogged, ws, runId);
  }

  private async acknowledge(ws: WebSocket, runId: string, exec: string, seq: number): Promise<void> {
    this.sinceAck.delete(runId);
    await this.persisting.get(runId);
    try {
      ws.send(JSON.stringify({ type: 'ack', runId, exec, seq }));
    } catch { /* the connection is gone; the agent replays and gets acknowledged on the next one */ }
  }

  private async last(runId: string): Promise<DeliveredMark | undefined> {
    const stored = await this.state.storage.get<DeliveredMark>(deliveredSeqKey(runId));
    return stored && isValidExec(stored.exec) && isValidSeq(stored.seq) ? stored : undefined;
  }
}

function onceFor(seen: WeakMap<WebSocket, Set<string>>, ws: WebSocket, runId: string): boolean {
  let runs = seen.get(ws);
  if (!runs) {
    runs = new Set();
    seen.set(ws, runs);
  }
  if (runs.has(runId)) return false;
  runs.add(runId);
  return true;
}
