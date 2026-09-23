// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FormattedMarkdown, renderFormattedMarkdown } from './FormattedMarkdown';

describe('FormattedMarkdown', () => {
  it('renders null or empty string safely', () => {
    const { container } = render(<FormattedMarkdown content="" />);
    expect(container.firstChild).toBeNull();

    const { container: nullContainer } = render(<FormattedMarkdown content={undefined as any} />);
    expect(nullContainer.firstChild).toBeNull();
  });

  it('renders plain text without markdown as plain text', () => {
    render(<FormattedMarkdown content="Just regular explanation text" />);
    expect(screen.getByText('Just regular explanation text')).toBeTruthy();
  });

  it('formats **bold text** into <strong> elements', () => {
    render(<FormattedMarkdown content="Here is **Root Cause Analysis:** and some normal text" />);
    const boldEl = screen.getByText('Root Cause Analysis:');
    expect(boldEl.tagName.toLowerCase()).toBe('strong');
    expect(boldEl.className).toContain('ai-markdown-bold');
  });

  it('formats __bold text__ into <strong> elements', () => {
    render(<FormattedMarkdown content="Here is __Critical Risk:__ and normal text" />);
    const boldEl = screen.getByText('Critical Risk:');
    expect(boldEl.tagName.toLowerCase()).toBe('strong');
    expect(boldEl.className).toContain('ai-markdown-bold');
  });

  it('formats `inline code` into <code> elements', () => {
    render(<FormattedMarkdown content="Detected at `/users` endpoint" />);
    const codeEl = screen.getByText('/users');
    expect(codeEl.tagName.toLowerCase()).toBe('code');
    expect(codeEl.className).toContain('ai-markdown-code');
  });

  it('formats *italic text* into <em> elements', () => {
    render(<FormattedMarkdown content="This is *strictly recommended* for security" />);
    const emEl = screen.getByText('strictly recommended');
    expect(emEl.tagName.toLowerCase()).toBe('em');
    expect(emEl.className).toContain('ai-markdown-italic');
  });

  it('formats multiline code blocks into <pre><code>', () => {
    const markdown = 'Steps:\n```json\n{"status": "ok"}\n```\nDone';
    render(<FormattedMarkdown content={markdown} />);
    const preEl = screen.getByText('{"status": "ok"}');
    expect(preEl.tagName.toLowerCase()).toBe('code');
    expect(preEl.closest('pre')?.className).toContain('ai-markdown-pre');
  });

  it('formats complex security explanation with bold and inline code', () => {
    const text = '**Root Cause Analysis:** Potential Server-Side Request Forgery (SSRF) pattern detected at `/users`.\n\n**Operational Impact:** Cloud metadata theft (e.g. AWS IMDSv1).';
    render(<FormattedMarkdown content={text} />);
    
    expect(screen.getByText('Root Cause Analysis:')).toBeTruthy();
    expect(screen.getByText('/users')).toBeTruthy();
    expect(screen.getByText('Operational Impact:')).toBeTruthy();
  });

  it('formats remediation list with numbered bold headers', () => {
    const text = '1. **Egress Network Filtering**: Restrict outbound connections.\n2. **Block Private IP Ranges**: Validate loopback (`127.0.0.0/8`).';
    render(<FormattedMarkdown content={text} />);

    expect(screen.getByText('Egress Network Filtering')).toBeTruthy();
    expect(screen.getByText('Block Private IP Ranges')).toBeTruthy();
    expect(screen.getByText('127.0.0.0/8')).toBeTruthy();
  });

  it('supports renderFormattedMarkdown helper directly', () => {
    const nodes = renderFormattedMarkdown('Simple **bold** word');
    expect(nodes).toBeDefined();
  });

  it('formats ### markdown headings with markdown-heading-3 class and inner formatting', () => {
    const markdown = '### Executive **Summary** for `/api/v1`\nDetails follow.';
    render(<FormattedMarkdown content={markdown} />);

    const h3El = screen.getByRole('heading', { level: 3 });
    expect(h3El).toBeTruthy();
    expect(h3El.className).toContain('markdown-heading-3');
    expect(h3El.textContent).toBe('Executive Summary for /api/v1');

    // Bold inside heading
    const boldInside = h3El.querySelector('strong');
    expect(boldInside).toBeTruthy();
    expect(boldInside?.textContent).toBe('Summary');

    // Code inside heading
    const codeInside = h3El.querySelector('code');
    expect(codeInside).toBeTruthy();
    expect(codeInside?.textContent).toBe('/api/v1');
  });

  it('formats ## markdown headings with markdown-heading-2 class', () => {
    const markdown = '## Vulnerability Assessment\nFound issues.';
    render(<FormattedMarkdown content={markdown} />);

    const h2El = screen.getByRole('heading', { level: 2 });
    expect(h2El).toBeTruthy();
    expect(h2El.className).toContain('markdown-heading-2');
    expect(h2El.textContent).toBe('Vulnerability Assessment');
  });
});
