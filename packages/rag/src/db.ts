import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Chunk {
  id?: string;
  filepath: string;
  startLine: number;
  endLine: number;
  content: string;
  vector: number[];
}

export function initDb(dbPath: string): DatabaseSync {
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const db = new DatabaseSync(dbPath);

  // Enable WAL mode for concurrency and performance
  db.exec('PRAGMA journal_mode = WAL;');

  // Create tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS files (
      filepath TEXT PRIMARY KEY,
      hash TEXT NOT NULL,
      last_indexed INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chunks (
      id TEXT PRIMARY KEY,
      filepath TEXT NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      content TEXT NOT NULL,
      vector TEXT NOT NULL,
      FOREIGN KEY(filepath) REFERENCES files(filepath) ON DELETE CASCADE
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS queue (
      filepath TEXT PRIMARY KEY,
      added_at INTEGER NOT NULL
    );
  `);

  // Index on chunks filepath for cascade/deletes and quick retrieval
  db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_filepath ON chunks(filepath);`);

  return db;
}

export function getFileHash(db: DatabaseSync, filepath: string): string | null {
  const stmt = db.prepare('SELECT hash FROM files WHERE filepath = ?');
  const row = stmt.get(filepath) as { hash: string } | undefined;
  return row ? row.hash : null;
}

export function insertFile(db: DatabaseSync, filepath: string, hash: string) {
  const stmt = db.prepare('INSERT OR REPLACE INTO files (filepath, hash, last_indexed) VALUES (?, ?, ?)');
  stmt.run(filepath, hash, Date.now());
}

export function deleteFile(db: DatabaseSync, filepath: string) {
  // Clear chunks first (SQLite cascade delete will also handle this, but let's be safe)
  clearFileChunks(db, filepath);
  const stmt = db.prepare('DELETE FROM files WHERE filepath = ?');
  stmt.run(filepath);
}

export function clearFileChunks(db: DatabaseSync, filepath: string) {
  const stmt = db.prepare('DELETE FROM chunks WHERE filepath = ?');
  stmt.run(filepath);
}

export function insertChunk(db: DatabaseSync, chunk: Chunk) {
  const id = `${chunk.filepath}:${chunk.startLine}:${chunk.endLine}`;
  const vectorStr = JSON.stringify(chunk.vector);
  const stmt = db.prepare('INSERT OR REPLACE INTO chunks (id, filepath, start_line, end_line, content, vector) VALUES (?, ?, ?, ?, ?, ?)');
  stmt.run(id, chunk.filepath, chunk.startLine, chunk.endLine, chunk.content, vectorStr);
}

export function queueFile(db: DatabaseSync, filepath: string) {
  const stmt = db.prepare('INSERT OR REPLACE INTO queue (filepath, added_at) VALUES (?, ?)');
  stmt.run(filepath, Date.now());
}

export function dequeueFile(db: DatabaseSync, filepath: string) {
  const stmt = db.prepare('DELETE FROM queue WHERE filepath = ?');
  stmt.run(filepath);
}

export function getQueueCount(db: DatabaseSync): number {
  const stmt = db.prepare('SELECT COUNT(*) as count FROM queue');
  const row = stmt.get() as { count: number } | undefined;
  return row ? row.count : 0;
}

export function clearQueue(db: DatabaseSync) {
  db.exec('DELETE FROM queue');
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return normA === 0 || normB === 0 ? 0 : dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export interface SearchResult {
  filepath: string;
  startLine: number;
  endLine: number;
  content: string;
  similarity: number;
}

export function searchChunks(db: DatabaseSync, queryVector: number[], limit: number = 5, threshold: number = 0.7): SearchResult[] {
  const stmt = db.prepare('SELECT filepath, start_line, end_line, content, vector FROM chunks');
  const rows = stmt.all() as Array<{ filepath: string, start_line: number, end_line: number, content: string, vector: string }>;

  const results: SearchResult[] = [];
  for (const row of rows) {
    try {
      const vector = JSON.parse(row.vector) as number[];
      const similarity = cosineSimilarity(queryVector, vector);
      if (similarity >= threshold) {
        results.push({
          filepath: row.filepath,
          startLine: row.start_line,
          endLine: row.end_line,
          content: row.content,
          similarity
        });
      }
    } catch (e) {
      // Ignore parsing errors for individual rows
    }
  }

  // Sort by similarity descending
  results.sort((a, b) => b.similarity - a.similarity);

  return results.slice(0, limit);
}
