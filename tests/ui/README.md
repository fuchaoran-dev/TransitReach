# Epic 7 UI checks

## Startup recovery

Open `/tests/ui/bootstrap-preview.html` for labelled loading, slow/retrying and
exhausted-504 states. Check readable contrast, keyboard focus on Retry connection,
and that Retry returns to Loading in the same page. No API or room is written by
this fixture. `node scripts/test-bootstrap.mjs` exercises automatic/manual recovery
with the actual gate/loader under virtual clocks. See [startup recovery](../../docs/bootstrap-recovery.md).

## Radar discovery animation

Open `/tests/ui/radar-preview.html` for the isolated six-category demo over the existing
OpenFreeMap basemap. The banner identifies every POI as synthetic; coordinates live only
in `radarDemoData.ts` and are never imported into production. Use Stop/Start scanner to
check cleanup, pan/zoom to check fixed geographic anchors, and inspect desktop and 390px
layouts. The production Meet scanner is still visible only while common-ground calculation
is loading. It uses existing PostgreSQL-backed services, rail/bus stops and consent-gated
room member points, without claiming these are reachable proposals.

One rAF clock rotates the beam clockwise every four seconds and scrubs paused Web
Animations using each anchor's `atan2` angle. Icons start hidden, pop/glow after crossing,
float, fade by 2.8 seconds and wait for the next crossing. There are no random discovery
timers or React updates in the scan loop. Map events update projected anchors and retain
the clock epoch. Reduced-motion mode uses a static sector and visible fixed markers.
Run `node scripts/test-radar-scan.mjs` for controlled crossing/wraparound, background
resume, rediscovery, cancellation, reduced-motion and map-projection regression checks.
Verified in Chrome at desktop and 390 × 844 on 15 October 2026: six demo categories,
different marker opacities matching beam phase, Stop/Start, and preserved map controls.
The viewport override was reset. Radar (39), voting (49), meeting polish (23) and meeting
experience (62) checks passed, as did typecheck and build. Lint has 18 existing warnings
and no errors. This does not constitute a live multi-device/database calculation test.

## Automatic meeting and PNG revision (local)

See [meeting experience](../../docs/meeting-experience.md) for the seven requested
changes, isolated SQL test, current test evidence and the un-applied migration.
The meeting fixture now has a Calculating mode for the radar and labelled synthetic
intersection polygons. Propose adds an amber marker/name label. The outing fixture's
Preview offline image uses the new production PNG renderer. No cloud room is written.

## Meeting feedback desktop preview

After starting local Vite/FastAPI with PostgreSQL configured, open
`/tests/ui/meeting-feedback-preview.html`. The banner explicitly marks synthetic
room/vote state; it writes no cloud rooms. Check the single labelled member marker,
Stop sharing → Not ready, search → unshared preview → Share → Ready, meeting-time
input and confirmed-card Generate my travel pass. Pass generation queries real
OTP for public stations and saves only a synthetic-identity local record.
See [meeting feedback](../../docs/meeting-feedback.md) for timing/coverage limits,
route-only semantics and actual verification. Do not use this fixture to claim
live two-member voting or real GPS consent was verified.

For layout-only review without PostgreSQL, open
`/tests/ui/meeting-polish-preview.html`. It labels all room, member, area, venue and
travel-time values as synthetic and performs no database, room, vote or route writes.
Use it to inspect marker clustering, selected-place emphasis, the shared-area toggle,
the collapsible member panel, room QR and the mobile bottom sheet.

## Service contrast checks

Open `/tests/ui/contrast-preview.html` with Vite. This labelled synthetic fixture
uses the production service pins, list and detail panel without database setup.
Toggle day/night maps, hover the journey button, select each marker and use Tab
to check focus visibility. Check that selected cards remain dark with readable
text, all category glyphs remain legible, and marker tooltips identify the place.
The fixture does not request journeys or modify room data.

Checked in desktop Chrome on 14 October 2026: day and night vector maps,
selected service/list/detail, marker tooltip and journey hover. The hovered
journey computed colours were `#214154` background and `#e5eff7` text.
Typecheck, production build, 29 map UI checks and 44 lifecycle checks passed;
lint completed with zero errors and 18 existing warnings.

## Epic 8 group pass checks

Open `/tests/ui/outing-preview.html` for explicitly labelled synthetic invitation,
personal-pass and coarse member-status views. Check desktop and 390px mobile
layouts, expand walking directions, request the earlier-arrival action and generate
the QR. Download an image and verify its route, weak point and room QR remain
readable offline. This fixture does not write to the room service.

Automated checks: `npm run test:outing-pass`, `node scripts/test-meeting-privacy.mjs`
and `node scripts/test-outing-ui.mjs`. Live multi-device acceptance and service
prerequisites are described in [group-passes.md](../../docs/group-passes.md).

## Existing weather checks

Start Vite and open `/tests/ui/weather-preview.html`. This development-only page
is not part of the production build entry point. Sunny/rainy/storm/night are
explicitly labelled visual fixtures, not forecasts. This round targets desktop
only; the mobile fixture has been removed.

Manual acceptance checks:

1. Main map: the seven-day bar uses official MET Malaysia district forecasts
   through data.gov.my. Retrieval time is separate from unavailable issue time.
2. Selecting a day changes the departure date but preserves the clock time.
3. Select KLCC, 30 minutes, 20:00: the map switches to night styling and calculates
   a new scheduled GTFS/OSM reachable area.
4. Save that departure as baseline; select 09:00. The result shows the area
   difference only after the new request completes. Changing origin or budget
   clears the baseline.
5. Forecast failure must not prevent departure planning; Retry is available.
6. Fixture page: sunlight in sunny mode, rain without pointer interception,
   and night styling.
7. Select a service and View journey. Check native 3D transit/walking lines,
   boarding/alighting points, endpoints and selected-leg highlighting.
8. OS reduced-motion preference disables the rain animation.

Scope: scheduled accessibility and daily regional weather context. Weather is
not an hourly stop-level forecast and does not modify transit delays. Area
difference is not proof that one reachable polygon contains the other. No
claim is made about calibrated weather delays. Arrival availability uses source
opening-hour rules and modelled arrival; missing/unverifiable hours are Unknown.
The comparison now distinguishes shared/A-only/B-only polygons and category
counts; counts are geographical, not confirmed-open counts.

Automated checks: `npm run typecheck`, `npm run build`, `git diff --check`,
`node scripts/test-epic7.mjs` (35 arrival-hour and 3D-layer checks).
`node scripts/test-map-ui.mjs` adds 29 desktop weather/parser checks, including the compact details popover and source notes.
`node scripts/test-ui-state.mjs` adds 32 React lifecycle regression checks for stale requests, service selection, journey focus, 3D clearing, vector fallback and forecast refresh.
See [DESKTOP_UI_ACCEPTANCE.md](DESKTOP_UI_ACCEPTANCE.md) for the final layout scope
and native-browser observations.

Remaining dependency: Epic 7.4.3 retains origin/time/budget/destinations as an
outing draft. The actual multi-stop optimizer belongs to unfinished Epic 2;
the draft is explicitly NOT a calculated itinerary. No deployment this round.

## Observed local checks (2026-10-03)

- Live app: KLCC, 30 minutes, 20:00 returned 23.6 km²; changing to 09:00
  returned 20.5 km² and the saved-baseline comparison displayed -3.1 km².
- Night styling and real-forecast rain overlay were visually checked.
- Sunny styling was visually checked in the labelled fixture, not by changing
  the live forecast (all seven available days forecast rain).
- Current desktop check: Monash University Malaysia, October 4, 09:00,
  30 minutes returned 13.7 km², three regions and 515 services. Sunway Medical
  Centre opened in 3D; its 7-minute BRT journey showed real route geometry,
  two walking legs and 5-minute walking exposure. Missing hours showed Unknown.
- Earlier mobile observations are outside this round's acceptance scope.

## Travel pass layout and download preview

Open `/tests/ui/travel-pass-preview.html` with Vite for a fully isolated synthetic pass.
At desktop width, scroll the itinerary and confirm the route map stays visible. At 390px,
expand/collapse the bottom sheet, open walking directions and check both route endpoints
remain above the sheet. Preview PNG renders the production download layout, including
stop-code chips, transit stop counts, an arrival margin and the scannable room QR.
Save preview image downloads the labelled fixture's design sample, not a real journey.
The download uses the production Canvas renderer with layered navy panels, bevelled
teal borders, a recessed geometry grid, luminous route/timeline segments and an elevated
white QR tile. Cards have cyan-to-blue edge gradients that fade into their glass surfaces.
This styling is drawn into the PNG and does not depend on page CSS.
The fixed McDonald's / Bus 770 fixture departs at 2:59 pm, arrives at 3:07 pm and meets
at 3:08 pm. Its eight-minute journey contains six minutes walking and two minutes on
the bus; all fixture times and locations remain synthetic. Actual exports retain the
saved pass's times, line colours and recorded geometry. Export now fetches public
OpenFreeMap vector tiles for building footprints/heights and quiet streets, using a
pitched camera shared by the route projection. No room code, itinerary or QR payload
is sent to the tile server. Attribution is included inside the downloaded image.
Building detail depends on source coverage and route extent. The map gets ten seconds;
offline, failed or timed-out maps are labelled `3D map unavailable · schematic only`
and retain the original recorded-geometry schematic. Zero travel skips map requests.
The fixture neither joins a room nor queries OTP; changing the selected option is only a
presentation test. Regression checks: `node scripts/test-travel-pass-presentation.mjs`
and `node scripts/test-meeting-experience.mjs`. Implementation and API compatibility:
[meeting UI polish](../../docs/meeting-ui-polish.md).

3D PNG verification (15 October 2026): reviewed the actual 1200 × 2173 download in
Chrome, including the transit card, stop labels and footer. Apple Vision decoded its
QR back to the expected local invitation URL for synthetic room ABCDEFGH. Typecheck,
production build, the 62 canvas/meeting experience checks, 42 pass domain checks and
36 presentation checks passed. Lint had zero errors and 18 existing warnings.
