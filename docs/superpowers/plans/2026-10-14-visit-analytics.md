# Private Visit Analytics Implementation Plan

> **For agentic workers:** Execute inline using superpowers:executing-plans and test-driven-development. The approved chat already authorizes implementation and publication.

**Goal:** Permanent private visit cards, browser-specific owner exclusion and richer visit activity without screen metrics.

**Architecture:** Add independent detailed visit blobs and authenticated owner registrations beside the untouched legacy analytics store. Collect browser metadata/activity on the public page, combine historical and detailed aggregates behind the existing password API and render paginated expandable cards.

**Tech Stack:** Existing vanilla JS/CSS, Netlify Functions and Blobs, Node test runner and Playwright; no new dependencies.

**Spec:** docs/superpowers/specs/2026-10-14-visit-analytics-design.md

## Global constraints

- Owners are browsers, never IPs. Only successful password authentication may register an owner.
- Preserve all old statistics and history; retain all new detailed records indefinitely.
- API and UI details remain password protected, including pagination and refresh.
- Collect approved metadata and activity; omit screen dimensions, form data and secrets.
- All writes are validated, idempotent cumulative updates; activity stops on cleanup.

### Task 1: Durable records and statistics

Files: create netlify/lib/analytics-visits.mjs and tests/analytics-visits.test.mjs; extend analytics-core.mjs only for optional detailed records.

- [x] Write failing tests over a conditional blob fake: concurrent visitors survive, reordered heartbeats do not reduce activity, browser identity cannot change, marking one browser excludes only that browser even on a shared IP, old state remains untouched, future compaction retains detailed blobs.
- [x] Run `node --test tests/analytics-visits.test.mjs` and confirm missing-feature failures.
- [x] Implement `VisitRepository.upsertVisit(payload, context, now)`, `markOwner(browserId, now)`, `readVisits()` and the combined legacy/detailed factory. Validate UUIDs, dates, bounded strings/maps and trusted server metadata. Extend `buildStats` to filter owner records and merge optional detailed statistics without changing its legacy interface.
- [x] Run the new and existing unit suites. Verify counts against literal fixtures with one old visit, one real visitor and one owner.

### Task 2: Private endpoints

Files: modify analytics-session.mjs and analytics-stats.mjs; create analytics-owner.mjs and tests/analytics-extended-functions.test.mjs.

- [x] Write failing tests proving wrong/missing passwords cannot read or register, forged owner/IP fields are rejected, same-origin rich collection persists trusted IP/geo, and paginated authorized history is ordered without exposed browser IDs.
- [x] Implement strict rich collection with lean payload backwards compatibility, authenticated POST /api/analytics/owner and GET stats history pagination (50 records, validated offset).
- [x] Run `node --test tests/analytics*functions.test.mjs` and all unit tests.

### Task 3: Browser collection

Files: create analytics-visit.mjs and tests/analytics-visit.test.mjs; integrate into analytics.mjs and update existing browser payload tests.

- [x] Write failing behavioral tests for persistent browser/fresh visit IDs, referrer and campaign sanitation, section visibility without hidden time, scroll and click aggregation, storage failures and cleanup.
- [x] Implement `getBrowserId`, `createVisitCollector` and integrate collector snapshots into existing heartbeat delivery. Keep passwords and browser ownership out of collection payloads.
- [x] Run tracker unit tests and Playwright collection tests on the isolated server.

### Task 4: Cards, integration and release

Files: analytics-dashboard.mjs, analytics.css, secret.html, tests/analytics.spec.js and README.md.

- [x] Write failing browser tests for owner registration after correct password only, expandable cards and amber/text labels, safe rendering of hostile strings, pagination, desktop/mobile layout and clearing private DOM on lock.
- [x] Implement owner registration before stats loading, stable browser identity shared with the collector, paginated accessible details cards and metadata labels. Update asset version URLs and the documented data contract.
- [x] Run all unit and browser tests; inspect desktop/mobile screenshots; exercise real local Netlify endpoints and Blobs with a development password, including shared-IP owner exclusion and restart persistence.
- [ ] Review the final diff and checks, merge the feature branch into main, push, and verify public asset hashes and unauthorized APIs. Do not claim a real-user owner login was tested in production.

Local verification: 101 unit checks and 57 full browser checks passed. Final analytics browser rerun: 10 passed. Real Netlify Functions/Blobs sandbox verified trusted metadata, owner exclusion on a shared IP, browser collection, desktop/mobile cards, clearing data on lock and restart persistence. Installed @netlify/blobs 10.7.9 local emulator omits GET ETags; a temporary untracked dependency-only repair enabled local CAS checks. Application ETag integrity checks remain enforced. Independent read-only code review found no material issues. History paging bounds returned data; aggregate calculation currently scans retained visit records.
