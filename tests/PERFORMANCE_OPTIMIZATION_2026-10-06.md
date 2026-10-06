# Performance optimization — 2026-10-06

## Scope

Local code changes only. No Git commit/push, production redeploy, paid upgrade, schema
change, cloud data write, VM resize, region migration, or credential change.
The pre-existing UI worktree changes were preserved.

## Implemented

| Area | Change | Bound / invalidation |
| --- | --- | --- |
| OTP coverage | Share in-flight computations between map and services; retain the required transit + walking-only pair | Exact origin, budget, departure string, mode and endpoint; 60s TTL; 24 completed entries |
| OTP place estimates | Remove automatic routing of up to 80 services; compute selected places on demand | Exact origin/destination/mode/departure/endpoint; 60s TTL; 256 completed entries; 15s timeout |
| Cancellation | Each shared request tracks consumers; one consumer leaving does not cancel another | Abort upstream once the last consumer leaves; errors are not cached |
| Service UI | Show “Select to check travel time” before selection; recompute selected place after date/time/budget changes | Old results cannot overwrite the current origin; unverified arrival status remains Unknown |
| PostgreSQL | Process-local psycopg pool with startup/shutdown lifecycle | Default min 1 / max 4 per process; 10s acquisition timeout; bounded waiting queue; connection health check |
| Public bootstrap | Cache serialized PostgreSQL response, weak ETag/304, gzip | 60s origin TTL; HTTP revalidation, no extra CDN freshness; no bundled JSON fallback |
| Model catalog | Replace unlimited-lifetime catalog memoization | 60s TTL |
| AI prediction | Cache active model metadata and repeated inference + SHAP results | Metadata 30s; predictions 30s / 512 entries; key includes metadata, line, stop, request hour and weekday |
| Cache concurrency | Same-key fills share results/errors without holding a lock during I/O | Independent keys remain responsive; explicit clearing prevents an old fill restoring stale entries |
| API overload | Pool timeouts return a generic retryable 503 | Retry-After: 5; no-store; no private connection details |
| Observability | Server-Timing app duration and Uvicorn request-duration logging | Does not log query strings/coordinates/credentials; does not include network transit time |
| Frontend initialization | Single-flight database bootstrap initialization | Failed initialization can be retried |
| Frontend delivery | Lazy-load Meet page; immutable caching of Vite hashed assets | Entry HTML revalidated; API, weather and OTP excluded from static header rule |

Caches are bounded process/session memory only. They are not disk datasets. Routing
coordinates never enter shared server/CDN caches. Meeting-room participant/auth data
is not included in the bootstrap cache. The routing model and opening-hours rules were
not replaced with guessed travel times or weather multipliers.

## Validation

- `npm run typecheck`: passed.
- `npm run build`: passed; large App/MapLibre chunks and Leaflet dynamic/static import
  warnings remain. No warning threshold was increased to hide them.
- `npm run lint`: 0 errors, 16 existing warnings; no new warnings from this work.
- `node scripts/test-performance.mjs`: 31 controlled checks.
- `node scripts/test-ui-state.mjs`: 44 controlled lifecycle checks.
- `node scripts/test-epic7.mjs`: 40 controlled arrival/3D checks.
- `node scripts/test-map-ui.mjs`: 29 controlled weather/UI checks.
- Python offline tests: 30 passed, including 14 new cache/pool/API tests.
- Existing reliability API tests against real configured Supabase: 4 passed.
- `git diff --check`: passed.

Initial sandbox-only cloud checks could not resolve the database host. The approved
read-only network retries succeeded; this was not a database password change or cloud
migration.

### Desktop Chrome check against local code + real datasets

The local page loaded via the local FastAPI/PostgreSQL backend and the existing OTP
proxy. SunU-Monash, 30 minutes, 2026-10-06 09:00 MYT returned 14.0 km² and 515 services
(including 3 hospitals). Unselected rows showed the on-demand prompt. Selecting Sunway
Medical Centre opened the native 3D scene and obtained a real OTP estimate of 15 minutes.
Changing to 2026-10-07 cleared the old estimate while recomputing, preserved the station
and budget, and subsequently displayed the new result. Clearing the service restored
the list without clearing the origin/date/budget. These are observations, not permanent
ground-truth timings or promises about future routing data.

The lazy-loaded Meet screen rendered. Local Supabase frontend URL/key are not configured,
so shared-room creation, joining and Realtime synchronization were not tested. Production
Meet variables must be retained for any future deployment. No room was created.

### Read-only backend timings

Command: `.venv/bin/python -m scripts.benchmark-performance`

Measured in-process with FastAPI TestClient on this Mac, connected to the configured
cloud PostgreSQL. **These are not Render production latency, not a before/after baseline,
and not a load test.** Each run starts a fresh application pool/cache. First requests
include setup/query/serialization/inference; repeated requests use valid cache entries.

| Measurement | Run 1 | Final-version run 2 |
| --- | ---: | ---: |
| Bootstrap first request | 4727.46 ms | 11370.07 ms |
| Bootstrap cache-hit median, 5 samples | 34.95 ms | 35.96 ms |
| AI first request | 2450.27 ms | 3568.71 ms |
| AI cache hit | 3.55 ms | 3.92 ms |
| ETag revalidation | 304 | 304 |

Payload: 4,421,082 bytes uncompressed / 797,289 bytes at gzip level 5 (about 82% smaller).
Counts matched: 162 rail stops, 4,053 bus stops, 3,020 places, 19,406 essential services.
The benchmark observed two pool connections, not a new connection for each repeated
request. First-request variability remains significant and must not be hidden by the
cache-hit figures.

## Still requires deployment / future measurement

- Neither Render nor Netlify production contains this turn's changes yet.
- Render must install the new pinned `psycopg_pool==3.2.8` dependency on redeploy.
- DB_POOL_MIN_SIZE / DB_POOL_MAX_SIZE are optional; defaults work without adding env vars.
  Multiply maximum size by process/replica count when evaluating the database limit.
- Keep the existing Netlify VITE_SUPABASE_URL / public anon key during production builds.
- Render Free cold-start behavior is unchanged; a paid upgrade was not authorized/performed.
- Nectar JVM heap/GC tuning and co-location require actual VM/region measurements first.
- Full bootstrap splitting, first-query SQL profiling and reducing remaining map bundles
  are future work; the bootstrap payload contract was intentionally kept compatible.
- Collect warm/cold p50/p95, concurrent-user error rates and CPU/memory/GC on the deployed
  services before claiming production speedups or resizing infrastructure.

Official references used for implementation: [Psycopg pools](https://www.psycopg.org/psycopg3/docs/advanced/pool.html),
[FastAPI lifespan](https://fastapi.tiangolo.com/advanced/events/),
[Netlify headers](https://docs.netlify.com/manage/routing/headers/).
