import { render, screen, fireEvent } from '@testing-library/react';
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

    it('supports Mistral Vibe CLI option and updates commands across Triage and Remediation sub-tabs', () => {
        render(<AiRemediationTab />);

        const toolSelect = screen.getByLabelText('Preferred AI Tool:') as HTMLSelectElement;
        fireEvent.change(toolSelect, { target: { value: 'vibe' } });

        // Switch to Triage tab
        fireEvent.click(screen.getByRole('tab', { name: /Triage Model \(Pass 1\)/i }));
        const pass1Input = screen.getByLabelText('CLI Execution Command & Model') as HTMLInputElement;
        expect(pass1Input.value).toBe('vibe -p - --auto-approve --trust');

        // Switch to Remediation tab
        fireEvent.click(screen.getByRole('tab', { name: /Remediation Model \(Pass 2\)/i }));
        const pass2Input = screen.getByLabelText('CLI Execution Command & Model') as HTMLInputElement;
        expect(pass2Input.value).toBe('vibe -p - --auto-approve --trust');
    });
});
