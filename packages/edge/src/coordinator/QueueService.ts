// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Env } from '../env';
import { StateManager } from './StateManager';
import { ScansRepository } from '../repositories/scans';
import { logError } from '../../../common/logging/logger';
import { isValidScanConfigKey, isScanConfigKeyForRun, getScanConfig, deleteScanConfig, ScanConfigNotFoundError } from '../services/scanConfigStore';

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
      const activeScans = await scansRepo.getActiveScans();

      if (!activeScans || activeScans.length === 0) {
        return;
      }

      const keys = activeScans.flatMap(scan => [
        `config:${scan.id}`,
        `config_ref:${scan.id}`,
        `config_meta:${scan.id}`,
        `user_public_key:${scan.id}`
      ]);
      const storedData = await this.state.storage.get<any>(keys);

      for (const scan of activeScans) {
        // If the job is already active in memory, skip it
        if ((scan.status === 'dispatched' || scan.status === 'paused') && this.stateManager.jobs.has(scan.id)) {
          continue;
        }

        const scanUserPubKey = storedData.get(`user_public_key:${scan.id}`) || scan.userPublicKey || "";
        const legacyConfig = storedData.get(`config:${scan.id}`);
        const configRef: string | undefined = storedData.get(`config_ref:${scan.id}`);
        const configMeta: { disableShared?: boolean } | undefined = storedData.get(`config_meta:${scan.id}`);

        let isCompatible = false;
        if (String(this.env.AUTH_ENABLED) === 'false') {
          isCompatible = true;
        } else if (runnerPubKey) {
          if (scanUserPubKey === runnerPubKey) {
            isCompatible = true;
          }
        } else {
          let disableShared = false;
          if (legacyConfig !== undefined && legacyConfig !== null) {
            disableShared = legacyConfig.settings?.disable_shared_runners || false;
          } else if (configRef) {
            // Treat a missing meta as disableShared=true — fail closed
            disableShared = configMeta ? !!configMeta.disableShared : true;
          } else if (scan.project_id) {
            try {
              const configJson = await scansRepo.getScanConfigByProject(scan.project_id, scan.profile);
              if (configJson) {
                const parsed = JSON.parse(configJson);
                disableShared = parsed.settings?.disable_shared_runners || false;
              }
            } catch (err) {
              logError({ env: this.env, executionCtx: this.state }, "Coordinator", "Failed to fetch config from scan_configs", { error: err });
            }
          }
          if (!scanUserPubKey && !disableShared) {
            isCompatible = true;
          }
        }

        if (isCompatible) {
          const runId = scan.id;
          let config: any = null;

          if (legacyConfig !== undefined && legacyConfig !== null) {
            config = legacyConfig;
          } else if (configRef) {
            if (this.stateManager.jobs.has(scan.id)) {
              continue;
            }

            if (!isScanConfigKeyForRun(configRef, scan.id)) {
              logError({ env: this.env, executionCtx: this.state }, "Coordinator", `Invalid scan config key in storage for scan ${scan.id}: ${configRef}`);
              try {
                const marked = await scansRepo.markFailedIfActive(scan.id);
                if (marked) {
                  await this.state.storage.delete(`config:${scan.id}`);
                  await this.state.storage.delete(`config_ref:${scan.id}`);
                  await this.state.storage.delete(`config_meta:${scan.id}`);
                  await this.state.storage.delete(`user_public_key:${scan.id}`);
                }
              } catch (dbErr) {
                logError({ env: this.env, executionCtx: this.state }, "Coordinator", "Failed to update scan status to failed", { error: dbErr });
              }
              continue;
            }

            try {
              config = await getScanConfig(this.env, configRef);
            } catch (err) {
              if (this.stateManager.jobs.has(scan.id)) {
                continue;
              }
              if (err instanceof ScanConfigNotFoundError) {
                logError({ env: this.env, executionCtx: this.state }, "Coordinator", `Scan config not found in R2 for scan ${scan.id}`, { error: err });
                try {
                  const marked = await scansRepo.markFailedIfActive(scan.id);
                  if (marked) {
                    await this.state.storage.delete(`config:${scan.id}`);
                    await this.state.storage.delete(`config_ref:${scan.id}`);
                    await this.state.storage.delete(`config_meta:${scan.id}`);
                    await this.state.storage.delete(`user_public_key:${scan.id}`);
                  }
                } catch (dbErr) {
                  logError({ env: this.env, executionCtx: this.state }, "Coordinator", "Failed to update scan status to failed", { error: dbErr });
                }
              } else {
                logError({ env: this.env, executionCtx: this.state }, "Coordinator", `Failed to load scan config from R2 for scan ${scan.id}`, { error: err });
              }
              continue;
            }
          } else if (scan.project_id) {
            try {
              const configJson = await scansRepo.getScanConfigByProject(scan.project_id, scan.profile);
              if (configJson) {
                config = JSON.parse(configJson);
              }
            } catch (err) {
              logError({ env: this.env, executionCtx: this.state }, "Coordinator", "Failed to fetch config from scan_configs", { error: err });
            }
          }

          if (!config) {
            config = {};
          }
          if (!config.base_url) {
            config.base_url = scan.target_url;
          }

          let checkpoint = null;
          if (scan.last_checkpoint) {
            try {
              checkpoint = JSON.parse(scan.last_checkpoint);
            } catch {}
          }

          if (checkpoint) {
            config.settings = config.settings || {};
            config.settings.checkpoint = {
              ...checkpoint,
              paused: scan.status === 'paused'
            };
          }

          const dispatchMsg = JSON.stringify({
            type: 'job_dispatch',
            payload: {
              runId,
              config,
              userPublicKey: runnerPubKey || "",
            },
          });

          // Race check across the R2 await: if already assigned, skip without sending
          if (this.stateManager.jobs.has(runId)) {
            continue;
          }

          this.stateManager.jobs.set(runId, ws);
          const attachment = ws.deserializeAttachment() as { authenticated?: boolean; activeJobs?: string[] } | null || {};
          const activeJobs = attachment.activeJobs ? [...attachment.activeJobs] : [];
          if (!activeJobs.includes(runId)) {
            activeJobs.push(runId);
            ws.serializeAttachment({ ...attachment, activeJobs });
          }

          ws.send(dispatchMsg);

          try {
            await scansRepo.updateScanStatus(runId, 'dispatched');
          } catch (dbErr) {
            logError({ env: this.env, executionCtx: this.state }, "Coordinator", "Failed to update scan status to dispatched", { error: dbErr });
          }

          await this.state.storage.delete(`config:${runId}`);
          await this.state.storage.delete(`config_ref:${runId}`);
          await this.state.storage.delete(`config_meta:${runId}`);
          await this.state.storage.delete(`user_public_key:${runId}`);
          if (configRef) {
            await deleteScanConfig(this.env, configRef);
          }
          break;
        }
      }
    } catch (err) {
      logError({ env: this.env, executionCtx: this.state }, "Coordinator", "Error in checkAndDispatchQueuedScans", { error: err });
    }
  }
}
