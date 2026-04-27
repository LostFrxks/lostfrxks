const { test, expect } = require('@playwright/test');

async function enterPortfolio(page) {
  await page.getByRole('button', { name: /enter matrix intro/i }).click();
  await expect(page.locator('#intro-screen')).toBeHidden();
}

test('browser title uses the lostfrxks site name', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('lostfrxks');
});

test('matrix intro scrambles central text then decrypts into Artur identity', async ({ page }) => {
  await page.goto('/');

  const intro = page.getByRole('button', { name: /enter matrix intro/i });
  const introName = page.locator('[data-intro-name]');
  const finalText = await introName.getAttribute('data-final-text');
  await expect(intro).toBeVisible();
  await expect(intro).not.toContainText(/wake up/i);
  await expect(intro).not.toContainText(/click to/i);

  const firstCipher = (await introName.textContent()).trim();
  const spreadBefore = await introName.evaluate((element) =>
    parseFloat(getComputedStyle(element).letterSpacing)
  );
  await page.waitForTimeout(220);
  const secondCipher = (await introName.textContent()).trim();
  expect(finalText).toBe('Artur Usenov');
  expect(firstCipher.length).toBe(finalText.length);
  expect(firstCipher).not.toBe('ACCESS REQUEST');
  expect(Number.isFinite(spreadBefore)).toBe(true);
  expect(spreadBefore).toBeGreaterThan(6);
  expect(secondCipher).not.toBe(firstCipher);
  expect(secondCipher).not.toBe('Artur Usenov');

  await intro.click();
  await expect(intro).toHaveClass(/intro-revealing/);
  await page.waitForTimeout(450);
  const spreadDuring = await introName.evaluate((element) =>
    parseFloat(getComputedStyle(element).letterSpacing)
  );
  expect(spreadDuring).toBeCloseTo(spreadBefore, 2);
  const immediateDecrypt = (await introName.textContent()).trim();
  expect(immediateDecrypt).not.toBe('Artur Usenov');
  await expect(introName).toHaveText('Artur Usenov');
  await expect(page.locator('#intro-screen')).toBeHidden();
});

test('intro is an opaque multilingual matrix rain screen without a boxed content panel', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.site-header')).toBeHidden();
  await expect(page.locator('main')).toBeHidden();
  await expect(page.locator('.intro-content')).toHaveCount(0);
  await expect(page.locator('[data-intro-glyph]')).toHaveCount(0);

  const rainCanvas = page.locator('#intro-rain');
  await expect(rainCanvas).toBeVisible();
  const alphabet = await rainCanvas.getAttribute('data-rain-alphabet');
  expect(alphabet).toMatch(/[漢界龍]/);
  expect(alphabet).toMatch(/[アイウカ]/);
  expect(alphabet).toMatch(/[가나다]/);
  expect(alphabet).toMatch(/[АБВЖ]/);

  const hasRainPixels = await rainCanvas.evaluate((canvas) => {
    const context = canvas.getContext('2d');
    const sample = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < sample.length; index += 4) {
      if (sample[index] !== 0) {
        return true;
      }
    }
    return false;
  });

  expect(hasRainPixels).toBe(true);
});

test('intro rain slows down while the identity decrypts', async ({ page }) => {
  await page.goto('/');

  const rainCanvas = page.locator('#intro-rain');
  await expect(rainCanvas).toHaveAttribute('data-rain-speed-mode', 'normal');

  await page.getByRole('button', { name: /enter matrix intro/i }).click();

  await expect(rainCanvas).toHaveAttribute('data-rain-speed-mode', 'decrypting');
  await expect(rainCanvas).toHaveAttribute('data-rain-speed-target', '0.24');
  await page.waitForTimeout(450);

  const currentSpeed = Number(await rainCanvas.getAttribute('data-rain-speed-current'));
  expect(currentSpeed).toBeLessThan(0.85);
});

test('intro exits through a reveal transition instead of a hard cut', async ({ page }) => {
  await page.goto('/');

  const intro = page.locator('#intro-screen');
  await page.getByRole('button', { name: /enter matrix intro/i }).click();
  await expect(page.locator('[data-intro-name]')).toHaveText('Artur Usenov');
  await expect(intro).toHaveClass(/intro-exiting/);
  await expect(page.locator('body')).toHaveClass(/site-revealing/);
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Artur Usenov/i })).toBeVisible();
  await expect(intro).toBeHidden();
});

test('intro reveal keeps Artur name transition free of zoom scaling', async ({ page }) => {
  await page.goto('/');

  const idleBox = await page.locator('[data-intro-name]').boundingBox();
  const idleScale = await page.locator('[data-intro-name]').evaluate((element) => {
    const transform = getComputedStyle(element).transform;
    if (transform === 'none') {
      return { x: 1, y: 1 };
    }

    const values = transform.match(/matrix.*\((.+)\)/)[1].split(',').map(Number);
    return { x: values[0], y: values[3] };
  });

  expect(idleScale.x).toBeCloseTo(1, 2);
  expect(idleScale.y).toBeCloseTo(1, 2);

  await page.getByRole('button', { name: /enter matrix intro/i }).click();
  await expect(page.locator('#intro-screen')).toHaveClass(/intro-revealing/);
  await page.waitForTimeout(180);

  const decryptingScale = await page.locator('[data-intro-name]').evaluate((element) => {
    const transform = getComputedStyle(element).transform;
    if (transform === 'none') {
      return { x: 1, y: 1 };
    }

    const values = transform.match(/matrix.*\((.+)\)/)[1].split(',').map(Number);
    return { x: values[0], y: values[3] };
  });

  expect(decryptingScale.x).toBeCloseTo(1, 2);
  expect(decryptingScale.y).toBeCloseTo(1, 2);

  await expect(page.locator('[data-intro-name]')).toHaveText('Artur Usenov');
  const finalBox = await page.locator('[data-intro-name]').boundingBox();
  await expect(page.locator('#intro-screen')).toHaveClass(/intro-exiting/);
  await page.waitForTimeout(180);

  expect(finalBox.width).toBeGreaterThanOrEqual(idleBox.width * 0.97);

  const scales = await page.evaluate(() => {
    function readScale(selector) {
      const element = document.querySelector(selector);
      const transform = getComputedStyle(element).transform;
      if (transform === 'none') {
        return { x: 1, y: 1 };
      }

      const values = transform.match(/matrix.*\((.+)\)/)[1].split(',').map(Number);
      if (values.length === 6) {
        return { x: values[0], y: values[3] };
      }

      return { x: values[0], y: values[5] };
    }

    return {
      intro: readScale('#intro-screen'),
      name: readScale('[data-intro-name]'),
      main: readScale('main'),
    };
  });

  for (const scale of [scales.intro, scales.name, scales.main]) {
    expect(scale.x).toBeCloseTo(1, 2);
    expect(scale.y).toBeCloseTo(1, 2);
  }
});

test('main sections materialize with matrix reveal as they enter view', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  const hero = page.locator('.hero');
  const projects = page.locator('#projects');
  const projectCards = page.locator('#projects .project-card');

  await expect(hero).toHaveAttribute('data-matrix-reveal', 'hero');
  await expect(projects).toHaveAttribute('data-matrix-reveal', 'section');
  await expect(projects).not.toHaveClass(/matrix-revealed/);

  await page.getByRole('button', { name: /projects command/i }).click();

  await expect(projects).toHaveClass(/matrix-revealed/);
  await expect(projectCards.first()).toHaveClass(/matrix-revealed/);
  await expect(projectCards.nth(4)).toHaveClass(/matrix-revealed/);
});

test('hero presents Artur as lostfrxks fullstack developer', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  await expect(page.getByRole('heading', { name: /Artur Usenov/i })).toBeVisible();
  await expect(page.getByText(/lostfrxks/i).first()).toBeVisible();
  await expect(page.getByText(/Fullstack Developer/i).first()).toBeVisible();
  await expect(page.getByText(/Python \/ Django \/ FastAPI \/ React \/ TypeScript/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /GitHub/i })).toBeVisible();
});

test('featured projects and achievements are visible', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  await expect(page.getByRole('heading', { name: /Featured Systems/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /GUROO/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /USC/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Homy/i })).toBeVisible();
  await expect(page.getByText(/Makeathon Winner/i)).toBeVisible();
  await expect(page.getByText(/LeetCode 140\+/i)).toBeVisible();
});

test('command controls navigate to sections and toggle matrix intensity', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  await page.getByRole('button', { name: /projects command/i }).click();
  await expect(page.locator('#projects')).toBeInViewport();

  const matrixToggle = page.getByRole('button', { name: /matrix intensity/i });
  await expect(matrixToggle).toHaveAttribute('aria-pressed', 'true');
  await matrixToggle.click();
  await expect(matrixToggle).toHaveAttribute('aria-pressed', 'false');
});

test('matrix canvas draws visible pixels', async ({ page }) => {
  await page.goto('/');
  const hasPixels = await page.locator('#matrix-canvas').evaluate((canvas) => {
    const context = canvas.getContext('2d');
    const sample = context.getImageData(0, 0, canvas.width, canvas.height).data;
    for (let index = 3; index < sample.length; index += 4) {
      if (sample[index] !== 0) {
        return true;
      }
    }
    return false;
  });

  expect(hasPixels).toBe(true);
});

test('mobile layout keeps primary identity and actions reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await enterPortfolio(page);

  await expect(page.getByRole('heading', { name: /Artur Usenov/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /GitHub/i })).toBeVisible();
  await expect(page.getByRole('button', { name: /projects command/i })).toBeVisible();

  const avatarBox = await page.locator('.avatar').boundingBox();
  const panelContentWidth = await page.locator('.identity-panel').evaluate((element) => {
    const styles = getComputedStyle(element);
    return element.clientWidth - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
  });

  expect(avatarBox.width).toBeGreaterThanOrEqual(220);
  expect(avatarBox.height).toBeGreaterThanOrEqual(220);
  expect(avatarBox.width).toBeGreaterThanOrEqual(panelContentWidth - 2);
});

test('mock social contacts include LinkedIn Telegram and Instagram', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  await page.getByRole('button', { name: /contact command/i }).click();
  await expect(page.getByRole('link', { name: /LinkedIn/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Telegram/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /Instagram/i })).toBeVisible();
});
