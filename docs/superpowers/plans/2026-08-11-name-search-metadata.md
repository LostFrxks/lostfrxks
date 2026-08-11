# Name Search Metadata Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish metadata-only identity signals that associate lostfrxks.com with Artur Usenov's approved English and Cyrillic name variants without changing visible page content.

**Architecture:** Extend the static document head with canonical, description, and `ProfilePage`/`Person` JSON-LD metadata, then add static crawler discovery files at the site root. Playwright tests treat the head metadata and crawler endpoints as exact public contracts; Netlify continues publishing the repository root unchanged.

**Tech Stack:** Static HTML, JSON-LD / Schema.org, XML sitemap, robots.txt, Playwright, Netlify.

---

## File Map

- Modify `index.html`: canonical URL, name-aware descriptions, and the single identity JSON-LD block.
- Modify `tests/portfolio.spec.js`: exact browser contracts for identity metadata and crawler files.
- Create `robots.txt`: allow crawling and advertise the canonical sitemap.
- Create `sitemap.xml`: publish the canonical homepage URL only.

### Task 1: Publish canonical person metadata

**Files:**
- Modify: `tests/portfolio.spec.js`
- Modify: `index.html`

- [ ] **Step 1: Write the failing metadata contract**

Replace the existing `browser title targets backend and AI backend roles` test with this complete contract:

```javascript
test('head publishes canonical identity metadata without changing visible positioning', async ({ page }) => {
  await page.goto('/');

  const description =
    'Artur Usenov — Артур Усенов (Усенов Артур), Backend / AI Backend Engineer from Bishkek building marketplace microservices, Kubernetes platforms, Qdrant search and LLM pipelines.';

  await expect(page).toHaveTitle('Artur Usenov — Backend / AI Backend Engineer');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Artur Usenov');
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://lostfrxks.com/');
  await expect(page.locator('meta[name="description"]')).toHaveAttribute('content', description);
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    'content',
    'Artur Usenov — Backend / AI Backend Engineer'
  );
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute('content', description);
  await expect(page.locator('meta[name="keywords"]')).toHaveCount(0);

  const jsonLdScripts = page.locator('script[type="application/ld+json"]');
  await expect(jsonLdScripts).toHaveCount(1);
  const profile = JSON.parse(await jsonLdScripts.textContent());

  expect(profile).toEqual({
    '@context': 'https://schema.org',
    '@type': 'ProfilePage',
    url: 'https://lostfrxks.com/',
    mainEntity: {
      '@type': 'Person',
      '@id': 'https://lostfrxks.com/#person',
      name: 'Artur Usenov',
      alternateName: 'lostfrxks',
      url: 'https://lostfrxks.com/',
      image: 'https://lostfrxks.com/assets/artur-usenov-profile.webp',
      jobTitle: 'Backend / AI Backend Engineer',
      description:
        'Backend engineer working across marketplace microservices, platform delivery and AI-powered catalog automation.',
      sameAs: [
        'https://github.com/LostFrxks',
        'https://www.linkedin.com/in/artur-usenov-424108395/',
        'https://leetcode.com/u/lostfrxks/',
        'https://t.me/lostfrxks',
        'https://www.instagram.com/lostfrxks/',
      ],
    },
  });

  const serializedProfile = JSON.stringify(profile);
  expect(serializedProfile).not.toContain('lostfrxks@gmail.com');
  expect(serializedProfile).not.toContain('+996');
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx playwright test tests/portfolio.spec.js --grep "head publishes canonical identity metadata" --workers=1
```

Expected: FAIL because `link[rel="canonical"]` and `script[type="application/ld+json"]` do not exist and the current description does not include the bilingual full name.

- [ ] **Step 3: Add the minimal head metadata**

In `index.html`, keep the existing `<title>` and visible document body unchanged. Set both description tags to this exact value:

```html
<meta
  name="description"
  content="Artur Usenov — Артур Усенов (Усенов Артур), Backend / AI Backend Engineer from Bishkek building marketplace microservices, Kubernetes platforms, Qdrant search and LLM pipelines."
>
<meta property="og:title" content="Artur Usenov — Backend / AI Backend Engineer">
<meta
  property="og:description"
  content="Artur Usenov — Артур Усенов (Усенов Артур), Backend / AI Backend Engineer from Bishkek building marketplace microservices, Kubernetes platforms, Qdrant search and LLM pipelines."
>
```

Immediately after the unchanged `<title>`, add:

```html
<link rel="canonical" href="https://lostfrxks.com/">
<script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "url": "https://lostfrxks.com/",
    "mainEntity": {
      "@type": "Person",
      "@id": "https://lostfrxks.com/#person",
      "name": "Artur Usenov",
      "alternateName": "lostfrxks",
      "url": "https://lostfrxks.com/",
      "image": "https://lostfrxks.com/assets/artur-usenov-profile.webp",
      "jobTitle": "Backend / AI Backend Engineer",
      "description": "Backend engineer working across marketplace microservices, platform delivery and AI-powered catalog automation.",
      "sameAs": [
        "https://github.com/LostFrxks",
        "https://www.linkedin.com/in/artur-usenov-424108395/",
        "https://leetcode.com/u/lostfrxks/",
        "https://t.me/lostfrxks",
        "https://www.instagram.com/lostfrxks/"
      ]
    }
  }
</script>
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
npx playwright test tests/portfolio.spec.js --grep "head publishes canonical identity metadata" --workers=1
```

Expected: `1 passed`.

- [ ] **Step 5: Confirm that the visible body was not modified**

Run:

```bash
git diff --word-diff=porcelain -- index.html
```

Expected: changes appear only before `</head>`; no lines after `<body class="intro-active">` are changed.

- [ ] **Step 6: Commit the identity metadata**

```bash
git add index.html tests/portfolio.spec.js
git commit -m "feat: add portfolio identity metadata"
```

### Task 2: Publish crawler discovery files

**Files:**
- Modify: `tests/portfolio.spec.js`
- Create: `robots.txt`
- Create: `sitemap.xml`

- [ ] **Step 1: Write the failing crawler endpoint contract**

Add this test directly after the identity metadata test:

```javascript
test('crawler endpoints publish only the canonical portfolio URL', async ({ page }) => {
  const robotsResponse = await page.request.get('/robots.txt');
  expect(robotsResponse.status()).toBe(200);
  expect(robotsResponse.headers()['content-type']).toContain('text/plain');
  expect(await robotsResponse.text()).toBe(
    'User-agent: *\nAllow: /\n\nSitemap: https://lostfrxks.com/sitemap.xml\n'
  );

  const sitemapResponse = await page.request.get('/sitemap.xml');
  expect(sitemapResponse.status()).toBe(200);
  expect(sitemapResponse.headers()['content-type']).toMatch(/application\/xml|text\/xml/);
  const sitemap = await sitemapResponse.text();

  const parsedSitemap = await page.evaluate((xml) => {
    const document = new DOMParser().parseFromString(xml, 'application/xml');
    return {
      parserErrors: document.querySelectorAll('parsererror').length,
      locations: [...document.querySelectorAll('loc')].map((node) => node.textContent),
      changeFrequencies: document.querySelectorAll('changefreq').length,
      priorities: document.querySelectorAll('priority').length,
    };
  }, sitemap);

  expect(parsedSitemap).toEqual({
    parserErrors: 0,
    locations: ['https://lostfrxks.com/'],
    changeFrequencies: 0,
    priorities: 0,
  });
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx playwright test tests/portfolio.spec.js --grep "crawler endpoints publish only" --workers=1
```

Expected: FAIL because `/robots.txt` and `/sitemap.xml` return HTTP 404.

- [ ] **Step 3: Add robots.txt**

Create `robots.txt` with exactly:

```text
User-agent: *
Allow: /

Sitemap: https://lostfrxks.com/sitemap.xml
```

- [ ] **Step 4: Add sitemap.xml**

Create `sitemap.xml` with exactly:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://lostfrxks.com/</loc>
    <lastmod>2026-08-11</lastmod>
  </url>
</urlset>
```

- [ ] **Step 5: Run the focused test and verify GREEN**

Run:

```bash
npx playwright test tests/portfolio.spec.js --grep "crawler endpoints publish only" --workers=1
```

Expected: `1 passed`.

- [ ] **Step 6: Commit the crawler files**

```bash
git add robots.txt sitemap.xml tests/portfolio.spec.js
git commit -m "feat: publish crawler discovery files"
```

### Task 3: Verify and release

**Files:**
- Verify: `index.html`
- Verify: `robots.txt`
- Verify: `sitemap.xml`
- Verify: `tests/portfolio.spec.js`

- [ ] **Step 1: Run static validation**

Run:

```bash
git diff --check cff710c..HEAD
node -e 'const fs=require("node:fs");const html=fs.readFileSync("index.html","utf8");const match=html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);if(!match)throw new Error("JSON-LD missing");JSON.parse(match[1]);console.log("JSON-LD valid")'
```

Expected: no `git diff --check` output and `JSON-LD valid`.

- [ ] **Step 2: Run the complete automated suite**

Run:

```bash
npm test
```

Expected: `83` unit tests and `53` browser tests pass with zero failures.

- [ ] **Step 3: Confirm exact branch scope**

Run:

```bash
git status --short --branch
git diff --stat cff710c..HEAD
git log --oneline --decorate cff710c..HEAD
```

Expected: clean feature branch; the committed plan is followed by identity metadata, crawler discovery, and policy-alignment commits. Runtime changes remain limited to `index.html`, `robots.txt`, `sitemap.xml`, and `tests/portfolio.spec.js`; the policy-alignment commit also synchronizes this plan and the design spec with the reviewed implementation.

- [ ] **Step 4: Integrate the verified feature branch into main**

From the primary worktree, fast-forward `main` after confirming `origin/main` still equals `12d26fe`:

```bash
git fetch origin main
test "$(git rev-parse origin/main)" = "12d26fe41efa020f5cb598c47ef97215c38e9e27"
git merge --ff-only feat/name-search-metadata
```

Expected: `main` advances through the design and two implementation commits without a merge commit; pre-existing `.serena/` remains untracked and untouched.

- [ ] **Step 5: Push main and wait for Netlify**

```bash
git push origin main
```

Expected: GitHub accepts the fast-forward push. Poll cache-busted production URLs until the deployed HTML contains `https://lostfrxks.com/#person` and both crawler endpoints return HTTP 200.

- [ ] **Step 6: Run the public Chrome smoke test**

Using `/usr/bin/google-chrome-stable`, verify the production homepage still has the unchanged title and H1, exactly one canonical link, the full English and Cyrillic names in the meta description, exactly one parseable JSON-LD profile whose only `alternateName` is the visible `lostfrxks` handle, `/robots.txt` references `/sitemap.xml`, and `/sitemap.xml` contains only `https://lostfrxks.com/`.

Expected: every production assertion passes; report that metadata is live while noting that search recrawling and autocomplete changes are asynchronous and not guaranteed by deployment.
