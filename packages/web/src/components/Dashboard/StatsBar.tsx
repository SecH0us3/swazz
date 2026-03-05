import React, { useEffect, useRef, useState } from 'react';
import type { RunStats } from '@swazz/core';

interface Props {
    stats: RunStats;
}

function AnimatedNumber({ value, decimals = 0 }: { value: number; decimals?: number }) {
    const [display, setDisplay] = useState(value);
    const [pop, setPop] = useState(false);
    const prev = useRef(value);

    useEffect(() => {
        if (value === prev.current) return;
        const from = prev.current;
        const to = value;
        prev.current = value;
        setPop(true);
        const start = performance.now();
        const duration = 400;

        const animate = (now: number) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            // ease-out
            const eased = 1 - Math.pow(1 - progress, 3);
            setDisplay(from + (to - from) * eased);
            if (progress < 1) requestAnimationFrame(animate);
            else setPop(false);
        };
        requestAnimationFrame(animate);
    }, [value]);

    return (
        <span className={`stat-value ${pop ? 'pop' : ''}`}>
            {decimals > 0 ? display.toFixed(decimals) : Math.round(display).toLocaleString()}
        </span>
    );
}

function get2xx(stats: RunStats): number {
    return Object.entries(stats.statusCounts)
        .filter(([s]) => Number(s) >= 200 && Number(s) < 300)
        .reduce((sum, [, c]) => sum + c, 0);
}

function get4xx(stats: RunStats): number {
    return Object.entries(stats.statusCounts)
        .filter(([s]) => Number(s) >= 400 && Number(s) < 500)
        .reduce((sum, [, c]) => sum + c, 0);
}

function get5xx(stats: RunStats): number {
    return Object.entries(stats.statusCounts)
        .filter(([s]) => Number(s) >= 500)
        .reduce((sum, [, c]) => sum + c, 0);
}

export function StatsBar({ stats }: Props) {
    const count2xx = get2xx(stats);
    const count4xx = get4xx(stats);
    const count5xx = get5xx(stats);

    return (
        <div className="stats-bar">
            <div className="stat-card stat-rps card">
                <span className="stat-label">RPS</span>
                <AnimatedNumber value={stats.requestsPerSecond} decimals={1} />
            </div>
            <div className="stat-card stat-total card">
                <span className="stat-label">Total</span>
                <AnimatedNumber value={stats.totalRequests} />
            </div>
            <div className="stat-card stat-2xx card">
                <span className="stat-label">2xx Success</span>
                <AnimatedNumber value={count2xx} />
            </div>
            <div className="stat-card stat-4xx card">
                <span className="stat-label">4xx Client</span>
                <AnimatedNumber value={count4xx} />
            </div>
            <div className={`stat-card stat-5xx card ${count5xx > 0 ? 'has-errors' : ''}`}>
                <span className="stat-label">{count5xx > 0 ? '5xx CRASHES!' : '5xx Errors'}</span>
                <AnimatedNumber value={count5xx} />
            </div>
        </div>
    );
}
