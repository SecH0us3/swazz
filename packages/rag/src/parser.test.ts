import { describe, it, expect } from 'vitest';
import { chunkFile } from './parser.js';

describe('Logical Chunker Parser (parser.ts)', () => {
  it('should chunk Markdown files by headings', () => {
    const content = `# Section 1
This is text in section 1.
## Subsection 1.1
Some subsection text.
# Section 2
Text in section 2.`;

    const chunks = chunkFile('README.md', content);
    expect(chunks.length).toBeGreaterThanOrEqual(2);

    expect(chunks[0].content).toContain('# Section 1');
    expect(chunks[0].content).toContain('Subsection 1.1');
    expect(chunks[1].content).toContain('# Section 2');
  });

  it('should chunk Go files by logical blocks (functions/types)', () => {
    const content = `package main

import "fmt"

type Runner struct {
	Name string
}

func main() {
	fmt.Println("Hello")
}

func helper() {
	// brief helper
}`;

    const chunks = chunkFile('main.go', content);
    // Should extract package/imports block, Runner struct, main function, and helper function
    expect(chunks.length).toBe(4);

    // Verify main function chunk content
    const mainChunk = chunks.find(c => c.content.includes('func main()'));
    expect(mainChunk).toBeDefined();
    expect(mainChunk?.startLine).toBe(9);
    expect(mainChunk?.endLine).toBe(11);
  });

  it('should chunk TypeScript/JavaScript files by logical blocks', () => {
    const content = `import React from 'react';

export interface Props {
  name: string;
}

export function Welcome({ name }: Props) {
  return <h1>Hello, {name}</h1>;
}

class Calculator {
  add(a: number, b: number) {
    return a + b;
  }
}`;

    const chunks = chunkFile('Welcome.tsx', content);
    expect(chunks.length).toBe(4);

    const welcomeChunk = chunks.find(c => c.content.includes('function Welcome'));
    expect(welcomeChunk).toBeDefined();
    expect(welcomeChunk?.startLine).toBe(7);

    const classChunk = chunks.find(c => c.content.includes('class Calculator'));
    expect(classChunk).toBeDefined();
    expect(classChunk?.startLine).toBe(11);
  });

  it('should split very large functions/blocks into overlapping sub-chunks (sub-chunking)', () => {
    // Generate a function that has 60 lines of code (exceeds our 50-line threshold)
    const functionLines: string[] = ['func startAgent() {'];
    for (let i = 1; i <= 55; i++) {
      functionLines.push(`  // Line index ${i} of dummy business logic`);
    }
    functionLines.push('}');
    const content = functionLines.join('\n');

    const chunks = chunkFile('agent.go', content);
    // Since block length > 50 lines, it must trigger sub-chunking
    // It should yield at least 2 sub-chunks (first 50 lines, and remainder)
    expect(chunks.length).toBeGreaterThanOrEqual(2);
    
    // Check that all sub-chunks are smaller than the parent block size
    for (const chunk of chunks) {
      const lineCount = chunk.endLine - chunk.startLine + 1;
      expect(lineCount).toBeLessThan(58); // Must be smaller than full function size (57 lines)
    }
  });

  it('should fallback to sliding window line chunking for unsupported extensions', () => {
    // Write 80 lines of random configuration parameters
    const lines = Array.from({ length: 80 }, (_, i) => `config.param.${i}=value`);
    const content = lines.join('\n');

    const chunks = chunkFile('app.config', content);
    // Sliding fallback splits into 50-line window blocks with 10-line overlap
    expect(chunks.length).toBe(2);
    expect(chunks[0].startLine).toBe(1);
    expect(chunks[0].endLine).toBe(50);
    expect(chunks[1].startLine).toBe(41);
    expect(chunks[1].endLine).toBe(80);
  });
});
