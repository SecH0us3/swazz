import { describe, it, expect } from 'vitest';
import { KeywordHashEmbeddingClient } from './embedding.js';

describe('Keyword Hash Embedding Generator (embedding.ts)', () => {
  const client = new KeywordHashEmbeddingClient();

  it('should generate a 384-dimensional vector', async () => {
    const text = 'function calculateSum(a, b) { return a + b; }';
    const vector = await client.getEmbedding(text);
    
    expect(vector).toBeInstanceOf(Array);
    expect(vector).toHaveLength(384);
  });

  it('should normalize vectors (L2 norm equal to 1)', async () => {
    const text = 'func connectToTargetCoordinator()';
    const vector = await client.getEmbedding(text);

    // Calculate L2 norm: sum of squares should be close to 1 (or 0 if empty)
    let sumSq = 0;
    for (const val of vector) {
      sumSq += val * val;
    }
    
    expect(sumSq).toBeCloseTo(1.0, 5);
  });

  it('should produce identical vectors for identical inputs', async () => {
    const text = 'class RunnerHelper { start() {} }';
    const v1 = await client.getEmbedding(text);
    const v2 = await client.getEmbedding(text);

    expect(v1).toEqual(v2);
  });

  it('should produce different vectors for different inputs', async () => {
    const t1 = 'func handleJobCommandPayload()';
    const t2 = 'const showToastNotification = () => {}';
    const v1 = await client.getEmbedding(t1);
    const v2 = await client.getEmbedding(t2);

    expect(v1).not.toEqual(v2);
  });

  it('should filter out programming language stop words', async () => {
    // Only stop words
    const stopWordsOnly = 'function var let const return package import';
    const vector = await client.getEmbedding(stopWordsOnly);

    // Check that all dimensions are 0 except the fallback dimension index 0
    // Because there were no content words, it returns [1, 0, 0, ...]
    expect(vector[0]).toBeCloseTo(1.0, 5);
    for (let i = 1; i < 384; i++) {
      expect(vector[i]).toBe(0);
    }
  });
});
