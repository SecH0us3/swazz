import { Env } from '../env';
import { StateManager } from './StateManager';
import { ScansRepository } from '../repositories/scans';
import { logError } from '../../../common/logging/logger';

export class QueueService {
  constructor(
    private env: Env,
    private state: DurableObjectState,
    private stateManager: StateManager
  ) {}

  async checkAndDispatchQueuedScans(ws: WebSocket): Promise<void> {
    try {
      const tags = this.state.getTags(ws);
      const runnerPubKey = tags.find(t => 
        t !== 'runner-pending' && 
        t !== 'runner' && 
        !t.startsWith('name:') && 
        !t.startsWith('version:') && 
        !t.startsWith('user_id:')
      ) || null;

      const scansRepo = new ScansRepository(this.env);
      const queuedScans = await scansRepo.getQueuedScans();

      if (!queuedScans || queuedScans.length === 0) {
        return;
      }

      const keys = queuedScans.flatMap(scan => [
        `config:${scan.id}`,
        `user_public_key:${scan.id}`
      ]);
      const storedData = await this.state.storage.get<any>(keys);

      for (const scan of queuedScans) {
        const scanUserPubKey = storedData.get(`user_public_key:${scan.id}`) || scan.userPublicKey || "";
        let config = storedData.get(`config:${scan.id}`);
        
        if (!config && scan.project_id) {
          try {
            const configJson = await scansRepo.getScanConfigByProject(scan.project_id, scan.profile);
            if (configJson) {
              config = JSON.parse(configJson);
            }
          } catch (err) {
            logError(this.env, "Coordinator", "Failed to fetch config from scan_configs", { error: err });
          }
        }
        if (!config) {
          config = {};
        }
        if (!config.base_url) {
          config.base_url = scan.target_url;
        }

        let isCompatible = false;
        if (runnerPubKey) {
          if (scanUserPubKey === runnerPubKey) {
            isCompatible = true;
          }
        } else {
          const disableShared = config.settings?.disable_shared_runners || false;
          if (!scanUserPubKey && !disableShared) {
            isCompatible = true;
          }
        }

        if (isCompatible) {
          const runId = scan.id;
          this.stateManager.jobs.set(runId, ws);
          const attachment = ws.deserializeAttachment() as { authenticated?: boolean; activeJobs?: string[] } | null || {};
          const activeJobs = attachment.activeJobs ? [...attachment.activeJobs] : [];
          if (!activeJobs.includes(runId)) {
            activeJobs.push(runId);
            ws.serializeAttachment({ ...attachment, activeJobs });
          }

          const dispatchMsg = JSON.stringify({
            type: 'job_dispatch',
            payload: {
              runId,
              config,
              userPublicKey: runnerPubKey || "",
            },
          });

          ws.send(dispatchMsg);

          try {
            await scansRepo.updateScanStatus(runId, 'dispatched');
          } catch (dbErr) {
            logError(this.env, "Coordinator", "Failed to update scan status to dispatched", { error: dbErr });
          }

          await this.state.storage.delete(`config:${runId}`);
          await this.state.storage.delete(`user_public_key:${runId}`);
          break;
        }
      }
    } catch (err) {
      logError(this.env, "Coordinator", "Error in checkAndDispatchQueuedScans", { error: err });
    }
  }
}
