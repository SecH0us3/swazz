// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import crypto from 'node:crypto';

const API_URL = (process.env.API_URL || 'https://swazz.secmy.app').replace(/\/$/, '');

// Intentionally public development-only key, same as DEFAULT_DEV_LICENSE_PRIVKEY_HEX in license.ts.
// This key is embedded in the open-source codebase and must never be used in production.
const DEFAULT_DEV_LICENSE_PRIVKEY_HEX = '302e020100300506032b657004220420b52bfb4e1736b2d3026e64fc4273b3703d1c3c993d6661a40b6f0c144678bef6';

const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  'Accept': 'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
};

function base64UrlEncode(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function signDevLicenseToken(payload) {
  const header = { alg: 'EdDSA', typ: 'JWT' };
  const headerB64 = base64UrlEncode(Buffer.from(JSON.stringify(header)));
  const payloadB64 = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
  const dataToSign = Buffer.from(`${headerB64}.${payloadB64}`);

  const privKeyDer = Buffer.from(DEFAULT_DEV_LICENSE_PRIVKEY_HEX, 'hex');
  const privateKey = crypto.createPrivateKey({
    key: privKeyDer,
    format: 'der',
    type: 'pkcs8',
  });

  const signature = crypto.sign(null, dataToSign, privateKey);
  const sigB64 = base64UrlEncode(signature);

  return `${headerB64}.${payloadB64}.${sigB64}`;
}

async function runSmokeTest() {
  console.log(`🔍 [Smoke Test] Target: ${API_URL}`);

  // 1. Fetch /api/info to verify server is reachable and extract CSRF token
  let csrfToken = null;
  let cookieHeader = '';
  const maxAttempts = 10;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      console.log(`→ Attempt ${attempt}/${maxAttempts}: Checking server health at ${API_URL}/api/info...`);
      const infoRes = await fetch(`${API_URL}/api/info`, {
        headers: {
          ...BROWSER_HEADERS,
        },
      });
      if (infoRes.ok) {
        csrfToken = infoRes.headers.get('x-csrf-token');
        const setCookie = infoRes.headers.get('set-cookie');
        if (setCookie) {
          cookieHeader = setCookie.split(';')[0];
        }
        console.log(`✓ Server reachable. API info response: ${infoRes.status}`);
        break;
      } else {
        const bodyPreview = await infoRes.text().catch(() => '');
        console.log(`  [Attempt ${attempt}] HTTP ${infoRes.status} (${infoRes.statusText}): ${bodyPreview.slice(0, 180)}`);
      }
    } catch (err) {
      console.log(`  Waiting for server availability (${err.message})...`);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  if (!csrfToken) {
    console.error(`❌ Server unreachable after ${maxAttempts} attempts. Aborting smoke test.`);
    process.exit(1);
  }

  // 2. Generate a token signed with the default development private key
  const devToken = signDevLicenseToken({
    company: 'SmokeTest MaliciousDevKey Corp',
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    features: ['*'],
    max_users: 10,
    max_concurrency: 1000,
  });

  console.log('→ Sending development-signed license key to /api/license/verify...');
  const headers = {
    ...BROWSER_HEADERS,
    'Content-Type': 'application/json',
  };
  if (csrfToken) {
    headers['X-CSRF-Token'] = csrfToken;
  }
  if (cookieHeader) {
    headers['Cookie'] = cookieHeader;
  }

  const verifyRes = await fetch(`${API_URL}/api/license/verify`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ license_key: devToken }),
  });

  const responseText = await verifyRes.text();
  let responseData = {};
  try {
    responseData = JSON.parse(responseText);
  } catch {}

  console.log(`← Verification response HTTP status: ${verifyRes.status}`);
  console.log(`← Verification response body: ${responseText}`);

  // 3. Security Assertions:
  // If the server returned 200 with valid: true, the dev key was ACCEPTED in production - CRITICAL FAILURE!
  if (verifyRes.ok && responseData.valid === true) {
    console.error('❌ FATAL SECURITY VIOLATION: Production environment accepted a development-signed license key!');
    console.error('Check that SWAZZ_LICENSE_PUBKEY is configured with production public key and NODE_ENV=production.');
    process.exit(1);
  }

  // Expect rejection (HTTP 400 or 401 or 500 with valid: false or error)
  if (responseData.valid === false || verifyRes.status === 400 || verifyRes.status === 401 || verifyRes.status === 500) {
    console.log('✅ SUCCESS: Production environment correctly rejected development-signed license token.');
    process.exit(0);
  }

  console.error(`⚠️ Unexpected response status ${verifyRes.status}: ${responseText}`);
  process.exit(1);
}

runSmokeTest().catch((err) => {
  console.error('❌ Smoke test runner failed with unhandled error:', err);
  process.exit(1);
});
