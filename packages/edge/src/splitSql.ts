// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

export function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inInlineComment = false;
  let inMultiLineComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1] || "";

    if (inInlineComment) {
      if (char === "\n") {
        inInlineComment = false;
      }
      continue;
    }

    if (inMultiLineComment) {
      if (char === "*" && nextChar === "/") {
        inMultiLineComment = false;
        i++;
      }
      continue;
    }

    if (inSingleQuote) {
      current += char;
      if (char === "'") {
        if (nextChar === "'") {
          current += "'";
          i++;
        } else {
          inSingleQuote = false;
        }
      }
      continue;
    }

    if (inDoubleQuote) {
      current += char;
      if (char === '"') {
        if (nextChar === '"') {
          current += '"';
          i++;
        } else {
          inDoubleQuote = false;
        }
      }
      continue;
    }

    if (char === "-" && nextChar === "-") {
      inInlineComment = true;
      i++;
      continue;
    }

    if (char === "/" && nextChar === "*") {
      inMultiLineComment = true;
      i++;
      continue;
    }

    if (char === "'") {
      inSingleQuote = true;
      current += char;
      continue;
    }

    if (char === '"') {
      inDoubleQuote = true;
      current += char;
      continue;
    }

    if (char === ";") {
      if (current.trim().length > 0) {
        statements.push(current.trim());
      }
      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim().length > 0) {
    statements.push(current.trim());
  }

  return statements.filter(s => s.trim() !== "");
}
