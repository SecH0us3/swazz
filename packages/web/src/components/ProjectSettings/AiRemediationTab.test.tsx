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

    it('renders all tech stack checkboxes and prompt templates', () => {
        render(<AiRemediationTab />);

        expect(screen.getByText('AI Remediation Config')).toBeTruthy();
        expect(screen.getByText('Target Tech Stacks')).toBeTruthy();

        // Check if popular checkboxes exist
        expect(screen.getByLabelText('Go')).toBeTruthy();
        expect(screen.getByLabelText('React')).toBeTruthy();
        expect(screen.getByLabelText('.NET')).toBeTruthy();
        expect(screen.getByLabelText('Flask')).toBeTruthy();
        expect(screen.getByLabelText('Next.js')).toBeTruthy();
        expect(screen.getByLabelText('Spring Boot')).toBeTruthy();
    });

    it('appends and removes tech stack context from prompts when checkboxes are toggled', () => {
        render(<AiRemediationTab />);

        const goCheckbox = screen.getByLabelText('Go') as HTMLInputElement;
        const triageTextarea = screen.getByLabelText('Triage Prompt Template') as HTMLTextAreaElement;
        const remediationTextarea = screen.getByLabelText('Remediation Prompt Template') as HTMLTextAreaElement;

        expect(triageTextarea.value).toBe('triage prompt');
        expect(remediationTextarea.value).toBe('remediation prompt');

        // Check the Go checkbox
        fireEvent.click(goCheckbox);

        expect(goCheckbox.checked).toBe(true);
        expect(triageTextarea.value).toContain('=== Tech Stack: Go ===');
        expect(triageTextarea.value).toContain('Ensure all remediations follow idiomatic Go');
        expect(remediationTextarea.value).toContain('=== Tech Stack: Go ===');
        expect(remediationTextarea.value).toContain('Ensure all remediations follow idiomatic Go');

        // Uncheck the Go checkbox
        fireEvent.click(goCheckbox);

        expect(goCheckbox.checked).toBe(false);
        expect(triageTextarea.value).toBe('triage prompt');
        expect(remediationTextarea.value).toBe('remediation prompt');
    });

    it('appends and removes rule context when toggling rules', async () => {
        render(<AiRemediationTab />);

        const selectRulesBtn = screen.getByRole('button', { name: /\+ Select Rules/i });
        fireEvent.click(selectRulesBtn);

        // Wait for modal and select checkbox for bola-idor
        const ruleCheckbox = screen.getByLabelText('swazz/bola-idor') as HTMLInputElement;
        const triageTextarea = screen.getByLabelText('Triage Prompt Template') as HTMLTextAreaElement;

        // Since 'swazz/bola-idor' starts as checked (loaded from project), let's click it to uncheck
        expect(ruleCheckbox.checked).toBe(true);
        // By default, the default prompt doesn't contain rules context unless clicked, let's toggle it off and on
        fireEvent.click(ruleCheckbox);
        expect(ruleCheckbox.checked).toBe(false);

        fireEvent.click(ruleCheckbox);
        expect(ruleCheckbox.checked).toBe(true);
        expect(triageTextarea.value).toContain('=== Rule: swazz/bola-idor ===');
        expect(triageTextarea.value).toContain('Implement strict ownership and authorization checks');
    });

    it('supports Mistral Vibe CLI option and defaults its commands', () => {
        render(<AiRemediationTab />);

        const toolSelect = screen.getByLabelText('Preferred AI Tool:') as HTMLSelectElement;
        fireEvent.change(toolSelect, { target: { value: 'vibe' } });

        const vibeInputs = screen.getAllByPlaceholderText('vibe -p - --auto-approve --trust') as HTMLInputElement[];
        expect(vibeInputs).toHaveLength(2);
        const pass1Input = vibeInputs[0];
        const pass2Input = vibeInputs[1];

        expect(pass1Input.value).toBe('vibe -p - --auto-approve --trust');
        expect(pass2Input.value).toBe('vibe -p - --auto-approve --trust');
    });
});
