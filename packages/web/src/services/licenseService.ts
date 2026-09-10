// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { useAppStore } from '../store/appStore.js';
import type { LicenseInfo, LicenseStatus } from '../utils/license.js';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

export interface TrialStatusData {
  claimed: boolean;
  claimed_at: string | null;
  can_claim?: boolean;
  cooldown_remaining_ms?: number;
  next_available_at?: string | null;
}



function getAuthHeaders(options: { json?: boolean; csrf?: boolean } = {}): Record<string, string> {
  const headers: Record<string, string> = {};
  if (options.json) {
    headers['Content-Type'] = 'application/json';
  }
  const token = typeof localStorage !== 'undefined' && localStorage ? localStorage.getItem('swazz_token') : null;
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (options.csrf) {
    const csrfToken = useAppStore.getState().csrfToken;
    if (csrfToken) {
      headers['X-CSRF-Token'] = csrfToken;
    }
  }
  return headers;
}

export function normalizeLicenseKey(raw: string): string {
  if (!raw) return '';
  let clean = raw.trim();
  if (clean.includes('SWAZZ_LICENSE_KEY:')) {
    clean = clean.split('SWAZZ_LICENSE_KEY:')[1].trim();
  }
  const lines = clean.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.startsWith('eyJ') && line.split('.').length === 3) {
      return line;
    }
  }
  const jwtMatch = clean.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
  if (jwtMatch) {
    return jwtMatch[0];
  }
  return clean;
}

export async function fetchLicenseStatus(): Promise<LicenseStatus> {
  const res = await fetch(`${PROXY_URL}/api/user/license`, {
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP error ${res.status}`);
  }
  return data;
}

export async function fetchTrialStatus(): Promise<TrialStatusData> {
  const res = await fetch(`${PROXY_URL}/api/user/trial-status`, {
    headers: getAuthHeaders(),
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || `HTTP error ${res.status}`);
  }
  return data;
}

export async function activateLicense(key: string): Promise<{ license: LicenseInfo }> {
  const cleanKey = normalizeLicenseKey(key);
  const res = await fetch(`${PROXY_URL}/api/user/license`, {
    method: 'POST',
    headers: getAuthHeaders({ json: true, csrf: true }),
    credentials: 'include',
    body: JSON.stringify({ license_key: cleanKey }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Failed to activate license');
  }
  return data;
}

export async function deactivateLicense(): Promise<void> {
  const res = await fetch(`${PROXY_URL}/api/user/license`, {
    method: 'DELETE',
    headers: getAuthHeaders({ csrf: true }),
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Failed to deactivate license');
  }
}

export async function claimTrialLicense(): Promise<{ license: LicenseInfo; token?: string }> {
  const res = await fetch(`${PROXY_URL}/api/user/trial-license`, {
    method: 'POST',
    headers: getAuthHeaders({ json: true, csrf: true }),
    credentials: 'include',
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Failed to claim trial license');
  }
  return data;
}



export async function verifyLicenseKey(
  key: string
): Promise<{ valid: boolean; license?: LicenseInfo; error?: string }> {
  const cleanKey = normalizeLicenseKey(key);
  const res = await fetch(`${PROXY_URL}/api/license/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ license_key: cleanKey }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { valid: false, error: data.error || 'Invalid license key' };
  }
  return data;
}
