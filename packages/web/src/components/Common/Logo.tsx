// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React from 'react';

interface LogoProps {
    size?: number;
    className?: string;
    theme?: 'dark' | 'light';
    withBackground?: boolean;
    rx?: number;
}

export function Logo({
    size = 24,
    className = '',
    theme = 'dark',
    withBackground = false,
    rx = 20,
}: LogoProps) {
    const whiteByteColor = theme === 'light' ? '#0F172A' : '#FFFFFF';

    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 100 100"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={className}
            aria-hidden="true"
        >
            {withBackground && (
                <rect width="100" height="100" rx={rx} fill="#0F172A" />
            )}

            {/* Line 1: 3W */}
            <rect x="15" y="25" width="10" height="30" rx="3" fill="#0284C7" />

            {/* Line 2: 4W + 1W */}
            <rect x="30" y="15" width="10" height="40" rx="3" fill="#38BDF8" />
            <rect x="30" y="75" width="10" height="10" rx="3" fill="#0284C7" />

            {/* Line 3: 2W + 1W (Red Vulnerability Core) + 2W */}
            <rect x="45" y="15" width="10" height="20" rx="3" fill={whiteByteColor} />
            <rect x="45" y="45" width="10" height="10" rx="3" fill="#f43f5e" />
            <rect x="45" y="65" width="10" height="20" rx="3" fill="#0284C7" />

            {/* Line 4: 1W + 4W */}
            <rect x="60" y="15" width="10" height="10" rx="3" fill={whiteByteColor} />
            <rect x="60" y="45" width="10" height="40" rx="3" fill="#38BDF8" />

            {/* Line 5: 3W */}
            <rect x="75" y="45" width="10" height="30" rx="3" fill="#0284C7" />
        </svg>
    );
}

export default Logo;
