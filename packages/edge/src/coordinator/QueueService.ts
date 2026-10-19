// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Env } from '../env';
import { isRunnerOwnedBy, isSharedRunnerTags, configForRunner, getRunnerOwnerId, runnerIdentity } from './runnerAccess';
import { StateManager, MAX_ACTIVE_JOBS_PER_RUNNER } from './StateManager';
import { scanStateKeys, clearScanState, batchStorageGet, FINISHED_SCANS_KEY, getFinishedScans, getPublicKeyFromTags, recordJobRunner } from './utils';
import { ScansRepository } from '../repositories/scans';
import { logError } from '../../../common/logging/logger';
import { isValidScanConfigKey, isScanConfigKeyForRun, getScanConfig, deleteScanConfig, ScanConfigNotFoundError } from '../services/scanConfigStore';

export { MAX_ACTIVE_JOBS_PER_RUNNER };

export class QueueService {
  private inFlightByRunner = new Map<WebSocket, Promise<void>>();
  private pendingRerun = new Set<WebSocket>();

  constructor(
    private env: Env,
    private state: DurableObjectState,
    private stateManager: StateManager
  ) {}

  checkAndDispatchQueuedScans(ws: WebSocket): Promise<void> {
    const existing = this.inFlightByRunner.get(ws);
    if (existing) {
      this.pendingRerun.add(ws);
      return existing;
    }

    const runLoop = async () => {
      try {
        do {
          this.pendingRerun.delete(ws);
          await this.dispatchPass(ws);
        } while (this.pendingRerun.has(ws) && this.stateManager.hasCapacity(ws));
      } finally {
        this.pendingRerun.delete(ws);
        this.inFlightByRunner.delete(ws);
      }
    };

    const p = runLoop();
    this.inFlightByRunner.set(ws, p);
    return p;
  }

  /**
   * Marks a scan that can never be dispatched as failed and drops its coordinator state. Pass
   * ownConfigRef only when the stored config object belongs to this scan and should be deleted.
   */
  private async failScan(scansRepo: ScansRepository, scanId: string, ownConfigRef?: string): Promise<void> {
    try {
      if (await scansRepo.markFailedIfActive(scanId)) {
        await clearScanState(this.state.storage, scanId);
        if (ownConfigRef) await deleteScanConfig(this.env, ownConfigRef);
      }
    } catch (dbErr) {
      logError({ env: this.env, executionCtx: this.state }, "Coordinator", "Failed to update scan status to failed", { error: dbErr });
    }
  }

  private connectedRunnerOwners(): Set<string> {
    const owners = new Set<string>();
    for (const runnerWs of this.stateManager.runners) {
      const tags = this.state.getTags(runnerWs);
      const owner = isSharedRunnerTags(tags) ? null : getRunnerOwnerId(tags);
      if (owner) owners.add(owner);
    }
    return owners;
  }

  private collectRecentJobIds(ws: WebSocket): Set<string> {
    const recent = new Set<string>();
    const addFromSocket = (socket: WebSocket) => {
      try {
        const att = socket.deserializeAttachment?.() as { recentJobs?: unknown } | null;
        if (Array.isArray(att?.recentJobs)) {
          for (const id of att.recentJobs) {
            if (typeof id === 'string') {
              recent.add(id);
            }
          }
        }
      } catch {}
    };
    for (const runnerWs of this.stateManager.runners) {
      addFromSocket(runnerWs);
    }
    if (!this.stateManager.runners.has(ws)) {
      addFromSocket(ws);
    }
    return recent;
  }

  private async dispatchPass(ws: WebSocket): Promise<void> {
    try {
      const wasRunner = this.stateManager.runners.has(ws);
      this.stateManager.pruneDeadRunners();
      if (wasRunner && !this.stateManager.runners.has(ws)) {
        return;
      }
      if (!this.stateManager.hasCapacity(ws)) {
        return;
      }

      const tags = this.state.getTags(ws);
      const runnerPubKey = getPublicKeyFromTags(tags) || null;
      const isShared = isSharedRunnerTags(tags);

      const scansRepo = new ScansRepository(this.env);
      const activeScans = await scansRepo.getActiveScans();

      if (!activeScans || activeScans.length === 0) {
        return;
      }

      // Request per-scan state keys + the bounded finished_runs ring buffer in <=128-key batches
      const keys = [...activeScans.flatMap(scan => scanStateKeys(scan.id)), FINISHED_SCANS_KEY];
      const storedData = await batchStorageGet<any>(this.state.storage, keys);
      const finishedList = storedData.get(FINISHED_SCANS_KEY);
      const finishedScans = new Set<string>(Array.isArray(finishedList) ? finishedList : []);
      const recentJobs = this.collectRecentJobIds(ws);
      // Owners with a runner of their own connected: their scans wait for it, even when it is
      // busy, rather than going to a shared runner (the same rule as DispatchHandler).
      const ownersWithOwnRunner = isShared ? this.connectedRunnerOwners() : new Set<string>();

      for (const scan of activeScans) {
        // Skip scans that recently finished on any runner (either recorded durably in DO storage
        // under 'finished_runs' or in a live runner's recentJobs attachment) while FINDINGS_QUEUE
        // is still persisting the terminal status to D1.
        if (finishedScans.has(scan.id) || recentJobs.has(scan.id)) {
          continue;
        }
        // If the job is already active in memory, skip it
        if ((scan.status === 'dispatched' || scan.status === 'paused') && this.stateManager.jobs.has(scan.id)) {
          continue;
        }

        const [configKey, configRefKey, configMetaKey, userPubKeyKey] = scanStateKeys(scan.id);
        const scanUserPubKey = storedData.get(userPubKeyKey) || scan.userPublicKey || "";
        const legacyConfig = storedData.get(configKey);
        const configRef: string | undefined = storedData.get(configRefKey);
        const configMeta: { disableShared?: boolean } | undefined = storedData.get(configMetaKey);

        let isCompatible = false;
        if (String(this.env.AUTH_ENABLED) === 'false') {
          isCompatible = true;
        } else if (!isShared) {
          // A runner that is not an operator shared runner serves its owner's scans only.
          if (isRunnerOwnedBy(tags, scan.user_id)) {
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
          if (!scanUserPubKey && !disableShared && !(scan.user_id && ownersWithOwnRunner.has(scan.user_id))) {
            isCompatible = true;
          }
        }

        if (isCompatible) {
          if (!this.stateManager.hasCapacity(ws)) {
            // Checked before the R2 read too, so a full runner costs no config fetches.
            return;
          }
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
              // The ref names another run's object, so it must not be deleted here.
              await this.failScan(scansRepo, scan.id);
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
                await this.failScan(scansRepo, scan.id);
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
          // A tenant-supplied config that is not an object would throw below, abort the whole
          // pass at this (oldest) scan and starve every scan queued behind it. Fail it instead.
          if (typeof config !== 'object' || Array.isArray(config)) {
            logError({ env: this.env, executionCtx: this.state }, "Coordinator", `Scan ${scan.id} has a non-object config; marking it failed`);
            await this.failScan(scansRepo, scan.id, configRef);
            continue;
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
              config: configForRunner(config, tags, this.env),
              userPublicKey: runnerPubKey || "",
            },
          });

          // Race check across the R2/D1 await: if already assigned or recently finished, skip without sending
          if (this.stateManager.jobs.has(runId) || this.collectRecentJobIds(ws).has(runId)) {
            continue;
          }
          if (configRef || scan.project_id) {
            const latestFinished = await getFinishedScans(this.state.storage);
            if (latestFinished.has(runId)) {
              continue;
            }
          }
          if (!this.stateManager.hasCapacity(ws)) {
            // Leave the rest queued until a slot frees up or another runner connects.
            return;
          }
          const attachment = ws.deserializeAttachment() as { authenticated?: boolean; activeJobs?: string[]; recentJobs?: string[] } | null || {};
          const activeJobs = attachment.activeJobs ? [...attachment.activeJobs] : [];

          this.stateManager.jobs.set(runId, ws);
          try {
            if (!activeJobs.includes(runId)) {
              activeJobs.push(runId);
              ws.serializeAttachment({ ...attachment, activeJobs });
            }
            ws.send(dispatchMsg);
          } catch (sendErr) {
            // Same rollback as the /dispatch handler: the socket is unusable, so stop here
            // and leave this and every later scan queued for the next connect.
            this.stateManager.jobs.delete(runId);
            this.stateManager.runners.delete(ws);
            try {
              ws.serializeAttachment({ ...attachment, activeJobs: activeJobs.filter(id => id !== runId) });
            } catch {}
            logError({ env: this.env, executionCtx: this.state }, "Coordinator", `Failed to dispatch queued scan ${runId}`, { error: sendErr });
            return;
          }

          await recordJobRunner(this.state.storage, runId, runnerIdentity(tags));

          try {
            await scansRepo.updateScanStatus(runId, 'dispatched');
          } catch (dbErr) {
            logError({ env: this.env, executionCtx: this.state }, "Coordinator", "Failed to update scan status to dispatched", { error: dbErr });
          }

          await clearScanState(this.state.storage, runId);
          if (configRef) {
            await deleteScanConfig(this.env, configRef);
          }
          // Continue dispatching compatible queued scans until MAX_ACTIVE_JOBS_PER_RUNNER is reached.
        }
      }
    } catch (err) {
      logError({ env: this.env, executionCtx: this.state }, "Coordinator", "Error in checkAndDispatchQueuedScans", { error: err });
    }
  }
}

