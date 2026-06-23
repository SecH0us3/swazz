import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { initDb, getFileHash, insertFile, deleteFile, insertChunk, clearFileChunks, queueFile, dequeueFile, getQueueCount, clearQueue, cosineSimilarity, searchChunks } from './db.js';
import { DatabaseSync } from 'node:sqlite';

describe('Database Helper (db.ts)', () => {
  let tempDbDir: string;
  let tempDbPath: string;
  let db: DatabaseSync;

  beforeEach(() => {
    // Create a temporary database file
    tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swazz-rag-test-'));
    tempDbPath = path.join(tempDbDir, 'test-vectors.db');
    db = initDb(tempDbPath);
  });

  afterEach(() => {
    // Close database connection
    db.close();
    // Clean up temporary database directory
    try {
      fs.rmSync(tempDbDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore cleanup errors
    }
  });

  it('should initialize database tables correctly', () => {
    // Check if tables are created by running simple queries
    const stmt1 = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='files'");
    expect(stmt1.get()).toBeDefined();

    const stmt2 = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='chunks'");
    expect(stmt2.get()).toBeDefined();

    const stmt3 = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='queue'");
    expect(stmt3.get()).toBeDefined();
  });

  it('should handle file hashing and tracking operations', () => {
    const file = 'src/test.ts';
    const hash = 'abc123hash';

    expect(getFileHash(db, file)).toBeNull();

    insertFile(db, file, hash);
    expect(getFileHash(db, file)).toBe(hash);

    // Update file hash
    insertFile(db, file, 'newhash456');
    expect(getFileHash(db, file)).toBe('newhash456');

    // Delete file
    deleteFile(db, file);
    expect(getFileHash(db, file)).toBeNull();
  });

  it('should manage the indexing queue', () => {
    expect(getQueueCount(db)).toBe(0);

    queueFile(db, 'file1.ts');
    queueFile(db, 'file2.ts');
    expect(getQueueCount(db)).toBe(2);

    dequeueFile(db, 'file1.ts');
    expect(getQueueCount(db)).toBe(1);

    clearQueue(db);
    expect(getQueueCount(db)).toBe(0);
  });

  it('should calculate cosine similarity correctly', () => {
    const v1 = [1, 0, 0];
    const v2 = [1, 0, 0];
    const v3 = [0, 1, 0];
    const v4 = [-1, 0, 0];

    expect(cosineSimilarity(v1, v2)).toBeCloseTo(1.0); // Identical
    expect(cosineSimilarity(v1, v3)).toBeCloseTo(0.0); // Orthogonal
    expect(cosineSimilarity(v1, v4)).toBeCloseTo(-1.0); // Opposite
  });

  it('should handle chunk insert, delete, and search operations', () => {
    const filepath = 'src/math.ts';
    insertFile(db, filepath, 'hash1');

    insertChunk(db, {
      filepath,
      startLine: 1,
      endLine: 10,
      content: 'function add(a, b) { return a + b; }',
      vector: [1.0, 0.0, 0.0]
    });

    insertChunk(db, {
      filepath,
      startLine: 11,
      endLine: 20,
      content: 'function multiply(a, b) { return a * b; }',
      vector: [0.0, 1.0, 0.0]
    });

    // Check search functionality
    const queryVector = [0.98, 0.2, 0.0];
    const results = searchChunks(db, queryVector, 1, 0.5);

    expect(results).toHaveLength(1);
    expect(results[0].filepath).toBe(filepath);
    expect(results[0].startLine).toBe(1);
    expect(results[0].content).toContain('add');
    expect(results[0].similarity).toBeGreaterThan(0.9);

    // Delete chunks
    clearFileChunks(db, filepath);
    const resultsAfterDelete = searchChunks(db, queryVector, 5, 0.0);
    expect(resultsAfterDelete).toHaveLength(0);
  });
});
