// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// Acknowledged delivery of run events (the agent side is agent_delivery.go). Agents number each
// run's events (seq, from 1 for every new dispatch) and keep them until acknowledged; after a
// reconnect they replay everything unacknowledged. The coordinator therefore:
//  - drops an event whose seq it already processed (a replayed duplicate), acknowledging it once
//    per connection so the agent can let go of it;
//  - acknowledges every ACK_EVERY events and every terminal event, after persisting the run's
//    highest processed seq, so the agent's log stays short.
// Coordinators announce support with DELIVERY_HEADER on the runner's WebSocket upgrade; agents
// that send no seq are handled exactly as before.
//
// Non-goal: exactly-once across a Durable Object restart. Events processed after the last
// persisted ack and replayed after the restart are processed again (at most ACK_EVERY per run).

export const DELIVERY_HEADER = 'X-Swazz-Delivery';
export const ACK_EVERY = 50;

export function deliveredSeqKey(runId: string): string {
  return `delivered_seq:${runId}`;
}

export type SeqVerdict = 'new' | 'duplicate' | 'invalid';

export class DeliveryTracker {
  private lastSeq = new Map<string, number>();
  private sinceAck = new Map<string, number>();
  private duplicateAcked = new WeakMap<WebSocket, Set<string>>();

  constructor(private state: DurableObjectState) {}

  /** Classifies an event's seq and, if it is new, records it as the run's latest. */
  async accept(runId: string, seq: unknown): Promise<SeqVerdict> {
    if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 1) return 'invalid';
    const last = await this.last(runId);
    if (seq <= last) return 'duplicate';
    this.lastSeq.set(runId, seq);
    return 'new';
  }

  /** Counts a processed event; persists and acknowledges every ACK_EVERY events and on terminal ones. */
  async processed(ws: WebSocket, runId: string, seq: number, terminal: boolean): Promise<void> {
    const count = (this.sinceAck.get(runId) ?? 0) + 1;
    if (count < ACK_EVERY && !terminal) {
      this.sinceAck.set(runId, count);
      return;
    }
    this.sinceAck.set(runId, 0);
    await this.state.storage.put(deliveredSeqKey(runId), seq);
    sendAck(ws, runId, seq);
  }

  /** A replayed duplicate: tell this connection (once per run) how far the coordinator already is. */
  async duplicate(ws: WebSocket, runId: string): Promise<void> {
    let acked = this.duplicateAcked.get(ws);
    if (!acked) {
      acked = new Set();
      this.duplicateAcked.set(ws, acked);
    }
    if (acked.has(runId)) return;
    acked.add(runId);
    sendAck(ws, runId, await this.last(runId));
  }

  /** A new execution of the run (dispatch): its events are numbered from 1 again. */
  async reset(runId: string): Promise<void> {
    this.lastSeq.delete(runId);
    this.sinceAck.delete(runId);
    try {
      await this.state.storage.delete(deliveredSeqKey(runId));
    } catch (err) {
      console.error(`[Coordinator] Failed to reset delivery state of scan ${runId}`, err);
    }
  }

  private async last(runId: string): Promise<number> {
    const cached = this.lastSeq.get(runId);
    if (cached !== undefined) return cached;
    const stored = await this.state.storage.get<number>(deliveredSeqKey(runId));
    const last = typeof stored === 'number' ? stored : 0;
    this.lastSeq.set(runId, last);
    return last;
  }
}

function sendAck(ws: WebSocket, runId: string, seq: number): void {
  if (seq < 1) return;
  try {
    ws.send(JSON.stringify({ type: 'ack', runId, seq }));
  } catch { /* the connection is gone; the agent replays and gets acknowledged on the next one */ }
}
