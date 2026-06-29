export function splitSql(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inInlineComment = false;
  let inMultiLineComment = false;
  let inTrigger = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const nextChar = sql[i + 1] || "";

    if (inSingleQuote) {
      if (char === "'") inSingleQuote = false;
      current += char;
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"') inDoubleQuote = false;
      current += char;
      continue;
    }
    if (inInlineComment) {
      if (char === "\n") inInlineComment = false;
      continue;
    }
    if (inMultiLineComment) {
      if (char === "*" && nextChar === "/") {
        inMultiLineComment = false;
        i++;
      }
      continue;
    }

    if (char === "'" && !inTrigger) {
      inSingleQuote = true;
      current += char;
      continue;
    }
    if (char === '"' && !inTrigger) {
      inDoubleQuote = true;
      current += char;
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

    const uppercaseCurrent = current.trim().toUpperCase();
    if (uppercaseCurrent.startsWith("CREATE TRIGGER") || uppercaseCurrent.startsWith("CREATE OR REPLACE TRIGGER")) {
      inTrigger = true;
    }

    if (inTrigger && uppercaseCurrent.endsWith("END;")) {
      current += char;
      statements.push(current.trim());
      current = "";
      inTrigger = false;
      continue;
    }

    if (char === ";" && !inTrigger) {
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
