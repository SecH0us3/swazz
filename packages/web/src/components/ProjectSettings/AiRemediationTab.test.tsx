// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { AiRemediationTab } from './AiRemediationTab.js';
import { useAppStore } from '../../store/appStore.js';

describe('AiRemediationTab Component', () => {
    beforeEach(() => {
        useAppStore.setState({
            activeProject: {
                id: 'test-project-1',
                name: 'Test Proj',
                description: 'desc',
                url_mappings: '',
                ai_prompts: JSON.stringify({
                    pass1_cmd: 'claude -m haiku -p {{prompt_file}}',
                    pass1_prompt: 'triage prompt',
                    pass2_cmd: 'claude -m sonnet -p {{prompt_file}}',
                    pass2_prompt: 'remediation prompt',
                    tech_stacks: []
                }),
                auto_fix_rules: JSON.stringify(['swazz/bola-idor']),
                propose_fixes: 0
            },
            projects: [{ id: 'test-project-1', name: 'Test Proj', description: 'desc' }]
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('renders horizontal sub-tab buttons and renders general tab by default', () => {
        render(<AiRemediationTab />);

        expect(screen.getByText('AI Remediation Config')).toBeTruthy();
        expect(screen.getByRole('tab', { name: /CLI & General Settings/i })).toBeTruthy();
        expect(screen.getByRole('tab', { name: /Triage Model \(Pass 1\)/i })).toBeTruthy();
        expect(screen.getByRole('tab', { name: /Remediation Model \(Pass 2\)/i })).toBeTruthy();
        expect(screen.getByRole('tab', { name: /Tech Stacks & Auto-Fix Rules/i })).toBeTruthy();

        // Default tab (General)
        expect(screen.getByLabelText('Preferred AI Tool:')).toBeTruthy();
        expect(screen.getByLabelText('URL to Repository Mappings')).toBeTruthy();
    });

    it('switches to Tech Stacks & Auto-Fix Rules sub-tab and renders tech stack checkboxes', () => {
        render(<AiRemediationTab />);

        fireEvent.click(screen.getByRole('tab', { name: /Tech Stacks & Auto-Fix Rules/i }));

        expect(screen.getByText('Target Tech Stacks')).toBeTruthy();
        expect(screen.getByLabelText('Go')).toBeTruthy();
        expect(screen.getByLabelText('React')).toBeTruthy();
        expect(screen.getByLabelText('.NET')).toBeTruthy();
        expect(screen.getByLabelText('Flask')).toBeTruthy();
    });

    it('appends and removes tech stack context from prompts when checkboxes are toggled', () => {
        render(<AiRemediationTab />);

        // Switch to Tech Stacks tab
        fireEvent.click(screen.getByRole('tab', { name: /Tech Stacks & Auto-Fix Rules/i }));
        const goCheckbox = screen.getByLabelText('Go') as HTMLInputElement;

        // Check the Go checkbox
        fireEvent.click(goCheckbox);
        expect(goCheckbox.checked).toBe(true);

        // Switch to Triage tab to verify prompt text
        fireEvent.click(screen.getByRole('tab', { name: /Triage Model \(Pass 1\)/i }));
        const triageTextarea = screen.getByLabelText('Triage Prompt Template') as HTMLTextAreaElement;
        expect(triageTextarea.value).toContain('=== Tech Stack: Go ===');

        // Switch to Remediation tab to verify prompt text
        fireEvent.click(screen.getByRole('tab', { name: /Remediation Model \(Pass 2\)/i }));
        const remediationTextarea = screen.getByLabelText('Remediation Prompt Template') as HTMLTextAreaElement;
        expect(remediationTextarea.value).toContain('=== Tech Stack: Go ===');

        // Uncheck the Go checkbox in Tech Stacks tab
        fireEvent.click(screen.getByRole('tab', { name: /Tech Stacks & Auto-Fix Rules/i }));
        fireEvent.click(goCheckbox);
        expect(goCheckbox.checked).toBe(false);
    });

    it('appends and removes rule context when toggling rules', async () => {
        render(<AiRemediationTab />);

        // Switch to Tech Stacks & Auto-Fix Rules sub-tab
        fireEvent.click(screen.getByRole('tab', { name: /Tech Stacks & Auto-Fix Rules/i }));

        const selectRulesBtn = screen.getByRole('button', { name: /\+ Select Rules/i });
        fireEvent.click(selectRulesBtn);

        const ruleCheckbox = screen.getByLabelText('swazz/bola-idor') as HTMLInputElement;
        expect(ruleCheckbox.checked).toBe(true);

        fireEvent.click(ruleCheckbox);
        expect(ruleCheckbox.checked).toBe(false);

        fireEvent.click(ruleCheckbox);
        expect(ruleCheckbox.checked).toBe(true);

        // Switch to Triage tab to verify prompt
        fireEvent.click(screen.getByRole('tab', { name: /Triage Model \(Pass 1\)/i }));
        const triageTextarea = screen.getByLabelText('Triage Prompt Template') as HTMLTextAreaElement;
        expect(triageTextarea.value).toContain('=== Rule: swazz/bola-idor ===');
    });

    it('supports Google Antigravity CLI (agy) tool option', () => {
        render(<AiRemediationTab />);

        const toolSelect = screen.getByLabelText('Preferred AI Tool:') as HTMLSelectElement;
        fireEvent.change(toolSelect, { target: { value: 'agy' } });

        // Switch to Triage tab
        fireEvent.click(screen.getByRole('tab', { name: /Triage Model \(Pass 1\)/i }));
        const pass1Input = screen.getByLabelText('CLI Execution Command & Model') as HTMLInputElement;
        expect(pass1Input.value).toContain('agy -m gemini');
    });

    it('saves AI settings to backend on form submit', async () => {
        const mockFetch = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ success: true })
        });
        global.fetch = mockFetch;

        render(<AiRemediationTab />);

        const mappingsInput = screen.getByLabelText('URL to Repository Mappings');
        fireEvent.change(mappingsInput, { target: { value: '{"/api/*":"git@github.com:org/backend.git"}' } });

        const saveBtn = screen.getByRole('button', { name: /Save AI Settings/i });
        fireEvent.click(saveBtn);

        await waitFor(() => {
            expect(mockFetch).toHaveBeenCalledWith(
                expect.stringContaining('/api/projects/test-project-1'),
                expect.objectContaining({ method: 'PATCH' })
            );
            expect(screen.getByText(/✓ Saved successfully/i)).toBeTruthy();
        });
    });
});
