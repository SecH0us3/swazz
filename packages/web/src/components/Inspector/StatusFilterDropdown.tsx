import React, { useState, useEffect, useRef, useMemo } from 'react';

interface StatusFilterDropdownProps {
    availableStatuses: number[];
    excludedStatuses: Set<number>;
    setExcludedStatuses: React.Dispatch<React.SetStateAction<Set<number>>>;
}

export const StatusFilterDropdown: React.FC<StatusFilterDropdownProps> = ({
    availableStatuses,
    excludedStatuses,
    setExcludedStatuses,
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    const checkedCount = useMemo(() => {
        return availableStatuses.filter(status => !excludedStatuses.has(status)).length;
    }, [availableStatuses, excludedStatuses]);

    const toggleStatus = (status: number) => {
        setExcludedStatuses(prev => {
            const next = new Set(prev);
            if (next.has(status)) {
                next.delete(status);
            } else {
                next.add(status);
            }
            return next;
        });
    };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    return (
        <div className="status-dropdown-container" ref={dropdownRef}>
            <button
                type="button"
                className="btn btn-ghost btn-sm status-dropdown-btn"
                onClick={() => setIsOpen(!isOpen)}
            >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
                </svg>
                Statuses ({checkedCount}/{availableStatuses.length})
            </button>
            {isOpen && (
                <div className="status-dropdown-menu">
                    <div className="status-dropdown-actions">
                        <button
                            type="button"
                            className="status-dropdown-action-btn"
                            onClick={() => setExcludedStatuses(new Set())}
                        >
                            Select All
                        </button>
                        <button
                            type="button"
                            className="status-dropdown-action-btn"
                            onClick={() => setExcludedStatuses(prev => {
                                const next = new Set(prev);
                                availableStatuses.forEach(status => next.add(status));
                                return next;
                            })}
                        >
                            Clear All
                        </button>
                    </div>
                    {availableStatuses.map(status => {
                        const isChecked = !excludedStatuses.has(status);
                        const label = status === 0 ? <span title="Infinity (Timeout / Network Error)">∞</span> : String(status);
                        return (
                            <label key={status} className="status-dropdown-item">
                                <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => toggleStatus(status)}
                                />
                                <span>{label}</span>
                            </label>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
