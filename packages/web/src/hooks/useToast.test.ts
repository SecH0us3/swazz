import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useToast } from './useToast.js';

describe('useToast', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should initialize with an empty array of toasts', () => {
        const { result } = renderHook(() => useToast());
        expect(result.current.toasts).toEqual([]);
    });

    it('should add a toast with default info type', () => {
        vi.setSystemTime(new Date(1000));
        const { result } = renderHook(() => useToast());

        act(() => {
            result.current.showToast('Test message');
        });

        expect(result.current.toasts).toEqual([
            { id: 1000, message: 'Test message', type: 'info' }
        ]);
    });

    it('should add a toast with specific type', () => {
        vi.setSystemTime(new Date(2000));
        const { result } = renderHook(() => useToast());

        act(() => {
            result.current.showToast('Success message', 'success');
        });

        expect(result.current.toasts).toEqual([
            { id: 2000, message: 'Success message', type: 'success' }
        ]);
    });

    it('should only keep the last 5 toasts', () => {
        const { result } = renderHook(() => useToast());

        act(() => {
            for (let i = 1; i <= 6; i++) {
                vi.setSystemTime(new Date(i * 1000));
                result.current.showToast(`Message ${i}`);
            }
        });

        expect(result.current.toasts).toHaveLength(5);
        expect(result.current.toasts.map(t => t.message)).toEqual([
            'Message 2',
            'Message 3',
            'Message 4',
            'Message 5',
            'Message 6'
        ]);
    });

    it('should dismiss a toast by id', () => {
        vi.setSystemTime(new Date(1000));
        const { result } = renderHook(() => useToast());

        act(() => {
            result.current.showToast('Message 1');
        });

        vi.setSystemTime(new Date(2000));
        act(() => {
            result.current.showToast('Message 2');
        });

        expect(result.current.toasts).toHaveLength(2);

        act(() => {
            result.current.dismissToast(1000);
        });

        expect(result.current.toasts).toHaveLength(1);
        expect(result.current.toasts[0].message).toBe('Message 2');
    });
});
