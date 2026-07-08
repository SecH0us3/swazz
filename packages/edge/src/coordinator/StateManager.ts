import { getPublicKeyFromTags, getRunIdFromTags } from './utils';

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
}
