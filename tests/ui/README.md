# Epic 7 UI checks

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
