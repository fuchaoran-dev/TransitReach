# Startup recovery

The browser still loads its public reference data exclusively from the PostgreSQL
`/api/data/bootstrap` endpoint before importing the application. A transient gateway
failure no longer immediately replaces the application with a reload-only error.

- At most four attempts per automatic/manual cycle, with a 32-second request/body
  timeout and a hard two-minute operation deadline. Backoff is 5/15/45 seconds,
  allowing about a minute of warm-up even when failures return immediately.
- Only network interruptions, timeouts and HTTP 408/429/500/502/503/504 retry.
  HTTP 4xx configuration/permission failures, unreadable JSON and incompatible
  top-level datasets fail explicitly. A longer Retry-After is honoured only when
  it fits the total deadline; it never creates an unbounded wait.
- After eight seconds or a transient failure, the screen explains that the server
  **may** be waking up. This is not a diagnosis or a fabricated completion percentage.
- Exhaustion offers Retry connection in the same React root. It does not reload
  the document, clear a room link/auth session/pass, or substitute local sample data.
  A separate app-module failure has a distinct diagnostic from a data failure.
- Concurrent consumers share one operation; cancelling the last aborts it. Late
  responses cannot publish data after cancellation. Timers/listeners are released.
- Existing HTTP cache/ETag behaviour is preserved: no cache-busting query, forced
  cache bypass, offline dataset, persisted private data or new production dependency.

This fixes startup recovery, not Render's sleep policy or a prolonged outage. No
paid hosting, environment variables, SQL, backend/API contract or CDN freshness
policy changed. Splitting the public dataset is deferred: synchronous reference-data
adapters currently require the full contract, so that is a separate optimisation
with cross-Epic acceptance rather than a silent partial-data fallback.

Verification:

```bash
node scripts/test-bootstrap.mjs
node scripts/test-performance.mjs
node scripts/test-ui-state.mjs
npm run typecheck
npm run lint
npm run build
git diff --check
```

The bootstrap checks use controlled fetch responses and virtual timers. They include
automatic recovery, retry exhaustion, permission/configuration failure, stalled
response bodies, cancellation, shared consumers, stale responses and the actual
React gate mounting the app after automatic/manual retry. They do not claim to
reproduce a real Render sleep or a production deployment.

Visual fixture: `/tests/ui/bootstrap-preview.html` (Loading / Server may be waking /
HTTP 504 exhausted). It renders the production screen with explicitly synthetic
states; its Retry button only changes the fixture, without requests or room writes.

Local verification (15 October 2026): 112 startup-recovery assertions, 31 performance
assertions and 44 UI-lifecycle assertions passed. Desktop checks covered the waiting
and error screens, visible keyboard focus and the fixture's retry action. In a
separate real-data check, only the locally started FastAPI process was stopped:
one browser reload showed the waiting state, and restarting that process allowed
automatic recovery into the PostgreSQL-backed map without another reload. This
simulates local unavailability, not Render's production cold-start timing. This
local verification preceded publication; it does not establish the current
production version or claim a live cold-start test.

TypeScript checking and the production build passed. ESLint reported zero errors
and 18 existing warnings in unrelated files. Existing large-chunk, Leaflet import
and Browserslist freshness build warnings remain outside this startup fix.
