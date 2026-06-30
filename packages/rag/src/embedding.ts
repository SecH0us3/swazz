import { pipeline } from '@huggingface/transformers';

export interface EmbeddingClient {
  getEmbedding(text: string): Promise<number[]>;
  getEmbeddings(texts: string[]): Promise<number[][]>;
}

// ─── LOCAL KEYWORD-HASH EMBEDDING FALLBACK ─────────────────────────────────
// Generates a 384-dimensional normalized vector based on word hashes.
// This is a robust fallback if ONNX fails to load/download or if offline.
export class KeywordHashEmbeddingClient implements EmbeddingClient {
  private stopWords = new Set([
    'and', 'or', 'but', 'if', 'else', 'for', 'while', 'do', 'func', 'function',
    'var', 'const', 'let', 'import', 'from', 'package', 'return', 'interface',
    'type', 'struct', 'class', 'public', 'private', 'protected', 'default',
    'string', 'number', 'boolean', 'any', 'void', 'int', 'float', 'err', 'error',
    'nil', 'null', 'undefined', 'this', 'self', 'true', 'false'
  ]);

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  public async getEmbedding(text: string): Promise<number[]> {
    const vector = new Array(384).fill(0);
    const words = text
      .toLowerCase()
      .split(/[^a-zA-Z0-9_\-]+/)
      .filter(w => w.length > 1 && !this.stopWords.has(w));

    if (words.length === 0) {
      // Return a unit vector if empty
      vector[0] = 1;
      return vector;
    }

    // Accumulate word occurrences with a simple hashing trick
    for (const word of words) {
      const idx = this.simpleHash(word) % 384;
      vector[idx] += 1;
    }

    // Normalize the vector (L2 norm)
    let sumSq = 0;
    for (let i = 0; i < 384; i++) {
      sumSq += vector[i] * vector[i];
    }
    const norm = Math.sqrt(sumSq);
    if (norm > 0) {
      for (let i = 0; i < 384; i++) {
        vector[i] /= norm;
      }
    }

    return vector;
  }

  public async getEmbeddings(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map(t => this.getEmbedding(t)));
  }
}

// ─── TRANSFORMERS ONNX EMBEDDING CLIENT ─────────────────────────────────────
export class ONNXEmbeddingClient implements EmbeddingClient {
  private extractor: any = null;
  private initPromise: Promise<void> | null = null;
  private fallbackClient = new KeywordHashEmbeddingClient();

  private async init() {
    if (this.extractor) return;
    if (!this.initPromise) {
      this.initPromise = (async () => {
        try {
          console.log('[Swazz RAG] Loading ONNX model Xenova/all-MiniLM-L6-v2...');
          this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
            progress_callback: (info: any) => {
              if (info.status === 'downloading') {
                console.log(`[Swazz RAG] Downloading model: ${info.file} (${Math.round(info.loaded / 1024 / 1024)}MB / ${Math.round(info.total / 1024 / 1024)}MB)`);
              }
            }
          });
          console.log('[Swazz RAG] ONNX model loaded successfully.');
        } catch (err) {
          console.error('[Swazz RAG] Failed to load ONNX model, using keyword-hash fallback:', err);
          this.extractor = null;
        }
      })();
    }
    await this.initPromise;
  }

  public async getEmbedding(text: string): Promise<number[]> {
    await this.init();
    if (!this.extractor) {
      return this.fallbackClient.getEmbedding(text);
    }

    try {
      const output = await this.extractor(text, { pooling: 'mean', normalize: true });
      return Array.from(output.data) as number[];
    } catch (err) {
      console.error('[Swazz RAG] ONNX extraction error, falling back:', err);
      return this.fallbackClient.getEmbedding(text);
    }
  }

  public async getEmbeddings(texts: string[]): Promise<number[][]> {
    await this.init();
    if (!this.extractor) {
      return this.fallbackClient.getEmbeddings(texts);
    }

    try {
      const results = await Promise.all(
        texts.map(async (text) => {
          const output = await this.extractor(text, { pooling: 'mean', normalize: true });
          return Array.from(output.data) as number[];
        })
      );
      return results;
    } catch (err) {
      console.error('[Swazz RAG] ONNX batch extraction error, falling back:', err);
      return this.fallbackClient.getEmbeddings(texts);
    }
  }
}

// ─── DYNAMIC EMBEDDING CLIENT CONFIGURATION ────────────────────────────────
export function createEmbeddingClient(modelEnv: string = 'local'): EmbeddingClient {
  if (modelEnv === 'keyword' || modelEnv === 'hash') {
    console.log('[Swazz RAG] Configured to use local keyword-hash vectorizer.');
    return new KeywordHashEmbeddingClient();
  }
  return new ONNXEmbeddingClient();
}
