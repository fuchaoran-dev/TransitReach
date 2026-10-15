# Meeting experience revision

## Production release · 15 October 2026 (MYT)

- Runtime commit `b2f53ed` is on upstream `main` and the Render source branch
  `fuchaoran-dev/TransitReach:deploy/md8-6-20261008`.
- Supabase project `tritrrkakzechbvlvbcj`: rollback preflight and application of
  `meeting-auto-planning.sql` passed. SHA-256:
  `4a936fd612463258c119f820b452ab490e757790dc38321f961698d263747159`.
  Fingerprints (excluding the new schedule and room update timestamps) matched
  across all six meeting tables: 19 rooms, 28 members, 19 creator records,
  5 votes, 1 selection and 14 proposals. No existing agreement was reset.
  Function-definition backup is restricted locally; it contains no credentials.
- Netlify production: <https://transitreach-kl-team8.netlify.app/>, deployment
  `6ad05137f8f86efecf2ada4c`. Published entry `index-BHWaMhT2.js` and the meeting,
  room-service and app assets were byte-compared with the local production build.
- Render deployment `dep-db852s6q1p3s739k6k00` succeeded for `b2f53ed`;
  `/health` returned HTTP 200. No environment variables or OTP graph changed.
- Repeated typecheck/build, lint (0 errors, 18 existing warnings), 76 backend
  tests, all frontend checks listed below and 35 isolated SQL checks passed.
- 47/47 live Auth/RLS/API/OTP/Realtime checks passed using public GTFS station
  origins and a disposable room. They verified automatic all-Ready preparation,
  late unready joining, member ensure idempotency, preserved meeting time,
  fresh geometry after an origin change without host Start, proposer sharing,
  tie handling, voting confirmation and six private arrive-by route options.
  The test room and its three newly created anonymous identities were removed
  with scoped guards; no existing room or account was deleted.
- Native production Chrome additionally verified explicit Share → green Ready,
  My Passes → Meet retaining the current room and shared origin, automatic radar
  and calculation after the test peer joined, only the cyan intersection,
  amber Propose/name feedback and the matching native 3D area/venue label.
  Show everyone reframed the native 3D scene to include both named starts.
  The additional UI test room and newly created peer were then removed;
  the pre-existing browser identity was preserved.
  Existing browser passes were not modified. Generic empty-list Go to Meet is
  covered by the controlled regression, not an empty production browser store.
- Remaining limits: this is not full two-physical-device acceptance, a fresh GPS
  permission test, QR physical scanning, or a contention/load benchmark. The PNG
  layout was inspected in the local browser fixture, not re-downloaded in this
  production browser. Regional forecasts/routing remain estimates.

The implementation notes below record the pre-release verification separately.

## Changes

1. Propose saves first, then focuses the venue. Every member sees an amber rank
   marker and proposer names from the shared selections. A failed save produces
   an error, not a successful marker. Proposed places remain visible despite
   category filters; rank numbers stay consistent with the server's shortlist.
2. Generic **Go to Meet** retains the current `?meet=` value. Opening a particular
   saved pass switches to that room explicitly. Navigation never calls Leave.
3. All Ready automatically prepares a round in PostgreSQL. The persistent
   `meeting_time` survives origin/budget invalidation, so a non-host can update
   their shared origin while the host's browser is offline. The next valid round
   resets old selections, votes, proposals and confirmation. Clients fetch new
   geometry for the new revision and discard stale responses.
4. Calculation has a decorative radar sweep with a static reduced-motion version.
   It blocks no map interaction and claims no fabricated completion percentage.
5. Only the actual OTP-region intersection is filled, in high-contrast cyan.
   Member points/names and venue markers remain. Individual region fills are
   removed; no arbitrary distance circles replace real boundaries. This remains
   the conservative budget-window preview, not every possible departure time.
   The same intersection, member/proposer labels and point focus are supplied to
   3D; exactly coincident labels merge without moving coordinates. Meeting 3D
   controls sit between the panels instead of being covered by the right panel.
   Show everyone also frames the native 3D scene, not only the hidden Leaflet map.
6. Repeated explanatory text, duplicated vote lists and unknown-hours rows are
   removed. Detailed rules/provenance remain in disclosures; explicit sharing
   consent, errors, unknown evidence and estimate limitations are retained.
7. PNG export is a designed ticket: date/venue header, departure/estimated-arrival/
   meeting-time cards, recorded-geometry route sketch, coloured mode timeline,
   walking directions and QR ticket stub. No map tiles are downloaded. Missing
   geometry is disclosed rather than drawn as a fabricated straight connection.
   Long/CJK names wrap; QR still encodes the room invitation only, not the route.

## Automatic planning rules

- New rooms have a server-persisted meeting time 90 minutes after creation; this
  is an editable default, **not an optimized/recommended time**. The creator can
  change it in MYT; a valid edited time saves on blur and resets/recalculates votes.
- At least two members must explicitly share points. Withdrawal or an unready
  new member stops the round, never producing a partial group answer.
- New members can join an automatically prepared **unconfirmed** group; this
  invalidates its current round and waits for them to share. Confirmed groups
  still require the creator's Reset votes/reopen action before a new person joins.
- Existing room-first locks, six-member cap, owner-only participant RLS and the
  everyone-votes/unique-plurality rule are unchanged. A member ensure RPC can only
  prepare the saved schedule, not assign a new time or finalize the place.
- Expired/too-close times are not automatically rolled forward. The creator must
  choose a valid time with a full future travel window, at most 30 days ahead.

## Deployment order (applied in the release above)

Apply `supabase/meeting-auto-planning.sql` **after** the existing voting migration,
then publish the matched frontend. The existing arrive-by Render API remains
compatible; no new environment variables or OTP graph upgrade are required.
Do not rerun `meeting-rooms.sql` or `meeting-voting.sql` alone after this upgrade:
they overwrite the new projection/grants. A full bootstrap must apply all three
in order. New clients explicitly reject an old projection with a migration-required
message and Retry, instead of displaying a never-ending Opening room state.

The migration preserves existing agreements and persisted schedules, is rerunnable,
and does not force active rooms to reset at installation. Already-ready inactive
groups are prepared through the idempotent member ensure RPC on opening the page.
Before cloud application, review the current database state and coordinate deployment.
Back up affected existing room metadata if rollback is needed. A later user action
that changes an origin/time/budget legitimately clears that group's votes/agreement.

## Verification

- Typecheck, lint (0 errors / 18 existing warnings), build and diff check passed.
- Frontend: 49 voting, 33 experience/canvas/navigation, 26 feedback, 24 privacy,
  42 legacy Pass, 9 Pass UI, 29 map, 44 lifecycle, 40 Epic 7, 31 performance and
  127 trip-planner fixture checks passed.
- 76 backend tests passed. An initial unprivileged run's four DB integrations
  failed on network/DNS restrictions; an approved read-only run with explicitly
  configured DATABASE_URL passed. No cloud schema/room/Auth writes were made.
- 35 SQL checks passed against ephemeral local PGlite using the real schemas,
  RLS, RPCs and triggers. Only pg_cron setup was omitted. Checks include readiness,
  non-host-origin restart, target preservation, idempotency, late joining,
  withdrawal, vote invalidation, schedule permissions and preservation of a
  confirmed agreement on rerun. This does **not** simulate multi-connection lock
  contention or establish production realtime timing.
- Native desktop Chrome inspected the labelled meeting fixture: amber Proposed
  marker with name, only cyan overlap, no Start button, and radar while old area/
  candidate markers are hidden. The offline PNG was generated in-browser and
  inspected for readable time cards, route sketch, timeline and QR stub.
  Native 3D additionally displayed the cyan shared region and merged
  member/Proposed label when Propose focused the venue; the exposed toolbar opened.
- These pre-release UI states are explicitly synthetic. At that stage,
  production automatic rounds, real
  multi-browser navigation, fresh GPS permission, QR physical scanning and the
  new cloud migration had not been accepted. See the production release above
  for the subsequent deployment and live verification, with remaining limits.

Run locally:

```bash
node scripts/test-meeting-experience.mjs
node scripts/test-meeting-voting.mjs
node scripts/test-meeting-privacy.mjs
# Optional isolated SQL test; use an already installed official PGlite module.
TEST_PGLITE_MODULE=file:///absolute/path/to/pglite/dist/index.js node scripts/test-meeting-auto-sql.mjs
```

Visual fixtures:
`http://127.0.0.1:5173/tests/ui/meeting-feedback-preview.html`
(Shared starts / Calculating / Confirmed meeting) and
`http://127.0.0.1:5173/tests/ui/outing-preview.html` → Preview offline image.
The latter is a historical checked-Pass fixture used only to inspect the new PNG
renderer; it does not reinstate shared personal-check badges in the meeting page.
