# Meeting feedback revision — 14 October 2026 (local implementation)

No push, cloud SQL application or deployment was performed in this revision.
Production remains the previously released voting workflow at
https://transitreach-kl-team8.netlify.app/ until matching frontend/backend release.

## Behaviour

1. Meeting maps disable the generic Start pin. Saved room origins use one coloured
   member marker, with permanent names. Exactly coincident origins share one marker
   and one name label; coordinates are not moved to manufacture separation.
2. Search, map clicks and one-shot GPS create a local preview, never save automatically.
   **Share starting point** explicitly discloses that point/name to room members.
   Only successful persistence produces Ready. **Stop sharing** withdraws the origin
   using the existing consent-gated RPC. Cancelling/changing a draft invalidates a
   pending GPS callback. No background tracking is added.
3. The creator chooses **Meeting time** and the group's travel-time budget. The
   existing SQL start RPC receives a derived preview-window opening internally;
   nobody is asked to agree to that as their own departure.
4. OTP forward surfaces/isochrones use meeting time minus budget. Their intersection
   is a **conservative preview**, not the complete set over every departure time.
   Setting arriveBy=true at each participant would reverse the travel direction
   and is intentionally not used. See the official
   [OTP 2.5 TravelTime contract](https://docs.opentripplanner.org/en/v2.5.0/sandbox/TravelTime/).
5. Up to 30 surface-screened candidates are independently verified toward each venue
   with real arrive-by itineraries, Malaysian wall time and the budget. Late,
   over-budget or unavailable routes exclude that candidate. Malformed responses or
   OTP outages fail the calculation; partial success is not published. Up to six
   OTP requests run concurrently. The top 20 verified candidates are ranked by
   longest trip, then travel-time gap, **within that shortlist**. This does not
   establish a global optimum, full geographic coverage or real-world punctuality.
   Verification has a 25-second overall deadline. Identical start/venue coordinates
   need zero travel; nearby-but-distinct trivial paths are not guessed as zero.
6. The existing everyone-votes/unique-plurality rule is unchanged. The confirmed
   card now has **Generate my travel pass**. Each member independently obtains a
   real arrive-by route, suggested departure, walking instructions and private map.
   Route generation does not change room Ready, publish personal Check statuses,
   run ML/weather/hours checks or unilaterally change the agreed meeting.
7. Passes retain the existing identity-scoped browser storage and PNG/room QR export.
   Route-only records carry `evidenceMode=route-only`; legacy evidence fields remain
   explicitly not-requested, never falsely checked. The route-only screen, library
   and export say Travel pass rather than Check needed/Not checked. Reopening the
   room allows fresh generation; old saved routes are not treated as current.

## Integration and limitations

- No new SQL or environment variables are required on the already migrated project.
  Keep `meeting-voting.sql`; do not reapply legacy `meeting-rooms.sql` by itself.
- Backend adds `arrivalTime` and `areaMethod=budget-window-preview`. A new client
  rejects an old backend rather than displaying a mismatched calculation.
- Deploy both runtimes together; reopen active legacy rounds before new voting.
  Old clients/old candidate caches are not verified under the new timing semantics.
- A meeting must be more than one travel budget ahead and within 30 days, respecting
  the existing SQL future-window constraint. Expired meetings cannot generate a pass.
- The new pass does not fulfil historical full Plan Check ACs. It is deliberately
  the requested route-only handoff; delay/weather/hours evidence remains a separate
  feature. Rooms still only display origin Ready.

## Verification

```bash
npm run typecheck
npm run lint
npm run build
node scripts/test-meeting-feedback.mjs
node scripts/test-meeting-voting.mjs
node scripts/test-meeting-privacy.mjs
node scripts/test-outing-pass.mjs
node scripts/test-outing-ui.mjs
node scripts/test-map-ui.mjs
node scripts/test-ui-state.mjs
node scripts/test-performance.mjs
.venv/bin/python -m unittest backend.tests.test_meeting_api backend.tests.test_meeting_common_ground -v
git diff --check
```

Browser layout fixture: `/tests/ui/meeting-feedback-preview.html` on local Vite.
It is clearly labelled, simulates room state without cloud writes, reads actual
PostgreSQL search/reference data and may route public stations through real OTP.
It is not a substitute for live multi-member voting, full candidate timing,
GPS permission or cloud release acceptance.

### Observed checks

- Typecheck/build passed. Lint: 0 errors, 18 pre-existing warnings.
- Meeting backend: 42 unit/contract tests passed, including arrive-by direction,
  timezone, late/over-budget rejection, outages, stale revisions and exact zero travel.
- Frontend: 26 feedback, 34 voting, 24 privacy/lifecycle, 42 legacy pass, 9 pass UI,
  29 map/weather, 44 UI lifecycle, 40 Epic 7/3D and 31 performance assertions passed. These use
  controlled fixtures, not live multiplayer sessions.
- Native Chrome inspected the labelled desktop fixture: one origin/name marker,
  no sharing checkbox, local search preview retains Not ready, explicit Share
  produces Ready, withdrawal removes it, and the confirmed card opens a personal Pass.
- That local fixture routed the two named public railway stations through actual
  OTP: departure around 18:21 and arrival around 18:27 for a 15 October 18:30 target,
  with a private route map and saved fixture record. No real room was created.
- PNG download completed; the actual image was inspected for readable journey,
  estimate/no-check wording and a room-only QR. This QA image's QR targets a local
  synthetic room, not a real invitation; physical scanning was not claimed.
- An isolated backend calculation used actual public GTFS station records and
  live OTP surfaces/isochrones/arrive-by routes: 2 areas and 2 verified candidates,
  about 4.6 seconds. Room loading/proposal storage were replaced to prevent writes.
  This verifies routing integration, not Supabase voting under the new timing semantics.
- The first isolated calculation failed on OTP's 409 trivial-distance response;
  an exact-zero-travel rule fixed it, with regression coverage. No nearby-distance
  shortcut or unavailable-data success fallback was added.
- No cloud migration, account/room creation, deployment or Git push occurred.
  A local fixture pass/image remains under a synthetic browser identity, distinct
  from the real member's My Passes. Private user coordinates were not used for QA.
