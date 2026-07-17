# Secret Analytics Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the private dashboard to `/secret.html` and render a non-descriptive password-only gate until authentication succeeds.

**Architecture:** Keep the existing stats API and bearer-password authentication. Change only the static route, locked markup/state transitions, styling, focused browser tests, and README handoff.

**Tech Stack:** HTML, CSS, vanilla ES modules, Playwright.

---

### Task 1: Specify the locked and unlocked browser behavior

**Files:**
- Modify: `tests/analytics.spec.js`

- [ ] Change dashboard navigation to `page.goto('/secret.html')`.
- [ ] Before submission, assert `Private analytics` and `[data-dashboard]` are hidden while the password input is visible.
- [ ] After a successful stats response, assert the heading and metrics become visible.
- [ ] For a 401 response, assert the generic text `Access denied.` and no analytics heading.
- [ ] Run `TMPDIR="$PWD/test-results/tmp" npx playwright test tests/analytics.spec.js` and confirm the dashboard cases fail against the old markup/URL behavior.

### Task 2: Implement the secret gate

**Files:**
- Delete: `analytics.html`
- Create: `secret.html`
- Modify: `analytics-dashboard.mjs`
- Modify: `analytics.css`
- Modify: `README.md`

- [ ] Move the HTML to `secret.html`; keep the form outside `[data-private-content]`, move the existing heading and dashboard inside `[data-private-content][hidden]`, and use visually hidden label/button elements.
- [ ] Update `initializeDashboard()` so `showLocked()` hides private content, successful `load()` reveals it, 401 renders `Access denied.`, and other failures render `Temporarily unavailable.`
- [ ] Style the locked form as a centered, borderless single input and add a reusable `.visually-hidden` class; preserve the existing authenticated dashboard styles.
- [ ] Replace `/analytics.html` with `/secret.html` in README.
- [ ] Run the focused Playwright file and expect all tests to pass.
- [ ] Run `npm run test:unit`, `git diff --check`, then commit and push the change.
