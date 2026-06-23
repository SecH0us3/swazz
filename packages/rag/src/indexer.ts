import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { initDb, getFileHash, insertFile, deleteFile, clearFileChunks, insertChunk, queueFile, dequeueFile, clearQueue } from './db.js';
import { chunkFile } from './parser.js';
import { createEmbeddingClient, EmbeddingClient } from './embedding.js';

export interface IndexerOptions {
  dbDir: string;
  workspaceDir: string;
  excludes: string[];
  modelEnv: string;
}

export class CodeIndexer {
  private db: DatabaseSync;
  private options: IndexerOptions;
  private embedder: EmbeddingClient;
  private isProcessingQueue = false;
  private queueTimeout: NodeJS.Timeout | null = null;
  private watcher: fs.FSWatcher | null = null;

  constructor(options: IndexerOptions) {
    this.options = options;
    const dbPath = path.join(options.dbDir, 'vectors.db');
    this.db = initDb(dbPath);
    this.embedder = createEmbeddingClient(options.modelEnv);
    // Clear any leftover queue items from a previous crash on startup
    clearQueue(this.db);
  }

  private isExcluded(filepath: string): boolean {
    const relativePath = path.relative(this.options.workspaceDir, filepath);
    const parts = relativePath.split(path.sep);
    
    // Check excludes (e.g. node_modules, .git)
    for (const part of parts) {
      if (this.options.excludes.includes(part) || part.startsWith('.')) {
        // Exclude hidden folders like .git, .agents, etc., unless explicitly requested
        if (part !== '.' && part !== '..' && part !== '.agents' && part !== '.gemini') {
          // Keep standard project files and exclude node_modules, build, git
          if (part === '.git' || this.options.excludes.includes(part)) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private isSupportedFile(filepath: string): boolean {
    const ext = path.extname(filepath).toLowerCase();
    return ['.go', '.ts', '.tsx', '.js', '.jsx', '.md'].includes(ext);
  }

  // Synchronously computes SHA256 of file contents
  private getFileContentHash(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  // Scans all files in the workspace (Initial Scan)
  public async initialScan() {
    console.log('[Swazz RAG] Starting initial workspace scan...');
    const startTime = Date.now();
    const filesToIndex: string[] = [];

    const walk = (dir: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (this.isExcluded(fullPath)) continue;

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile() && this.isSupportedFile(fullPath)) {
          filesToIndex.push(fullPath);
        }
      }
    };

    walk(this.options.workspaceDir);
    console.log(`[Swazz RAG] Found ${filesToIndex.length} supported files in workspace.`);

    // Enqueue all files that need indexing
    let enqueuedCount = 0;
    for (const file of filesToIndex) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const currentHash = this.getFileContentHash(content);
        const relativePath = path.relative(this.options.workspaceDir, file);
        const storedHash = getFileHash(this.db, relativePath);

        if (currentHash !== storedHash) {
          queueFile(this.db, relativePath);
          enqueuedCount++;
        }
      } catch (err) {
        // Handle read error (e.g. permissions or removed file)
      }
    }

    console.log(`[Swazz RAG] Enqueued ${enqueuedCount} modified/new files for indexing.`);
    
    // Process the initial queue
    if (enqueuedCount > 0) {
      await this.processQueue();
    }

    // Clean up database for files that no longer exist in the workspace
    const stmt = this.db.prepare('SELECT filepath FROM files');
    const dbFiles = stmt.all() as Array<{ filepath: string }>;
    for (const dbFile of dbFiles) {
      const fullPath = path.join(this.options.workspaceDir, dbFile.filepath);
      if (!fs.existsSync(fullPath)) {
        console.log(`[Swazz RAG] File removed from disk: ${dbFile.filepath}. Deleting from index.`);
        deleteFile(this.db, dbFile.filepath);
      }
    }

    console.log(`[Swazz RAG] Initial scan and sync completed in ${((Date.now() - startTime) / 1000).toFixed(2)}s.`);
  }

  // Background queue worker
  private async processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    try {
      while (true) {
        // Fetch next pending file from queue table
        const stmt = this.db.prepare('SELECT filepath FROM queue ORDER BY added_at ASC LIMIT 1');
        const next = stmt.get() as { filepath: string } | undefined;
        if (!next) break;

        const relPath = next.filepath;
        const fullPath = path.join(this.options.workspaceDir, relPath);

        try {
          if (!fs.existsSync(fullPath)) {
            // File was deleted
            deleteFile(this.db, relPath);
            dequeueFile(this.db, relPath);
            console.log(`[Swazz RAG] Cleaned up deleted file: ${relPath}`);
            continue;
          }

          const content = fs.readFileSync(fullPath, 'utf-8');
          const hash = this.getFileContentHash(content);
          
          // Double check if hash matches stored hash (to avoid double work)
          const storedHash = getFileHash(this.db, relPath);
          if (hash === storedHash) {
            dequeueFile(this.db, relPath);
            continue;
          }

          console.log(`[Swazz RAG] Indexing file: ${relPath}...`);
          
          // Split into logical blocks
          const fileChunks = chunkFile(relPath, content);
          clearFileChunks(this.db, relPath);

          // Insert file record first to satisfy SQLite foreign key constraints
          insertFile(this.db, relPath, hash);

          // Generate embeddings in batches if possible
          for (const chunk of fileChunks) {
            if (chunk.content.trim().length === 0) continue;

            const vector = await this.embedder.getEmbedding(chunk.content);
            insertChunk(this.db, {
              filepath: relPath,
              startLine: chunk.startLine,
              endLine: chunk.endLine,
              content: chunk.content,
              vector
            });
          }
          console.log(`[Swazz RAG] Successfully indexed: ${relPath} (${fileChunks.length} chunks)`);
        } catch (err) {
          console.error(`[Swazz RAG] Error processing file ${relPath}:`, err);
        } finally {
          dequeueFile(this.db, relPath);
        }
      }
    } finally {
      this.isProcessingQueue = false;
    }
  }

  // Debounced queue processing trigger
  private triggerQueueProcessing() {
    if (this.queueTimeout) {
      clearTimeout(this.queueTimeout);
    }
    this.queueTimeout = setTimeout(() => {
      this.processQueue().catch(err => {
        console.error('[Swazz RAG] Error in queue runner:', err);
      });
    }, 150);
  }

  // Starts fs.watch file watcher
  public startWatcher() {
    console.log(`[Swazz RAG] Starting file watcher recursively on: ${this.options.workspaceDir}`);
    
    try {
      this.watcher = fs.watch(this.options.workspaceDir, { recursive: true }, (eventType, filename) => {
        if (!filename) return;

        const fullPath = path.join(this.options.workspaceDir, filename);
        if (this.isExcluded(fullPath)) return;
        if (!this.isSupportedFile(fullPath)) return;

        const relPath = path.relative(this.options.workspaceDir, fullPath);

        // Queue change
        queueFile(this.db, relPath);
        this.triggerQueueProcessing();
      });
      
      this.watcher.on('error', (err) => {
        console.error('[Swazz RAG] Watcher error:', err);
      });
    } catch (err) {
      console.error('[Swazz RAG] Failed to initialize recursive watcher:', err);
    }
  }

  public close() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.queueTimeout) {
      clearTimeout(this.queueTimeout);
      this.queueTimeout = null;
    }
  }
}
