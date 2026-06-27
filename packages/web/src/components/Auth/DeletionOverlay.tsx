import React, { useEffect, useState } from 'react';
import { useAppStore } from '../../store/appStore.js';

interface DeletionOverlayProps {
    deleteRequestedAt: string;
    onCancelSuccess: () => void;
    onLogout: () => void;
}

export function DeletionOverlay({ deleteRequestedAt, onCancelSuccess, onLogout }: DeletionOverlayProps) {
    const [timeLeft, setTimeLeft] = useState<{
        days: number;
        hours: number;
        minutes: number;
        seconds: number;
        totalHours: number;
        isExpired: boolean;
    }>({ days: 0, hours: 0, minutes: 0, seconds: 0, totalHours: 0, isExpired: false });
    
    const [isCancelling, setIsCancelling] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        const calculateTimeLeft = () => {
            const reqTime = new Date(deleteRequestedAt).getTime();
            // 7 days = 7 * 24 * 60 * 60 * 1000
            const expiryTime = reqTime + 7 * 24 * 60 * 60 * 1000;
            const now = new Date().getTime();
            const diff = expiryTime - now;

            if (diff <= 0) {
                return { days: 0, hours: 0, minutes: 0, seconds: 0, totalHours: 0, isExpired: true };
            }

            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
            const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
            const seconds = Math.floor((diff % (1000 * 60)) / 1000);
            const totalHours = Math.floor(diff / (1000 * 60 * 60));

            return { days, hours, minutes, seconds, totalHours, isExpired: false };
        };

        setTimeLeft(calculateTimeLeft());

        const timer = setInterval(() => {
            setTimeLeft(calculateTimeLeft());
        }, 1000);

        return () => clearInterval(timer);
    }, [deleteRequestedAt]);

    const handleCancelDeletion = async () => {
        setIsCancelling(true);
        setError('');
        const token = localStorage.getItem('swazz_token');
        const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

        const csrfToken = useAppStore.getState().csrfToken;
        const headers: Record<string, string> = {
            'Authorization': `Bearer ${token}`
        };
        if (csrfToken) {
            headers['X-CSRF-Token'] = csrfToken;
        }

        try {
            const res = await fetch(`${PROXY_URL}/api/users/me/cancel-deletion`, {
                method: 'POST',
                headers
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Failed to cancel deletion');
            }

            onCancelSuccess();
        } catch (err: any) {
            console.error(err);
            setError(err.message || 'An error occurred while cancelling deletion');
        } finally {
            setIsCancelling(false);
        }
    };

    return (
        <div className="deletion-overlay">
            <div className="deletion-card">
                <div className="deletion-icon-container">
                    ⚠️
                </div>
                <h2 className="deletion-title">Account Scheduled for Deletion</h2>
                <p className="deletion-desc">
                    Your account and all associated data are scheduled to be permanently and irreversibly deleted.
                </p>

                <div className="deletion-countdown-box">
                    <div className="deletion-countdown-label">Time Remaining</div>
                    {timeLeft.isExpired ? (
                        <div className="deletion-countdown-time">Deletion imminent</div>
                    ) : (
                        <>
                            <div className="deletion-countdown-time">
                                {timeLeft.days}d {timeLeft.hours}h {timeLeft.minutes}m {timeLeft.seconds}s
                            </div>
                            <div className="deletion-countdown-hours">
                                (approx. {timeLeft.totalHours} hours left)
                            </div>
                        </>
                    )}
                </div>

                {error && (
                    <p className="delete-error-message deletion-error-spacing">
                        {error}
                    </p>
                )}

                <div className="deletion-actions">
                    <button 
                        className="deletion-btn-cancel" 
                        onClick={handleCancelDeletion}
                        disabled={isCancelling}
                    >
                        {isCancelling ? 'Cancelling...' : 'Cancel Account Deletion'}
                    </button>
                    <button 
                        className="deletion-btn-logout" 
                        onClick={onLogout}
                    >
                        Logout & Exit
                    </button>
                </div>
            </div>
        </div>
    );
}
