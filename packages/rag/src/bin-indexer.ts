#!/usr/bin/env node
import * as path from 'node:path';
import * as os from 'node:os';
import { CodeIndexer } from './indexer.js';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command !== 'watch') {
    console.error('Usage: swazz-indexer watch [--db-dir <dir>]');
    process.exit(1);
  }

  // Parse arguments
  let dbDir = path.join(os.homedir(), '.gemini/antigravity/sidecar_data/swazz-rag/data');
  
  for (let i = 1; i < args.length; i++) {
    if (args[i] === '--db-dir' && i + 1 < args.length) {
      dbDir = args[i + 1];
      i++;
    }
  }

  // If dbDir is relative, resolve it against workspace directory
  const workspaceDir = process.cwd();
  if (!path.isAbsolute(dbDir)) {
    dbDir = path.resolve(workspaceDir, dbDir);
  }

  const excludesStr = process.env.WATCH_EXCLUDES || 'node_modules,.git,dist,build,tmp';
  const excludes = excludesStr.split(',').map(s => s.trim());
  const modelEnv = process.env.EMBEDDING_MODEL || 'local';

  console.log(`[Swazz RAG] Initializing Indexer Sidecar:`);
  console.log(`  Workspace: ${workspaceDir}`);
  console.log(`  DB Dir:    ${dbDir}`);
  console.log(`  Excludes:  ${excludes.join(', ')}`);
  console.log(`  Embedder:  ${modelEnv}`);

  const indexer = new CodeIndexer({
    dbDir,
    workspaceDir,
    excludes,
    modelEnv
  });

  // Run initial scan
  await indexer.initialScan();

  // Start watching filesystem
  indexer.startWatcher();

  // Handle termination signals
  const cleanup = () => {
    console.log('[Swazz RAG] Terminating Indexer Sidecar...');
    indexer.close();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

main().catch(err => {
  console.error('[Swazz RAG] Indexer Sidecar failed:', err);
  process.exit(1);
});
