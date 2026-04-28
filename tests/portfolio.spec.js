const { test, expect } = require('@playwright/test');

function secondsFromCssTime(value) {
  const trimmed = value.trim();
  if (trimmed.endsWith('ms')) {
    return Number.parseFloat(trimmed) / 1000;
  }
  return Number.parseFloat(trimmed);
}

function transitionDurationForProperty(state, property) {
  const properties = state.transitionProperty.split(',').map((item) => item.trim());
  const durations = state.transitionDuration.split(',').map(secondsFromCssTime);
  const index = properties.indexOf(property);

  if (index === -1) {
    return null;
  }

  return durations[index] ?? durations[durations.length - 1] ?? null;
}

async function enterPortfolio(page) {
  await page.getByRole('button', { name: /enter matrix intro/i }).click();
  await expect(page.locator('#intro-screen')).toBeHidden({ timeout: 10000 });
}

async function disableSmoothScroll(page) {
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
    document.body.style.scrollBehavior = 'auto';
  });
}

async function jumpToScrollY(page, y) {
  await disableSmoothScroll(page);
  await page.evaluate(
    (targetY) =>
      new Promise((resolve) => {
        window.scrollTo(0, targetY);
        window.dispatchEvent(new Event('scroll'));
        window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
      }),
    y
  );
}

test('browser title uses the lostfrxks site name', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('lostfrxks');
});

test('site exposes a neon terminal favicon', async ({ page }) => {
  await page.goto('/');

  const favicon = page.locator('link[rel="icon"]');
  await expect(favicon).toHaveAttribute('type', 'image/svg+xml');
  await expect(favicon).toHaveAttribute('href', 'favicon.svg');

  const response = await page.request.get('/favicon.svg');
  expect(response.ok()).toBe(true);
  const svg = await response.text();
  expect(svg).not.toContain('01 lostfrxks');
  expect(svg).toContain('data-terminal-underscore="true"');
  expect(svg).toContain('#5cffb1');
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

test('intro holds on the resolved Artur identity before revealing the portfolio', async ({ page }) => {
  await page.goto('/');

  const holdDuration = await page.evaluate(async () => {
    const intro = document.querySelector('#intro-screen');
    const introName = document.querySelector('[data-intro-name]');
    const start = performance.now();
    let finalNameAt = null;

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        observer.disconnect();
        reject(new Error('Intro did not start exiting after resolving the identity.'));
      }, 4000);
      const observer = new MutationObserver(() => {
        if (introName.textContent === 'Artur Usenov' && finalNameAt === null) {
          finalNameAt = performance.now() - start;
        }

        if (intro.classList.contains('intro-exiting') && finalNameAt !== null) {
          window.clearTimeout(timeout);
          observer.disconnect();
          resolve(performance.now() - start - finalNameAt);
        }
      });

      observer.observe(document.documentElement, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
      });
      intro.click();
    });
  });

  expect(holdDuration).toBeGreaterThanOrEqual(1200);
  expect(holdDuration).toBeLessThan(1500);
});

test('intro rain matches the main matrix background style without a boxed content panel', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.site-header')).toBeHidden();
  await expect(page.locator('main')).toBeHidden();
  await expect(page.locator('.intro-content')).toHaveCount(0);
  await expect(page.locator('[data-intro-glyph]')).toHaveCount(0);

  const rainCanvas = page.locator('#intro-rain');
  await expect(rainCanvas).toBeVisible();
  const alphabet = await rainCanvas.getAttribute('data-rain-alphabet');
  expect(alphabet).toBe('01{}[]<>/\\$#@lostfrxksARTURPYTSFASTAPI');
  await expect(rainCanvas).toHaveAttribute('data-font-size', '16');
  await expect(rainCanvas).toHaveAttribute('data-column-width', '18');

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
  await expect(rainCanvas).toHaveAttribute('data-trail-range', '5-18');
  await expect(rainCanvas).toHaveAttribute('data-frame-clear-mode', 'focusing');
  await expect(rainCanvas).toHaveAttribute('data-respawn-mode', 'after-full-trail-exit');
  await page.waitForTimeout(450);

  const currentSpeed = Number(await rainCanvas.getAttribute('data-rain-speed-current'));
  expect(currentSpeed).toBeLessThan(0.85);
});

test('intro rain smoothly focuses from fast blurred trails into crisp decrypt rain', async ({ page }) => {
  await page.goto('/');

  const rainCanvas = page.locator('#intro-rain');
  await expect(rainCanvas).toHaveAttribute('data-frame-clear-alpha', '0.12');

  await page.getByRole('button', { name: /enter matrix intro/i }).click();

  const firstFocus = await rainCanvas.evaluate((canvas) => ({
    alpha: Number(canvas.getAttribute('data-frame-clear-alpha')),
    focus: Number(canvas.getAttribute('data-focus-progress')),
    refreshFrames: Number(canvas.getAttribute('data-glyph-refresh-frames')),
  }));
  expect(firstFocus.alpha).toBeLessThan(1);
  expect(firstFocus.focus).toBeLessThan(0.5);
  expect(firstFocus.refreshFrames).toBeLessThan(72);

  await page.waitForTimeout(700);

  const laterFocus = await rainCanvas.evaluate((canvas) => ({
    alpha: Number(canvas.getAttribute('data-frame-clear-alpha')),
    focus: Number(canvas.getAttribute('data-focus-progress')),
    refreshFrames: Number(canvas.getAttribute('data-glyph-refresh-frames')),
    mode: canvas.getAttribute('data-frame-clear-mode'),
  }));
  expect(laterFocus.alpha).toBeGreaterThan(firstFocus.alpha);
  expect(laterFocus.focus).toBeGreaterThan(firstFocus.focus);
  expect(laterFocus.focus).toBeLessThan(0.8);
  expect(laterFocus.refreshFrames).toBeGreaterThan(firstFocus.refreshFrames);
  expect(laterFocus.mode).toBe('focusing');

  await expect(rainCanvas).toHaveAttribute('data-frame-clear-mode', 'crisp', { timeout: 2500 });
  await expect(rainCanvas).toHaveAttribute('data-frame-clear-alpha', '1.00');
  await expect(rainCanvas).toHaveAttribute('data-glyph-refresh-frames', '72');
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

test('reload starts the portfolio from the top instead of restoring old scroll', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  await page.locator('.nav-links a[href="#contact"]').click();
  await expect(page.locator('#contact')).toBeInViewport();

  await page.reload();
  await enterPortfolio(page);

  await expect
    .poll(() => page.evaluate(() => Math.round(window.scrollY)))
    .toBeLessThanOrEqual(4);
  await expect(page.locator('.hero')).toBeInViewport();
});

test('hash links do not force-scroll the intro into a section', async ({ page }) => {
  await page.goto('/#whoami');
  await enterPortfolio(page);
  await page.waitForTimeout(600);

  await expect(page.locator('.hero')).toBeInViewport();
  await expect(page.locator('#whoami')).not.toBeInViewport();
  await expect
    .poll(() => page.evaluate(() => window.location.hash))
    .toBe('#whoami');
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

  await page.locator('.nav-links a[href="#projects"]').click();

  await expect(projects).toHaveClass(/matrix-revealed/);
  await expect(projectCards.first()).toHaveClass(/matrix-revealed/);
  await expect(projectCards.nth(4)).toHaveClass(/matrix-revealed/);
});

test('desktop matrix sections wait until they are inside the viewport before revealing', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await enterPortfolio(page);
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
  });

  const stack = page.locator('#stack');
  await expect(stack).not.toHaveClass(/matrix-revealed/);

  const earlyScrollY = await stack.evaluate((element) => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    return Math.max(0, top - window.innerHeight * 0.82);
  });
  await jumpToScrollY(page, earlyScrollY);
  await page.waitForTimeout(180);

  await expect(stack).not.toHaveClass(/matrix-revealed/);

  const revealScrollY = await stack.evaluate((element) => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    return Math.max(0, top - window.innerHeight * 0.74);
  });
  await jumpToScrollY(page, revealScrollY);

  await expect(stack).toHaveClass(/matrix-revealed/);
});

test('hero presents Artur as lostfrxks fullstack developer', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  await expect(page.getByRole('heading', { name: /Artur Usenov/i })).toBeVisible();
  await expect(page.getByText(/lostfrxks/i).first()).toBeVisible();
  await expect(page.getByText(/Fullstack Developer/i).first()).toBeVisible();
  await expect(page.getByText(/Current Role/i)).toBeVisible();
  await expect(page.getByText(/Junior Backend Developer at MDigital/i)).toBeVisible();
  await expect(page.getByText(/ship working MVPs/i)).toHaveCount(0);
  await expect(page.getByText(/Python \/ Django \/ React \/ TypeScript \/ C\+\+/i)).toBeVisible();
  await expect(page.getByText(/TSI AUCA, 2022-2026, GPA 3\.85/i)).toBeVisible();
  await expect(page.getByText(/AUCA TSI/i)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /GitHub/i })).toBeVisible();
});

test('whoami block reveals its heading before typing the right-side copy', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  const whoami = page.locator('#whoami');
  const command = page.locator('[data-whoami-command]');
  const heading = page.locator('[data-whoami-heading]');
  const firstParagraph = page.locator('[data-whoami-line="intro"]');
  const secondParagraph = page.locator('[data-whoami-line="signals"]');

  await expect(firstParagraph).toHaveText('');
  await expect(secondParagraph).toHaveText('');

  await page.locator('.nav-links a[href="#whoami"]').click();
  await expect(whoami).toHaveClass(/matrix-revealed/);
  await expect(command).toHaveText('/usr/bin/whoami');
  await expect(heading).toHaveText('Backend brain, fullstack hands.');
  await expect(page.locator('[data-whoami-spinner]')).toHaveCount(0);
  await expect(firstParagraph).toContainText(/I am Artur Usenov/);
  await expect(secondParagraph).toContainText(/The strongest public signals/);
});

test('boot lines are hidden until the terminal types them', async ({ page }) => {
  await page.goto('/');

  const bootLines = page.locator('[data-boot-text]');
  await expect(bootLines.first()).toHaveText('');
  await expect(bootLines.nth(1)).toHaveText('');
  await expect(bootLines.nth(2)).toHaveText('');

  await enterPortfolio(page);

  await expect(bootLines.first()).toHaveText('loading public profile...');
  await expect(bootLines.nth(1)).toHaveText('mounting projects: GUROO, USC, Homy, embedding-search');
  await expect(bootLines.nth(2)).toHaveText('status: online');
});

test('featured projects and achievements are visible', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  const projectGrid = page.locator('#projects .project-grid');
  const timeline = page.locator('.timeline');

  await expect(page.getByRole('heading', { name: /Featured Systems/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /GUROO/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /USC/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Homy/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /ATLAS-STORE/i })).toBeVisible();
  await expect(page.getByText(/mbank-voice-stand/i)).toHaveCount(0);
  await expect(projectGrid.getByText(/Django, HTML, CSS,\s+JavaScript, SQLite/i)).toBeVisible();
  await expect(projectGrid.getByText(/agent profile with avatar and metrics/i)).toBeVisible();
  await expect(projectGrid.getByText(/production e-commerce/i)).toBeVisible();
  await expect(projectGrid.getByText(/Next\.js/i)).toBeVisible();
  await expect(projectGrid.getByText(/Django REST/i)).toBeVisible();
  await expect(projectGrid.getByText(/status:/i)).toHaveCount(0);
  await expect(page.getByText(/Makeathon Winner/i)).toBeVisible();
  await expect(page.getByText(/LeetCode 260\+/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /LeetCode profile: lostfrxks/i })).toHaveAttribute(
    'href',
    'https://leetcode.com/u/lostfrxks/'
  );
  await expect(page.getByRole('link', { name: /open atlas-store/i })).toHaveAttribute(
    'href',
    'https://atlas-store.kg/'
  );
  await expect(page.getByLabel('Signals').getByText(/ICPC NERC 2025 finalist/i)).toBeVisible();
  await expect(page.getByLabel('Signals').getByText(/GPA 3\.85/i)).toBeVisible();
  await expect(timeline.getByText(/Dec 2025 - Feb 2026/i)).toBeVisible();
  await expect(timeline.getByText(/MBank backend developer internship/i)).toBeVisible();
});

test('featured projects use a stable card grid without slider mechanics', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  await page.locator('.nav-links a[href="#projects"]').click();
  await expect(page.locator('#projects')).toBeInViewport();
  await page.waitForTimeout(700);

  const grid = page.locator('#projects .project-grid');
  const items = page.locator('#projects .project-grid__item');

  await expect(grid).toBeVisible();
  await expect(items).toHaveCount(5);
  await expect(page.locator('[data-project-carousel]')).toHaveCount(0);
  await expect(page.locator('#projects .project-track')).toHaveCount(0);
  await expect(page.locator('#projects .project-scrollbar')).toHaveCount(0);
  await expect(page.locator('#projects [data-loop-clone="true"]')).toHaveCount(0);
  await expect(page.locator('#projects .carousel-button')).toHaveCount(0);
  await expect(page.locator('#projects .carousel-dots')).toHaveCount(0);

  const gridState = await grid.evaluate((element) => {
    const styles = getComputedStyle(element);
    const itemStates = Array.from(element.children).map((item) => {
      const itemStyles = getComputedStyle(item);
      return {
        opacity: itemStyles.opacity,
        transform: itemStyles.transform,
      };
    });

    return {
      display: styles.display,
      gridTemplateColumns: styles.gridTemplateColumns,
      overflowX: styles.overflowX,
      itemStates,
    };
  });

  expect(gridState.display).toBe('grid');
  expect(gridState.gridTemplateColumns.split(' ').length).toBeGreaterThanOrEqual(2);
  expect(gridState.overflowX).toBe('visible');
  for (const itemState of gridState.itemStates) {
    expect(itemState.opacity).toBe('1');
    expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(itemState.transform);
  }
});

test('project cards deform into a cursor-driven 3D tilt', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  await page.locator('.nav-links a[href="#projects"]').click();

  const card = page.locator('#projects .project-card').first();
  await expect(card).toHaveClass(/matrix-revealed/);
  await expect(card).toHaveClass(/matrix-reveal-settled/);
  await expect(card).toHaveAttribute('data-card-tilt', 'idle');

  const box = await card.boundingBox();
  await card.hover({ position: { x: box.width * 0.12, y: box.height * 0.12 } });

  await expect(card).toHaveClass(/card-tilt-active/);
  await expect(card).toHaveAttribute('data-card-tilt', 'active');

  const activeState = await card.evaluate((element) => {
    const styles = getComputedStyle(element);
    const focusLayer = getComputedStyle(element, '::before');
    return {
      cursorX: styles.getPropertyValue('--card-cursor-x').trim(),
      cursorY: styles.getPropertyValue('--card-cursor-y').trim(),
      tiltX: styles.getPropertyValue('--card-tilt-x').trim(),
      tiltY: styles.getPropertyValue('--card-tilt-y').trim(),
      liftZ: styles.getPropertyValue('--card-lift-z').trim(),
      transform: styles.transform,
      focusBackground: focusLayer.backgroundImage,
      transitionProperty: styles.transitionProperty,
      transitionDuration: styles.transitionDuration,
    };
  });

  expect(parseFloat(activeState.cursorX)).toBeLessThan(20);
  expect(parseFloat(activeState.cursorY)).toBeLessThan(20);
  expect(parseFloat(activeState.tiltX)).not.toBe(0);
  expect(parseFloat(activeState.tiltY)).not.toBe(0);
  expect(parseFloat(activeState.liftZ)).toBe(0);
  expect(activeState.transform).not.toBe('none');
  expect(activeState.focusBackground).not.toContain('radial-gradient');
  expect(transitionDurationForProperty(activeState, 'transform')).toBeLessThanOrEqual(0.12);

  await page.mouse.move(box.x - 20, box.y - 20);
  await expect(card).toHaveAttribute('data-card-tilt', 'returning');
  await expect(card).toHaveClass(/card-tilt-active/);
  await expect(card).toHaveClass(/card-tilt-returning/);

  await page.waitForTimeout(260);
  await expect(card).toHaveAttribute('data-card-tilt', 'idle');
  await expect(card).not.toHaveClass(/card-tilt-active/);
  await expect(card).toHaveClass(/matrix-reveal-settled/);

  const idleAnimationName = await card.evaluate((element) => getComputedStyle(element).animationName);
  expect(idleAnimationName).not.toContain('matrixMaterialize');
});

test('stack cards use the same cursor-driven 3D tilt', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  await page.locator('.nav-links a[href="#stack"]').click();

  const card = page.locator('#stack .stack-card').first();
  await expect(card).toHaveClass(/matrix-revealed/);
  await expect(card).toHaveAttribute('data-card-tilt', 'idle');

  const box = await card.boundingBox();
  await card.hover({ position: { x: box.width * 0.16, y: box.height * 0.18 } });

  await expect(card).toHaveClass(/card-tilt-active/);
  await expect(card).toHaveAttribute('data-card-tilt', 'active');

  const activeState = await card.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      cursorX: styles.getPropertyValue('--card-cursor-x').trim(),
      cursorY: styles.getPropertyValue('--card-cursor-y').trim(),
      tiltX: styles.getPropertyValue('--card-tilt-x').trim(),
      tiltY: styles.getPropertyValue('--card-tilt-y').trim(),
      liftZ: styles.getPropertyValue('--card-lift-z').trim(),
      transform: styles.transform,
      focusBackground: getComputedStyle(element, '::before').backgroundImage,
    };
  });

  expect(parseFloat(activeState.cursorX)).toBeLessThan(22);
  expect(parseFloat(activeState.cursorY)).toBeLessThan(32);
  expect(parseFloat(activeState.tiltX)).not.toBe(0);
  expect(parseFloat(activeState.tiltY)).not.toBe(0);
  expect(parseFloat(activeState.liftZ)).toBe(0);
  expect(activeState.transform).not.toBe('none');
  expect(activeState.focusBackground).not.toContain('radial-gradient');

  await page.mouse.move(box.x - 20, box.y - 20);
  await expect(card).toHaveAttribute('data-card-tilt', 'returning');
  await expect(card).toHaveClass(/card-tilt-active/);
  await expect(card).toHaveClass(/card-tilt-returning/);

  await page.waitForTimeout(260);
  await expect(card).toHaveAttribute('data-card-tilt', 'idle');
  await expect(card).not.toHaveClass(/card-tilt-active/);
  await expect(card).toHaveClass(/matrix-reveal-settled/);

  const idleAnimationName = await card.evaluate((element) => getComputedStyle(element).animationName);
  expect(idleAnimationName).not.toContain('matrixMaterialize');
});

test('achievement cards use the same cursor-driven 3D tilt', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  const card = page.locator('.achievement-card').first();
  await card.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  await expect(card).toHaveClass(/matrix-revealed/);
  await expect(card).toHaveAttribute('data-card-tilt', 'idle');

  const box = await card.boundingBox();
  await card.hover({ position: { x: box.width * 0.18, y: box.height * 0.2 } });

  await expect(card).toHaveClass(/card-tilt-active/);
  await expect(card).toHaveAttribute('data-card-tilt', 'active');

  const activeState = await card.evaluate((element) => {
    const styles = getComputedStyle(element);
    return {
      cursorX: styles.getPropertyValue('--card-cursor-x').trim(),
      cursorY: styles.getPropertyValue('--card-cursor-y').trim(),
      tiltX: styles.getPropertyValue('--card-tilt-x').trim(),
      tiltY: styles.getPropertyValue('--card-tilt-y').trim(),
      liftZ: styles.getPropertyValue('--card-lift-z').trim(),
      transform: styles.transform,
      focusBackground: getComputedStyle(element, '::before').backgroundImage,
    };
  });

  expect(parseFloat(activeState.cursorX)).toBeLessThan(24);
  expect(parseFloat(activeState.cursorY)).toBeLessThan(34);
  expect(parseFloat(activeState.tiltX)).not.toBe(0);
  expect(parseFloat(activeState.tiltY)).not.toBe(0);
  expect(parseFloat(activeState.liftZ)).toBe(0);
  expect(activeState.transform).not.toBe('none');
  expect(activeState.focusBackground).not.toContain('radial-gradient');

  await page.mouse.move(box.x - 20, box.y - 20);
  await expect(card).toHaveAttribute('data-card-tilt', 'returning');
  await expect(card).toHaveClass(/card-tilt-active/);
  await expect(card).toHaveClass(/card-tilt-returning/);

  await page.waitForTimeout(260);
  await expect(card).toHaveAttribute('data-card-tilt', 'idle');
  await expect(card).not.toHaveClass(/card-tilt-active/);
  await expect(card).toHaveClass(/matrix-reveal-settled/);

  const idleAnimationName = await card.evaluate((element) => getComputedStyle(element).animationName);
  expect(idleAnimationName).not.toContain('matrixMaterialize');
});

test('mobile cards ignore tap hover effects instead of showing sticky 3D or glow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await enterPortfolio(page);

  const card = page.locator('#projects .project-card').first();
  await card.scrollIntoViewIfNeeded();
  await expect(card).toHaveClass(/matrix-revealed/);
  await expect(card).toHaveAttribute('data-card-tilt', 'idle');

  await card.evaluate((element) => {
    element.dispatchEvent(
      new PointerEvent('pointerdown', {
        bubbles: true,
        pointerType: 'touch',
        clientX: element.getBoundingClientRect().left + element.getBoundingClientRect().width / 2,
        clientY: element.getBoundingClientRect().top + element.getBoundingClientRect().height / 2,
      })
    );
  });

  await expect(card).not.toHaveClass(/card-tilt-active/);
  await expect(card).not.toHaveClass(/card-touch-active/);
  await expect(card).toHaveAttribute('data-card-touch', 'idle');

  const touchState = await card.evaluate((element) => ({
    transform: getComputedStyle(element).transform,
    tiltX: getComputedStyle(element).getPropertyValue('--card-tilt-x').trim(),
    tiltY: getComputedStyle(element).getPropertyValue('--card-tilt-y').trim(),
  }));

  expect(touchState.transform).not.toContain('matrix3d');
  expect(touchState.tiltX).toBe('0deg');
  expect(touchState.tiltY).toBe('0deg');

  await page.waitForTimeout(280);
  await expect(card).not.toHaveClass(/card-touch-active/);
  await expect(card).toHaveAttribute('data-card-touch', 'idle');
});

test('primary navigation uses header links without the hero command dock', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  await page.locator('.nav-links a[href="#projects"]').click();
  await expect(page.locator('#projects')).toBeInViewport();
  await expect(page.locator('.command-dock')).toHaveCount(0);
  await expect(page.locator('[data-target]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /whoami command|projects command|stack command|contact command/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /matrix intensity/i })).toHaveCount(0);
  await expect(page.getByText(/matrix:on/i)).toHaveCount(0);
});

test('desktop anchor navigation reliably reveals the contact section', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  const contact = page.locator('#contact');
  await expect(contact).not.toHaveClass(/matrix-revealed/);

  await page.locator('.nav-links a[href="#contact"]').click();

  await expect(contact).toHaveClass(/matrix-revealed/);
  await expect(page.locator('#contact .contact-actions a').first()).toHaveClass(/matrix-revealed/);
});

test('main matrix background matches the intro rain style and draws visible pixels', async ({ page }) => {
  await page.goto('/');

  const matrixCanvas = page.locator('#matrix-canvas');
  const introCanvas = page.locator('#intro-rain');

  await expect(matrixCanvas).toHaveAttribute('data-matrix-style', 'intro-rain');
  await expect(matrixCanvas).toHaveAttribute('data-rain-alphabet', await introCanvas.getAttribute('data-rain-alphabet'));
  await expect(matrixCanvas).toHaveAttribute('data-font-size', await introCanvas.getAttribute('data-font-size'));
  await expect(matrixCanvas).toHaveAttribute('data-column-width', await introCanvas.getAttribute('data-column-width'));
  await expect(matrixCanvas).toHaveAttribute('data-rain-speed', '0.24');
  await expect(matrixCanvas).toHaveAttribute('data-trail-range', '5-18');
  await expect(matrixCanvas).toHaveAttribute('data-glyph-refresh-frames', '72');
  await expect(matrixCanvas).toHaveAttribute('data-glyph-refresh-mode', 'staggered-slow');
  await expect(matrixCanvas).toHaveAttribute('data-frame-clear-mode', 'crisp');
  await expect(matrixCanvas).toHaveAttribute('data-frame-clear-alpha', '1.00');
  await expect(matrixCanvas).toHaveAttribute('data-respawn-mode', 'after-full-trail-exit');

  const trailLengths = (await matrixCanvas.getAttribute('data-trail-lengths'))
    .split(',')
    .map(Number);
  expect(new Set(trailLengths).size).toBeGreaterThanOrEqual(4);

  const matrixOpacity = await matrixCanvas.evaluate((canvas) => getComputedStyle(canvas).opacity);
  expect(Number(matrixOpacity)).toBeGreaterThanOrEqual(0.72);

  const hasPixels = await matrixCanvas.evaluate((canvas) => {
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

test('matrix rain includes rare vertical easter egg words', async ({ page }) => {
  await page.goto('/');

  const expectedWords = ['lostfrxks', 'G5_IS_THE_BEST', 'MISS_U'];
  const matrixCanvas = page.locator('#matrix-canvas');
  const introCanvas = page.locator('#intro-rain');

  await expect(matrixCanvas).toHaveAttribute('data-easter-egg-words', expectedWords.join(','));
  await expect(introCanvas).toHaveAttribute('data-easter-egg-words', expectedWords.join(','));

  const sample = await matrixCanvas.evaluate((canvas) => {
    const columns = window.__matrixDebug?.columns || [];
    return columns.some((column) => column.word && column.glyphs.join('').includes(column.word));
  });

  expect(sample).toBe(true);
});

test('mobile layout keeps primary identity and actions reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await enterPortfolio(page);

  await expect(page.locator('.brand')).toBeHidden();
  await expect(page.getByRole('heading', { name: /Artur Usenov/i })).toBeVisible();
  await expect(page.getByRole('link', { name: /GitHub/i })).toBeVisible();
  await expect(page.locator('.nav-links a[href="#projects"]')).toBeVisible();
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

test('mobile matrix sections reveal before they are deep in the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await enterPortfolio(page);

  const stack = page.locator('#stack');
  await expect(stack).not.toHaveClass(/matrix-revealed/);

  const scrollY = await stack.evaluate((element) => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    return Math.max(0, top - window.innerHeight + 96);
  });
  await jumpToScrollY(page, scrollY);

  await expect(stack).toHaveClass(/matrix-revealed/);
});

test('mobile project cards reveal individually as their column items enter view', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await enterPortfolio(page);
  await disableSmoothScroll(page);

  const projects = page.locator('#projects');
  const projectCards = page.locator('#projects .project-card');
  await page.locator('.nav-links a[href="#projects"]').click();

  await expect(projects).toHaveClass(/matrix-revealed/);
  await expect(projectCards.first()).toHaveClass(/matrix-revealed/);
  await expect(projectCards.nth(4)).not.toHaveClass(/matrix-revealed/);

  const almostVisibleScrollY = await projectCards.nth(1).evaluate((element) => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    return Math.max(0, top - window.innerHeight * 0.82);
  });
  await jumpToScrollY(page, almostVisibleScrollY);
  await page.waitForTimeout(220);

  await expect(projectCards.nth(1)).not.toHaveClass(/matrix-revealed/);

  const revealScrollY = await projectCards.nth(1).evaluate((element) => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    return Math.max(0, top - window.innerHeight * 0.68);
  });
  await jumpToScrollY(page, revealScrollY);

  await expect(projectCards.nth(1)).toHaveClass(/matrix-revealed/);

  await projectCards.nth(4).scrollIntoViewIfNeeded();

  await expect(projectCards.nth(4)).toHaveClass(/matrix-revealed/);
});

test('mobile stack cards reveal one-by-one down the column', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await enterPortfolio(page);

  const stack = page.locator('#stack');
  const stackCards = page.locator('#stack .stack-card');
  await page.locator('.nav-links a[href="#stack"]').click();

  await expect(stack).toHaveClass(/matrix-revealed/);
  await expect(stackCards.first()).toHaveClass(/matrix-revealed/);
  await expect(stackCards.nth(4)).not.toHaveClass(/matrix-revealed/);

  await stackCards.nth(4).scrollIntoViewIfNeeded();

  await expect(stackCards.nth(4)).toHaveClass(/matrix-revealed/);
});

test('mobile contact actions reveal with the final contact section', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await enterPortfolio(page);

  const contact = page.locator('#contact');
  const firstContactAction = page.locator('#contact .contact-actions a').first();
  const scrollY = await contact.evaluate((element) => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    return Math.max(0, top - window.innerHeight + 96);
  });
  await jumpToScrollY(page, scrollY);

  await expect(contact).toHaveClass(/matrix-revealed/);
  await expect(firstContactAction).toHaveClass(/matrix-revealed/);
});

test('contact links include real email LinkedIn Telegram and Instagram profiles', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  await page.locator('.nav-links a[href="#contact"]').click();
  await expect(page.getByRole('link', { name: /\+996 501 271 007/i })).toHaveCount(0);
  await expect(page.locator('a[href^="tel:"]')).toHaveCount(0);
  await expect(page.getByRole('link', { name: /lostfrxks@gmail\.com/i })).toHaveAttribute(
    'href',
    'mailto:lostfrxks@gmail.com'
  );
  await expect(page.getByRole('link', { name: /LinkedIn/i })).toHaveAttribute(
    'href',
    'https://www.linkedin.com/in/artur-usenov-424108395/'
  );
  await expect(page.getByRole('link', { name: /^Telegram$/i })).toHaveAttribute(
    'href',
    'https://t.me/lostfrxks'
  );
  await expect(page.getByRole('link', { name: /Instagram/i })).toHaveAttribute(
    'href',
    'https://www.instagram.com/lostfrxks/'
  );
});

test('contact is followed by an interactive ascii torus artifact', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  await page.locator('.nav-links a[href="#contact"]').click();
  const artifact = page.locator('#ascii-torus');
  const torusOutput = artifact.locator('[data-ascii-torus-output]');

  await expect(artifact).toBeVisible();
  await expect(artifact).toHaveAttribute('data-matrix-reveal', 'section');
  await expect(artifact).toHaveAttribute('data-ascii-torus', 'interactive');
  await expect(torusOutput).toContainText(/[.@#$*+=:;~\-_/<>01]{12,}/);

  const contactBottom = await page.locator('#contact').evaluate((element) => element.offsetTop + element.offsetHeight);
  const torusTop = await artifact.evaluate((element) => element.offsetTop);
  expect(torusTop).toBeGreaterThanOrEqual(contactBottom);

  const before = await artifact.getAttribute('data-torus-rotation');
  const box = await artifact.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.35);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.62, { steps: 8 });
  await page.mouse.up();

  await expect
    .poll(() => artifact.getAttribute('data-torus-rotation'), { timeout: 2000 })
    .not.toBe(before);
});

test('ascii torus artifact floats near contact without terminal chrome', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  const artifact = page.locator('#ascii-torus');
  await artifact.scrollIntoViewIfNeeded();

  await expect(artifact.getByText(/floating artifact/i)).toHaveCount(0);
  await expect(artifact.getByText(/^ASCII Torus$/i)).toHaveCount(0);
  await expect(artifact.getByText(/small symbol engine/i)).toHaveCount(0);
  await expect(artifact.locator('.ascii-torus-bar')).toHaveCount(0);

  const sizing = await artifact.evaluate((element) => {
    const contact = document.getElementById('contact');
    const wrapper = element.querySelector('.section-inner');
    const shell = element.querySelector('.ascii-torus-shell');
    const output = element.querySelector('[data-ascii-torus-output]');
    const shellStyles = getComputedStyle(shell);
    const shellBeforeStyles = getComputedStyle(shell, '::before');
    const shellAfterStyles = getComputedStyle(shell, '::after');
    const outputRect = output.getBoundingClientRect();
    return {
      contactGap: element.offsetTop - (contact.offsetTop + contact.offsetHeight),
      wrapperWidth: wrapper.getBoundingClientRect().width,
      shellWidth: shell.getBoundingClientRect().width,
      shellBorder: shellStyles.borderTopWidth,
      shellGlow: shellStyles.boxShadow,
      beforeGlow: shellBeforeStyles.backgroundImage,
      beforeOpacity: shellBeforeStyles.opacity,
      afterGlow: shellAfterStyles.backgroundImage,
      outputWidth: outputRect.width,
      outputHeight: outputRect.height,
    };
  });

  expect(sizing.contactGap).toBeLessThanOrEqual(32);
  expect(sizing.shellWidth).toBeGreaterThanOrEqual(sizing.wrapperWidth - 2);
  expect(sizing.shellBorder).toBe('0px');
  expect(sizing.shellGlow).toContain('rgba(92, 255, 177, 0.04)');
  expect(sizing.beforeGlow).toContain('rgba(92, 255, 177, 0.07)');
  expect(sizing.beforeGlow).toContain('rgba(101, 231, 255, 0.035)');
  expect(Number.parseFloat(sizing.beforeOpacity)).toBeLessThanOrEqual(0.5);
  expect(sizing.afterGlow).toMatch(/rgba\(92, 255, 177, 0\.02[45]\)/);
  expect(sizing.outputHeight).toBeLessThan(sizing.outputWidth * 0.72);
});

test('ascii torus render fills the terminal with a larger symbol donut', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  const artifact = page.locator('#ascii-torus');
  await artifact.scrollIntoViewIfNeeded();
  await expect(artifact).toHaveAttribute('data-torus-reveal', 'complete', { timeout: 2500 });

  const bounds = await artifact.locator('[data-ascii-torus-output]').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const lines = element.textContent.split('\n');
    const occupied = [];
    lines.forEach((line, row) => {
      [...line].forEach((char, column) => {
        if (char !== ' ') {
          occupied.push({ row, column });
        }
      });
    });

    return {
      boxWidth: rect.width,
      boxHeight: rect.height,
      width: Math.max(...occupied.map((point) => point.column)) - Math.min(...occupied.map((point) => point.column)) + 1,
      height: Math.max(...occupied.map((point) => point.row)) - Math.min(...occupied.map((point) => point.row)) + 1,
    };
  });

  expect(bounds.boxHeight).toBeGreaterThanOrEqual(430);
  expect(bounds.width).toBeGreaterThanOrEqual(49);
  expect(bounds.height).toBeGreaterThanOrEqual(21);
});

test('mobile ascii torus stays visually centered in its floating area', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await enterPortfolio(page);

  const artifact = page.locator('#ascii-torus');
  await artifact.scrollIntoViewIfNeeded();
  await expect(artifact).toHaveAttribute('data-torus-reveal', 'complete', { timeout: 2500 });

  const centering = await artifact.locator('[data-ascii-torus-output]').evaluate((element) => {
    const lines = element.textContent.split('\n');
    const occupied = [];
    lines.forEach((line, row) => {
      [...line].forEach((char, column) => {
        if (char !== ' ') {
          occupied.push({ row, column });
        }
      });
    });

    const width = Math.max(...lines.map((line) => line.length));
    const height = lines.length;
    const minColumn = Math.min(...occupied.map((point) => point.column));
    const maxColumn = Math.max(...occupied.map((point) => point.column));
    const minRow = Math.min(...occupied.map((point) => point.row));
    const maxRow = Math.max(...occupied.map((point) => point.row));

    return {
      horizontalOffset: (minColumn + maxColumn + 1) / 2 - width / 2,
      verticalOffset: (minRow + maxRow + 1) / 2 - height / 2,
    };
  });

  expect(Math.abs(centering.horizontalOffset)).toBeLessThanOrEqual(1.5);
  expect(Math.abs(centering.verticalOffset)).toBeLessThanOrEqual(1.5);
});

test('ascii torus symbols are typed in when its reveal triggers', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  const artifact = page.locator('#ascii-torus');
  const output = artifact.locator('[data-ascii-torus-output]');

  await expect(artifact).not.toHaveClass(/matrix-revealed/);
  await expect(output).toHaveText(/^\s*$/);

  await artifact.scrollIntoViewIfNeeded();
  await expect(artifact).toHaveClass(/matrix-revealed/);
  await expect(artifact).toHaveAttribute('data-torus-reveal', 'running');
  await expect(output).toContainText(/[.@#$*+=:;~\-_/<>01]{12,}/);
  await expect(artifact).toHaveAttribute('data-torus-reveal', 'complete', { timeout: 2500 });
});

test('ascii torus render keeps breathing room inside its symbol buffer', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  const artifact = page.locator('#ascii-torus');
  await artifact.scrollIntoViewIfNeeded();

  const margins = await artifact.locator('[data-ascii-torus-output]').evaluate((element) => {
    const lines = element.textContent.split('\n');
    const occupied = [];
    lines.forEach((line, row) => {
      [...line].forEach((char, column) => {
        if (char !== ' ') {
          occupied.push({ row, column });
        }
      });
    });

    const width = Math.max(...lines.map((line) => line.length));
    const height = lines.length;
    const minColumn = Math.min(...occupied.map((point) => point.column));
    const maxColumn = Math.max(...occupied.map((point) => point.column));
    const minRow = Math.min(...occupied.map((point) => point.row));
    const maxRow = Math.max(...occupied.map((point) => point.row));

    return {
      left: minColumn,
      right: width - maxColumn - 1,
      top: minRow,
      bottom: height - maxRow - 1,
    };
  });

  expect(margins.left).toBeGreaterThanOrEqual(3);
  expect(margins.right).toBeGreaterThanOrEqual(3);
  expect(margins.top).toBeGreaterThanOrEqual(2);
  expect(margins.bottom).toBeGreaterThanOrEqual(2);
});

test('ascii torus projection never clips points outside the symbol buffer', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  const artifact = page.locator('#ascii-torus');
  await artifact.scrollIntoViewIfNeeded();

  await expect(artifact).toHaveAttribute('data-torus-clipped-points', '0');
});

test('ascii torus keeps buffer margins after drift and manual rotation', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  const artifact = page.locator('#ascii-torus');
  const shell = artifact.locator('.ascii-torus-shell');
  await disableSmoothScroll(page);
  const scrollY = await artifact.evaluate((element) => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    return Math.max(0, top - 96);
  });
  await jumpToScrollY(page, scrollY);
  await expect(artifact).toHaveClass(/matrix-reveal-settled/);

  const box = await shell.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.68);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.18, { steps: 14 });
  await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.18, { steps: 14 });
  await page.mouse.up();
  await page.waitForTimeout(420);

  const margins = await artifact.locator('[data-ascii-torus-output]').evaluate((element) => {
    const lines = element.textContent.split('\n');
    const occupied = [];
    lines.forEach((line, row) => {
      [...line].forEach((char, column) => {
        if (char !== ' ') {
          occupied.push({ row, column });
        }
      });
    });

    const width = Math.max(...lines.map((line) => line.length));
    const height = lines.length;
    const minColumn = Math.min(...occupied.map((point) => point.column));
    const maxColumn = Math.max(...occupied.map((point) => point.column));
    const minRow = Math.min(...occupied.map((point) => point.row));
    const maxRow = Math.max(...occupied.map((point) => point.row));

    return {
      left: minColumn,
      right: width - maxColumn - 1,
      top: minRow,
      bottom: height - maxRow - 1,
    };
  });

  expect(margins.left).toBeGreaterThanOrEqual(2);
  expect(margins.right).toBeGreaterThanOrEqual(2);
  expect(margins.top).toBeGreaterThanOrEqual(2);
  expect(margins.bottom).toBeGreaterThanOrEqual(2);
});

test('ascii torus drag maps pointer movement to natural trackball axes', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  const artifact = page.locator('#ascii-torus');
  const shell = artifact.locator('.ascii-torus-shell');
  await disableSmoothScroll(page);
  const scrollY = await artifact.evaluate((element) => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    return Math.max(0, top - 96);
  });
  await jumpToScrollY(page, scrollY);
  await expect(artifact).toHaveClass(/matrix-revealed/);
  await expect(artifact).toHaveClass(/matrix-reveal-settled/);

  const box = await shell.boundingBox();
  expect(box).not.toBeNull();

  const readRotation = async () =>
    (await artifact.getAttribute('data-torus-rotation')).split(',').map((value) => Number.parseFloat(value));

  const before = await readRotation();
  await page.mouse.move(box.x + box.width * 0.36, box.y + box.height * 0.52);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.66, box.y + box.height * 0.52, { steps: 10 });
  await page.mouse.up();
  const afterHorizontal = await readRotation();

  expect(Math.abs(afterHorizontal[1] - before[1])).toBeGreaterThan(0.35);
  expect(afterHorizontal[1]).toBeLessThan(before[1]);
  expect(Math.abs(afterHorizontal[0] - before[0])).toBeLessThan(0.16);
  expect(Math.abs(afterHorizontal[2] - before[2])).toBeLessThan(0.08);

  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.36);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.66, { steps: 10 });
  await page.mouse.up();
  const afterVertical = await readRotation();

  expect(Math.abs(afterVertical[0] - afterHorizontal[0])).toBeGreaterThan(0.35);
  expect(afterVertical[0]).toBeLessThan(afterHorizontal[0]);
  expect(Math.abs(afterVertical[1] - afterHorizontal[1])).toBeLessThan(0.16);
  expect(Math.abs(afterVertical[2] - afterHorizontal[2])).toBeLessThan(0.08);
});

test('ascii torus drag stays screen-relative after a half roll', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  const artifact = page.locator('#ascii-torus');
  const shell = artifact.locator('.ascii-torus-shell');
  await disableSmoothScroll(page);
  const scrollY = await artifact.evaluate((element) => {
    const top = element.getBoundingClientRect().top + window.scrollY;
    return Math.max(0, top - 96);
  });
  await jumpToScrollY(page, scrollY);
  await expect(artifact).toHaveClass(/matrix-reveal-settled/);
  await page.evaluate(() => window.__asciiTorusDebug.applyScreenRoll(Math.PI));

  const box = await shell.boundingBox();
  expect(box).not.toBeNull();

  const readRotation = async () =>
    (await artifact.getAttribute('data-torus-rotation')).split(',').map((value) => Number.parseFloat(value));

  const before = await readRotation();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.66);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.36, { steps: 10 });
  await page.mouse.up();
  const after = await readRotation();

  expect(Math.abs(after[0] - before[0])).toBeGreaterThan(0.35);
  expect(after[0]).toBeGreaterThan(before[0]);
  expect(Math.abs(after[1] - before[1])).toBeLessThan(0.16);
});
