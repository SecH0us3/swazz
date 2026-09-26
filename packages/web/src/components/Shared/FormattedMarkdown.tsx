// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React, { type ReactNode } from 'react';

export interface FormattedMarkdownProps {
  content?: string | null;
  className?: string;
}

// Matches code blocks, headings (## and ###), double asterisk/underscore bold, inline backticks, and single asterisk italics
const TOKEN_REGEX = /(```[\s\S]*?```|(?:^|\r?\n)[ \t]{0,3}###[ \t]+[^\r\n]*(?:\r?\n)?|(?:^|\r?\n)[ \t]{0,3}##[ \t]+[^\r\n]*(?:\r?\n)?|\*\*[^*]+?\*\*|__[^_]+?__|`[^`]+?`|\*[^*]+?\*)/g;

/**
 * Parses inline markdown tokens safely into React nodes without using innerHTML or unsafe HTML parsing.
 */
export function renderFormattedMarkdown(text?: string | null, keyPrefix = 'md'): ReactNode {
  if (!text) return null;

  const parts = text.split(TOKEN_REGEX);

  return parts.map((part, index) => {
    if (!part) return null;

    const key = `${keyPrefix}-${index}`;

    // Multiline code blocks: ```lang ... ```
    if (part.startsWith('```') && part.endsWith('```') && part.length >= 6) {
      let code = part.slice(3, -3);
      // Strip initial language header if present (e.g. ```json\n)
      code = code.replace(/^[a-zA-Z0-9_-]*\r?\n/, '');
      return (
        <pre key={key} className="ai-markdown-pre">
          <code className="ai-markdown-code-block">{code}</code>
        </pre>
      );
    }

    const trimmed = part.trim();

    // Heading 3: ### Heading
    if (/^[ \t]{0,3}###[ \t]+/.test(trimmed)) {
      const headingText = trimmed.replace(/^[ \t]{0,3}###[ \t]+/, '');
      return (
        <h3 key={key} className="markdown-heading-3">
          {renderFormattedMarkdown(headingText, `${key}-inner`)}
        </h3>
      );
    }

    // Heading 2: ## Heading
    if (/^[ \t]{0,3}##[ \t]+/.test(trimmed)) {
      const headingText = trimmed.replace(/^[ \t]{0,3}##[ \t]+/, '');
      return (
        <h2 key={key} className="markdown-heading-2">
          {renderFormattedMarkdown(headingText, `${key}-inner`)}
        </h2>
      );
    }

    // Bold text: **bold** or __bold__
    if (
      (part.startsWith('**') && part.endsWith('**') && part.length >= 4) ||
      (part.startsWith('__') && part.endsWith('__') && part.length >= 4)
    ) {
      const inner = part.slice(2, -2);
      return (
        <strong key={key} className="ai-markdown-bold">
          {renderFormattedMarkdown(inner, `${key}-inner`)}
        </strong>
      );
    }

    // Inline code: `code`
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      const code = part.slice(1, -1);
      return (
        <code key={key} className="ai-markdown-code">
          {code}
        </code>
      );
    }

    // Italic text: *italic*
    if (part.startsWith('*') && part.endsWith('*') && part.length >= 2) {
      const inner = part.slice(1, -1);
      return (
        <em key={key} className="ai-markdown-italic">
          {renderFormattedMarkdown(inner, `${key}-inner`)}
        </em>
      );
    }

    // Plain text
    return <React.Fragment key={key}>{part}</React.Fragment>;
  });
}

/**
 * Clean, XSS-safe component to render AI Insights markdown (bold headers, code badges, italics).
 */
export const FormattedMarkdown: React.FC<FormattedMarkdownProps> = ({ content, className }) => {
  if (!content) return null;

  const rendered = renderFormattedMarkdown(content);
  if (!className) {
    return <>{rendered}</>;
  }

  return <div className={className}>{rendered}</div>;
};

export default FormattedMarkdown;
