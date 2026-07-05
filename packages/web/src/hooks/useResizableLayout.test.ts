/**
 * @vitest-environment jsdom
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useResizableLayout } from './useResizableLayout.js';

describe('useResizableLayout', () => {
    it('should initialize with given widths', () => {
        const { result } = renderHook(() => useResizableLayout(250, 300));
        expect(result.current.sidebarWidth).toBe(250);
        expect(result.current.configSidebarWidth).toBe(300);
    });

    it('should handle left sidebar resizing within limits', () => {
        const { result } = renderHook(() => useResizableLayout(250, 300));
        
        const mockPreventDefault = { preventDefault: () => {} } as any;

        act(() => {
            result.current.startResizingLeft(mockPreventDefault);
        });

        expect(document.body.classList.contains('resizing')).toBe(true);

        // Move to valid width (e.g., clientX = 400)
        act(() => {
            const mouseMoveEvent = new MouseEvent('mousemove', { clientX: 400 });
            document.dispatchEvent(mouseMoveEvent);
        });
        expect(result.current.sidebarWidth).toBe(400);

        // Move beyond min limit (clientX = 100)
        act(() => {
            const mouseMoveEvent = new MouseEvent('mousemove', { clientX: 100 });
            document.dispatchEvent(mouseMoveEvent);
        });
        expect(result.current.sidebarWidth).toBe(200); // capped at min 200

        // Move beyond max limit (clientX = 800)
        act(() => {
            const mouseMoveEvent = new MouseEvent('mousemove', { clientX: 800 });
            document.dispatchEvent(mouseMoveEvent);
        });
        expect(result.current.sidebarWidth).toBe(600); // capped at max 600

        // End resizing
        act(() => {
            const mouseUpEvent = new MouseEvent('mouseup');
            document.dispatchEvent(mouseUpEvent);
        });
        expect(document.body.classList.contains('resizing')).toBe(false);

        // Further mouse movements should not update sidebarWidth
        act(() => {
            const mouseMoveEvent = new MouseEvent('mousemove', { clientX: 300 });
            document.dispatchEvent(mouseMoveEvent);
        });
        expect(result.current.sidebarWidth).toBe(600); // remains unchanged
    });

    it('should handle right sidebar resizing within limits', () => {
        // Set window.innerWidth for calculations
        Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1000 });

        const { result } = renderHook(() => useResizableLayout(250, 300));
        
        const mockPreventDefault = { preventDefault: () => {} } as any;

        act(() => {
            result.current.startResizingRight(mockPreventDefault);
        });

        expect(document.body.classList.contains('resizing')).toBe(true);

        // Move to valid width (window.innerWidth - clientX = 1000 - 650 = 350)
        act(() => {
            const mouseMoveEvent = new MouseEvent('mousemove', { clientX: 650 });
            document.dispatchEvent(mouseMoveEvent);
        });
        expect(result.current.configSidebarWidth).toBe(350);

        // Move beyond min limit (1000 - 900 = 100)
        act(() => {
            const mouseMoveEvent = new MouseEvent('mousemove', { clientX: 900 });
            document.dispatchEvent(mouseMoveEvent);
        });
        expect(result.current.configSidebarWidth).toBe(250); // capped at min 250

        // Move beyond max limit (1000 - 300 = 700)
        act(() => {
            const mouseMoveEvent = new MouseEvent('mousemove', { clientX: 300 });
            document.dispatchEvent(mouseMoveEvent);
        });
        expect(result.current.configSidebarWidth).toBe(600); // capped at max 600

        // End resizing
        act(() => {
            const mouseUpEvent = new MouseEvent('mouseup');
            document.dispatchEvent(mouseUpEvent);
        });
        expect(document.body.classList.contains('resizing')).toBe(false);
    });
});
