# MD8-6 acceptance record

Checked 8 October 2026. Scope: group invitation and each member's personal pass;
no Epic 2 multi-stop optimiser or Add errands action.

## Configuration and live results

- Applied the corrected `supabase/meeting-rooms.sql` to the project selected by
  the local `DATABASE_URL` (`tritrrkakzechbvlvbcj`). Created four meeting tables,
  confirmation/status RPCs, RLS rules, realtime publication and one expiry job.
- Core transit-stop and essential-service row counts were unchanged.
- Reapplying the schema succeeded. A rollback-only SQL acceptance script passed
  25 checks; no synthetic identity or room was retained.
- The same script with `--check-routing` passed 27 checks, including actual OTP
  GeoTIFF decoding and a next-day arrive-by transit journey between public stations.
- Local browser/server project URLs and OTP URL are set in gitignored `.env.local`.
  Local Vite now reads `DEV_API_TARGET` from that file.
- The supplied public publishable key is now configured for both browser and
  server in gitignored `.env.local`. Both keys and project URLs match the local
  PostgreSQL project. A live `GET /auth/v1/settings` returned HTTP 200, verifying
  that the key is accepted by this project; no key or token is recorded here.
- After the user enabled and saved anonymous sign-in, a live Auth settings check
  on 8 October 2026 returned HTTP 200 and `external.anonymous_users=true`.
  New signups are allowed and email confirmation remains enabled. Configuration
  is verified. The subsequent local and online browser checks also signed in
  anonymously. No test Auth user was created by the read-only settings check.
- Netlify's production `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` were updated
  to the same project and supplied public key. Existing unrelated values were not
  listed or copied. The deployed build uses this project and contains no database
  connection string.
- A live local browser check signed in anonymously, created a temporary room and
  joined it in a separate Chrome incognito session. Members selected KL Sentral
  and Pasar Seni. The authenticated local FastAPI ranked actual public venues;
  Bombay Talkies was confirmed for 8 October 2026, 18:45 MYT as plan version one.
- The incognito member's pass used actual OTP LRT/walking legs, displayed arrival
  and closing margins, and correctly retained `Not checked` for unsupported rail
  delay and unavailable weather. PNG download and same-session My Passes reopen
  succeeded, with a new check timestamp after reopening. Physical QR scanning,
  the first member's pass and prompt cross-session version updates remain pending.
- The user authorized an independent deployment branch on the fork, without
  modifying either remote main branch. Runtime commit `00a0f7d` on
  `deploy/md8-6-20261008` is deployed on Render. Only `SUPABASE_URL`, the public
  `SUPABASE_ANON_KEY` and `OTP_BASE_URL` were added; existing secrets and
  `DATABASE_URL` were not expanded or modified.
- Render deployment: `dep-db395v60tbcc738289d0`. Netlify production deployment:
  `6ac693591cb9227c51d93d88`. Production URL:
  https://transitreach-kl-fuchaorantransitreach.netlify.app.
- Online health and bootstrap returned HTTP 200; unauthenticated and invalid
  bearer requests returned HTTP 401. OTP feed and weather proxies returned actual
  JSON. OTP reports Rapid KL rail, Rapid KL bus and MRT feeder feeds loaded.
- The production browser displayed the confirmed invitation and a new anonymous
  test member joined successfully. Automated native keyboard/clipboard input then
  became unreliable, so the online starting-point/pass UI was not claimed as
  browser-verified. The remaining online checks used the real Auth/REST/API/OTP
  and realtime SDK, not simulated responses or extracted browser tokens.
- `scripts/check-meeting-online.py` passed 23 live checks against the production
  URL: two anonymous sessions, private origins/RLS, server venue ranking, shared
  confirmation, two actual arrive-by journeys, a cross-session realtime update,
  unchanged agreement after a suggestion, and invalidated status after plan v2.
  The script removed only its own temporary room and anonymous identities.
  The separately created browser-QA room remains temporary and expires through
  the normal cleanup job; its browser sessions were not deleted underneath users.

## Acceptance traceability

“Fixture” means controlled regression evidence, not live multi-device acceptance.
“SQL live” means the real PostgreSQL behaviour was exercised inside a transaction
that was rolled back. “Online API” uses two actual anonymous sessions against the
production stack. Realtime delivery was verified using the real SDK; physical QR
scanning and all remaining browser interactions are not inferred from API tests.

| Criterion | Implementation / evidence | Current verification |
|---|---|---|
| 8-6.1.1 Confirmed place/time | `confirm_meeting_plan`, canonical venue and proposal validation | SQL live + local browser + online API |
| 8-6.1.2 Shared confirmation | `get_meeting_room_state`, room subscription | SQL live + online API/realtime SDK; UI version propagation pending |
| 8-6.1.3 Changed agreement | `plan_version`, coarse-status version comparison | SQL live + online API + UI fixture |
| 8-6.1.4 Unconfirmed planning | `RoomLobby`, null confirmed plan | SQL live + fixture |
| 8-6.2.1 Personal arrive-by journey | `usePersonalPass`, `routeArriveByJourneys` | Local authenticated browser + online arrive-by OTP for both origins |
| 8-6.2.2 Connection spare time | `passCheckService.connectionChecks` | Fixture |
| 8-6.2.3 Typical delay propagation | `checkedLegs`, `reliabilityClient` | Fixture; historical evidence disclosed |
| 8-6.2.4 Arrival/closing margins | `buildPass`, `evaluateClosingMargin` | Local browser + fixture, including missing/conditional hours |
| 8-6.2.5 Weather exposure | `weatherService`, period boundary splitting | Fixture; live pass forecast pending |
| 8-6.2.6 Named weak point | `weakPoint`, no overall score | Fixture |
| 8-6.2.7 Missing delay data | Explicit `not-checked` leg/status | Fixture |
| 8-6.3.1 Group invitation | `InvitationCard`, `get_meeting_invitation` | SQL live + local/production browser invitation and join |
| 8-6.3.2 Personal pass per member | Own origin from safe projection, `usePersonalPass` | Local second-member pass + online journeys for both origins; two-device UI pending |
| 8-6.3.3 Pass contents | `PersonalPassView`, `PrivateJourneyMap` | UI fixture + real local browser journey/map |
| 8-6.3.4 Estimated wording | `passPresentation`, renderer/export labels | Fixture |
| 8-6.3.5 Canonical format | Shared `PersonalPass` model/renderer | Fixture; group scope only |
| 8-6.3.6 Group privacy | RLS, safe member projection, server-only ranking | SQL live + online RLS/projection/realtime + frontend/backend privacy tests |
| 8-6.4.1 Download | Canvas PNG export of the current member's pass | Local browser download + inspected readable PNG; final rounding fix regression-checked |
| 8-6.4.2 Group QR | `createRoomQrData`, invitation restore/join flow | Payload fixture + SQL invitation; scanning pending |
| 8-6.4.3 My Passes | Identity-scoped local storage, `MyPassesPage` | Fixture + same-browser live reopen |
| 8-6.4.4 Recheck on reopening | `usePersonalPass`, fresh route/evidence requests | Lifecycle fixture + live reopen with new check timestamp |
| 8-6.4.5 QR privacy | Room-only opaque reference; no origin or member id | Payload fixture + SQL invitation |
| 8-6.5.1 Personal fix | Earlier target and alternative journey with group agreement preserved | Fixture; browser interaction pending |
| 8-6.5.2 Proposed meeting time | `propose_meeting_time`, separate confirmation | SQL live + online API/realtime + fixture |
| 8-6.5.3 Recheck after change | Request cancellation, version guards and origin invalidation | SQL live + lifecycle fixture |

## Bugs found and fixed

1. The confirmation RPC used a PL/pgSQL variable named `venue`, also a column in
   `meeting_plan_proposals`. PostgreSQL rejected the ambiguous expression on real
   execution. Renamed the variable to `resolved_venue`, reapplied the schema and
   verified first confirmation, repeat confirmation and changed-time versions.
2. Real OTP GeoTIFF responses encode the int32 no-data sentinel as
   `-2.147483648E9`. The decoder previously called `int()` on that string. It now
   accepts finite integral scientific notation and rejects fractional/out-of-range
   values. Added regression cases and verified actual surfaces.
3. Vite's config previously only read `process.env.DEV_API_TARGET`. `.env.local`
   does not automatically populate that object while evaluating the config.
   `loadEnv` now reads only server-side `DEV_` settings, so local meetings use the
   local FastAPI implementation instead of an older deployed API.
4. Two reused room components still claimed that everyone could see each origin
   and that confirmed rooms always expired 24 hours after creation. Updated the
   privacy/expiry copy and added five rendered-markup regression checks.
5. PNG walking time rounded differently from the live pass. Export now uses the
   same upward duration rounding and shared arrival-margin labels as the screen.

## Regression results

- Backend suite: 51 tests passed with database network access (including three
  new regression tests). A sandbox-only run could not resolve the Supabase host;
  its four database-dependent failures disappeared in the authorized network run.
- Outing-pass domain: 42 checks; meeting privacy/lifecycle: 22; pass UI: 9.
- Existing UI lifecycle: 44; desktop weather/map UI: 29.
- Production Auth/API/OTP/realtime: 23 live checks passed; test fixtures cleaned up.
- Frontend typecheck, Vite-config typecheck and production build passed.
- ESLint completed with zero errors and 17 existing warnings. The build retains
  existing large-chunk/dynamic-import warnings.
- `npm ci` installed the newly required QR dependencies. It also reported 29
  dependency advisories (21 high); no automatic force upgrade was applied. These
  require a separate dependency-security review, not a claim of a clean audit.

## Release checks still required

1. Finish the first member's local pass and both members' production-browser pass
   views. Local second-member UI and both online API journeys were verified, but
   this is not yet two physical devices completing every interaction.
2. Exercise a live pass with applicable bus-delay and supported weather evidence;
   the rail test correctly displayed unsupported/unknown evidence, not a false pass.
3. Change the agreement and origin in two browsers. Verify UI version propagation and a new
   check; a suggested time alone must not change the confirmed agreement.
4. Scan the PNG QR on the same and a new physical device; the new device must join
   and provide its own origin. Verify the personal “leave earlier” action in a browser.
5. Keep the remaining dependency advisories/build warnings in the separate review
   backlog. Deployment succeeded; that does not mean every acceptance criterion or
   security-advisory remediation is complete.
