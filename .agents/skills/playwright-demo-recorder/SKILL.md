---
name: playwright-demo-recorder
description: Record high-resolution, human-paced, pointer-traced E2E walkthrough videos using Playwright.
---

# Playwright E2E Demo Video Recorder

This skill provides instructions and templates to capture high-quality, 1920x1080 (1080p Full HD) screen recordings of your web application during Playwright E2E tests, displaying a visual mouse cursor follower and natural human-like typing and click speeds.

---

## 1. Configure Playwright for Full HD Video

Update [playwright.config.ts](file:///Users/alex/src/swazz/playwright.config.ts) temporarily to force 1920x1080 layout viewport and window sizes:

```typescript
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  // ...
  use: {
    video: {
      mode: 'on',
      size: { width: 1920, height: 1080 }
    }
  },
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        viewport: { width: 1920, height: 1080 },
        launchOptions: {
          args: ['--window-size=1920,1080']
        }
      },
    },
  ],
});
```

---

## 2. E2E Recording Helper Snippets

Inject a cursor follower and use smooth movements in your E2E test file (`tests/e2e/some-spec.spec.ts`):

```typescript
import { test, expect } from '@playwright/test';

// 1. Inject visual pointer (custom cursor)
async function installMouseHelper(page: any) {
  await page.evaluate(() => {
    const box = document.createElement('playwright-mouse-pointer');
    const styleElement = document.createElement('style');
    styleElement.innerHTML = `
      playwright-mouse-pointer {
        pointer-events: none;
        position: absolute;
        top: 0;
        left: 0;
        width: 24px;
        height: 24px;
        background: rgba(139, 92, 246, 0.4); /* Custom accent color */
        border: 2px solid rgba(255, 255, 255, 0.8);
        border-radius: 50%;
        margin: -12px 0 0 -12px;
        padding: 0;
        transition: background 0.15s, transform 0.15s;
        z-index: 100000;
        box-shadow: 0 0 10px rgba(139, 92, 246, 0.6);
      }
      playwright-mouse-pointer.mousedown {
        background: rgba(139, 92, 246, 0.8);
        transform: scale(0.8);
      }
    `;
    document.head.appendChild(styleElement);
    document.body.appendChild(box);
    document.addEventListener('mousemove', event => {
      box.style.left = event.pageX + 'px';
      box.style.top = event.pageY + 'px';
    }, true);
    document.addEventListener('mousedown', event => {
      box.classList.add('mousedown');
    }, true);
    document.addEventListener('mouseup', event => {
      box.classList.remove('mousedown');
    }, true);
  });
}

// 2. Smoothly move mouse and click
async function moveAndClick(page: any, locator: any) {
  await locator.waitFor({ state: 'visible' });
  const box = await locator.boundingBox();
  if (box) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y, { steps: 25 }); // 25 steps for visible animation
    await page.waitForTimeout(400);
    await page.mouse.down();
    await page.waitForTimeout(100);
    await page.mouse.up();
    await page.waitForTimeout(400);
  } else {
    await locator.click();
  }
}

// 3. Smoothly move mouse and type like a human
async function moveAndType(page: any, locator: any, text: string) {
  await locator.waitFor({ state: 'visible' });
  const box = await locator.boundingBox();
  if (box) {
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await page.mouse.move(x, y, { steps: 25 });
    await page.waitForTimeout(300);
    await page.mouse.click(x, y);
    await page.waitForTimeout(300);
  }
  await locator.fill('');
  for (const char of text) {
    await page.keyboard.type(char);
    await page.waitForTimeout(80); // Typist speed delay
  }
  await page.waitForTimeout(400);
}
```

---

## 3. Run and Fetch the Recording

1. Execute the recording E2E spec (this script starts local environment, runs tests, and stops services):
   ```bash
   rtk bash tests/e2e/run-e2e.sh tests/e2e/some-spec.spec.ts
   ```
2. Locate the output video inside the `test-results` folder:
   ```bash
   find test-results -name "video.webm"
   ```
3. Copy the recording to the target assets or artifacts directory.
4. **Important**: Revert changes to [playwright.config.ts](file:///Users/alex/src/swazz/playwright.config.ts) after capturing to prevent slowing down normal E2E test suite executions.
