// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// Acknowledged delivery of run events (the agent side is agent_delivery.go). Agents number each
// run's events (seq, from 1 for every execution, which carries its own exec id) and keep them
// until acknowledged; after a reconnect they replay everything unacknowledged. The coordinator
// therefore:
//  - keeps, per run, the exec and highest seq it processed, and writes it to storage once every
//    event up to it has been persisted (so the stored record never covers an event that could
//    still be lost, and survives hibernation, which never interrupts pending work, and restarts);
//  - drops an event of the same exec whose seq it already processed (a replayed duplicate),
//    acknowledging it once per connection so the agent can let go of it; an event of another
//    exec is a new execution of the run (a dispatch elsewhere or a restart) and starts over;
//  - acknowledges every ACK_EVERY events, every terminal event and, for runs the connection owns,
//    whatever the agent asks for (ack_request: the tail of a run) up to what it processed, each
//    only once the events it covers have been handed to the findings queue or written to D1.
// Events of runs the connection does not own are not acknowledged: the refusal may be temporary
// (a failed resume) while the agent still executes the run. The agent discards them on its own
// once the run is no longer executing.
//
// Persistence itself is idempotent (scan_events ids derive from run, exec and seq), so an event
// processed twice, after a restart or from the queue and its D1 fallback, is stored once.
// Coordinators announce support with DELIVERY_HEADER on the runner's WebSocket upgrade; agents
// that send no seq are handled exactly as before.
//
// Non-goal: an event whose persistence fails on both the queue and the D1 fallback is lost (and
// logged); it is acknowledged like the rest, since a replay would be dropped as a duplicate.
// Webhooks of a terminal event processed twice by concurrent consumers may fire twice.

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

const EXEC_PATTERN = new RegExp(`^[A-Za-z0-9_-]{1,${MAX_EXEC_LENGTH}}$`);

// Part of stored event ids (see eventIdFor), so restricted to characters that cannot forge one.
export function isValidExec(exec: unknown): exec is string {
  return typeof exec === 'string' && EXEC_PATTERN.test(exec);
}

export class DeliveryTracker {
  private sinceAck = new Map<string, number>();
  // Per run, the latest processed event, until it is written to storage.
  private marks = new Map<string, DeliveredMark>();
  // Per run, settles once every event processed so far was persisted (or failed for good) and
  // the mark covering them was written.
  private persisting = new Map<string, Promise<unknown>>();
  private duplicateAcked = new WeakMap<WebSocket, Set<string>>();
  private refusalLogged = new WeakMap<WebSocket, Set<string>>();

  constructor(private state: DurableObjectState) {}

  /** Classifies an event's seq and, if it is new, records it as the run's latest. */
  async accept(runId: string, exec: unknown, seq: unknown): Promise<SeqVerdict> {
    if (!isValidSeq(seq) || !isValidExec(exec)) return 'invalid';
    const last = await this.last(runId);
    if (last && last.exec === exec && seq <= last.seq) return 'duplicate';
    this.marks.set(runId, { exec, seq });
    return 'new';
  }

  /**
   * Tracks the persistence of the event just accepted. Once it and every earlier one settled,
   * the run's mark is written to storage and acknowledgements waiting for it go out. The caller
   * keeps the returned promise alive.
   */
  persisted(runId: string, done: Promise<unknown>): Promise<unknown> {
    const mark = this.marks.get(runId);
    const previous = this.persisting.get(runId);
    const chain: Promise<unknown> = Promise.allSettled(previous ? [previous, done] : [done]).then(async () => {
      // A later event extends the chain; its link writes the newer mark.
      if (!mark || this.persisting.get(runId) !== chain) return;
      try {
        await this.state.storage.put(deliveredSeqKey(runId), mark);
      } catch (err) {
        console.error(`[Coordinator] Failed to record the delivery mark of scan ${runId}`, err);
      }
      if (this.persisting.get(runId) === chain) this.persisting.delete(runId);
      if (this.marks.get(runId) === mark) this.marks.delete(runId);
    });
    this.persisting.set(runId, chain);
    return chain;
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
   * The agent asks for acknowledgement of a run the connection owns, up to seq: its events were
   * handled in order before this message. Only what was processed is acknowledged.
   */
  async requested(ws: WebSocket, runId: string, exec: unknown, seq: unknown): Promise<void> {
    if (!isValidExec(exec) || !isValidSeq(seq)) return;
    const last = await this.last(runId);
    if (!last || last.exec !== exec) return;
    await this.acknowledge(ws, runId, exec, Math.min(seq, last.seq));
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
    const pending = this.marks.get(runId);
    if (pending) return pending;
    const stored = await this.state.storage.get<DeliveredMark>(deliveredSeqKey(runId));
    return stored && isValidExec(stored.exec) && isValidSeq(stored.seq) ? stored : undefined;
  }
}

/** The scan_events id of a sequenced event: the same event, processed twice, is stored once. */
export function eventIdFor(runId: string, exec: string, seq: number): string {
  return `ev:${runId}:${exec}:${seq}`;
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
