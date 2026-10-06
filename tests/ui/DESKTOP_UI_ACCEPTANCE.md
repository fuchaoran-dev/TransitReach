# Desktop map UI acceptance — 2026-10-03

Scope: existing desktop Map/Services/Journey UI and Epic 7 weather/time controls.
No mobile work, Epic 2 optimizer, Epic 8 implementation, Git push or production
deployment is included.

Implemented:

- Automatic starting-point summary, explicit Edit control, readable MYT date.
- Compact, period-specific seven-day icons with detailed forecast tooltips.
- One task panel with preserved content when hidden; no nested service-list scroll.
- Service list/detail switch; Back retains selection, × clears selection.
- Place details/provenance collapsed, Unknown states remain explicit.
- Compact service rows with keyboard Enter/Space activation.
- Origin and service use distinct native 3D points and labels.
- Return-to-origin toolbar; route legend and departure comparison collapsed.
- Weather decoration has no solar/lunar discs or yellow lightning SVG.
- Vector map uses public MapLibre/Leaflet APIs, not renderer-private bridge fields.
- Region/theme updates reuse the map; service focus changes no longer recreate 3D.
- New origin clears obsolete service selection; date changes retain its location
  without carrying over the old departure's estimates.

Checks:

```
npm run typecheck
npm run build
npm run lint
node scripts/test-epic7.mjs
node scripts/test-map-ui.mjs
node scripts/test-ui-state.mjs
git diff --check
```

The 40 routing-layer/arrival tests, 29 weather-render/parser tests and 32 lifecycle tests use synthetic
fixtures. Lint has warnings about existing effect dependencies and mixed
component/helper exports; no lint errors remain.

Observed native Chrome checks at http://127.0.0.1:5180/:

- Simplified vector basemap restored instead of the raster fallback.
- Monash University Malaysia selection auto-collapses to its date/budget summary.
- 30-minute scheduled result: 13.7 km², 515 services; hospital category has 3.
- Selecting Sunway Medical Centre opens compact details and native 3D.
- Back to service list retains Sunway selection; hide/show retains filters.
- A selected 7-minute BRT journey displayed its walking/transit path in native 3D.
- Clearing the service removed its destination and journey geometry while keeping
  Monash as the origin and preserving the October 3, 09:00, 30-minute settings.
- Switching to October 6 updated the summary and calculation without resetting
  the native 3D camera during the request.

These are point-in-time live checks. Provider availability and all device/GPU
configurations cannot be guaranteed. New production deployment is a separate step.
