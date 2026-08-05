// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { MouseEvent as ReactMouseEvent, useState, useEffect, useRef, useCallback } from 'react';

export function useResizableLayout(initialSidebarWidth: number, initialConfigSidebarWidth: number) {
    const [sidebarWidth, setSidebarWidth] = useState(initialSidebarWidth);
    const [configSidebarWidth, setConfigSidebarWidth] = useState(initialConfigSidebarWidth);
    const isResizingLeftRef = useRef(false);
    const isResizingRightRef = useRef(false);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isResizingLeftRef.current) {
                const newWidth = Math.max(200, Math.min(600, e.clientX));
                setSidebarWidth(newWidth);
            } else if (isResizingRightRef.current) {
                const newWidth = Math.max(250, Math.min(600, window.innerWidth - e.clientX));
                setConfigSidebarWidth(newWidth);
            }
        };

        const handleMouseUp = () => {
            isResizingLeftRef.current = false;
            isResizingRightRef.current = false;
            document.body.classList.remove('resizing');
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, []);

    const startResizingLeft = useCallback((e: ReactMouseEvent) => {
        e.preventDefault();
        isResizingLeftRef.current = true;
        document.body.classList.add('resizing');
    }, []);

    const startResizingRight = useCallback((e: ReactMouseEvent) => {
        e.preventDefault();
        isResizingRightRef.current = true;
        document.body.classList.add('resizing');
    }, []);

    return { sidebarWidth, configSidebarWidth, startResizingLeft, startResizingRight };
}
