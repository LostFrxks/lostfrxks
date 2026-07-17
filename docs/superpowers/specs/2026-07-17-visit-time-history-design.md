# Anonymous Visit Time History Design

## Goal

Add a password-protected, full visit-time history to the private analytics dashboard while keeping the public payload and stored dataset anonymous.

## Scope

- Exact visit times are retained beginning with this deployment.
- Exact times from already compacted historical days cannot be reconstructed and will not be fabricated.
- Existing live sessions are seeded into the history during state migration.
- The feature stores timestamps only. It does not add UUIDs to the history, IP addresses, user agents, referrers, URLs, locations, languages, or device data.

## Storage and migration

The existing single `analytics/state-v1` Blob remains the atomic consistency boundary. Its versioned schema gains a `visitTimes` array containing canonical ISO timestamps.

When a heartbeat creates a session that is absent from the live-session map, the same ETag compare-and-set transition appends the server timestamp to `visitTimes`. Updates to an existing session do not append another timestamp, so reloads and heartbeats remain one visit. If a session was compacted after at least 48 hours of inactivity and later reappears, it is already treated as a new visit and receives a new timestamp.

The repository accepts the deployed legacy state without `visitTimes`, seeds the array from currently live sessions' `startedAt` values, and writes the upgraded schema on the next mutation. Compaction never removes history entries.

## API and dashboard

The protected stats response gains `visitTimes`, sorted newest first. The value is returned only after the existing password check and contains timestamps only.

After the four aggregate cards, the unlocked `/secret.html` dashboard shows a scrollable `Visit history` list. Every entry is formatted in `Asia/Bishkek` as day, abbreviated month, year, and time with seconds. The locked page remains the anonymous single-input gate.

## Failure behavior

Malformed stored history fails closed for mutations so valid history is never silently overwritten. A bad stats response keeps the dashboard locked or shows the existing temporary-unavailable state. Empty history renders a neutral `No visits recorded yet.` message.

## Verification

- Repository tests cover legacy migration, one append per new visit, no append on heartbeat, preservation through compaction, and concurrent CAS retries.
- Core/function tests cover newest-first aggregate-only response shaping plus timestamp history.
- Focused Playwright tests cover password protection, Bishkek formatting, ordering, and empty history.
