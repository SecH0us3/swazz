// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Env } from '../../src/env';

export interface TestLicenseKeyPair {
  pubKeyHex: string;
  privKeyHex: string;
}

export async function generateTestKeyPair(): Promise<TestLicenseKeyPair> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' },
    true,
    ['sign', 'verify']
  );
  const pubKey = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const privKey = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);

  const pubHex = Array.from(new Uint8Array(pubKey)).map(b => b.toString(16).padStart(2, '0')).join('');
  const privHex = Array.from(new Uint8Array(privKey)).map(b => b.toString(16).padStart(2, '0')).join('');
  return { pubKeyHex: pubHex, privKeyHex: privHex };
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function signLicenseToken(
  privKeyHex: string,
  payload: { company: string; expires_at: string; features: string[]; max_users?: number; max_concurrency?: number }
): Promise<string> {
  const header = { alg: 'EdDSA', typ: 'JWT' };
  const headerB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(header)));
  const payloadB64 = bytesToBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const signedMessage = new TextEncoder().encode(headerB64 + '.' + payloadB64);

  const privKeyBytes = hexToBytes(privKeyHex);
  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    privKeyBytes,
    { name: 'Ed25519' },
    true,
    ['sign']
  );
  const sig = await crypto.subtle.sign('Ed25519', cryptoKey, signedMessage);
  const sigB64 = bytesToBase64Url(new Uint8Array(sig));

  return `${headerB64}.${payloadB64}.${sigB64}`;
}

export async function activateLicenseForUser(
  appFetchWrapper: (req: any, env?: any, ctx?: any) => Promise<Response>,
  env: Env,
  token: string,
  licenseKey: string
): Promise<Response> {
  return appFetchWrapper(new Request('http://localhost/api/user/license', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ license_key: licenseKey }),
  }), env);
}

// Shared test keypair — the public key is exposed via SWAZZ_LICENSE_PUBKEY on
// the test env so requireFeature middleware can verify tokens signed here.
let sharedKeyPair: TestLicenseKeyPair | null = null;

export async function getSharedTestKeyPair(): Promise<TestLicenseKeyPair> {
  if (!sharedKeyPair) {
    sharedKeyPair = await generateTestKeyPair();
  }
  return sharedKeyPair;
}

export async function signSharedLicenseToken(features: string[]): Promise<string> {
  const kp = await getSharedTestKeyPair();
  return signLicenseToken(kp.privKeyHex, {
    company: 'Test Corp',
    expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    features,
  });
}

export async function activateSharedLicense(
  appFetchWrapper: (req: any, env?: any, ctx?: any) => Promise<Response>,
  env: Env,
  token: string,
  features: string[]
): Promise<Response> {
  const licenseKey = await signSharedLicenseToken(features);
  return activateLicenseForUser(appFetchWrapper, env, token, licenseKey);
}
