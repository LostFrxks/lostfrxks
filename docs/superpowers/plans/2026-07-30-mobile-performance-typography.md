# Mobile Performance and Typography Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove mobile-only navigation and torus work, and make phone typography 12.5% smaller while preserving the current desktop experience.

**Architecture:** Keep the existing `680px` responsive boundary. CSS owns mobile visibility, sizing, and touch targets; `ascii-torus.js` uses the same media query as an initialization guard so hidden animation work never starts. Playwright covers both the mobile opt-out and the unchanged desktop path.

**Tech Stack:** HTML, CSS, vanilla JavaScript, Playwright, Node.js test runner.

---

### Task 1: Create the failing responsive contract

**Files:**
- Modify: `tests/portfolio.spec.js:1235-1390`
- Test: `tests/portfolio.spec.js`

- [ ] **Step 1: Change the existing mobile layout test**

Replace the mobile header assertions and add typography/touch-target checks:

```js
test('mobile layout removes navigation and keeps compact primary content reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await enterPortfolio(page);

  await expect(page.locator('.site-header')).toBeHidden();
  await expect(page.locator('.brand')).toBeHidden();
  await expect(page.locator('.nav-links')).toBeHidden();
  await expect(page.locator('html')).toHaveCSS('font-size', '14px');
  await expect(page.getByRole('heading', { name: /Artur Usenov/i })).toBeVisible();

  const githubAction = page.locator('.hero-actions').getByRole('link', { name: /Open GitHub/i });
  await expect(githubAction).toBeVisible();
  const githubActionBox = await githubAction.boundingBox();
  expect(githubActionBox.height).toBeGreaterThanOrEqual(44);
  await expect(page.locator('.command-dock')).toHaveCount(0);

  const avatarBox = await page.locator('.avatar').boundingBox();
  const panelContentWidth = await page.locator('.identity-panel').evaluate((element) => {
    const styles = getComputedStyle(element);
    return element.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
  });

  expect(avatarBox.width).toBeGreaterThanOrEqual(220);
  expect(avatarBox.height).toBeGreaterThanOrEqual(220);
  expect(avatarBox.width).toBeGreaterThanOrEqual(panelContentWidth - 2);
});
```

- [ ] **Step 2: Stop mobile reveal tests from depending on hidden navigation**

In the mobile project-card test, replace the projects navigation click with:

```js
await projects.scrollIntoViewIfNeeded();
```

In the mobile stack-card test, replace the stack navigation click with:

```js
await stack.scrollIntoViewIfNeeded();
```

- [ ] **Step 3: Add a failing mobile torus-runtime test**

Add this test before the desktop torus test:

```js
test('mobile hides the ascii torus without initializing its renderer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await enterPortfolio(page);

  const artifact = page.locator('#ascii-torus');
  await expect(artifact).toBeHidden();

  const runtime = await artifact.evaluate((element) => ({
    debugApi: typeof window.__asciiTorusDebug,
    rotation: element.getAttribute('data-torus-rotation'),
    output: element.querySelector('[data-ascii-torus-output]').textContent,
  }));

  expect(runtime).toEqual({
    debugApi: 'undefined',
    rotation: null,
    output: '',
  });
});
```

- [ ] **Step 4: Extend the desktop torus contract**

At the start of the existing desktop torus test, after entering the portfolio, add:

```js
await expect(page.locator('.site-header')).toBeVisible();
await expect(page.locator('html')).toHaveCSS('font-size', '16px');
```

- [ ] **Step 5: Run the new contract and verify RED**

Run:

```bash
./node_modules/.bin/playwright test \
  --config=/tmp/lostfrxks-playwright-chrome.config.cjs \
  --workers=1 \
  --grep "mobile layout removes|mobile hides the ascii torus|ascii torus artifact is visible"
```

Expected: mobile header, `14px` root type, and mobile torus assertions fail against the current implementation; the desktop torus assertions pass.

### Task 2: Implement the mobile CSS behavior

**Files:**
- Modify: `styles.css:1174-1261`
- Test: `tests/portfolio.spec.js`

- [ ] **Step 1: Replace the mobile header rules and add the type scale**

At the start of `@media (max-width: 680px)`, use:

```css
  html {
    font-size: 87.5%;
  }

  .site-header {
    display: none;
  }
```

Remove the now-obsolete mobile `.brand` and `.nav-links` rules.

- [ ] **Step 2: Remove the header allowance from the mobile hero**

Change the mobile hero rule to:

```css
  .hero {
    min-height: 100vh;
    padding-top: 2rem;
  }
```

- [ ] **Step 3: Preserve touch targets**

Add:

```css
  .command-link,
  .contact-actions a {
    min-height: 44px;
  }
```

- [ ] **Step 4: Hide the complete torus section**

Replace the mobile torus shell/output rules with:

```css
  .ascii-torus-band {
    display: none;
  }
```

- [ ] **Step 5: Run the responsive contract**

Run the Task 1 command again.

Expected: header, type scale, action height, and desktop assertions pass. The mobile runtime test still fails because `ascii-torus.js` initializes behind the hidden CSS.

### Task 3: Prevent mobile torus initialization

**Files:**
- Modify: `ascii-torus.js:1-6`
- Test: `tests/portfolio.spec.js`

- [ ] **Step 1: Add the matching initialization guard**

Replace the opening guard with:

```js
(function () {
  const root = document.getElementById('ascii-torus');
  const mobileViewport = window.matchMedia('(max-width: 680px)').matches;
  if (!root || root.hidden || mobileViewport) {
    return;
  }
```

- [ ] **Step 2: Verify GREEN**

Run the Task 1 command again.

Expected: all three selected tests pass. On mobile, the section is hidden, the debug API is undefined, no rotation dataset is written, and the output remains empty.

### Task 4: Full verification and handoff

**Files:**
- Modify: none
- Verify: `styles.css`, `ascii-torus.js`, `tests/portfolio.spec.js`

- [ ] **Step 1: Run unit tests**

Run:

```bash
npm run test:unit
```

Expected: all 83 unit tests pass.

- [ ] **Step 2: Run the complete browser suite**

Run:

```bash
./node_modules/.bin/playwright test \
  --config=/tmp/lostfrxks-playwright-chrome.config.cjs \
  --workers=4
```

Expected: all 52 Playwright tests pass, including mobile and desktop torus coverage.

- [ ] **Step 3: Capture visual evidence**

Run:

```bash
./node_modules/.bin/serve --listen tcp://127.0.0.1:4173 . >/tmp/lostfrxks-responsive-serve.log 2>&1 &
site_pid=$!
trap 'kill "$site_pid"' EXIT
for attempt in $(seq 1 20); do
  curl -fsS http://127.0.0.1:4173/ >/dev/null && break
  sleep 0.25
done

node <<'NODE'
const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: '/usr/bin/google-chrome-stable',
  });

  for (const target of [
    { name: 'mobile', width: 390, height: 844 },
    { name: 'desktop', width: 1440, height: 960 },
  ]) {
    const page = await browser.newPage({
      viewport: { width: target.width, height: target.height },
    });
    await page.goto('http://127.0.0.1:4173/');
    await page.getByRole('button', { name: /enter matrix intro/i }).click();
    await page.locator('#intro-screen').waitFor({ state: 'hidden', timeout: 10000 });
    await page.screenshot({
      path: `/tmp/lostfrxks-${target.name}-responsive-pass.png`,
      fullPage: true,
    });
    await page.close();
  }

  await browser.close();
})();
NODE

kill "$site_pid"
trap - EXIT
```

Expected: the mobile capture has no header or torus, uses smaller readable text, and has no horizontal overflow. The desktop capture retains the current header and torus.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git diff --check
git diff -- styles.css ascii-torus.js tests/portfolio.spec.js
git status --short --branch
```

Expected: only the three intended implementation files differ; `.serena/` remains untracked and untouched.

- [ ] **Step 5: Commit the verified implementation**

Run:

```bash
git add -- styles.css ascii-torus.js tests/portfolio.spec.js
git commit -m "perf: simplify mobile portfolio"
```

Expected: one implementation commit with no deployment. Production remains unchanged until the user explicitly requests a push.
