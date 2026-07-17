# Anonymous Visit Time History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Retain every anonymous visit start time from the next deployment and display the full newest-first history on the password-protected dashboard.

**Architecture:** Upgrade the existing single atomic state document to schema version 2 with a timestamp-only `visitTimes` array. Append a server timestamp in the same ETag write that creates a new live session, preserve it through compaction, expose it through the protected stats response, and render it in a scrollable dashboard list.

**Tech Stack:** Node.js ES modules, Netlify Blobs/Functions, vanilla HTML/CSS, Node test runner, Playwright.

---

### Task 1: Persist visit timestamps atomically

**Files:**
- Modify: `tests/analytics-repository.test.mjs`
- Modify: `netlify/lib/analytics-repository.mjs`

- [ ] **Step 1: Write failing repository tests**

Add tests proving that a new state contains `visitTimes: [startedAt]`, a heartbeat for an existing session leaves the array unchanged, a second new session appends exactly once, version-1 state seeds currently live `startedAt` values, compaction preserves history, corrupt history fails closed for mutations, and a competing CAS retry appends no duplicates.

Use canonical fixtures such as:

```js
const firstVisit = '2026-07-17T01:00:00.000Z';
const secondVisit = '2026-07-17T02:00:00.000Z';
assert.deepEqual(store.state.visitTimes, [firstVisit, secondVisit]);
```

- [ ] **Step 2: Run the repository file and verify RED**

Run:

```bash
node --test tests/analytics-repository.test.mjs
```

Expected: assertions fail because state version 1 has no `visitTimes` field.

- [ ] **Step 3: Upgrade and migrate the state schema**

Set `STATE_VERSION = 2`, make `emptyState()` return:

```js
{ version: 2, daily: {}, sessions: {}, visitTimes: [] }
```

Accept the exact legacy version-1 root (`daily`, `sessions`, `version`) and the exact version-2 root (`daily`, `sessions`, `version`, `visitTimes`). Decode version 1 by sorting valid live-session `startedAt` timestamps ascending. Decode version 2 by validating every history entry with `canonicalTimestampTime`; strict mutations reject any bad entry while non-strict reads omit corrupt entries.

In `upsertSession`, compute whether the session ID was absent before merging and build:

```js
visitTimes: isNewVisit
  ? [...state.visitTimes, timestamp.toISOString()]
  : [...state.visitTimes]
```

Copy `visitTimes` unchanged in compaction and return it from `readDataset()`. An absent state returns `{ daily: [], sessions: [], visitTimes: [] }`.

- [ ] **Step 4: Run repository and unit tests**

Run:

```bash
node --test tests/analytics-repository.test.mjs
npm run test:unit
```

Expected: all tests pass.

### Task 2: Return protected newest-first history

**Files:**
- Modify: `tests/analytics-core.test.mjs`
- Modify: `tests/analytics-functions.test.mjs`
- Modify: `netlify/lib/analytics-core.mjs`

- [ ] **Step 1: Write failing response-shaping tests**

Add a `buildStats` assertion using out-of-order canonical timestamps and require:

```js
assert.deepEqual(stats.visitTimes, [
  '2026-07-17T02:00:00.000Z',
  '2026-07-17T01:00:00.000Z',
]);
```

Update the authorized stats-handler test so its injected dataset includes `visitTimes` and the protected JSON returns them, while unauthorized requests still never read the repository.

- [ ] **Step 2: Run core/function tests and verify RED**

Run:

```bash
node --test tests/analytics-core.test.mjs tests/analytics-functions.test.mjs
```

Expected: `visitTimes` is absent from the stats result.

- [ ] **Step 3: Shape the history in `buildStats`**

Change the signature to default missing history for old callers:

```js
export function buildStats({ daily, sessions, visitTimes = [], now })
```

Return `visitTimes: [...visitTimes].sort((left, right) => Date.parse(right) - Date.parse(left))` alongside the existing generated time, timezone, and periods. The stats Function needs no public route change because it already spreads the protected repository dataset into `buildStats`.

- [ ] **Step 4: Run focused and full unit tests**

Run:

```bash
node --test tests/analytics-core.test.mjs tests/analytics-functions.test.mjs
npm run test:unit
```

Expected: all tests pass.

### Task 3: Render full Bishkek visit history

**Files:**
- Modify: `tests/analytics.spec.js`
- Modify: `secret.html`
- Modify: `analytics-dashboard.mjs`
- Modify: `analytics.css`
- Modify: `README.md`

- [ ] **Step 1: Write failing dashboard tests**

Extend the successful dashboard response with two newest-first timestamps. Assert that `[data-visit-history]` displays both as Bishkek date-times in response order. Add an empty-history test requiring `No visits recorded yet.` and retain the locked-page assertions.

- [ ] **Step 2: Run focused Playwright and verify RED**

Run:

```bash
mkdir -p test-results/tmp
TMPDIR="$PWD/test-results/tmp" npx playwright test tests/analytics.spec.js
```

Expected: history locators are missing.

- [ ] **Step 3: Add semantic history markup and rendering**

After `.analytics-grid`, add:

```html
<section class="analytics-history" aria-labelledby="visit-history-title">
  <h2 id="visit-history-title">Visit history</h2>
  <ol data-visit-history></ol>
</section>
```

Add `formatVisitTime(timestamp, timeZone)` using `Intl.DateTimeFormat('en-GB', { timeZone, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })`. In `renderStats`, clear the list with `replaceChildren()`, append one text-only `<li>` per timestamp, or append `No visits recorded yet.` when empty.

Style `.analytics-history` as the existing dark panel with a bounded scroll area and tabular numbers. Update README to state that exact anonymous visit times are retained from this deployment and visible only behind the admin password.

- [ ] **Step 4: Verify, commit, and deploy**

Run:

```bash
TMPDIR="$PWD/test-results/tmp" npx playwright test tests/analytics.spec.js
npm run test:unit
git diff --check
```

Expected: focused browser tests and all unit tests pass with a clean diff check. Commit the implementation, fast-forward `main`, rerun focused verification on `main`, and push `origin/main` so Netlify deploys it.
