export interface FileChunk {
  startLine: number;
  endLine: number;
  content: string;
}

export function chunkFile(filepath: string, content: string): FileChunk[] {
  const ext = filepath.substring(filepath.lastIndexOf('.')).toLowerCase();

  if (ext === '.md') {
    return chunkMarkdown(content);
  } else if (ext === '.go') {
    return chunkBraceLanguages(content, ['func ', 'type ']);
  } else if (ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx') {
    return chunkBraceLanguages(content, ['function ', 'class ', 'interface ', 'type ', 'const ', 'let ', 'export ']);
  } else {
    // Default fallback chunker: 50 lines with 10 lines overlap
    return chunkFallback(content);
  }
}

function chunkMarkdown(content: string): FileChunk[] {
  const lines = content.split('\n');
  const chunks: FileChunk[] = [];
  let currentHeader = '';
  let currentLines: string[] = [];
  let startLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('# ')) {
      // Flush previous chunk
      if (currentLines.length > 0) {
        chunks.push({
          startLine,
          endLine: i,
          content: (currentHeader ? currentHeader + '\n' : '') + currentLines.join('\n')
        });
      }
      currentHeader = line;
      currentLines = [];
      startLine = i + 1;
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    chunks.push({
      startLine,
      endLine: lines.length,
      content: (currentHeader ? currentHeader + '\n' : '') + currentLines.join('\n')
    });
  }

  return chunks.length > 0 ? chunks : [{ startLine: 1, endLine: lines.length, content }];
}

function chunkBraceLanguages(content: string, declarationKeywords: string[]): FileChunk[] {
  const lines = content.split('\n');
  const chunks: FileChunk[] = [];
  const processedLines = new Set<number>();

  let i = 0;
  while (i < lines.length) {
    const line = lines[i].trim();

    if (line.startsWith('//') || line.startsWith('/*') || line.startsWith('*')) {
      i++;
      continue;
    }

    // Check if this line starts a logical block (function, struct, class)
    let isDecl = false;
    for (const kw of declarationKeywords) {
      if (line.includes(kw)) {
        isDecl = true;
        break;
      }
    }

    if (isDecl && !processedLines.has(i)) {
      // Look for the starting brace '{' and match it with '}'
      let startLine = i + 1;
      let braceCount = 0;
      let foundStartBrace = false;
      let endLine = i + 1;

      // Scan ahead to match braces, ignoring strings and comments
      let inString: string | null = null;
      let inMultilineComment = false;

      for (let j = i; j < lines.length; j++) {
        const scanLine = lines[j];
        let k = 0;
        while (k < scanLine.length) {
          if (inMultilineComment) {
            if (scanLine[k] === '*' && scanLine[k + 1] === '/') {
              inMultilineComment = false;
              k += 2;
            } else {
              k++;
            }
            continue;
          }

          if (!inString && scanLine[k] === '/' && scanLine[k + 1] === '/') {
            break; // Ignore rest of the line
          }

          if (!inString && scanLine[k] === '/' && scanLine[k + 1] === '*') {
            inMultilineComment = true;
            k += 2;
            continue;
          }

          const char = scanLine[k];

          if (inString) {
            if (char === '\\') {
              k += 2; // Skip escaped char
              continue;
            }
            if (char === inString) {
              inString = null;
            }
            k++;
            continue;
          }

          if (char === '"' || char === "'" || char === String.fromCharCode(96)) {
            inString = char;
            k++;
            continue;
          }

          if (char === '{') {
            braceCount++;
            foundStartBrace = true;
          } else if (char === '}') {
            braceCount--;
          }
          k++;
        }

        if (foundStartBrace && braceCount === 0) {
          endLine = j + 1;
          break;
        }

        // If we scanned more than 150 lines and didn't close braces, stop to avoid runaway chunking
        if (j - i > 150) {
          endLine = j + 1;
          break;
        }
      }

      if (foundStartBrace) {
        const chunkContent = lines.slice(startLine - 1, endLine).join('\n');
        
        // If the logical block is large (e.g. > 50 lines), split it into overlapping sub-chunks
        // to prevent semantic signal dilution, while keeping the parent block as well.
        if (endLine - startLine > 50) {
          const blockLines = lines.slice(startLine - 1, endLine);
          for (let o = 0; o < blockLines.length; o += 40) {
            const subLines = blockLines.slice(o, o + 50);
            chunks.push({
              startLine: startLine + o,
              endLine: Math.min(startLine + o + subLines.length - 1, endLine),
              content: subLines.join('\n')
            });
            if (o + 50 >= blockLines.length) break;
          }
        } else {
          chunks.push({
            startLine,
            endLine,
            content: chunkContent
          });
        }

        for (let idx = startLine - 1; idx < endLine; idx++) {
          processedLines.add(idx);
        }

        i = endLine; // Skip ahead
        continue;
      }
    }
    
    i++;
  }

  // Handle remaining lines that were not part of any brace blocks (e.g. package statements, imports, globals)
  let orphanStart = -1;
  for (let idx = 0; idx < lines.length; idx++) {
    if (!processedLines.has(idx)) {
      if (orphanStart === -1) {
        orphanStart = idx;
      }
    } else {
      if (orphanStart !== -1) {
        flushOrphan(lines, orphanStart, idx, chunks);
        orphanStart = -1;
      }
    }
  }
  if (orphanStart !== -1) {
    flushOrphan(lines, orphanStart, lines.length, chunks);
  }

  // Sort chunks by startLine
  chunks.sort((a, b) => a.startLine - b.startLine);

  return chunks.length > 0 ? chunks : [{ startLine: 1, endLine: lines.length, content }];
}

function flushOrphan(lines: string[], startIdx: number, endIdx: number, chunks: FileChunk[]) {
  const orphanLines = lines.slice(startIdx, endIdx);
  const content = orphanLines.join('\n');
  if (content.trim().length === 0) return;

  // If orphan is small, just make it a single chunk
  if (orphanLines.length <= 50) {
    chunks.push({
      startLine: startIdx + 1,
      endLine: endIdx,
      content: content
    });
  } else {
    // Split large orphans into 40-line blocks
    for (let o = 0; o < orphanLines.length; o += 40) {
      const chunkLines = orphanLines.slice(o, o + 50); // 10 lines overlap
      const chunkContent = chunkLines.join('\n');
      if (chunkContent.trim().length === 0) continue;
      chunks.push({
        startLine: startIdx + o + 1,
        endLine: Math.min(startIdx + o + chunkLines.length, endIdx),
        content: chunkContent
      });
    }
  }
}

function chunkFallback(content: string): FileChunk[] {
  const lines = content.split('\n');
  const chunks: FileChunk[] = [];
  
  if (lines.length <= 60) {
    return [{ startLine: 1, endLine: lines.length, content }];
  }

  for (let i = 0; i < lines.length; i += 40) {
    const chunkLines = lines.slice(i, i + 50); // 10 lines overlap
    chunks.push({
      startLine: i + 1,
      endLine: Math.min(i + chunkLines.length, lines.length),
      content: chunkLines.join('\n')
    });
    if (i + 50 >= lines.length) {
      break;
    }
  }

  return chunks;
}
