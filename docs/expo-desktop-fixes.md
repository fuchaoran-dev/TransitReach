# Expo desktop reliability revision

Scope: desktop browser only. This revision does not redesign mobile navigation,
change production settings, migrate SQL, push Git commits or deploy services.

## Meeting calculation

The frontend uses authenticated `POST /api/meetings/{code}/common-ground-job` short
polls, not a single long request through the Netlify proxy. Its body contains only
room revision, budget and venue categories, never participant coordinates or IDs.
The old synchronous endpoint remains for compatibility, with its original limitations.

The single-worker FastAPI service coordinates one job per room/revision/budget/type
set. Every poll rechecks PostgreSQL membership, expiry, revision and budget, including
completed-result reads. Five clients therefore join one routing operation. A changed
round rejects stale reads and cancels older work when a current round is polled.

All members' OTP isochrones are calculated first and published as a complete
`finding_places` preview with an empty proposal list. The map shows their intersection
while surfaces and individual arrive-by routes are checked. A failed member never
produces a misleading subset of the group. Place failure retains a valid area but
does not publish or permit voting on partially checked proposals. PostgreSQL still
guards proposal storage against revision changes.

Work limits: six OTP requests per process across rooms, at most 12 screened candidates,
45 seconds for candidate verification and 90 seconds per job. Browser polling has a
150-second ceiling, 12-second individual requests and at most three transient
failures with backoff. Permission, incompatible-data and revision errors are not
automatically replayed. These are ceilings, not speed guarantees or optimality claims.

The 12 candidate slots are allocated round-robin across available venue categories
(stations, cafés, restaurants and malls), retaining the existing duration/fairness
ordering within each category. Sparse categories release unused slots to others.
Only candidates inside every member's travel-time surface enter this shortlist;
every selected venue still requires all members' arrive-by route checks. Verified
results retain the existing global ranking. A category is not guaranteed a result:
failed route checks can remove its candidates, and untested places are not ruled out.
The desktop category filter now explains an empty shortlist rather than showing
a blank panel or claiming no such venues exist in the whole common area.

Job state is bounded to 16 entries, expires automatically (60 seconds after success,
five seconds after failure), and is cancelled/cleared on shutdown. It retains no
tokens or travel-time rasters. This is transient member-only job coordination, not
a durable task queue or a public data cache. Restart loses jobs and polling safely
starts fresh work. **Keep the existing one-worker/one-instance deployment:** multiple
workers/replicas require a shared coordinator before claiming cross-worker deduplication.
Private geometry remains a consent-gated budget-window preview, not an exact
arrive-by accessibility set. No approximate circles or bundled JSON substitute for OTP.

## Other fixes

- Sharing an origin reports the successful save independently of a skipped/stale
  follow-up refresh. A newer local preview is still protected from older saves.
- A failed transit request cannot silently become a successful walking-only plan;
  a genuinely successful transit search may still return a real walk option.
- Confirmed invitations explain reopening instead of offering an impossible Join.
- Travel-pass dialogs are portalled to `document.body`, above navigation and outside
  the meeting map's clipped container. Focus trap/Escape/back behaviour is preserved.
- Pass reading maps use real OSM raster streets without a second WebGL context;
  tile failures are disclosed. PNGs keep full street/water/label style and a flat
  camera, with explicitly labelled schematic output if the basemap is unavailable.
- Custom SVG favicon and PNG social preview replace Vite/Bolt defaults. The PNG is
  generated from the versioned `public/social-preview.svg` source.

Main map 3D is unchanged. Starting stations remain valid meeting candidates; zero
travel is not a failure. The reported marker numbering mismatch needs its exact
overlap/reordering reproduction before a speculative renumbering change. No bus
pole codes are inferred from ambiguous names. Netlify's injected badge is a separate
online project setting; this local revision does not switch it or raise mobile navigation.

## Verification

New checks: `node scripts/test-expo-fixes.mjs` and
`.venv/bin/python -m unittest backend.tests.test_meeting_jobs -v`, plus existing
meeting, pass, planner, map, lifecycle, performance and bootstrap regressions.

One live OTP test used five **public rail stations**, 60 minutes and a modelled
arrival of 16 October 2026 at 18:30 MYT. Room authorization/loading/storage were
controlled fixtures; it made no cloud room writes. Five callers shared one job.
All five areas were available at about 9.13 seconds (20 intersection pieces), and
12 fully checked candidate places completed at about 26.47 seconds. This is one
observed run, not a production latency guarantee, real five-account room test or
Expo-time acceptance.

Desktop Chrome verification on 15 October 2026 covered the street-backed pass
fixture, successful PNG rendering with visible street labels/route, and the actual
pass dialog opened from a controlled confirmed-room fixture. The latter queried
real OTP for KL Sentral to Pasar Seni; its title/Back button remained above the
page header, and Escape closed it and returned focus to Generate my travel pass.
Only a synthetic-identity pass was stored locally; no cloud room or vote changed.

Final automated run (including category-balanced mall selection): 92 backend
unittest tests and 646 assertions across the 13
frontend regression scripts passed, as did typecheck, build and diff checking.
ESLint has zero errors and 18 pre-existing warnings; existing build-size,
Leaflet import and Browserslist freshness warnings remain. Local unauthenticated
job requests return 401; API regressions also cover member-only reads, stale rounds,
queue saturation and no-store response headers. No phone acceptance was performed.

Mall regression coverage includes dense-category starvation, spare-slot reuse,
empty/single-category shortlists, all-member route rejection, surface exclusion,
filtered mall rendering and an explicit empty-category message. These use controlled
fixtures, not a live room. A fresh desktop browser check for this mall revision was
attempted but navigation did not respond; the earlier desktop checks above do not
establish visual acceptance of this new empty-category state.

Deployment must update FastAPI before the new frontend. No SQL migration or new
environment variable is required. Deploying only the frontend against the old
backend will fail explicitly rather than silently reverting to long calculations.
