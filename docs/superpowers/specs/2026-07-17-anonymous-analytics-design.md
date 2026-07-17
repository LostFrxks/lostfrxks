# Anonymous Portfolio Analytics Design

**Date:** 2026-07-17

**Status:** Approved design, awaiting written-spec review

**Target:** `lostfrxks.com`, deployed on Netlify

## Summary

Add first-party, anonymous analytics to the existing static portfolio. The site will count browser-tab sessions and measure active viewing time without cookies, persistent identifiers, fingerprinting, or application-level storage of IP addresses, user agents, referrers, URL parameters, location, or device data.

Events will be accepted by Netlify Functions and stored in Netlify Blobs. A private, token-protected dashboard will display visits and average active viewing time for today, the last 7 calendar days, the last 30 calendar days, and all time.

## Goals

- Count anonymous visits to the portfolio.
- Measure average active viewing time instead of elapsed wall-clock time.
- Provide a private owner-only dashboard.
- Keep the feature within the Netlify Free plan for normal portfolio traffic.
- Collect no personal or confidential visitor data in the application.
- Keep analytics failures isolated from the public website.

## Non-goals

- Identifying physical people across tabs, devices, browsers, or days.
- Advertising attribution, cross-site tracking, cohorts, funnels, geography, or device reports.
- A public traffic counter.
- Perfect bot detection or protection against a determined party fabricating events.
- Replacing Netlify's infrastructure logs or controlling data Netlify processes to host and protect the site.

## Metric Definitions

### Visit

A visit is one browser-tab session:

- A random session ID is generated with `crypto.randomUUID()` and stored in `sessionStorage`.
- Reloading the page preserves the session and does not increment the visit count.
- Opening another tab or closing and reopening the site creates a new visit.
- The ID has no encoded meaning and cannot link the visitor after that tab session ends.

The dashboard will label this metric **Anonymous visits**, not people or unique users. Exact human counts are impossible without a longer-lived identifier or fingerprint.

### Active viewing time

The tracker accumulates time only while `document.visibilityState === "visible"`:

- Time in a background or minimized tab is excluded.
- A visit that leaves immediately remains in the average with approximately zero seconds.
- The server accepts only non-decreasing cumulative durations and caps one session at 12 hours.
- Average active time is `sum(activeSeconds) / visits`, including zero-duration visits.

### Reporting periods

- Today: since midnight in `Asia/Bishkek`.
- Last 7 days: seven Bishkek calendar days including today.
- Last 30 days: thirty Bishkek calendar days including today.
- All time: every retained daily aggregate and every uncompacted live session.

Timestamps are stored as UTC ISO-8601 values. Calendar boundaries and dashboard labels use `Asia/Bishkek`.
Each visit and all of its active time are attributed to the Bishkek calendar date on which that visit started, including sessions that remain open across midnight.

## Architecture

### Public tracker

A small standalone browser module will:

1. Get or create the tab-scoped session ID.
2. Send an initial event with zero active seconds as soon as the page initializes.
3. Accumulate visible time using monotonic browser time.
4. Send the cumulative duration approximately every 20 seconds.
5. Flush once more on `visibilitychange` and `pagehide` using a keepalive request or `navigator.sendBeacon`.

The tracker sends only:

```json
{
  "sessionId": "random UUID",
  "activeSeconds": 42
}
```

It does not send client timestamps, the current URL, query parameters, referrer, screen size, language, location, device information, or custom headers.

### Event function

`POST /api/analytics/session` will:

1. Accept only `POST` with a small JSON body.
2. Require the `Origin` header to exactly match `new URL(request.url).origin`; this works for the custom domain, Netlify domain, and deploy previews without a permissive origin list.
3. Inspect the request user-agent only to reject known automated crawlers matching the conservative case-insensitive pattern `bot|crawler|spider|slurp|headless`, then discard it.
4. Reject bodies larger than 512 bytes and validate a canonical UUID v4 plus an integer cumulative duration from 0 through 43,200 seconds.
5. Use server time for `startedAt` and `lastSeenAt`.
6. Create or update one Blob record per session.
7. Preserve the earliest start and the greatest valid active duration when duplicate or out-of-order events arrive.
8. Use strong reads and Blob ETag conditions (`onlyIfNew` or `onlyIfMatch`) with up to three conflict retries so a late, shorter heartbeat cannot overwrite a newer duration.

The application will never read or write the request IP. Netlify's code-based rate limiter may group requests by IP at the platform edge, but the value is not exposed to or stored by application code.

### Blob storage

Live session records will use session-only keys so the same record remains addressable if a tab stays open across midnight:

```text
sessions/<session-id>
```

Each value contains only:

```json
{
  "startedAt": "2026-07-17T10:00:00.000Z",
  "lastSeenAt": "2026-07-17T10:01:12.000Z",
  "activeSeconds": 58
}
```

The reporting date is derived from `startedAt` in the `Asia/Bishkek` timezone. No raw request metadata is stored.

### Daily compaction

An `@daily` Netlify Scheduled Function will compact completed days that ended at least 48 hours ago:

1. List records under `sessions/` and group eligible records by the Bishkek date derived from `startedAt`.
2. Calculate `visits` and `totalActiveSeconds` for each eligible date.
3. Write `daily/YYYY-MM-DD` with those aggregate values.
4. Delete the corresponding individual records only after the aggregate write succeeds.

Compaction is idempotent: an existing daily aggregate is authoritative, and the stats function must not count both that aggregate and leftover session records. If compaction fails, the raw records remain available and the next run can retry. This retains all-time totals while minimizing long-term session-level data and avoiding a single concurrently updated global counter.

### Stats function

`GET /api/analytics/stats` will:

1. Require `Authorization: Bearer <token>`.
2. SHA-256 hash the supplied value and `ANALYTICS_ADMIN_TOKEN`, then compare the equal-length digests with a timing-safe comparison.
3. Read daily aggregates and any uncompacted session records.
4. Return only period-level aggregates; it will not return session IDs or raw timestamps.

Example response shape:

```json
{
  "generatedAt": "2026-07-17T10:05:00.000Z",
  "timezone": "Asia/Bishkek",
  "periods": {
    "today": { "visits": 4, "averageActiveSeconds": 36 },
    "sevenDays": { "visits": 18, "averageActiveSeconds": 51 },
    "thirtyDays": { "visits": 47, "averageActiveSeconds": 44 },
    "allTime": { "visits": 47, "averageActiveSeconds": 44 }
  }
}
```

### Private dashboard

`/analytics.html` will be an unlinked, terminal-styled static page consistent with the portfolio:

- Before authentication it shows only a token input.
- The token is never hard-coded or committed.
- After submission, the token is kept in `sessionStorage` for that admin tab and sent only in the stats request header.
- Four compact metric cards show today, 7 days, 30 days, and all time.
- Each card shows anonymous visits and formatted average active time.
- The page also shows the dashboard timezone and last refresh time.
- No raw session list, charting library, or public share mode is included.

The HTML file itself is not secret. Authorization is enforced by the stats function, so discovering the URL reveals no analytics data.

## Privacy and Security

- No cookies or local persistent storage are used for visitors.
- The tab-scoped session ID is random, short-lived, first-party, and used only to make heartbeat updates idempotent.
- Application code does not collect or store IP addresses, request user agents, referrers, URL/query data, geolocation, screen data, or device properties.
- Known crawler detection may inspect a user-agent in memory for the current request, but never persists or returns it.
- The admin token must be generated from at least 32 random bytes and configured as the Netlify environment variable `ANALYTICS_ADMIN_TOKEN`.
- The event endpoint receives a code-based Netlify rate limit of 60 requests per 60 seconds, grouped at the platform edge by IP and domain. The private stats endpoint receives a second rule of 20 requests per 60 seconds with the same grouping.
- Strict method, content-type, origin, payload-size, UUID, number, and maximum-duration validation limits malformed input.
- No client-side secret is used. Consequently, origin checks and rate limiting reduce casual fabrication but cannot make a public analytics endpoint impossible to spoof.
- The public site contains no visible counter, consent popup, or analytics controls. The request remains observable in browser developer tools.

## Error Handling

### Public site

- Analytics initializes independently from the portfolio animations and interactions.
- Network, function, storage, and serialization failures are swallowed by the tracker and never block rendering or navigation.
- A failed heartbeat can be superseded by a later cumulative heartbeat.
- A failed final beacon may lose the last few seconds, but the initial visit normally remains recorded.
- No analytics error is displayed to visitors.

### API

- Unsupported methods return `405`.
- Invalid origins, admin tokens, or credentials return generic authorization errors without detail.
- Invalid payloads return `400`; oversized or excessive requests are rejected before storage work.
- Rate-limited requests return `429` through Netlify.
- Blob failures return `503` and do not fabricate successful writes.
- Responses use `Cache-Control: no-store` where private or event-specific data is involved.

### Dashboard

- A wrong token shows a concise authentication error and no partial metrics.
- Network/server errors show a retry action without clearing the entered token during the tab session.
- Empty datasets render zero visits and `0s`, not an error or `NaN`.

## Testing Strategy

### Unit tests

Pure, storage-independent modules will cover:

- Session payload validation and duration caps.
- Idempotent create/update behavior for duplicate and out-of-order heartbeats.
- Bishkek date boundaries and period selection.
- Daily compaction without double counting.
- Weighted averages across daily aggregates and live sessions.
- Empty data and zero-duration visits.
- Admin token verification and response shaping.

Blob access will be injected behind a small repository interface so tests use an in-memory fake instead of production storage.

### Browser tests

Playwright will verify:

- The tracker sends only `sessionId` and `activeSeconds`.
- Reloads reuse the same tab session ID.
- Visible time increases while hidden time is excluded.
- Analytics request failures do not break the portfolio.
- The dashboard starts locked, handles a wrong token, renders returned metrics, and formats durations.
- Existing portfolio behavior and tests continue to pass.

### API tests

Function handler tests will verify:

- Method, origin, content-type, schema, and size rejection.
- Known bot rejection without persistence of request metadata.
- Unauthorized stats access returns no data.
- Successful stats responses contain aggregates only and never session IDs.

### Manual verification

Use Netlify Dev to exercise the complete flow with local Blobs, then verify a deploy preview before production. After production deployment:

1. Open the portfolio and keep it visible for at least one heartbeat.
2. Reload and confirm the visit count does not increase.
3. Close the tab, revisit, and confirm it does increase.
4. Confirm the average active time updates.
5. Confirm the dashboard rejects a missing or wrong token.
6. Inspect the browser request and Blob value to confirm no extra visitor data is present.

## Deployment and Configuration

- Add `@netlify/blobs` and `@netlify/functions` as project dependencies.
- Add Netlify function routes for the event and stats APIs.
- Add the daily compaction function with an `@daily` schedule; scheduled functions run in UTC and are available on all Netlify plans.
- Add the event function's code-based rate-limit configuration; basic code-based rules are available on the Free plan.
- Set `ANALYTICS_ADMIN_TOKEN` in the Netlify UI or CLI, never in `netlify.toml` or the repository.
- Use Netlify Dev for local function and Blob behavior.
- Keep the existing custom domain and static deployment model.

Netlify currently documents Functions, Blob storage, and code-based rate limiting as available on Free, with a fixed monthly usage allowance. If the allowance is exhausted, analytics may pause with the site rather than incur an automatic charge on the Free plan. Relevant platform references:

- [Netlify pricing](https://www.netlify.com/pricing/)
- [Netlify Blobs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/)
- [Netlify rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)
- [Netlify Scheduled Functions](https://docs.netlify.com/build/functions/scheduled-functions/)
- [Netlify environment variables](https://docs.netlify.com/build/functions/environment-variables/)

## Acceptance Criteria

- A first page load creates exactly one anonymous visit record.
- Reloading in the same tab does not create another visit.
- Closing the tab and revisiting creates a new visit.
- Active seconds do not advance while the document is hidden.
- The event payload and stored value contain no data beyond the approved fields.
- The dashboard reports visits and average active time for all four approved periods.
- The stats API returns no analytics without the correct admin token.
- Compaction preserves totals and removes old session-level records only after a successful aggregate write.
- Analytics failures do not produce visible errors or break existing site behavior.
- Existing and new automated tests pass under the documented local workflow.
- The feature can run on the site's Netlify Free plan with no paid analytics subscription.
