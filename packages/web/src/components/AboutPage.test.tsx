// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

/**
 * @vitest-environment jsdom
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import React from 'react';
import { AboutPage } from './AboutPage.js';

describe('AboutPage Component', () => {
    it('renders the about header, logo, and core sections', () => {
        render(<AboutPage />);

        expect(screen.getByRole('heading', { level: 1, name: /Swazz API Fuzzer/i })).toBeInTheDocument();
        expect(screen.getByText(/A high-performance smart fuzzer for REST APIs/i)).toBeInTheDocument();
        expect(screen.getByText('🎯 Smart Fuzzing')).toBeInTheDocument();
        expect(screen.getByText('🔍 Detections')).toBeInTheDocument();
        expect(screen.getByText('⚙️ Architecture')).toBeInTheDocument();
        expect(screen.getByText('🛡️ Security & Privacy')).toBeInTheDocument();
        expect(screen.getByText(/Reflected XSS/i)).toBeInTheDocument();
        expect(screen.getByText(/SQL Injection Leaks/i)).toBeInTheDocument();

        const githubLink = screen.getByRole('link', { name: /GitHub Repository/i });
        expect(githubLink).toHaveAttribute('href', 'https://github.com/SecH0us3/swazz');
        expect(githubLink).toHaveAttribute('target', '_blank');

        const docsLink = screen.getByRole('link', { name: /Documentation/i });
        expect(docsLink).toHaveAttribute('href', 'https://sech0us3.github.io/swazz/');
        expect(docsLink).toHaveAttribute('target', '_blank');
    });
});
