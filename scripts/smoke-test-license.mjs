// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import crypto from 'node:crypto';
import { chromium } from 'playwright';

const API_URL = (process.env.API_URL || 'https://swazz.secmy.app').replace(/\/$/, '');

// Intentionally public development-only key, same as DEFAULT_DEV_LICENSE_PRIVKEY_HEX in license.ts.
// This key is embedded in the open-source codebase and must never be used in production.
const DEFAULT_DEV_LICENSE_PRIVKEY_HEX = '302e020100300506032b657004220420b52bfb4e1736b2d3026e64fc4273b3703d1c3c993d6661a40b6f0c144678bef6';

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
  console.log(`🔍 [Smoke Test - Playwright] Target: ${API_URL}`);

  console.log('→ Launching headless Chromium browser...');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
    ],
  });

  try {
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    });
    const page = await context.newPage();

    console.log(`→ Navigating to ${API_URL}/api/info...`);
    let reached = false;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        console.log(`  Attempt ${attempt}/5: Loading ${API_URL}/api/info...`);
        const res = await page.goto(`${API_URL}/api/info`, { waitUntil: 'networkidle', timeout: 15000 });

        // Check for Cloudflare challenge
        const title = await page.title();
        if (title.includes('Just a moment')) {
          console.log('  Cloudflare challenge detected, waiting for challenge clearance...');
          await page.waitForFunction(() => !document.title.includes('Just a moment'), { timeout: 15000 }).catch(() => {});
        }

        const currentTitle = await page.title();
        const bodyContent = await page.textContent('body').catch(() => '');
        if (!currentTitle.includes('Just a moment') && (res?.status() === 200 || bodyContent.includes('auth_enabled'))) {
          console.log('✓ Server reachable via browser session.');
          reached = true;
          break;
        } else {
          console.log(`  Attempt ${attempt} title: "${currentTitle}", status: ${res?.status()}`);
        }
      } catch (err) {
        console.log(`  Navigation attempt ${attempt} warning: ${err.message}`);
      }
      await page.waitForTimeout(2000);
    }

    if (!reached) {
      console.error('❌ Server unreachable via browser session after 5 attempts.');
      process.exit(1);
    }

    // Extract CSRF token from cookies
    const cookies = await context.cookies();
    const csrfCookie = cookies.find((c) => c.name === 'csrf_token');
    const csrfToken = csrfCookie?.value;
    console.log('✓ Extracted CSRF token from browser cookies:', csrfToken ? 'present' : 'missing');

    // Generate token signed with dev private key
    const devToken = signDevLicenseToken({
      company: 'SmokeTest MaliciousDevKey Corp',
      expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      features: ['*'],
      max_users: 10,
      max_concurrency: 1000,
    });

    console.log('→ Sending development-signed license key to /api/license/verify via browser context...');
    const result = await page.evaluate(async ({ targetUrl, token, csrf }) => {
      const headers = {
        'Content-Type': 'application/json',
      };
      if (csrf) {
        headers['X-CSRF-Token'] = csrf;
      }
      const res = await fetch(`${targetUrl}/api/license/verify`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ license_key: token }),
      });
      const text = await res.text();
      return { status: res.status, text };
    }, { targetUrl: API_URL, token: devToken, csrf: csrfToken });

    console.log(`← Verification response HTTP status: ${result.status}`);
    console.log(`← Verification response body: ${result.text}`);

    let responseData = {};
    try {
      responseData = JSON.parse(result.text);
    } catch {}

    // Security Assertions:
    if (result.status === 200 && responseData.valid === true) {
      console.error('❌ FATAL SECURITY VIOLATION: Production environment accepted a development-signed license key!');
      console.error('Check that SWAZZ_LICENSE_PUBKEY is configured with production public key and NODE_ENV=production.');
      process.exit(1);
    }

    if (responseData.valid === false || result.status === 400 || result.status === 401 || result.status === 500) {
      console.log('✅ SUCCESS: Production environment correctly rejected development-signed license token.');
      process.exit(0);
    }

    console.error(`⚠️ Unexpected response status ${result.status}: ${result.text}`);
    process.exit(1);
  } finally {
    await browser.close();
  }
}

runSmokeTest().catch((err) => {
  console.error('❌ Smoke test runner failed with unhandled error:', err);
  process.exit(1);
});
