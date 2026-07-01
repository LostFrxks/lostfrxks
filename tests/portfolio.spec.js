const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

const indexHtmlPath = path.resolve(__dirname, '..', 'index.html');

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

test('browser title targets backend and AI backend roles', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle('Artur Usenov — Backend / AI Backend Engineer');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    'content',
    'Backend / AI Backend Engineer from Bishkek focused on Python, FastAPI, Django, PostgreSQL, Redis, Docker, marketplace systems, e-commerce and AI search.'
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    'content',
    'Artur Usenov — Backend / AI Backend Engineer'
  );
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
    'content',
    'Production-focused backend engineer building marketplace, e-commerce and AI/search systems.'
  );
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

test('hero stack copy presents the backend and AI focus', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.hero-stack')).toHaveText('Python · FastAPI · Django · PostgreSQL · Redis · Docker · AI Search');
});

test('hero eyebrow frames backend and AI backend positioning', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.eyebrow')).toHaveText('Backend / AI Backend Engineer');
});

test('hero distributes terminal content without focus cards', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.hero-focus-grid')).toHaveCount(0);
  await expect(page.locator('.hero-focus-card')).toHaveCount(0);
  await expect(page.locator('.terminal-boot')).toHaveCount(1);
  await expect(page.locator('.hero-identity')).toHaveCount(1);
  await expect(page.locator('.hero-actions')).toHaveCount(1);

  const terminalLayout = await page.locator('.terminal-content').evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      display: style.display,
      rowGap: style.rowGap,
    };
  });

  expect(terminalLayout.display).toBe('grid');
  expect(parseFloat(terminalLayout.rowGap)).toBeGreaterThan(12);
});

test('hero identity keeps an even vertical rhythm into the action row', async ({ page }) => {
  await page.goto('/');

  const identityLayout = await page.locator('.hero-identity').evaluate((element) => {
    const style = getComputedStyle(element);
    const eyebrowMargin = getComputedStyle(element.querySelector('.eyebrow')).marginTop;
    const handleMargin = getComputedStyle(element.querySelector('.handle')).marginTop;
    const stackMargin = getComputedStyle(element.querySelector('.hero-stack')).marginTop;
    const handleBox = element.querySelector('.handle').getBoundingClientRect();
    const stackBox = element.querySelector('.hero-stack').getBoundingClientRect();
    const actionsBox = document.querySelector('.hero-actions').getBoundingClientRect();
    const terminalBox = document.querySelector('.terminal-content').getBoundingClientRect();
    const terminalStyle = getComputedStyle(document.querySelector('.terminal-content'));

    return {
      display: style.display,
      flexDirection: style.flexDirection,
      justifyContent: style.justifyContent,
      rowGap: style.rowGap,
      eyebrowMargin,
      handleMargin,
      stackMargin,
      handleToStack: stackBox.top - handleBox.bottom,
      stackToActions: actionsBox.top - stackBox.bottom,
      actionsToContentBottom:
        terminalBox.bottom - parseFloat(terminalStyle.paddingBottom) - actionsBox.bottom,
    };
  });

  expect(identityLayout.display).toBe('flex');
  expect(identityLayout.flexDirection).toBe('column');
  expect(identityLayout.justifyContent).toBe('flex-start');
  expect(identityLayout.eyebrowMargin).toBe('0px');
  expect(identityLayout.handleMargin).toBe('0px');
  expect(identityLayout.stackMargin).toBe('0px');
  expect(identityLayout.handleToStack).toBeGreaterThan(12);
  expect(Math.abs(identityLayout.handleToStack - identityLayout.stackToActions)).toBeLessThanOrEqual(2);
  expect(Math.abs(identityLayout.actionsToContentBottom)).toBeLessThanOrEqual(2);
});

test('hero stays concise without long recruiter copy', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.hero-copy')).toHaveCount(0);
  await expect(page.locator('.hero-location')).toHaveCount(0);
  await expect(page.getByText(/Backend-first software engineer building marketplace/i)).toHaveCount(0);
  await expect(page.getByText(/Bishkek, Kyrgyzstan · Open to remote Backend/i)).toHaveCount(0);
  const heroActions = page.locator('.hero-actions');
  await expect(heroActions.locator('a').filter({ hasText: /View Experience/i })).toHaveAttribute('href', '#experience');
  await expect(heroActions.locator('a').filter({ hasText: /Open GitHub/i })).toHaveAttribute('href', 'https://github.com/LostFrxks');
  await expect(heroActions.locator('a').filter({ hasText: /Download CV/i })).toHaveAttribute('href', 'assets/artur-usenov-resume.pdf');
  await expect(heroActions.locator('a[href="#contact"]')).toContainText('Contact');
  await expect(page.getByText(/Junior/i)).toHaveCount(0);
  await expect(page.getByText(/salary/i)).toHaveCount(0);
  await expect(page.getByText(/I build practical fullstack systems/i)).toHaveCount(0);
  await expect(page.getByText(/a little terminal drama/i)).toHaveCount(0);
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
      }, 5500);
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

test('intro decrypts the Artur identity at a slower readable pace', async ({ page }) => {
  await page.goto('/');

  const decryptDuration = await page.evaluate(async () => {
    const intro = document.querySelector('#intro-screen');
    const introName = document.querySelector('[data-intro-name]');
    const start = performance.now();

    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        observer.disconnect();
        reject(new Error('Intro identity did not finish decrypting.'));
      }, 5000);
      const observer = new MutationObserver(() => {
        if (introName.textContent !== 'Artur Usenov') {
          return;
        }

        window.clearTimeout(timeout);
        observer.disconnect();
        resolve(performance.now() - start);
      });

      observer.observe(introName, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      intro.click();
    });
  });

  expect(decryptDuration).toBeGreaterThanOrEqual(2200);
  expect(decryptDuration).toBeLessThan(4200);
});

test('intro keeps cipher letters scrambling at the same fast cadence while decrypting', async ({ page }) => {
  await page.goto('/');

  const changes = await page.evaluate(async () => {
    const intro = document.querySelector('#intro-screen');
    const introName = document.querySelector('[data-intro-name]');
    const start = performance.now();
    const textChanges = [];
    let previousText = introName.textContent;

    return new Promise((resolve) => {
      const timeout = window.setTimeout(() => {
        observer.disconnect();
        resolve(textChanges);
      }, 850);
      const observer = new MutationObserver(() => {
        const nextText = introName.textContent;
        if (nextText === previousText) {
          return;
        }

        previousText = nextText;
        textChanges.push({
          time: performance.now() - start,
          text: nextText,
        });
      });

      observer.observe(introName, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      intro.click();
    });
  });

  const deltas = changes.slice(1).map((change, index) => change.time - changes[index].time);
  expect(changes.length).toBeGreaterThanOrEqual(8);
  expect(Math.min(...deltas)).toBeLessThan(110);
});

test('intro uses the main matrix canvas as its only rain background', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('.site-header')).toBeHidden();
  await expect(page.locator('main')).toBeHidden();
  await expect(page.locator('.intro-content')).toHaveCount(0);
  await expect(page.locator('[data-intro-glyph]')).toHaveCount(0);
  await expect(page.locator('#intro-rain')).toHaveCount(0);

  const matrixCanvas = page.locator('#matrix-canvas');
  await expect(matrixCanvas).toBeVisible();
  await expect(matrixCanvas).toHaveAttribute('data-matrix-style', 'shared-intro-main-rain');
  await expect(matrixCanvas).toHaveAttribute('data-animation-state', 'running');

  const hasRainPixels = await matrixCanvas.evaluate((canvas) => {
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

test('intro uses the regular pointer cursor', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('#intro-screen')).toHaveCSS('cursor', 'default');
});

test('main matrix canvas keeps its rain columns when intro reveals the site', async ({ page }) => {
  await page.goto('/');

  const matrixCanvas = page.locator('#matrix-canvas');
  await expect(matrixCanvas).toHaveAttribute('data-animation-state', 'running');
  await expect(matrixCanvas).toHaveAttribute('data-rain-generation', '1');
  const generationBeforeReveal = await matrixCanvas.getAttribute('data-rain-generation');

  await page.getByRole('button', { name: /enter matrix intro/i }).click();

  await expect(page.locator('body')).toHaveClass(/site-revealing/, { timeout: 7000 });
  await expect(matrixCanvas).toHaveAttribute('data-animation-state', 'running');
  await expect(matrixCanvas).toHaveAttribute('data-rain-generation', generationBeforeReveal);
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

  await expect(projectCards).toHaveCount(4);
  await expect(projects).toHaveClass(/matrix-revealed/);
  await expect(projectCards.first()).toHaveClass(/matrix-revealed/);
  await expect(projectCards.last()).toHaveClass(/matrix-revealed/);
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

test('hero presents Artur for backend and AI backend roles', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  await expect(page.getByRole('heading', { name: /Artur Usenov/i })).toBeVisible();
  await expect(page.getByText(/lostfrxks/i).first()).toBeVisible();
  await expect(page.getByText(/Backend \/ AI Backend Engineer/i).first()).toBeVisible();
  await expect(page.locator('.identity-panel .avatar')).toHaveAttribute(
    'src',
    'https://avatars.githubusercontent.com/u/197055331?v=4'
  );
  await expect(page.locator('.signal-list').getByText('Current', { exact: true })).toBeVisible();
  await expect(page.locator('.signal-list').getByText(/Backend Developer @ MDigital/i)).toBeVisible();
  await expect(page.locator('.signal-list').getByText(/Domain/i)).toBeVisible();
  await expect(page.locator('.signal-list').getByText(/E-commerce · FinTech · Marketplace/i)).toBeVisible();
  await expect(page.locator('.signal-list').getByText(/Live production store shipped/i)).toBeVisible();
  await expect(page.locator('.signal-list').getByText(/300\+ LeetCode · ICPC NERC finalist/i)).toBeVisible();
  await expect(page.locator('.signal-list').getByText(/Junior Backend Developer at MDigital/i)).toHaveCount(0);
  await expect(page.getByText(/ship working MVPs/i)).toHaveCount(0);
  await expect(page.getByText(/Python · FastAPI · Django · PostgreSQL · Redis · Docker · AI Search/i)).toBeVisible();
  await expect(page.getByText(/AUCA TSI/i)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /Open GitHub/i })).toBeVisible();
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
  await expect(firstParagraph).toContainText(/I build backend-heavy products/i);
  await expect(secondParagraph).toContainText(/production backend experience, marketplace\/e-commerce domain knowledge/i);
});

test('whoami typing reserves copy height so lower sections do not jump', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  const whoami = page.locator('#whoami');
  const initialWhoamiHeight = await whoami.evaluate((element) => element.offsetHeight);

  await page.locator('.nav-links a[href="#whoami"]').click();
  await expect(whoami).toHaveClass(/matrix-revealed/);
  await expect(page.locator('[data-whoami-line="signals"]')).toContainText(
    /semantic retrieval/,
    { timeout: 5000 }
  );
  const finalWhoamiHeight = await whoami.evaluate((element) => element.offsetHeight);

  expect(Math.abs(finalWhoamiHeight - initialWhoamiHeight)).toBeLessThanOrEqual(2);
});

test('whoami copy tells a human college-to-backend story', async () => {
  const markup = fs.readFileSync(indexHtmlPath, 'utf8');
  const introCopy = markup.match(/data-whoami-line="intro"[\s\S]*?data-whoami-text="([^"]+)"/)?.[1] ?? '';
  const signalsCopy = markup.match(/data-whoami-line="signals"[\s\S]*?data-whoami-text="([^"]+)"/)?.[1] ?? '';

  expect(introCopy).toMatch(/backend-heavy products/i);
  expect(introCopy).toMatch(/marketplace systems, e-commerce flows, admin tools, APIs, integrations and AI\/search features/i);
  expect(introCopy).toMatch(/Python, FastAPI, Django, PostgreSQL, Redis and Docker/i);
  expect(introCopy).toMatch(/React\/TypeScript when the product needs a full interface/i);
  expect(signalsCopy).toMatch(/production backend experience/i);
  expect(signalsCopy).toMatch(/marketplace\/e-commerce domain knowledge/i);
  expect(signalsCopy).toMatch(/embeddings and semantic retrieval/i);
  expect(signalsCopy).not.toMatch(/three-month MBank backend internship/i);
  expect(signalsCopy).not.toMatch(/Homy/i);
  expect(signalsCopy).not.toMatch(/junior backend/i);
  expect(signalsCopy).not.toMatch(/student/i);
  expect(`${introCopy} ${signalsCopy}`).not.toMatch(/The strongest public signals/i);
  expect(`${introCopy} ${signalsCopy}`).not.toMatch(/turn coursework and hackathon pressure/i);
});

test('timeline starts with college and moves into backend work', async () => {
  const markup = fs.readFileSync(indexHtmlPath, 'utf8');
  const timelineMarkup = markup.match(/<ol class="timeline">[\s\S]*?<\/ol>/)?.[0] ?? '';

  expect(timelineMarkup).toMatch(/<time>2023<\/time>/);
  expect(timelineMarkup).toMatch(/<time>2024<\/time>/);
  expect(timelineMarkup).toMatch(/<time>2025<\/time>/);
  expect(timelineMarkup).toMatch(/<time>Winter 2025–2026<\/time>/);
  expect(timelineMarkup).toMatch(/<time>2026<\/time>/);
  expect(timelineMarkup).toMatch(/Started Software Engineering and Social Transformation at TSI AUCA/i);
  expect(timelineMarkup).toMatch(/Built GUROO for AUCA tutor workflows and won Makeathon TOM: Kyrgyzstan/i);
  expect(timelineMarkup).toMatch(/Advanced to ICPC NERC 2025 final, built USC marketplace MVP, created embedding-search, and shipped ATLAS-STORE live e-commerce/i);
  expect(timelineMarkup).toMatch(/Software Developer Intern in the MBank \/ marketplace ecosystem/i);
  expect(timelineMarkup).toMatch(/Backend Developer at MDigital, focused on backend services, product systems and e-commerce\/AI-enabled workflows/i);
  expect(timelineMarkup).not.toMatch(/<time>2022<\/time>/);
  expect(timelineMarkup).not.toMatch(/Homy/i);
});

test('boot lines are hidden until the terminal types them', async ({ page }) => {
  await page.goto('/');

  const bootLines = page.locator('[data-boot-text]');
  await expect(bootLines.first()).toHaveText('');
  await expect(bootLines.nth(1)).toHaveText('');
  await expect(bootLines.nth(2)).toHaveText('');

  await enterPortfolio(page);

  await expect(bootLines.first()).toHaveText('loading public profile...');
  await expect(bootLines.nth(1)).toHaveText('mounting selected work: ATLAS-STORE, AGL.KG, USC, embedding-search, GUROO');
  await expect(bootLines.nth(2)).toHaveText('status: online');
});

test('featured projects and achievements are visible', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  const projectGrid = page.locator('#projects .project-grid');
  const timeline = page.locator('.timeline');

  await expect(page.getByRole('heading', { name: /Selected Work/i })).toBeVisible();
  await expect(page.getByText(/Production, marketplace and AI\/search systems/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: /ATLAS-STORE/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /AGL\.KG/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /USC/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /embedding-search/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /GUROO/i })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Homy/i })).toHaveCount(0);
  await expect(page.getByText(/mbank-voice-stand/i)).toHaveCount(0);
  await expect(projectGrid.getByText(/agent profile with avatar and metrics/i)).toHaveCount(0);
  await expect(projectGrid.locator('a[href="https://github.com/LostFrxks/homy"]')).toHaveCount(0);
  await expect(projectGrid.getByText(/Production e-commerce platform for home appliances and household goods/i)).toBeVisible();
  await expect(projectGrid.getByText(/Production catalog website for AGL medical equipment/i)).toBeVisible();
  await expect(projectGrid.getByText(/localized product data, catalog import scripts, product pages, contacts, WhatsApp\s+flow/i)).toBeVisible();
  await expect(projectGrid.getByText(/Dockerized marketplace platform with FastAPI backend, PostgreSQL, Redis/i)).toBeVisible();
  await expect(projectGrid.locator('.project-highlights')).toHaveCount(0);
  await expect(projectGrid.getByText(/Idempotent order creation/i)).toHaveCount(0);
  await expect(projectGrid.getByText(/Audit logs/i)).toHaveCount(0);
  await expect(projectGrid.getByText(/Notifications API/i)).toHaveCount(0);
  await expect(projectGrid.getByText(/Health checks/i)).toHaveCount(0);
  await expect(projectGrid.getByText(/Metrics\/tracing/i)).toHaveCount(0);
  await expect(projectGrid.getByText(/Sentry integration/i)).toHaveCount(0);
  await expect(projectGrid.getByText(/CI\/test baseline/i)).toHaveCount(0);
  await expect(projectGrid.getByText(/Marketplace Semantic Search Prototype/i)).toBeVisible();
  await expect(projectGrid.getByText(/AUCA Tutor Registration System/i)).toBeVisible();
  const atlasCard = projectGrid.locator('.project-card').filter({
    has: page.getByRole('heading', { name: 'ATLAS-STORE', exact: true }),
  });
  const aglCard = projectGrid.locator('.project-card').filter({
    has: page.getByRole('heading', { name: 'AGL.KG', exact: true }),
  });
  const uscCard = projectGrid.locator('.project-card').filter({
    has: page.getByRole('heading', { name: 'USC', exact: true }),
  });
  await expect(atlasCard).toHaveCount(1);
  await expect(aglCard).toHaveCount(1);
  await expect(uscCard).toHaveCount(1);
  await expect(atlasCard.getByText(/agl\.kg/i)).toHaveCount(0);
  await expect(projectGrid.locator('.project-card--agl')).toHaveCount(0);
  await expect(projectGrid.locator('.project-card__preview')).toHaveCount(0);
  const atlasStack = projectGrid.locator('[aria-label="ATLAS-STORE stack"]');
  await expect(atlasStack.getByText('Next.js', { exact: true })).toBeVisible();
  await expect(atlasStack.getByText('Django REST', { exact: true })).toBeVisible();
  await expect(atlasStack.getByText('PostgreSQL', { exact: true })).toBeVisible();
  await expect(atlasStack.getByText('Celery', { exact: true })).toBeVisible();
  const uscStack = projectGrid.locator('[aria-label="USC stack"]');
  await expect(uscStack.getByText('Prometheus', { exact: true })).toBeVisible();
  await expect(uscStack.getByText('Sentry', { exact: true })).toBeVisible();
  const aglStack = projectGrid.locator('[aria-label="AGL.KG stack"]');
  await expect(aglStack.getByText('Next.js', { exact: true })).toBeVisible();
  await expect(aglStack.getByText('React 19', { exact: true })).toBeVisible();
  await expect(aglStack.getByText('TypeScript', { exact: true })).toBeVisible();
  await expect(aglStack.getByText('Static Export', { exact: true })).toBeVisible();
  await expect(aglStack.getByText('Zod', { exact: true })).toBeVisible();
  await expect(aglStack.getByText('Cheerio', { exact: true })).toBeVisible();
  await expect(aglStack.getByText('lucide-react', { exact: true })).toBeVisible();
  await expect(aglStack.getByText('Vitest', { exact: true })).toBeVisible();
  await expect(aglStack.getByText('Playwright', { exact: true })).toBeVisible();
  const selectedTitles = await projectGrid.locator('.project-card h3').allTextContents();
  expect(selectedTitles).toEqual(['ATLAS-STORE', 'AGL.KG', 'USC', 'embedding-search', 'GUROO']);
  const featuredBackgrounds = await projectGrid.locator('.project-card').evaluateAll((cards) =>
    cards.map((card) => `${getComputedStyle(card).backgroundImage} ${getComputedStyle(card).backgroundColor}`)
  );
  expect(featuredBackgrounds.every((background) => !/255,\s*255,\s*255|251,\s*252,\s*253|237,\s*246,\s*251/.test(background))).toBe(true);
  await expect(projectGrid.getByText(/status:/i)).toHaveCount(0);
  await expect(page.getByText(/Makeathon TOM: Kyrgyzstan Winner/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /Makeathon Instagram post/i })).toHaveAttribute(
    'href',
    'https://www.instagram.com/p/DCEQDdWoWb6/'
  );
  await expect(page.getByText(/M-AI Champion/i)).toBeVisible();
  await expect(page.getByLabel('Signals').getByText(/Won the Mbank ecosystem OpenAI CODEX Challenge/i)).toBeVisible();
  await expect(page.getByLabel('Signals').getByText(/AI contribution to MMarket and process quality improvement/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /MDigital website/i })).toHaveAttribute(
    'href',
    'https://mdigital.kg/'
  );
  await expect(page.getByText(/LeetCode 300\+/i)).toBeVisible();
  await expect(page.getByText(/Consistent algorithms and data structures practice across interview-style problems/i)).toBeVisible();
  await expect(page.getByText(/TSI Contest 2026 Winner/i)).toBeVisible();
  await expect(page.getByText(/1st place in the official standings/i)).toBeVisible();
  await expect(page.getByRole('link', { name: /TSI Contest 2026 standings/i })).toHaveAttribute(
    'href',
    'https://olymp.krsu.kg/conteststandings/16593'
  );
  await expect(page.getByText(/Placed 9th among 61 Kyrgyzstan teams and advanced to the ICPC NERC 2025 final/i)).toBeVisible();
  await expect(page.getByText(/Mega Creeps/i)).toHaveCount(0);
  await expect(page.getByText(/III degree diploma/i)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /TSI AUCA ICPC news/i })).toHaveAttribute(
    'href',
    'https://tsiauca.kg/news/6909d751e900cf411335d90c'
  );
  await expect(page.getByRole('link', { name: /LeetCode profile: lostfrxks/i })).toHaveAttribute(
    'href',
    'https://leetcode.com/u/lostfrxks/'
  );
  await expect(page.getByRole('link', { name: /Open live store/i })).toHaveAttribute(
    'href',
    'https://atlas-store.kg/'
  );
  await expect(page.getByRole('link', { name: /open agl\.kg/i })).toHaveAttribute(
    'href',
    'https://www.agl.kg/'
  );
  await expect(page.getByLabel('Signals').getByText(/ICPC NERC 2025 finalist/i)).toBeVisible();
  await expect(page.getByLabel('Signals').getByText(/GPA 3\.80/i)).toBeVisible();
  await expect(page.getByLabel('Signals').getByText(/2023–2026/i)).toBeVisible();
  await expect(page.getByLabel('Signals').getByText(/2022–2026/i)).toHaveCount(0);
  await expect(page.getByRole('link', { name: /TSI AUCA website/i })).toHaveAttribute(
    'href',
    'https://tsiauca.kg'
  );
  await expect(page.locator('a[href*="credentials.html"]')).toHaveCount(0);
  const signalTitles = await page.getByLabel('Signals').locator('.achievement-card strong').allTextContents();
  expect(signalTitles).toEqual([
    'ICPC NERC 2025 finalist',
    'LeetCode 300+',
    'TSI Contest 2026 Winner',
    'M-AI Champion',
    'TSI AUCA',
    'Makeathon TOM: Kyrgyzstan Winner',
  ]);
  await expect(timeline.getByText(/Winter 2025–2026/i)).toBeVisible();
  await expect(timeline.getByText(/Software Developer Intern in the MBank \/ marketplace ecosystem/i)).toBeVisible();
  await expect(timeline.getByText(/Backend Developer at MDigital, focused on backend services/i)).toBeVisible();
  await expect(timeline.getByText(/backend-heavy fullstack work/i)).toHaveCount(0);
});

test('experience and contact target remote backend roles', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  await expect(page.getByRole('heading', { name: /Experience/i })).toBeVisible();
  await expect(page.getByText(/experience --production/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Backend Developer$/i })).toBeVisible();
  await expect(page.getByText(/^MDigital$/i)).toBeVisible();
  await expect(page.getByText(/2026 — Present/i)).toBeVisible();
  await expect(page.getByText(/Ship and maintain backend APIs, database models, admin\/product workflows and integrations/i)).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Software Developer Intern$/i })).toBeVisible();
  await expect(page.getByText(/MBank \/ MMarket ecosystem/i)).toBeVisible();
  await expect(page.getByLabel('Experience').getByText(/Winter 2025–2026/i)).toBeVisible();
  await expect(page.getByText(/Worked with Python\/FastAPI\/PostgreSQL-based backend development\./i)).toBeVisible();
  await expect(page.getByText(/TODO: confirm exact stack/i)).toHaveCount(0);

  await expect(page.locator('.contact-copy')).toContainText(
    /Open to remote Backend, AI Backend and Software Engineer roles/i
  );
  await expect(page.getByRole('link', { name: /^Email$/i })).toHaveAttribute('href', 'mailto:lostfrxks@gmail.com');
  await expect(page.getByRole('link', { name: /^GitHub$/i })).toHaveAttribute('href', 'https://github.com/LostFrxks');
  await expect(page.locator('#contact > .section-inner > .contact-actions > a')).toHaveText([
    'Email',
    'GitHub',
    'Resume',
  ]);
  await expect(page.locator('#contact .mock-socials a')).toHaveText([
    'LinkedIn',
    'Telegram',
    'Instagram',
  ]);
  await expect(page.getByRole('link', { name: /^LinkedIn$/i })).toHaveAttribute(
    'href',
    'https://www.linkedin.com/in/artur-usenov-424108395/'
  );
  await expect(page.getByRole('link', { name: /^Telegram$/i })).toHaveAttribute('href', 'https://t.me/lostfrxks');
  await expect(page.getByRole('link', { name: /^Instagram$/i })).toHaveAttribute(
    'href',
    'https://www.instagram.com/lostfrxks/'
  );
  await expect(page.getByRole('link', { name: /^Resume$/i })).toHaveAttribute(
    'href',
    'assets/artur-usenov-resume.pdf'
  );
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

test('achievement card links sit on the same bottom baseline', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  const cardsWithLinks = page.locator('.achievement-card').filter({ has: page.locator('a') });
  await cardsWithLinks.first().scrollIntoViewIfNeeded();
  await expect(cardsWithLinks).toHaveCount(5);

  const linkOffsets = await cardsWithLinks.evaluateAll((cards) =>
    cards.map((card) => {
      const link = card.querySelector('a');
      const cardBox = card.getBoundingClientRect();
      const linkBox = link.getBoundingClientRect();
      return Math.round(cardBox.bottom - linkBox.bottom);
    })
  );

  const minOffset = Math.min(...linkOffsets);
  const maxOffset = Math.max(...linkOffsets);
  expect(maxOffset - minOffset).toBeLessThanOrEqual(2);
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

  await expect(matrixCanvas).toHaveAttribute('data-matrix-style', 'shared-intro-main-rain');
  await expect(matrixCanvas).toHaveAttribute('data-rain-alphabet', '01{}[]<>/\\$#@lostfrxksARTURPYTSFASTAPI');
  await expect(matrixCanvas).toHaveAttribute('data-font-size', '16');
  await expect(matrixCanvas).toHaveAttribute('data-column-width', '18');
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

  await expect(matrixCanvas).toHaveAttribute('data-easter-egg-words', expectedWords.join(','));
  await expect(page.locator('#intro-rain')).toHaveCount(0);

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
  await expect(page.locator('.hero-actions').getByRole('link', { name: /Open GitHub/i })).toBeVisible();
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

  await expect(projectCards).toHaveCount(4);
  await expect(projects).toHaveClass(/matrix-revealed/);
  await expect(projectCards.first()).toHaveClass(/matrix-revealed/);
  await expect(projectCards.last()).not.toHaveClass(/matrix-revealed/);

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

  await projectCards.last().scrollIntoViewIfNeeded();

  await expect(projectCards.last()).toHaveClass(/matrix-revealed/);
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
  await expect(page.getByRole('link', { name: /lostfrxks Instagram profile/i })).toHaveAttribute(
    'href',
    'https://www.instagram.com/lostfrxks/'
  );
});

test('ascii torus artifact is kept in the DOM but hidden on production', async ({ page }) => {
  await page.goto('/');
  await enterPortfolio(page);

  const artifact = page.locator('#ascii-torus');
  await expect(artifact).toHaveCount(1);
  await expect(artifact).toBeHidden();
  await expect(artifact).toHaveAttribute('hidden', '');
  await expect(artifact).toHaveAttribute('data-ascii-torus', 'interactive');
  await expect(artifact.locator('[data-ascii-torus-output]')).toHaveCount(1);
});
